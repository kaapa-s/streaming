#!/usr/bin/env bash
# Prove Chromium GPU compositing locally (Apple GPU on macOS, or Linux GPU).
# Does not prove Tesla NVENC. Run from the repo root:
#   ./scripts/verify-compositor-gpu-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/compositor"

if [[ ! -d node_modules/puppeteer ]]; then
  echo "missing compositor/node_modules — run: npm install --prefix compositor && npx puppeteer browsers install chrome" >&2
  exit 1
fi

export COMPOSITOR_GPU="${COMPOSITOR_GPU:-1}"
# Cursor/CI may inject a sandbox Puppeteer cache that does not contain Chrome.
if [[ -n "${PUPPETEER_CACHE_DIR:-}" && ! -d "${PUPPETEER_CACHE_DIR}/chrome" ]]; then
  unset PUPPETEER_CACHE_DIR
fi
echo "Local compositor GPU probe  COMPOSITOR_GPU=$COMPOSITOR_GPU  platform=$(uname -s)"
exec npx ts-node --transpile-only src/browser/probe-local-gpu.ts
