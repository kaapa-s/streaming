# Streaming Studio POC

A StreamYard-style proof of concept: speakers join a browser studio, media flows
through a mediasoup SFU embedded in a NestJS server, and a server-launched
headless Chromium joins the room as a hidden "compositor" that records the
program feed (both speakers side by side, mixed audio) to a `.webm` file — and
optionally pushes it live to YouTube via ffmpeg/RTMP.

## Architecture

- `server/` — NestJS + Postgres/TypeORM auth + mediasoup SFU + WebSocket signaling + recording sink + Puppeteer launcher
- `web/` — React (Vite) studio UI and compositor page, sharing one canvas/WebAudio compositing module

Auth: register/login (JWT + refresh tokens). Speakers get a short-lived join token
from `POST /api/rooms/:slug/join` before SFU signaling. Recording start/stop requires
room membership.

Every participant (speakers and the compositor) connects only to the SFU — no
peer-to-peer connections. The recording is produced by the compositor page
itself (canvas + Web Audio + MediaRecorder) and streamed to the server over a
WebSocket, where it is appended to `server/recordings/<room>-<timestamp>.webm`.
If you paste a YouTube RTMP URL (or stream key) in the studio, those same chunks
are also piped through `ffmpeg` to YouTube Live (transcoded to H.264 + AAC).

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (local install, or `cd server && docker compose up -d` when Docker is available)
- macOS/Linux with build basics (mediasoup ships prebuilt workers for common platforms)
- `ffmpeg` on `PATH` (required only for YouTube Live) — e.g. `brew install ffmpeg`

## Setup

```bash
cd server && npm install
cp .env.example .env   # DATABASE_URL, JWT_SECRET, SFU_JOIN_SECRET
# ensure Postgres is up and DATABASE_URL points at it, then:
npm run migration:run
npx puppeteer browsers install chrome   # one-time Chrome download for the recorder
cd ../web && npm install
```

## Run (two terminals)

```bash
# terminal 1
cd server && npm run dev    # API + SFU + signaling on http://localhost:3000

# terminal 2
cd web && npm run dev       # studio on https://localhost:5173 (proxies /api and /ws to :3000)
```

Register / log in in the studio, then join a room. Recording and signaling require auth (Bearer JWT + room join token).

## Try it

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

The studio's "Program preview" canvas runs the same compositing code as the
recorder, so what you see is what gets recorded / streamed.

## Compositor playground (no stack required)

Open https://localhost:5173/compositor-dev while the Vite web app is running.
It feeds the compositor with synthetic canvas/oscillator peers so you can
iterate on layout without mediasoup or the Nest server.

- `?peers=4` — start with N fake speakers (default 2)
- `?audio=0` — skip oscillator tracks on new peers

## Environment variables (server)

- `PORT` — HTTP/WS port (default `3000`)
- `WEB_ORIGIN` — where the compositor page is served (default `https://localhost:5173`)
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — access-token signing secret
- `SFU_JOIN_SECRET` — HMAC secret for short-lived SFU join tokens
- `MEDIASOUP_LISTEN_IP` / `MEDIASOUP_ANNOUNCED_IP` — set for LAN/internet use (defaults target localhost)
- `FFMPEG_PATH` — optional path to the ffmpeg binary (default `ffmpeg` on `PATH`)

## Deploy to EC2 (Docker Compose)

Monolith stack: `postgres` + `server` (API, SFU, recording) + `web` (nginx).

### Instance

- **AMI:** Ubuntu 24.04 LTS
- **Size:** `t3.medium` minimum (2 vCPU / 4 GB); `c5.xlarge` if recordings feel sluggish
- **Elastic IP:** attach and set as `MEDIASOUP_ANNOUNCED_IP` in `.env.prod`

### Security group

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | tcp | SSH (restrict to your IP) |
| 80 | tcp | HTTP (ACME + redirect to HTTPS) |
| 443 | tcp | HTTPS |
| 40000-40100 | udp + tcp | WebRTC (mediasoup) |

### HTTPS without a domain (sslip.io)

Browsers require HTTPS for camera/mic. Let's Encrypt won't issue for a bare IP, but it will for an sslip.io hostname:

```
EIP 203.0.113.42  →  https://203-0-113-42.sslip.io
```

No DNS setup or sslip.io signup required — the hostname resolves automatically.

The compose `web` service listens on `127.0.0.1:8080`. Host nginx terminates TLS on 80/443 and proxies to that port.

### Deploy

```bash
# Docker (Amazon Linux example)
sudo dnf install -y docker
# Install compose plugin or use docker-compose binary — see troubleshooting if needed
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # then log out / back in

# App
git clone <repo> streaming && cd streaming
cp .env.prod.example .env.prod
# Edit .env.prod: POSTGRES_PASSWORD, JWT_SECRET, SFU_JOIN_SECRET (openssl rand -hex 32),
# MEDIASOUP_ANNOUNCED_IP = Elastic IP, PUBLIC_ORIGIN = https://<eip-with-dashes>.sslip.io

docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### TLS with certbot + host nginx

Replace `203-0-113-42` with your Elastic IP (dots → dashes).

```bash
# Amazon Linux 2023
sudo dnf install -y nginx certbot python3-certbot-nginx

# Proxy HTTP → Docker web (certbot will add SSL later)
sudo tee /etc/nginx/conf.d/streaming.conf <<'EOF'
server {
    listen 80;
    server_name 203-0-113-42.sslip.io;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
EOF

sudo nginx -t && sudo systemctl enable --now nginx

# Issue certificate (opens interactive prompts for email / ToS)
sudo certbot --nginx -d 203-0-113-42.sslip.io
```

Certbot rewrites the nginx config for HTTPS and sets up renewal. Share **`https://203-0-113-42.sslip.io`** with testers.

Renewal check: `sudo certbot renew --dry-run`

### Verify

```bash
docker compose -f docker-compose.prod.yml ps
docker stats   # during a test recording

# Two browsers → register → join same room → Start recording → Stop recording
docker compose -f docker-compose.prod.yml exec server ls /app/recordings
```

**Cellular ICE test:** one tester on a mobile hotspot confirms `MEDIASOUP_ANNOUNCED_IP` and SG `40000-40100/udp` are correct.

### Post-live diagnostics

Every recording/live session always writes a `*.session.log` next to the `.webm` (codec/mode, ffmpeg stderr including `speed=`, compositor console, loadavg/memory every 10s, ingress bitrate). The compose `monitor` service also samples `docker stats` every 15s into `recordings/diagnostics/host-stats.log`.

After a live:

```bash
chmod +x scripts/collect-logs.sh
./scripts/collect-logs.sh
# → diagnostics-<utc>.tar.gz  (session logs + container logs + host stats)
```

What to look for: `speed=` below `1.0`, rising `loadavg`, `codec=vp8/vp9` with `libx264/medium`, `stdin backpressure`, or `server` CPU/RAM pegged in `host-stats.log`.

### Troubleshooting

- **ICE fails for external users:** SG allows `40000-40100/udp`, `MEDIASOUP_ANNOUNCED_IP` equals the Elastic IP, `docker logs server` shows `[mediasoup] worker started`
- **Recording fails / Chrome crash:** check `shm_size` in compose, `docker logs server`
- **Compositor can't connect:** `WEB_ORIGIN` must stay `http://web` in compose (internal Docker URL, not the public HTTPS URL)
- **Choppy YouTube A/V:** undersized instance (use ≥ `t3.medium`); pull a diagnostics bundle and check session + host-stats logs above
