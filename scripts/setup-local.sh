#!/usr/bin/env bash
# One-command local bootstrap + start (API + SFU + compositor + web via npm run dev).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

need node
need npm
need docker

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node.js 22+ required (found $(node -v))" >&2
  exit 1
fi

echo "==> ensuring local env files"
if [[ ! -f server/.env ]]; then
  cp server/.env.example server/.env
  echo "    created server/.env"
fi
if [[ ! -f sfu/.env ]]; then
  cp sfu/.env.example sfu/.env
  echo "    created sfu/.env"
fi
if [[ ! -f compositor/.env ]]; then
  cp compositor/.env.example compositor/.env
  echo "    created compositor/.env"
fi

echo "==> starting Postgres (server/docker-compose.yml)"
docker compose -f server/docker-compose.yml up -d

echo "==> installing dependencies"
npm install
npm install --prefix shared/join-token
npm install --prefix shared/stream-quality
npm install --prefix shared/canvas-compositor
npm install --prefix shared/sfu-client
npm install --prefix server
npm install --prefix sfu
PUPPETEER_SKIP_DOWNLOAD=true npm install --prefix compositor
npm install --prefix compositor/page
npm install --prefix web

echo "==> waiting for Postgres"
for _ in $(seq 1 30); do
  if docker compose -f server/docker-compose.yml exec -T postgres pg_isready -U streaming >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> running migrations"
npm run migration:run --prefix server

echo "==> ensuring Puppeteer Chrome (compositor)"
(
  cd compositor
  npx puppeteer browsers install chrome
)

echo "==> starting API + SFU + compositor + web"
exec npm run dev
