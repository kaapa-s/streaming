#!/usr/bin/env bash
# One-command deploy/rebuild on an EC2 box: git pull + compose up --build.
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

    echo "==> compose up (API box)"
    "${COMPOSE[@]}" up -d --build
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

    echo "==> compose up (SFU box)"
    "${COMPOSE[@]}" --profile sfu up -d --build sfu sfu-nginx
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

    # Chromium+ffmpeg image needs several GB free; leftover BuildKit layers from
    # failed builds are a common cause of "No space left" / host freezes.
    avail_kb="$(df -Pk "$ROOT" | awk 'NR==2 { print $4 }')"
    if [[ -n "$avail_kb" && "$avail_kb" -lt 4000000 ]]; then
      echo "==> low disk (${avail_kb}KB free) — pruning Docker build cache"
      docker builder prune -af || true
      docker system prune -af || true
      avail_kb="$(df -Pk "$ROOT" | awk 'NR==2 { print $4 }')"
      if [[ -n "$avail_kb" && "$avail_kb" -lt 3000000 ]]; then
        echo "still only ${avail_kb}KB free after prune — expand the EBS volume (≥20GB)" >&2
        exit 1
      fi
    fi

    echo "==> compose up (compositor box)"
    "${COMPOSE[@]}" --profile compositor up -d --build compositor compositor-nginx monitor
    echo "Done — https://${DOMAIN}"
    ;;
esac
