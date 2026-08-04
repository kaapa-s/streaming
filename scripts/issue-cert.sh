#!/usr/bin/env bash
# Issue a Let's Encrypt cert (manual DNS-01) and reload the matching nginx service.
# Certbot prints the _acme-challenge TXT value, waits for you to create it, then continues.
# Usage:
#   ./scripts/issue-cert.sh web [env-file]   # API box — SERVER_NAME (default .env.prod)
#   ./scripts/issue-cert.sh sfu [env-file]   # SFU box — SFU_SERVER_NAME (default .env.prod)
# Examples:
#   ./scripts/issue-cert.sh sfu sfu/.env
#   ENV_FILE=sfu/.env ./scripts/issue-cert.sh sfu
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"
ENV_FILE="${2:-${ENV_FILE:-.env.prod}}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — pass the path: $0 $TARGET /path/to/env" >&2
  exit 1
fi

if [[ ! -t 0 ]]; then
  echo "this script needs an interactive terminal (certbot waits for you to create the TXT record)" >&2
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
    echo "usage: $0 web|sfu [env-file]" >&2
    exit 1
    ;;
esac

echo "Issuing cert for ${DOMAIN} (${TARGET}) via manual DNS using ${ENV_FILE}…"
echo "When prompted: create the TXT record in DigitalOcean DNS, wait for it to resolve, then press Enter."
# -it so certbot can print the challenge and wait for Enter after you add the TXT.
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" run --rm -it --entrypoint certbot "$SERVICE" \
  certonly --manual --preferred-challenges dns \
  --manual-public-ip-logging-ok \
  -d "$DOMAIN" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos

echo "Linking certs + reloading ${RELOAD}…"
# Pass DOMAIN explicitly — the container may still have a stale SERVER_NAME from an older compose up.
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" exec -T -e SERVER_NAME="$DOMAIN" "$RELOAD" \
  /docker-entrypoint.d/40-selfsigned.sh
"${COMPOSE[@]}" "${PROFILE_ARGS[@]}" exec -T "$RELOAD" nginx -s reload
echo "Done — https://${DOMAIN}"
echo "If nginx still serves the wrong Host/cert, recreate the edge so SERVER_NAME is refreshed:"
echo "  ${COMPOSE[*]} ${PROFILE_ARGS[*]} up -d ${RELOAD}"
