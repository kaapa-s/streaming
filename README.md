# Streaming Studio POC

A StreamYard-style proof of concept: speakers join a browser studio, media flows
through a mediasoup SFU, and a dedicated **compositor** service runs a warm
Chromium pool that joins the room as a hidden compositor, records the program
feed to `.webm`, optionally pushes live to one or more RTMP destinations
(YouTube, Facebook, LinkedIn, Instagram, X) via ffmpeg, and uploads finished
files to S3.

## Architecture

- `server/` — NestJS + Postgres/TypeORM auth, rooms API, recording orchestration, S3 presign, platform OAuth + YouTube live comments
- `compositor/` — warm Chromium pool, local `/compositor` recorder page, `/ws/recording` sink, ffmpeg → RTMP destinations, S3 PUT
- `sfu/` — mediasoup worker + `/ws/signaling` (join tokens only; no DB)
- `shared/join-token/` — HMAC issue/verify used by API and SFU
- `shared/canvas-compositor/` / `shared/sfu-client/` / `shared/stream-quality/` — browser + stream profile libs shared by studio and recorder
- `web/` — React (Vite) studio UI (+ `/compositor-dev` layout playground)

Auth: register/login (JWT + refresh tokens). Speakers get a short-lived join token
from `POST /api/rooms/:slug/join` before SFU signaling. Join also **warms** a
compositor tab (SFU subscribe + render, no MediaRecorder). Go live / Start
recording calls the compositor to start capture (+ optional RTMP).

Locally, Vite proxies `/ws/signaling` → SFU, `/api` → API, `/ws/recording` → compositor.
Headless Chromium loads the recorder from the compositor itself
(`http://127.0.0.1:3002/compositor/`) and writes chunks to loopback
`RECORDING_SINK_URL` (`ws://127.0.0.1:3002/ws/recording`).

## Run locally

### Prerequisites

- Node.js 22+
- Docker (for Postgres)
- macOS/Linux with build basics (mediasoup ships prebuilt workers for common platforms)
- `ffmpeg` on `PATH` (required only for live RTMP; needs RTMPS/OpenSSL for Facebook and Instagram) — e.g. `brew install ffmpeg`

### One command

```bash
npm run setup
```

This copies `server/.env` / `sfu/.env` / `compositor/.env` from examples if missing,
starts Postgres, installs dependencies, runs migrations, installs Puppeteer Chrome
for the compositor, then starts API (`:3000`), SFU (`:3001`), compositor (`:3002`),
and web (`:5173` HTTPS via mkcert).

After the first setup, day-to-day:

```bash
npm run dev
```

Or four terminals: `npm run dev:api`, `npm run dev:sfu`, `npm run dev:compositor`, `npm run dev:web`.

Ensure `SFU_JOIN_SECRET` matches in `server/.env` and `sfu/.env`, and
`COMPOSITOR_INTERNAL_SECRET` matches in `server/.env` and `compositor/.env`.

### Try it

1. Open https://localhost:5173, register an account, join room `main`.
2. Open a second browser/profile, register another user, join the same room.
3. Click **Start recording** — the warmed compositor starts MediaRecorder.
4. Talk/move for a bit, click **Stop recording**.
5. Play the file under `compositor/recordings/` (when S3 is configured, the local `.webm` is renamed `*.uploaded.webm` then deleted after a successful upload; use the S3 download URL instead).

### Go live

1. Connect destinations in **Settings** (OAuth identity). This pass does **not** create broadcasts via platform APIs.
2. Create a live stream in each platform’s own tool and copy the stream key / RTMP URL:
   - **YouTube** — YouTube Studio → Go live (bare key or full URL)
   - **Facebook** — Live Producer / Meta Business Suite (`rtmps://live-api-s.facebook.com:443/rtmp/<key>`)
   - **Instagram** — Instagram Live Producer (professional account). Not the Instagram mobile Live button.
   - **LinkedIn** — LinkedIn Live (account must already have Live access); paste the **full** RTMP URL including key
   - **X** — Media Studio / Live; paste the **full** RTMP URL including key
3. In studio, **Go live ▾**, select one or more destinations, paste keys (prefilled from Settings), click **Go live**. ffmpeg encodes once and fans out (tee); one dead destination does not stop the others.
4. Click **Stop live** when done.

Comments are **YouTube-only**. The chat panel appears only when YouTube is among the live destinations.

### YouTube live comments

Comments need a Google OAuth connection (stream key alone cannot read/post chat).
Going live auto-starts the comments panel against your active broadcast.

1. In [Google Cloud Console](https://console.cloud.google.com/), create an OAuth client (Web),
   enable **YouTube Data API v3**, and add redirect URI
   `http://localhost:3000/api/platforms/youtube/callback` (or your API URL + that path).
2. Set in `server/.env`:
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI` (must match the console redirect)
   - `TOKEN_ENCRYPTION_KEY` (passphrase or 64-char hex)
   - `WEB_ORIGIN=https://localhost:5173` (studio origin for post-OAuth redirect)
3. In Settings, click **Connect YouTube** and approve access.
4. Start the YouTube broadcast (same account), paste the RTMP key, click **Go live**.
   The comments panel auto-binds once YouTube reports the broadcast (this can take a
   short wait after RTMP starts). No live video URL is needed.
5. Reply from the panel; **On screen** pins a comment on the program preview and
   compositor (YouTube viewers see it for ~10s).

### Compositor playground (no stack required)

Open https://localhost:5173/compositor-dev while the Vite web app is running.
It feeds the compositor with synthetic canvas/oscillator peers so you can
iterate on layout without mediasoup or the Nest server.

- `?peers=4` — start with N fake speakers (default 2)
- `?audio=0` — skip oscillator tracks on new peers

### Local environment variables

**server** (`server/.env`)

- `PORT` — HTTP port (default `3000`)
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — access-token signing secret
- `SFU_JOIN_SECRET` — HMAC secret for SFU join tokens (must match SFU)
- `COMPOSITOR_URL` — compositor base URL (default `http://localhost:3002`)
- `COMPOSITOR_INTERNAL_SECRET` — shared secret for internal compositor API
- `WEB_ORIGIN` — studio origin for OAuth redirects (default `https://localhost:5173`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` — YouTube Live Chat OAuth
- `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` / `FACEBOOK_OAUTH_REDIRECT_URI` — Facebook Login (identity)
- `INSTAGRAM_OAUTH_REDIRECT_URI` — Instagram Login (identity; may reuse `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`)
- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_OAUTH_REDIRECT_URI` — LinkedIn OpenID
- `X_CLIENT_ID` / `X_CLIENT_SECRET` / `X_OAUTH_REDIRECT_URI` — X OAuth 2.0 + PKCE
- `TOKEN_ENCRYPTION_KEY` — encrypts stored platform OAuth tokens
- `SFU_PUBLIC_WS_URL` — optional direct signaling URL
- `AWS_REGION` / `S3_BUCKET` / `S3_PREFIX` — optional S3 upload; `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` only when not using an EC2 IAM role

**compositor** (`compositor/.env`)

- `PORT` — default `3002`
- `COMPOSITOR_INTERNAL_SECRET` — must match server
- `COMPOSITOR_POOL_SIZE` — warm Chromium browsers (default `1`)
- `COMPOSITOR_PAGE_ORIGIN` — must be loopback (`http://127.0.0.1:$PORT`). Chromium loads Nest's recorder page in the compositor container. A public studio URL (e.g. `https://streaming.kaapa.pl`) is ignored — that origin serves the SPA, which never defines `__startRecording`.
- `RECORDING_SINK_URL` — MediaRecorder WebSocket (local `ws://127.0.0.1:3002/ws/recording`)
- `SFU_PUBLIC_WS_URL` — SFU signaling for the headless page (local `ws://localhost:3001/ws/signaling`)
- `FFMPEG_PATH` — optional
- `COMPOSITOR_GPU` — `1` force GPU Chromium flags, `0` force CPU. Unset autodectects `/dev/nvidia0` or `/dev/dri`. Production Docker needs `compose.gpu.yml` so those devices exist.

**sfu** (`sfu/.env`)

- `PORT` — signaling HTTP/WS port (default `3001`)
- `SFU_JOIN_SECRET` — same secret as server
- `MEDIASOUP_LISTEN_IP` / `MEDIASOUP_ANNOUNCED_IP` — set for LAN/internet use
- `MEDIASOUP_RTC_MIN_PORT` / `MEDIASOUP_RTC_MAX_PORT` — WebRTC port range (default `40000–40100`)

## Deploy on EC2 (Docker Compose)

Three boxes:

| Box | Compose services | Domain | Deploy |
|-----|------------------|--------|--------|
| API | `postgres` + `server` + `web` | `streaming.kaapa.pl` | `./scripts/deploy.sh api` |
| SFU | `sfu` + `sfu-nginx` (`--profile sfu`) | `sfu.kaapa.pl` | `./scripts/deploy.sh sfu` |
| Compositor | `compositor` + `compositor-nginx` + `monitor` (`--profile compositor`) | `compositor.kaapa.pl` | `./scripts/deploy.sh compositor` |

TLS terminates **inside Compose**. Do not run host nginx on 80/443.

### Instance

- **AMI:** Ubuntu 24.04 LTS
- **Size:** API can be smaller; compositor wants a GPU instance (`g4dn.xlarge` / `g5.xlarge`) so Chromium can rasterize and decode on NVIDIA instead of SwiftShader. CPU-only (`c5` / `t3.medium`+) still works, slower.
- **Elastic IP:** attach; set `MEDIASOUP_ANNOUNCED_IP` to the **SFU** box EIP
- **DNS:** A records for `streaming` / `sfu` / `compositor` → respective EIPs

### Security group

| Port | Protocol | Purpose | Where |
|------|----------|---------|-------|
| 22 | tcp | SSH (restrict to your IP) | all |
| 80 | tcp | HTTP → HTTPS redirect | all |
| 443 | tcp | HTTPS / WSS | all |
| 40000-40100 | udp + tcp | WebRTC (mediasoup SFU) | SFU |

### First-time setup (once per box)

```bash
# Docker on Ubuntu 24.04 — install Docker Engine + Compose plugin, then:
sudo usermod -aG docker $USER   # log out / back in

git clone <repo> streaming && cd streaming
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD, JWT_SECRET, SFU_JOIN_SECRET, COMPOSITOR_INTERNAL_SECRET
#   CERTBOT_EMAIL
#   SERVER_NAME=streaming.kaapa.pl
#   SFU_SERVER_NAME=sfu.kaapa.pl
#   COMPOSITOR_SERVER_NAME=compositor.kaapa.pl
#   SFU_PUBLIC_WS_URL=wss://sfu.kaapa.pl/ws/signaling
#   COMPOSITOR_URL=https://compositor.kaapa.pl
#   MEDIASOUP_ANNOUNCED_IP=<sfu-eip>
#   Optional S3: AWS_REGION + S3_BUCKET (+ access keys locally; on EC2 prefer IAM role)
#   Optional destination OAuth (identity; stream keys still pasted):
#     GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI
#     FACEBOOK_APP_ID / FACEBOOK_APP_SECRET / FACEBOOK_OAUTH_REDIRECT_URI
#     INSTAGRAM_OAUTH_REDIRECT_URI (optional INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET)
#     LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET / LINKEDIN_OAUTH_REDIRECT_URI
#     X_CLIENT_ID / X_CLIENT_SECRET / X_OAUTH_REDIRECT_URI
#     WEB_ORIGIN / TOKEN_ENCRYPTION_KEY
# Same SFU_JOIN_SECRET and COMPOSITOR_INTERNAL_SECRET across boxes that need them.
```

### Compositor GPU (NVIDIA)

Headless Chromium in Docker uses SwiftShader (CPU) unless the GPU is passed into the container **with graphics + video capabilities** (CUDA-only passthrough still leaves `nvidia-smi` at 0% for Chrome).

On the compositor box (Ubuntu 24.04), after the NVIDIA driver is installed and `nvidia-smi` works:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Then `./scripts/deploy.sh compositor`. Logs should show `Chromium GPU renderer: NVIDIA …`, not SwiftShader.

### One-command deploy / rebuild

```bash
./scripts/deploy.sh api
./scripts/deploy.sh sfu
./scripts/deploy.sh compositor
```

Each run prunes unused Docker build cache/images (volumes kept), builds new images while the stack stays up, then recreates containers from those images and prunes the previous generation. Compositor deploy also sweeps leftover `*.webm` on the recordings volume (session logs and `diagnostics/` stay; a live or pending-upload file is skipped). After a successful S3 upload, the compositor already renamed the file `*.uploaded.webm` and deleted it, so this sweep mainly clears legacy files and any tagged leftovers if unlink failed.

On a compositor box with `nvidia-smi`, deploy also loads `compose.gpu.yml` (NVIDIA device + `graphics,video` driver caps). Without nvidia-container-toolkit, Chrome stays on SwiftShader and the GPU stays at 0%.

Share **https://streaming.kaapa.pl** with testers.

### TLS (manual DNS-01)

```bash
./scripts/issue-cert.sh web         # streaming.kaapa.pl
./scripts/issue-cert.sh sfu         # sfu.kaapa.pl
./scripts/issue-cert.sh compositor  # compositor.kaapa.pl
```

Routine `./scripts/deploy.sh` skips cert issue when the cert already exists in the volume.

### Verify

```bash
docker compose --env-file .env ps
docker compose --env-file .env --profile compositor ps
docker stats   # during a test recording

# Two browsers → register → join same room → Start recording → Stop recording
docker compose --env-file .env --profile compositor exec compositor ls /app/compositor/recordings
# After S3 upload the .webm is gone; *.session.log remains
```

### Post-live diagnostics

Session logs live next to recordings on the compositor box (`.webm` files are deleted after a successful S3 upload). `monitor` samples `docker stats`
into `recordings/diagnostics/host-stats.log`.

```bash
./scripts/collect-logs.sh
```

### Troubleshooting

- **ICE fails for external users:** SG allows `40000-40100/udp`, `MEDIASOUP_ANNOUNCED_IP` equals the SFU Elastic IP
- **Recording fails / Chrome crash:** check `shm_size` on compositor, `docker logs compositor`
- **Warmup / go-live fails:** API `COMPOSITOR_URL` reachable; secrets match; compositor image includes `page/dist`; `SFU_PUBLIC_WS_URL` reachable from Chromium
- **Go live 504 / `Waiting failed: 60000ms exceeded`:** Chromium loaded the studio SPA instead of the recorder. Confirm compositor logs show `warmup navigating … http://127.0.0.1:3002/compositor/` (not `https://streaming.kaapa.pl/compositor`). `COMPOSITOR_PAGE_ORIGIN` must be loopback.
- **Recording sink fails:** use loopback `ws://127.0.0.1:3002/ws/recording` (`RECORDING_SINK_URL`). Do not use `ws://compositor:…` (private Docker DNS)
- **Signaling fails from HTTPS UI:** use `wss://sfu.kaapa.pl/ws/signaling`
- **SFU WSS 502:** `sfu-nginx` proxies to `http://sfu:3001`
- **ACME / cert issue fails:** TXT `_acme-challenge.<domain>` propagated before Enter
- **Nginx won't start (missing cert):** `./scripts/issue-cert.sh web|sfu|compositor`, then deploy
- **Choppy YouTube A/V:** undersized compositor instance; check session + host-stats logs
- **GPU at 0% / compositor CPU pegged:** Chrome is on SwiftShader. Host needs NVIDIA driver + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html), then `./scripts/deploy.sh compositor` (loads `compose.gpu.yml`). Confirm logs show `Chromium GPU renderer: NVIDIA …` not `SwiftShader`, and `/internal/health` has `"gpu":{"enabled":true,"renderer":"…NVIDIA…"}`. MediaRecorder H.264 is still a Chrome software encode — GPU takes canvas raster + video decode; nvidia-smi should no longer sit at 0%.
- **Compositor `deploy.sh` hang / host freeze during build:** BuildKit was racing Chromium apt with the Node build stage; pull latest Dockerfile (sentinel serializes them). Check `free -h` / `df -h` — compositor wants ≥4GB RAM; an 8GB disk is enough for rebuilds once leftover `.webm` files are gone (first Chromium image build is tighter)
- **`No space left on device` during compositor build:** Chromium+ffmpeg image is large. `deploy.sh` prunes build cache / unused images (without `--volumes`, so certs/recordings survive), then sweeps leftover `*.webm` (keeping session logs and diagnostics) before building while the old stack is still up, then swaps and prunes again. After S3 success, local files are renamed `*.uploaded.webm` and deleted immediately. Rebuilds abort only if less than ~1GB is free; expand EBS if a first-time Chromium build still fills the disk
