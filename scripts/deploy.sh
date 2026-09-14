#!/usr/bin/env bash
# One-command deploy/rebuild on an EC2 box: prune → build → swap.
# First time (no cert yet, interactive TTY): also runs issue-cert.sh.
# Usage:
#   ./scripts/deploy.sh api
#   ./scripts/deploy.sh sfu
#   ./scripts/deploy.sh compositor
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE=(docker compose -f compose.yml --env-file "$ENV_FILE")

usage() {
  echo "usage: $0 api|sfu|compositor" >&2
  exit 1
}

case "$TARGET" in
  api|sfu|compositor) ;;
  *) usage ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — run: cp .env.example .env  and fill secrets/domains" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# When NVIDIA is present, pass the GPU into Chromium (compose.gpu.yml).
enable_compositor_gpu_if_available() {
  local want=0
  if [[ "${COMPOSITOR_GPU:-}" == "1" ]]; then
    want=1
  elif command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    want=1
  fi
  if [[ "$want" -ne 1 ]]; then
    echo "==> no NVIDIA GPU detected — Chromium will use CPU (SwiftShader)"
    return 0
  fi
  if [[ ! -e /usr/bin/nvidia-container-runtime ]] && ! command -v nvidia-container-cli >/dev/null 2>&1; then
    echo "==> NVIDIA GPU found but nvidia-container-toolkit is missing" >&2
    echo "    Chromium cannot see the GPU until you install it:" >&2
    echo "    https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html" >&2
    echo "    Continuing without GPU passthrough (nvidia-smi will stay at 0%)." >&2
    return 0
  fi
  echo "==> NVIDIA GPU detected — enabling compositor GPU passthrough (compose.gpu.yml)"
  COMPOSE+=(-f "$ROOT/compose.gpu.yml")
}

require_vars() {
  local missing=0
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      echo "missing required var in $ENV_FILE: $v" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

cert_exists_in_volume() {
  local service="$1"
  local domain="$2"
  local profile_args=("${@:3}")
  # One-off container sharing the letsencrypt volume; ignore if volume empty / service never run.
  "${COMPOSE[@]}" "${profile_args[@]}" run --rm --entrypoint sh "$service" -c \
    "test -f /etc/letsencrypt/live/${domain}/fullchain.pem && test -f /etc/letsencrypt/live/${domain}/privkey.pem" \
    >/dev/null 2>&1
}

# Reclaim build cache / unused images while the live stack keeps running.
# Intentionally omits `docker system prune --volumes` so named volumes
# (letsencrypt, recordings, pg_data) survive across redeploys.
reclaim_disk() {
  echo "==> pruning Docker build cache and unused images"
  docker builder prune -af || true
  docker system prune -af || true
  docker system df || true
}

# Prefer POST /internal/recordings/purge-local (skips in-use files). If this image
# predates that route, unlink top-level *.webm with Node instead.
purge_webm_js() {
  cat <<'EOF'
const fs = require("fs");
const dir = "/app/compositor/recordings";
function unlinkWebms() {
  let n = 0, bytes = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".webm")) continue;
    const p = dir + "/" + name;
    const st = fs.statSync(p);
    if (!st.isFile()) continue;
    bytes += st.size;
    fs.unlinkSync(p);
    console.log("removed " + name);
    n++;
  }
  console.log("deleted " + n + " .webm files (" + Math.round(bytes / 1e6) + " MB)");
}
fetch("http://127.0.0.1:3002/internal/recordings/purge-local", {
  method: "POST",
  headers: { "x-internal-secret": process.env.COMPOSITOR_INTERNAL_SECRET ?? "" },
}).then(async (r) => {
  if (r.ok) { console.log(await r.text()); return; }
  console.log("purge API HTTP " + r.status + " - deleting .webm with Node");
  unlinkWebms();
}).catch((err) => {
  console.log("purge API unreachable - deleting .webm with Node (" + err + ")");
  unlinkWebms();
});
EOF
}

purge_local_recordings() {
  echo "==> removing leftover local .webm recordings"
  if "${COMPOSE[@]}" --profile compositor exec -T compositor true >/dev/null 2>&1; then
    purge_webm_js | "${COMPOSE[@]}" --profile compositor exec -T compositor node || true
    return 0
  fi
  echo "==> compositor not running - deleting .webm from recordings volume"
  purge_webm_js | "${COMPOSE[@]}" --profile compositor run --rm --no-deps --entrypoint node compositor || true
}

# Build new images while the old stack is still up, then recreate containers
# from those images (short outage), then prune the previous image generation.
# Args: optional compose profile flags, then service names (empty = default project).
build_and_swap() {
  local profile_args=()
  local services=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile)
        profile_args+=("$1" "$2")
        shift 2
        ;;
      *)
        services+=("$@")
        break
        ;;
    esac
  done

  echo "==> building images"
  "${COMPOSE[@]}" "${profile_args[@]}" build "${services[@]}"

  echo "==> swapping containers"
  "${COMPOSE[@]}" "${profile_args[@]}" up -d --no-build "${services[@]}"

  echo "==> pruning previous image generation"
  docker system prune -af || true
  docker system df || true
}

echo "==> git pull"
git pull

case "$TARGET" in
  api)
    require_vars POSTGRES_PASSWORD JWT_SECRET SIGNUP_PASSWORD SFU_JOIN_SECRET SERVER_NAME CERTBOT_EMAIL SFU_PUBLIC_WS_URL COMPOSITOR_URL COMPOSITOR_INTERNAL_SECRET
    DOMAIN="$SERVER_NAME"
    CERT_SERVICE=certbot
    PROFILE_ARGS=(--profile tools)

    if ! cert_exists_in_volume "$CERT_SERVICE" "$DOMAIN" "${PROFILE_ARGS[@]}"; then
      if [[ -t 0 ]]; then
        echo "==> no cert for ${DOMAIN} — running issue-cert (DNS-01)"
        ./scripts/issue-cert.sh web "$ENV_FILE"
      else
        echo "no cert for ${DOMAIN} and no TTY — run: ./scripts/issue-cert.sh web" >&2
        exit 1
      fi
    else
      echo "==> cert for ${DOMAIN} already present"
    fi

    reclaim_disk
    echo "==> deploy (API box)"
    build_and_swap
    echo "Done — https://${DOMAIN}"
    ;;
  sfu)
    require_vars SFU_JOIN_SECRET MEDIASOUP_ANNOUNCED_IP SFU_SERVER_NAME CERTBOT_EMAIL
    DOMAIN="$SFU_SERVER_NAME"
    CERT_SERVICE=sfu-certbot
    PROFILE_ARGS=(--profile tools)

    if ! cert_exists_in_volume "$CERT_SERVICE" "$DOMAIN" "${PROFILE_ARGS[@]}"; then
      if [[ -t 0 ]]; then
        echo "==> no cert for ${DOMAIN} — running issue-cert (DNS-01)"
        ./scripts/issue-cert.sh sfu "$ENV_FILE"
      else
        echo "no cert for ${DOMAIN} and no TTY — run: ./scripts/issue-cert.sh sfu" >&2
        exit 1
      fi
    else
      echo "==> cert for ${DOMAIN} already present"
    fi

    reclaim_disk
    echo "==> deploy (SFU box)"
    build_and_swap --profile sfu sfu sfu-nginx
    echo "Done — wss://${DOMAIN}/ws/signaling"
    ;;
  compositor)
    require_vars COMPOSITOR_SERVER_NAME COMPOSITOR_INTERNAL_SECRET SFU_PUBLIC_WS_URL CERTBOT_EMAIL
    DOMAIN="$COMPOSITOR_SERVER_NAME"
    CERT_SERVICE=compositor-certbot
    PROFILE_ARGS=(--profile tools)
    enable_compositor_gpu_if_available

    if ! cert_exists_in_volume "$CERT_SERVICE" "$DOMAIN" "${PROFILE_ARGS[@]}"; then
      if [[ -t 0 ]]; then
        echo "==> no cert for ${DOMAIN} — running issue-cert (DNS-01)"
        ./scripts/issue-cert.sh compositor "$ENV_FILE"
      else
        echo "no cert for ${DOMAIN} and no TTY — run: ./scripts/issue-cert.sh compositor" >&2
        exit 1
      fi
    else
      echo "==> cert for ${DOMAIN} already present"
    fi

    reclaim_disk
    purge_local_recordings

    avail_kb="$(df -Pk "$ROOT" | awk 'NR==2 { print $4 }')"
    df -h "$ROOT" || true
    # 3GB is unreachable on an 8GB box while the live Chromium image (~2GB) stays in
    # use. Rebuilds reuse that layer; 1GB free is enough to fail only when the disk
    # is actually packed.
    if [[ -n "$avail_kb" && "$avail_kb" -lt 1000000 ]]; then
      echo "only ${avail_kb}KB free after prune — expand the EBS volume or delete leftover recordings" >&2
      exit 1
    fi

    echo "==> deploy (compositor box)"
    build_and_swap --profile compositor compositor compositor-nginx monitor
    echo "Done — https://${DOMAIN}"
    ;;
esac
