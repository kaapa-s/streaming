#!/bin/sh
ids="$(docker ps -q -f "label=com.docker.compose.service=${RELOAD_SERVICE}" || true)"
if [ -n "$ids" ]; then
  echo "$ids" | while read -r id; do
    [ -n "$id" ] && docker kill -s HUP "$id"
  done
fi
