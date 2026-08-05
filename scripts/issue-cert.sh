#!/usr/bin/env bash
# Issue a Let's Encrypt cert (manual DNS-01) and reload the matching nginx service.
# Certbot prints the _acme-challenge TXT value, waits for you to create it, then continues.
# Usage:
#   ./scripts/issue-cert.sh web [env-file]         # API box — SERVER_NAME
#   ./scripts/issue-cert.sh sfu [env-file]         # SFU box — SFU_SERVER_NAME
#   ./scripts/issue-cert.sh compositor [env-file]  # compositor box — COMPOSITOR_SERVER_NAME
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"
ENV_FILE="${2:-${ENV_FILE:-.env}}"
COMPOSE=(docker compose -f compose.yml --env-file "$ENV_FILE")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — pass the path: $0 $TARGET /path/to/env" >&2
  echo "hint: cp .env.example .env" >&2
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
    PROFILE_ARGS=(--profile tools)
    ;;
  sfu)
    : "${SFU_SERVER_NAME:?set SFU_SERVER_NAME in $ENV_FILE}"
    DOMAIN="$SFU_SERVER_NAME"
    SERVICE=sfu-certbot
    RELOAD=sfu-nginx
    PROFILE_ARGS=(--profile tools --profile sfu)
    ;;
  compositor)
    : "${COMPOSITOR_SERVER_NAME:?set COMPOSITOR_SERVER_NAME in $ENV_FILE}"
    DOMAIN="$COMPOSITOR_SERVER_NAME"
    SERVICE=compositor-certbot
    RELOAD=compositor-nginx
    PROFILE_ARGS=(--profile tools --profile compositor)
    ;;
  *)
    echo "usage: $0 web|sfu|compositor [env-file]" >&2
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

echo "Reloading ${RELOAD} (if running)…"
if "${COMPOSE[@]}" "${PROFILE_ARGS[@]}" ps --status running --services 2>/dev/null | grep -qx "$RELOAD"; then
  "${COMPOSE[@]}" "${PROFILE_ARGS[@]}" exec -T "$RELOAD" nginx -s reload
else
  echo "${RELOAD} is not running yet — start the stack (./scripts/deploy.sh) so nginx picks up the cert."
fi
echo "Done — https://${DOMAIN}"
