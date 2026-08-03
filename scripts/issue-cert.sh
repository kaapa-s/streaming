#!/usr/bin/env bash
# Issue a Let's Encrypt cert (webroot) and reload the matching nginx service.
# Usage:
#   ./scripts/issue-cert.sh web          # API box — SERVER_NAME
#   ./scripts/issue-cert.sh sfu          # SFU box — SFU_SERVER_NAME
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — copy .env.prod.example and fill in values" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${CERTBOT_EMAIL:?set CERTBOT_EMAIL in $ENV_FILE}"

case "$TARGET" in
  web)
    : "${SERVER_NAME:?set SERVER_NAME in $ENV_FILE}"
    DOMAIN="$SERVER_NAME"
    SERVICE=certbot
    RELOAD=web
    PROFILE_ARGS=()
    ;;
  sfu)
    : "${SFU_SERVER_NAME:?set SFU_SERVER_NAME in $ENV_FILE}"
    DOMAIN="$SFU_SERVER_NAME"
    SERVICE=sfu-certbot
    RELOAD=sfu-nginx
    PROFILE_ARGS=(--profile sfu)
    ;;
  *)
    echo "usage: $0 web|sfu" >&2
    exit 1
    ;;
esac

echo "Issuing cert for ${DOMAIN} (${TARGET})…"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" run --rm --entrypoint certbot "$SERVICE" \
  certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --non-interactive

echo "Linking certs + reloading ${RELOAD}…"
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" exec -T "$RELOAD" /docker-entrypoint.d/40-selfsigned.sh
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" exec -T "$RELOAD" nginx -s reload
echo "Done — https://${DOMAIN}"
