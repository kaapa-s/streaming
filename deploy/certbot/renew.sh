#!/bin/sh
# Renew Let's Encrypt certs and HUP the nginx compose service so it reloads them.
set -e

: "${SERVER_NAME:?SERVER_NAME is required}"
: "${RELOAD_SERVICE:?RELOAD_SERVICE is required (web or sfu-nginx)}"

trap 'exit 0' TERM

echo "certbot renew loop for ${SERVER_NAME} (reload ${RELOAD_SERVICE})"

while :; do
  certbot renew --webroot -w /var/www/certbot --deploy-hook /reload-hook.sh || true
  sleep 12h &
  wait $!
done
