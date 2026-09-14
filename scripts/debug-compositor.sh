#!/usr/bin/env bash
# Narrow down a compositor 502/503 from outside the boxes.
#
# `POST /api/recordings/stop` returning 503 with an nginx 502 HTML body means the
# API reached compositor-nginx but compositor-nginx could not reach the compositor
# container (CompositorClient wraps any non-400/404 upstream status as 503).
# This walks the chain layer by layer so you know which box to SSH into.
#
# Usage: ./scripts/debug-compositor.sh [--secret=...]
# Reads COMPOSITOR_URL + COMPOSITOR_INTERNAL_SECRET from .env when present.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

for arg in "$@"; do
  case "$arg" in
    --secret=*) COMPOSITOR_INTERNAL_SECRET="${arg#*=}" ;;
    --api=*) API_URL="${arg#*=}" ;;
  esac
done

API_URL="${API_URL:-https://streaming.kaapa.pl}"
COMPOSITOR_URL="${COMPOSITOR_URL:-https://compositor.kaapa.pl}"
SECRET="${COMPOSITOR_INTERNAL_SECRET:-}"

hr() { printf '\n─── %s\n' "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || echo "000"; }

hr "1. API box — is Nest up? ($API_URL)"
API_CODE="$(code "$API_URL/api/recordings")"
case "$API_CODE" in
  401|200) echo "   OK ($API_CODE) — the API process is alive and routing." ;;
  000)     echo "   UNREACHABLE — DNS/TLS/security-group problem, or the API box is down." ;;
  502|503) echo "   $API_CODE — nginx on the API box has no upstream; the server container is down." ;;
  *)       echo "   $API_CODE — unexpected; check the web (nginx) container on the API box." ;;
esac

hr "2. compositor-nginx — is the proxy up? ($COMPOSITOR_URL/)"
# `location /` returns 204 unconditionally, with no auth. 204 proves nginx is
# serving and TLS is valid, independent of the compositor container.
NGINX_CODE="$(code "$COMPOSITOR_URL/")"
case "$NGINX_CODE" in
  204) echo "   OK (204) — compositor-nginx is up. The box and cert are fine." ;;
  000) echo "   UNREACHABLE — the compositor box is down, DNS is wrong, or port 443 is blocked." ;;
  *)   echo "   $NGINX_CODE — nginx answered but not with the expected 204." ;;
esac

hr "3. compositor container — via the proxy ($COMPOSITOR_URL/internal/health)"
if [[ -z "$SECRET" ]]; then
  echo "   SKIPPED — no COMPOSITOR_INTERNAL_SECRET (set it in .env or pass --secret=...)"
else
  HEALTH_BODY="$(curl -s --max-time 15 -H "X-Internal-Secret: $SECRET" "$COMPOSITOR_URL/internal/health" 2>/dev/null)"
  HEALTH_CODE="$(code -H "X-Internal-Secret: $SECRET" "$COMPOSITOR_URL/internal/health")"
  echo "   HTTP $HEALTH_CODE"
  case "$HEALTH_CODE" in
    200)
      echo "$HEALTH_BODY" | (command -v jq >/dev/null && jq . || cat) | sed 's/^/   /'
      echo "   → The compositor is alive. If stop still 503s, the failure is per-request"
      echo "     (ffmpeg/upload), not the process. Check docker logs for the stack trace."
      ;;
    502|504)
      echo "   nginx is up but the compositor container is NOT accepting connections on :3002."
      echo "   → Almost certainly a boot crash-loop. BrowserPoolService.onModuleInit launches"
      echo "     the whole Chromium pool before Nest listens, so a GPU/Chromium launch failure"
      echo "     takes the process down and it never binds the port."
      ;;
    401)
      echo "   Reached the compositor, but the secret is wrong."
      echo "   → COMPOSITOR_INTERNAL_SECRET differs between the API box and the compositor box."
      ;;
    000) echo "   No response — see step 2." ;;
  esac
fi

hr "Next step — on the compositor box"
cat <<'EOF'
   # Is it crash-looping? Look at STATUS/RESTARTS, not just "is it listed".
   docker compose -f compose.yml --env-file .env --profile compositor ps

   # The boot failure itself. The GPU verdict is the prime suspect.
   docker compose -f compose.yml --env-file .env --profile compositor logs --tail=200 compositor

   Look for, in order:
     - "warming Chromium pool size=N gpu=..."  → boot reached the pool
     - no "Chromium pool ready" line after it  → it died during launch
     - a GPU assertion + "Set COMPOSITOR_GPU_STRICT=1 to fail the container instead"
       → non-strict: it degraded to CPU and should still be serving
     - the same assertion WITHOUT that sentence, then an exit
       → COMPOSITOR_GPU_STRICT=1 is killing the container. Unset it in .env and
         redeploy to get a running box you can actually inspect.
     - "Failed to launch the browser process" / SIGTRAP / shm errors
       → Chromium itself, not the GPU verdict.

   # Full bundle (session logs, host stats, nvidia-smi samples):
   ./scripts/collect-logs.sh
EOF
echo
