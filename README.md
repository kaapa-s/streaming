# Streaming Studio POC

A StreamYard-style proof of concept: speakers join a browser studio, media flows
through a mediasoup SFU process, and a server-launched headless Chromium joins
the room as a hidden "compositor" that records the program feed (both speakers
side by side, mixed audio) to a `.webm` file — and optionally pushes it live to
YouTube via ffmpeg/RTMP.

## Architecture

- `server/` — NestJS + Postgres/TypeORM auth, rooms API, recording sink, Puppeteer launcher
- `sfu/` — mediasoup worker + `/ws/signaling` (join tokens only; no DB)
- `shared/join-token/` — HMAC issue/verify used by API and SFU
- `web/` — React (Vite) studio UI and compositor page

Auth: register/login (JWT + refresh tokens). Speakers get a short-lived join token
from `POST /api/rooms/:slug/join` before SFU signaling. Recording start/stop requires
room membership.

Locally, Vite same-origin path-proxies `/ws/signaling` → SFU and `/api` + `/ws/recording` → API.
In split prod, browsers use `SFU_PUBLIC_WS_URL` (WSS via `sfu-nginx`); `web` nginx only proxies API/recording.
WebRTC media still goes to the SFU announced IP.

Every participant (speakers and the compositor) connects only to the SFU — no
peer-to-peer connections. The recording is produced by the compositor page
itself (canvas + Web Audio + MediaRecorder) and streamed to the API over a
WebSocket, where it is appended to `server/recordings/<room>-<timestamp>.webm`.
If you paste a YouTube RTMP URL (or stream key) in the studio, those same chunks
are also piped through `ffmpeg` to YouTube Live (transcoded to H.264 + AAC).

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

This copies `server/.env` / `sfu/.env` from examples if missing, starts Postgres,
installs dependencies, runs migrations, installs Puppeteer Chrome, then starts
API (`:3000`), SFU (`:3001`), and web (`:5173` HTTPS via mkcert).

After the first setup, day-to-day:

```bash
npm run dev
```

Or three terminals: `npm run dev:api`, `npm run dev:sfu`, `npm run dev:web`.

Ensure `SFU_JOIN_SECRET` matches in `server/.env` and `sfu/.env`.

### Try it

1. Open https://localhost:5173, register an account, join room `main`.
2. Open a second browser/profile, register another user, join the same room.
3. Click **Start recording** — the server launches a headless Chromium that joins
   the room and records the program feed.
4. Talk/move for a bit, click **Stop recording**.
5. Play the file written to `server/recordings/`.

### Go live on YouTube

1. In [YouTube Studio](https://studio.youtube.com) → **Create** → **Go live**, create a stream
   and copy the **Stream key** (or the full RTMP URL + key).
2. Pick **720p** or **1080p** in the studio header (output canvas + YouTube encode target).
3. Paste the key into the RTMP field (`rtmp://a.rtmp.youtube.com/live2/<key>` or just the key).
4. Click **Go live** — the compositor starts, records locally, and ffmpeg pushes to YouTube
   (H.264 @ ~4.5 Mbps for 720p / ~6 Mbps for 1080p).
5. Click **Stop live** when done.

Speakers should re-join after this change so cameras publish at higher WebRTC bitrate.

### Compositor playground (no stack required)

Open https://localhost:5173/compositor-dev while the Vite web app is running.
It feeds the compositor with synthetic canvas/oscillator peers so you can
iterate on layout without mediasoup or the Nest server.

- `?peers=4` — start with N fake speakers (default 2)
- `?audio=0` — skip oscillator tracks on new peers

### Local environment variables

**server** (`server/.env`)

- `PORT` — HTTP/WS port (default `3000`)
- `WEB_ORIGIN` — where the compositor page is served (default `https://localhost:5173`)
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — access-token signing secret
- `SFU_JOIN_SECRET` — HMAC secret for short-lived SFU join tokens (must match SFU)
- `SFU_PUBLIC_WS_URL` — optional direct signaling URL; leave unset for same-origin `/ws/signaling`
- `FFMPEG_PATH` — optional path to the ffmpeg binary (default `ffmpeg` on `PATH`)

**sfu** (`sfu/.env`)

- `PORT` — signaling HTTP/WS port (default `3001`)
- `SFU_JOIN_SECRET` — same secret as server
- `MEDIASOUP_LISTEN_IP` / `MEDIASOUP_ANNOUNCED_IP` — set for LAN/internet use (defaults target localhost)
- `MEDIASOUP_RTC_MIN_PORT` / `MEDIASOUP_RTC_MAX_PORT` — WebRTC port range (default `40000–40100`)

## Deploy on EC2 (Docker Compose)

Split stack by default:

- **API box:** `postgres` + `server` + `web` (nginx TLS) + `monitor`
- **SFU box:** `sfu` + `sfu-nginx` (WSS) via `--profile sfu`

TLS terminates **inside Compose**. Do not run host nginx on 80/443.

Domains:

| Host | Role |
|------|------|
| `streaming.kaapa.pl` | API + studio UI |
| `sfu.kaapa.pl` | SFU signaling (WSS) |

### Instance

- **AMI:** Ubuntu 24.04 LTS
- **Size:** `t3.medium` minimum (2 vCPU / 4 GB); `c5.xlarge` if recordings feel sluggish
- **Elastic IP:** attach; set `MEDIASOUP_ANNOUNCED_IP` to the **SFU** box EIP
- **DNS:** A record `streaming.kaapa.pl` → API EIP; A record `sfu.kaapa.pl` → SFU EIP

### Security group

| Port | Protocol | Purpose | Where |
|------|----------|---------|-------|
| 22 | tcp | SSH (restrict to your IP) | both |
| 80 | tcp | HTTP → HTTPS redirect | both |
| 443 | tcp | HTTPS / WSS | both |
| 40000-40100 | udp + tcp | WebRTC (mediasoup SFU) | SFU |

### First-time setup (once per box)

```bash
# Docker on Ubuntu 24.04 — install Docker Engine + Compose plugin, then:
sudo usermod -aG docker $USER   # log out / back in

git clone <repo> streaming && cd streaming
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD, JWT_SECRET, SFU_JOIN_SECRET (openssl rand -hex 32)
#   CERTBOT_EMAIL
#   SERVER_NAME=streaming.kaapa.pl
#   SFU_SERVER_NAME=sfu.kaapa.pl
#   SFU_PUBLIC_WS_URL=wss://sfu.kaapa.pl/ws/signaling
#   MEDIASOUP_ANNOUNCED_IP=<sfu-eip>
# Same SFU_JOIN_SECRET on both boxes.
```

### One-command deploy / rebuild

Includes `git pull`, cert issue if missing (interactive DNS-01), and compose `--build`:

```bash
# API box
./scripts/deploy.sh api

# SFU box
./scripts/deploy.sh sfu
```

Share **https://streaming.kaapa.pl** with testers.

### TLS (manual DNS-01)

`./scripts/issue-cert.sh` runs certbot interactively: it prints the `_acme-challenge`
TXT name/value, waits while you create the record in DigitalOcean DNS, then continues
after you press Enter. Manual certs do **not** auto-renew — re-run before expiry (~60 days):

```bash
./scripts/issue-cert.sh web   # API box → streaming.kaapa.pl
./scripts/issue-cert.sh sfu   # SFU box → sfu.kaapa.pl
```

Routine `./scripts/deploy.sh` skips cert issue when the cert already exists in the volume.

Internal compositor traffic stays on `http://web` (no TLS redirect for that Host).

### Verify

```bash
docker compose --env-file .env ps
docker stats   # during a test recording

# Two browsers → register → join same room → Start recording → Stop recording
docker compose --env-file .env exec server ls /app/server/recordings
```

**Cellular ICE test:** one tester on a mobile hotspot confirms `MEDIASOUP_ANNOUNCED_IP` and SG `40000-40100/udp` are correct.

### Post-live diagnostics

Every recording/live session always writes a `*.session.log` next to the `.webm` (codec/mode, ffmpeg stderr including `speed=`, compositor console, loadavg/memory every 10s, ingress bitrate). The compose `monitor` service also samples `docker stats` every 15s into `recordings/diagnostics/host-stats.log`.

After a live:

```bash
./scripts/collect-logs.sh
# → diagnostics-<utc>.tar.gz  (session logs + container logs + host stats)
```

What to look for: `speed=` below `1.0`, rising `loadavg`, `codec=vp8/vp9` with `libx264/medium`, `stdin backpressure`, or `server`/`sfu` CPU/RAM pegged in `host-stats.log`.

### Troubleshooting

- **ICE fails for external users:** SG allows `40000-40100/udp`, `MEDIASOUP_ANNOUNCED_IP` equals the SFU Elastic IP, `docker logs sfu` shows `[mediasoup] worker started`
- **Recording fails / Chrome crash:** check `shm_size` in compose, `docker logs server`
- **Compositor can't connect:** `WEB_ORIGIN` must stay `http://web` in compose (internal Docker URL, not the public HTTPS URL)
- **Signaling fails from HTTPS UI / mixed content:** use `wss://sfu.kaapa.pl/ws/signaling`, not `ws://…:3001`
- **SFU WSS 502:** `sfu-nginx` proxies to `http://sfu:3001`; check `docker compose --env-file .env --profile sfu ps`
- **ACME / cert issue fails:** TXT `_acme-challenge.streaming.kaapa.pl` / `_acme-challenge.sfu.kaapa.pl` matches what certbot printed and has propagated (`dig TXT _acme-challenge.sfu.kaapa.pl`); press Enter only after it resolves; re-run `./scripts/issue-cert.sh` before expiry
- **Nginx won't start (missing cert):** run `./scripts/issue-cert.sh web|sfu` once, then `./scripts/deploy.sh api|sfu`
- **Choppy YouTube A/V:** undersized instance (use ≥ `t3.medium`); pull a diagnostics bundle and check session + host-stats logs above
