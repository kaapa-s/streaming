# Streaming Studio POC

A StreamYard-style proof of concept: speakers join a browser studio, media flows
through a mediasoup SFU, and a dedicated **compositor** service runs a warm
Chromium pool that joins the room as a hidden compositor, records the program
feed to `.webm`, optionally pushes live to YouTube via ffmpeg/RTMP, and uploads
finished files to S3.

## Architecture

- `server/` — NestJS + Postgres/TypeORM auth, rooms API, recording orchestration, S3 presign
- `compositor/` — warm Chromium pool, `/ws/recording` sink, ffmpeg → YouTube, S3 PUT
- `sfu/` — mediasoup worker + `/ws/signaling` (join tokens only; no DB)
- `shared/join-token/` — HMAC issue/verify used by API and SFU
- `web/` — React (Vite) studio UI and compositor page

Auth: register/login (JWT + refresh tokens). Speakers get a short-lived join token
from `POST /api/rooms/:slug/join` before SFU signaling. Join also **warms** a
compositor tab (SFU subscribe + render, no MediaRecorder). Go live / Start
recording calls the compositor to start capture (+ optional RTMP).

Locally, Vite proxies `/ws/signaling` → SFU, `/api` → API, `/ws/recording` → compositor.
In split prod, browsers use `SFU_PUBLIC_WS_URL`; headless Chromium loads the SPA from
`COMPOSITOR_WEB_ORIGIN` and writes chunks to Docker-internal `RECORDING_SINK_URL`.

## Run locally

### Prerequisites

- Node.js 22+
- Docker (for Postgres)
- macOS/Linux with build basics (mediasoup ships prebuilt workers for common platforms)
- `ffmpeg` on `PATH` (required only for YouTube Live) — e.g. `brew install ffmpeg`

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
5. Play the file under `compositor/recordings/` (and an S3 download URL if configured).

### Go live on YouTube

1. In [YouTube Studio](https://studio.youtube.com) → **Create** → **Go live**, create a stream
   and copy the **Stream key** (or the full RTMP URL + key).
2. Pick **720p** or **1080p** in the studio header (output canvas + YouTube encode target).
3. Paste the key into the RTMP field (`rtmp://a.rtmp.youtube.com/live2/<key>` or just the key).
4. Click **Go live** — records locally and ffmpeg pushes to YouTube.
5. Click **Stop live** when done.

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
- `SFU_PUBLIC_WS_URL` — optional direct signaling URL
- `AWS_REGION` / `S3_BUCKET` / `S3_PREFIX` — optional S3 upload; `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` only when not using an EC2 IAM role

**compositor** (`compositor/.env`)

- `PORT` — default `3002`
- `COMPOSITOR_INTERNAL_SECRET` — must match server
- `COMPOSITOR_POOL_SIZE` — warm Chromium browsers (default `1`)
- `WEB_ORIGIN` — where `/compositor` is served (local Vite `https://localhost:5173`)
- `RECORDING_SINK_URL` — MediaRecorder WebSocket (local `ws://127.0.0.1:3002/ws/recording`)
- `SFU_PUBLIC_WS_URL` — optional; local Vite can proxy `/ws/signaling`
- `FFMPEG_PATH` — optional

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
- **Size:** API can be smaller; compositor prefers `t3.medium`+ / `c5` for encode
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
#   COMPOSITOR_WEB_ORIGIN=https://streaming.kaapa.pl
#   MEDIASOUP_ANNOUNCED_IP=<sfu-eip>
#   Optional S3: AWS_REGION + S3_BUCKET (+ access keys locally; on EC2 prefer IAM role)
# Same SFU_JOIN_SECRET and COMPOSITOR_INTERNAL_SECRET across boxes that need them.
```

### One-command deploy / rebuild

```bash
./scripts/deploy.sh api
./scripts/deploy.sh sfu
./scripts/deploy.sh compositor
```

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
```

### Post-live diagnostics

Session logs live next to `.webm` on the compositor box. `monitor` samples `docker stats`
into `recordings/diagnostics/host-stats.log`.

```bash
./scripts/collect-logs.sh
```

### Troubleshooting

- **ICE fails for external users:** SG allows `40000-40100/udp`, `MEDIASOUP_ANNOUNCED_IP` equals the SFU Elastic IP
- **Recording fails / Chrome crash:** check `shm_size` on compositor, `docker logs compositor`
- **Warmup / go-live fails:** API `COMPOSITOR_URL` reachable; secrets match; `COMPOSITOR_WEB_ORIGIN` serves `/compositor`
- **Go-live Mixed Content / insecure WebSocket:** headless Chromium loads HTTPS `COMPOSITOR_WEB_ORIGIN` but sinks to Docker-internal `ws://` (`RECORDING_SINK_URL`). Pool launches with `--allow-running-insecure-content`; rebuild/restart compositor if that flag is missing
- **Signaling fails from HTTPS UI:** use `wss://sfu.kaapa.pl/ws/signaling`
- **SFU WSS 502:** `sfu-nginx` proxies to `http://sfu:3001`
- **ACME / cert issue fails:** TXT `_acme-challenge.<domain>` propagated before Enter
- **Nginx won't start (missing cert):** `./scripts/issue-cert.sh web|sfu|compositor`, then deploy
- **Choppy YouTube A/V:** undersized compositor instance; check session + host-stats logs
- **Compositor `deploy.sh` hang / host freeze during build:** BuildKit was racing Chromium apt with the Node build stage; pull latest Dockerfile (sentinel serializes them). Check `free -h` / `df -h` — compositor wants ≥4GB RAM and ≥20GB disk
- **`No space left on device` during compositor build:** Chromium+ffmpeg image is large. `deploy.sh` auto-prunes when disk is low; or manually: `docker builder prune -af && docker system prune -af`. Expand EBS if still tight
