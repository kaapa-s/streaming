#!/usr/bin/env bash
# Optional: sample docker stats on the host into ./diagnostics/host-stats.log
# Prefer the compose `monitor` service (always on). Use this only if monitor is disabled.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/diagnostics/host-stats.log}"
mkdir -p "$(dirname "$OUT")"
INTERVAL="${INTERVAL:-15}"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) host-monitor started interval=${INTERVAL}s" | tee -a "$OUT"
while true; do
  {
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}' 2>/dev/null || true
  } >>"$OUT"
  sleep "$INTERVAL"
done
