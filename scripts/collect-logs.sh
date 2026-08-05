#!/usr/bin/env bash
# Bundle session diagnostics + container logs for post-live analysis.
# Run on the compositor (or API) EC2 host from the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
COMPOSE=(docker compose -f "$ROOT/compose.yml" --env-file "$ENV_FILE")
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-$ROOT/diagnostics-$STAMP}"
mkdir -p "$OUT_DIR"

echo "==> writing bundle to $OUT_DIR"

echo "==> compose ps"
"${COMPOSE[@]}" --profile sfu --profile compositor ps >"$OUT_DIR/compose-ps.txt" 2>&1 || true

echo "==> docker stats (snapshot)"
docker stats --no-stream >"$OUT_DIR/docker-stats.txt" 2>&1 || true

echo "==> container logs (last 6h / 10k lines each)"
for svc in server web postgres monitor certbot sfu sfu-nginx sfu-certbot compositor compositor-nginx compositor-certbot; do
  "${COMPOSE[@]}" --profile sfu --profile compositor --profile tools logs --no-color --since 6h --tail 10000 "$svc" \
    >"$OUT_DIR/docker-$svc.log" 2>&1 || true
done

echo "==> session + host diagnostic files from recordings volume"
"${COMPOSE[@]}" --profile compositor exec -T compositor sh -c '
  mkdir -p /tmp/diag-export
  cp -a /app/compositor/recordings/*.session.log /tmp/diag-export/ 2>/dev/null || true
  cp -a /app/compositor/recordings/diagnostics /tmp/diag-export/ 2>/dev/null || true
  cd /tmp/diag-export && tar cf - .
' >"$OUT_DIR/recordings-diags.tar" 2>/dev/null || true

if [[ -s "$OUT_DIR/recordings-diags.tar" ]]; then
  mkdir -p "$OUT_DIR/recordings"
  tar xf "$OUT_DIR/recordings-diags.tar" -C "$OUT_DIR/recordings"
  rm -f "$OUT_DIR/recordings-diags.tar"
fi

{
  echo "# Streaming diagnostics bundle"
  echo "collected_at_utc: $STAMP"
  echo "host: $(hostname)"
  echo
  echo "## What to look for"
  echo "- *.session.log: codec/mode, ffmpeg speed=, loadavg, ingress kbps, backpressure"
  echo "- diagnostics/host-stats.log: docker CPU/RAM every 15s (t3 credit / OOM)"
  echo "- docker-compositor.log: Chromium pool / recording sink / ffmpeg"
  echo "- docker-server.log: nest API stdout"
  echo "- docker-sfu.log: mediasoup / signaling stdout"
  echo "- ffmpeg speed= < 1.0 or rising loadavg → undersized instance"
  echo "- codec=vp8/vp9 + libx264/medium → heavy re-encode path"
} >"$OUT_DIR/README.txt"

ARCHIVE="$OUT_DIR.tar.gz"
tar czf "$ARCHIVE" -C "$(dirname "$OUT_DIR")" "$(basename "$OUT_DIR")"
echo "==> done: $ARCHIVE"
echo "    session logs: $OUT_DIR/recordings/"
ls -la "$OUT_DIR/recordings" 2>/dev/null || true
