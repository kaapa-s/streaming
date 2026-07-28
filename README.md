# Streaming Studio POC

A StreamYard-style proof of concept: speakers join a browser studio, media flows
through a mediasoup SFU embedded in a NestJS server, and a server-launched
headless Chromium joins the room as a hidden "compositor" that records the
program feed (both speakers side by side, mixed audio) to a `.webm` file — and
optionally pushes it live to YouTube via ffmpeg/RTMP.

## Architecture

- `server/` — NestJS + mediasoup SFU + WebSocket signaling + recording sink + Puppeteer launcher
- `web/` — React (Vite) studio UI and compositor page, sharing one canvas/WebAudio compositing module

Every participant (speakers and the compositor) connects only to the SFU — no
peer-to-peer connections. The recording is produced by the compositor page
itself (canvas + Web Audio + MediaRecorder) and streamed to the server over a
WebSocket, where it is appended to `server/recordings/<room>-<timestamp>.webm`.
If you paste a YouTube RTMP URL (or stream key) in the studio, those same chunks
are also piped through `ffmpeg` to YouTube Live (transcoded to H.264 + AAC).

## Prerequisites

- Node.js 20+
- macOS/Linux with build basics (mediasoup ships prebuilt workers for common platforms)
- `ffmpeg` on `PATH` (required only for YouTube Live) — e.g. `brew install ffmpeg`

## Setup

```bash
cd server && npm install
npx puppeteer browsers install chrome   # one-time Chrome download for the recorder
cd ../web && npm install
```

## Run (two terminals)

```bash
# terminal 1
cd server && npm run dev    # API + SFU + signaling on http://localhost:3000

# terminal 2
cd web && npm run dev       # studio on http://localhost:5173 (proxies /api and /ws to :3000)
```

## Try it

1. Open http://localhost:5173 in two tabs (or two browsers), enter a name, join room `main`.
2. Click **Start recording** — the server launches a headless Chromium that joins
   the room and records the program feed.
3. Talk/move for a bit, click **Stop recording**.
4. Play the file written to `server/recordings/`.

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

Open http://localhost:5173/compositor-dev while the Vite web app is running.
It feeds the compositor with synthetic canvas/oscillator peers so you can
iterate on layout without mediasoup or the Nest server.

- `?peers=4` — start with N fake speakers (default 2)
- `?audio=0` — skip oscillator tracks on new peers

## Environment variables (server)

- `PORT` — HTTP/WS port (default `3000`)
- `WEB_ORIGIN` — where the compositor page is served (default `http://localhost:5173`)
- `MEDIASOUP_LISTEN_IP` / `MEDIASOUP_ANNOUNCED_IP` — set for LAN/internet use (defaults target localhost)
- `FFMPEG_PATH` — optional path to the ffmpeg binary (default `ffmpeg` on `PATH`)

## Later (out of scope for the POC)

- Internet deployment: set `MEDIASOUP_ANNOUNCED_IP`, add TURN (coturn) for restrictive NATs.
