#!/usr/bin/env bash
# Verify that compositor Chromium can see the NVIDIA GPU.
# Run on the compositor EC2 box from the repo root:
#   ./scripts/verify-compositor-gpu.sh
#
# Best during a warmed or live studio session — idle Chromium often shows 0%
# even when the GPU is correctly attached.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
COMPOSE=(docker compose -f "$ROOT/compose.yml" --env-file "$ENV_FILE" --profile compositor)
COMPOSE_GPU=(docker compose -f "$ROOT/compose.yml" -f "$ROOT/compose.gpu.yml" \
  --env-file "$ENV_FILE" --profile compositor)

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo "  PASS  $*"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL  $*"; }
warn() { WARN=$((WARN + 1)); echo "  WARN  $*"; }
note() { echo "        $*"; }

section() {
  echo
  echo "==> $*"
}

have_compose_gpu=0
if [[ -f "$ROOT/compose.gpu.yml" ]]; then
  have_compose_gpu=1
fi

echo "Compositor GPU check  $(date -u +%Y-%m-%dT%H:%M:%SZ)  host=$(hostname)"
echo "repo=$ROOT"

section "1. Host GPU"
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  pass "nvidia-smi sees a GPU"
  nvidia-smi -L | sed 's/^/        /'
else
  fail "nvidia-smi missing or no GPU (install the NVIDIA driver on this box)"
fi

section "2. nvidia-container-toolkit"
if [[ -e /usr/bin/nvidia-container-runtime ]] || command -v nvidia-container-cli >/dev/null 2>&1; then
  pass "nvidia-container-toolkit is installed"
  command -v nvidia-container-cli >/dev/null 2>&1 && nvidia-container-cli --version 2>/dev/null | head -1 | sed 's/^/        /' || true
else
  fail "toolkit missing — Docker cannot pass the GPU into Chromium"
  note "https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
  note "then: sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
fi
if docker info 2>/dev/null | grep -qi nvidia; then
  pass "Docker advertises an nvidia runtime"
  docker info 2>/dev/null | grep -iE 'Runtimes|nvidia' | sed 's/^/        /'
else
  warn "Docker info does not mention nvidia (newer toolkit may still work via CDI)"
fi

section "3. Compositor container"
if [[ ! -f "$ENV_FILE" ]]; then
  fail "missing $ENV_FILE"
else
  pass "env file $ENV_FILE"
fi
if [[ "$have_compose_gpu" -eq 1 ]]; then
  pass "compose.gpu.yml is in the repo (deploy.sh compositor should load it)"
else
  warn "compose.gpu.yml not in this checkout — GPU passthrough overlay is missing"
fi

CID="$("${COMPOSE[@]}" ps -q compositor 2>/dev/null || true)"
if [[ -z "${CID:-}" ]]; then
  fail "compositor container is not running"
  note "start it: ./scripts/deploy.sh compositor"
  echo
  echo "Summary:  $PASS pass / $FAIL fail / $WARN warn"
  echo "Cannot check inside a container that is not running."
  exit 1
fi
pass "compositor cid=${CID:0:12}"
"${COMPOSE[@]}" ps compositor | sed 's/^/        /' || true

section "4. GPU passed into the container?"
REQ="$(docker inspect "$CID" --format '{{json .HostConfig.DeviceRequests}}' 2>/dev/null || echo null)"
DEV="$(docker inspect "$CID" --format '{{json .HostConfig.Devices}}' 2>/dev/null || echo null)"
echo "        DeviceRequests=$REQ"
echo "        Devices=$DEV"
if echo "$REQ$DEV" | grep -qiE 'nvidia|gpu'; then
  pass "Docker attached an NVIDIA device to the compositor"
else
  fail "no NVIDIA device on this container (compose.gpu.yml was not applied at up)"
  note "typical cause: toolkit missing at deploy time, or stack started without the overlay"
  note "fix: install toolkit, then ./scripts/deploy.sh compositor"
fi

ENVS="$(docker inspect "$CID" --format '{{range .Config.Env}}{{println .}}{{end}}')"
echo "$ENVS" | grep -E '^(NVIDIA_|COMPOSITOR_GPU|LIBVA_|NVD_)' | sed 's/^/        /' || echo "        (no NVIDIA_* / COMPOSITOR_GPU env)"
CAPS="$(echo "$ENVS" | grep '^NVIDIA_DRIVER_CAPABILITIES=' || true)"
if echo "$CAPS" | grep -q 'graphics' && echo "$CAPS" | grep -q 'video'; then
  pass "NVIDIA_DRIVER_CAPABILITIES includes graphics+video"
elif [[ -n "$CAPS" ]]; then
  fail "NVIDIA_DRIVER_CAPABILITIES is '$CAPS' — need graphics,video (not just compute,utility)"
else
  fail "NVIDIA_DRIVER_CAPABILITIES unset (defaults to compute,utility — Chrome stays on SwiftShader)"
fi

section "5. Chromium GPU probe"
# One throwaway container, production launch flags, straight answer. This works
# even when the service container is down or restarting — which is exactly when
# the old `docker exec` checks reported phantom "no /dev/nvidia0" failures.
if [[ "$have_compose_gpu" -eq 1 ]]; then
  PROBE_OUT="$("${COMPOSE_GPU[@]}" run --rm -e COMPOSITOR_ANGLE="${COMPOSITOR_ANGLE:-}" \
    --entrypoint node compositor dist/browser/probe-local-gpu.js 2>&1 || true)"
  echo "$PROBE_OUT" \
    | grep -vE 'dbus|DBus|bus\.cc|object_proxy|Failed to call method|Container .* (Creating|Created)' \
    | sed 's/^/        /'
  if echo "$PROBE_OUT" | grep -q '^PASS'; then
    pass "Chromium composites on the GPU"
  elif echo "$PROBE_OUT" | grep -q '^SKIP'; then
    warn "probe skipped — GPU not requested in that container"
  else
    fail "Chromium is not compositing on the GPU (probe output above)"
    note "ANGLE gl-egl is the default; 'gl' means GLX and cannot work without an X display"
    note "override to experiment: COMPOSITOR_ANGLE=vulkan ./scripts/verify-compositor-gpu.sh"
  fi
else
  warn "compose.gpu.yml missing — cannot run the GPU probe"
fi

section "6. Chromium flags in the running pool"
CMDLINES="$("${COMPOSE[@]}" exec -T compositor sh -c '
  for f in /proc/[0-9]*/cmdline; do
    cmd=$(tr "\000" " " < "$f" 2>/dev/null) || continue
    exe=${cmd%% *}
    case "$exe" in
      */chromium|*/chromium-browser|*/chrome|*/google-chrome) echo "$cmd" ;;
    esac
  done
' 2>/dev/null | tr "\000" " " || true)"
if [[ -z "${CMDLINES// /}" ]]; then
  warn "no Chromium process (container down, restarting, or pool not warmed yet)"
  note "§5 above is the authoritative check and does not need a healthy container"
else
  echo "$CMDLINES" | fold -s -w 120 | sed 's/^/        /'
  if echo "$CMDLINES" | grep -q -- '--use-angle=gl-egl'; then
    pass "pool Chromium runs ANGLE gl-egl"
  elif echo "$CMDLINES" | grep -Eq -- '--use-angle=gl([[:space:]]|$)'; then
    fail "pool Chromium runs ANGLE gl (GLX) — needs an X display, will fall back to CPU"
  fi
  if echo "$CMDLINES" | grep -Eq '(^|[[:space:]])--disable-gpu([[:space:]]|$)'; then
    fail "Chromium args include --disable-gpu"
  fi
  if echo "$CMDLINES" | grep -q -- '--disable-vulkan-surface'; then
    fail "Chromium args include --disable-vulkan-surface (stale image)"
  fi
  if echo "$CMDLINES" | grep -q -- '--disable-gpu-compositing'; then
    fail "a Chromium process has --disable-gpu-compositing (software compositor)"
  fi
fi

section "7. Compositor logs (renderer)"
LOGS="$("${COMPOSE[@]}" logs --tail 400 compositor 2>/dev/null || true)"
echo "$LOGS" | grep -iE 'gpu|renderer|swiftshader|angle|vulkan|chrome://gpu' | tail -40 | sed 's/^/        /' || true
# Our own error text says "Refusing CPU/SwiftShader" — do not match on it.
if echo "$LOGS" | grep -iv 'Refusing CPU/SwiftShader' | grep -qi swiftshader; then
  fail "logs say SwiftShader — Chromium is compositing on CPU"
elif echo "$LOGS" | grep -qiE 'GPU renderer:.*NVIDIA|renderer=.*NVIDIA'; then
  pass "logs report an NVIDIA renderer"
elif echo "$LOGS" | grep -qi 'GPU renderer:'; then
  warn "logs have a GPU renderer line but it is not NVIDIA"
  echo "$LOGS" | grep -i 'GPU renderer:' | tail -5 | sed 's/^/        /'
else
  warn "no GPU renderer line in recent logs (this image may predate the probe)"
fi

section "8. /internal/health"
HEALTH="$("${COMPOSE[@]}" exec -T compositor node -e '
fetch("http://127.0.0.1:3002/internal/health", {
  headers: { "x-internal-secret": process.env.COMPOSITOR_INTERNAL_SECRET ?? "" },
}).then(async (r) => {
  const t = await r.text();
  if (!r.ok) throw new Error("HTTP " + r.status + " " + t);
  console.log(t);
}).catch((e) => { console.error(String(e)); process.exit(1); });
' 2>/dev/null || true)"
if [[ -n "$HEALTH" ]]; then
  echo "$HEALTH" | sed 's/^/        /'
  if echo "$HEALTH" | grep -qi swiftshader; then
    fail "health.gpu.renderer is SwiftShader"
  elif echo "$HEALTH" | grep -qi nvidia; then
    pass "health reports NVIDIA"
  elif echo "$HEALTH" | grep -q '"gpu"'; then
    warn "health has gpu but renderer is not NVIDIA"
  else
    warn "health has no gpu field (old image)"
  fi
  if echo "$HEALTH" | grep -q '"compositing":"disabled_software"'; then
    fail "health.gpu.compositing is disabled_software"
  elif echo "$HEALTH" | grep -q '"compositing":"enabled'; then
    pass "health.gpu.compositing is enabled"
  elif echo "$HEALTH" | grep -q '"compositing"'; then
    warn "health.gpu.compositing is not enabled"
  else
    warn "health has no gpu.compositing (old image)"
  fi
  if echo "$HEALTH" | grep -q '"encode":"nvenc"'; then
    pass "health.gpu.encode is nvenc"
  elif echo "$HEALTH" | grep -q '"encode":"mediarecorder"'; then
    warn "health.gpu.encode is mediarecorder (NVENC ffmpeg missing, or COMPOSITOR_NVENC=0)"
  fi
else
  warn "could not read /internal/health"
fi

section "9. nvidia-smi right now"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,utilization.gpu,utilization.encoder,utilization.decoder,memory.used --format=csv | sed 's/^/        /'
  echo "        --- pmon ---"
  nvidia-smi pmon -c 1 2>/dev/null | sed 's/^/        /' || true
  if nvidia-smi pmon -c 1 2>/dev/null | grep -qiE 'chrome|chrom'; then
    pass "nvidia-smi lists a Chromium process (GPU is in use)"
  else
    warn "no Chromium in nvidia-smi process list"
    note "if a session is live and this is empty, Chrome is not on the GPU"
    note "if nobody is in studio, 0% / empty process list is expected"
  fi
  ENC="$(nvidia-smi --query-gpu=utilization.encoder --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ' || true)"
  if [[ -n "$ENC" && "$ENC" != "0" && "$ENC" != "[N/A]" ]]; then
    pass "nvidia-smi encoder utilization is ${ENC}%"
  else
    note "encoder % is 0 unless a session is live on the NVENC path (health.gpu.encode=nvenc)"
  fi
fi

echo
echo "Summary:  $PASS pass / $FAIL fail / $WARN warn"
if [[ "$FAIL" -gt 0 ]]; then
  echo "Chromium is NOT using the NVIDIA GPU. nvidia-smi staying at 0% is expected until the FAILs above are fixed."
  exit 1
fi
echo "Plumbing looks OK. Confirm renderer is NVIDIA in §7/§8, and during a live session §9 should list chromium."
exit 0
