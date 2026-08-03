#!/bin/sh
set -e

if [ -z "${SERVER_NAME}" ]; then
  echo "SERVER_NAME is required (SFU sslip hostname, e.g. 203-0-113-42.sslip.io)" >&2
  exit 1
fi

mkdir -p /etc/nginx/ssl
live="/etc/letsencrypt/live/${SERVER_NAME}"
renewal="/etc/letsencrypt/renewal/${SERVER_NAME}.conf"

if [ -f "${renewal}" ] && [ -f "${live}/fullchain.pem" ] && [ -f "${live}/privkey.pem" ]; then
  ln -sfn "${live}/fullchain.pem" /etc/nginx/ssl/fullchain.pem
  ln -sfn "${live}/privkey.pem" /etc/nginx/ssl/privkey.pem
  echo "Using Let's Encrypt cert for ${SERVER_NAME}"
  exit 0
fi

if [ ! -f /etc/nginx/ssl/fullchain.pem ] || [ ! -f /etc/nginx/ssl/privkey.pem ] \
  || [ -L /etc/nginx/ssl/fullchain.pem ]; then
  echo "No Let's Encrypt cert for ${SERVER_NAME} — generating temporary self-signed cert"
  rm -f /etc/nginx/ssl/fullchain.pem /etc/nginx/ssl/privkey.pem
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/nginx/ssl/privkey.pem \
    -out /etc/nginx/ssl/fullchain.pem \
    -subj "/CN=${SERVER_NAME}"
fi
