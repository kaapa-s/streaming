#!/bin/sh
(
  while :; do
    sleep 43200
    /docker-entrypoint.d/40-selfsigned.sh 2>/dev/null || true
    nginx -s reload 2>/dev/null || true
  done
) &
