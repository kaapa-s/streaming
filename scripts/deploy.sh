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
    require_vars POSTGRES_PASSWORD JWT_SECRET SFU_JOIN_SECRET SERVER_NAME CERTBOT_EMAIL SFU_PUBLIC_WS_URL COMPOSITOR_URL COMPOSITOR_INTERNAL_SECRET
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
    require_vars COMPOSITOR_SERVER_NAME COMPOSITOR_INTERNAL_SECRET COMPOSITOR_WEB_ORIGIN SFU_PUBLIC_WS_URL CERTBOT_EMAIL
    DOMAIN="$COMPOSITOR_SERVER_NAME"
    CERT_SERVICE=compositor-certbot
    PROFILE_ARGS=(--profile tools)

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

    avail_kb="$(df -Pk "$ROOT" | awk 'NR==2 { print $4 }')"
    if [[ -n "$avail_kb" && "$avail_kb" -lt 3000000 ]]; then
      echo "only ${avail_kb}KB free after prune — expand the EBS volume (≥20GB)" >&2
      exit 1
    fi

    echo "==> deploy (compositor box)"
    build_and_swap --profile compositor compositor compositor-nginx monitor
    echo "Done — https://${DOMAIN}"
    ;;
esac
