# BuildKit parallelizes independent stages. On small EC2 boxes, racing
# chromium/ffmpeg apt with npm (or a second apt) thrashing-hangs the host.
# The sentinel COPY below forces the runtime apt to wait for `build`.
FROM node:22-slim AS build
WORKDIR /app

# Shared packages the Nest API + recorder page need.
COPY shared/stream-quality /app/shared/stream-quality
COPY shared/canvas-compositor /app/shared/canvas-compositor
COPY shared/sfu-client /app/shared/sfu-client
RUN cd /app/shared/stream-quality && npm ci && npm run build \
  && cd /app/shared/canvas-compositor && npm ci && npm run build \
  && cd /app/shared/sfu-client && npm ci && npm run build

# Recorder page (Vite) — served by Nest over loopback for Chromium.
WORKDIR /app/compositor/page
COPY compositor/page/package.json compositor/page/package-lock.json ./
RUN npm ci
COPY compositor/page ./
RUN npm run build

# Nest compositor service
WORKDIR /app/compositor
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY compositor/package.json compositor/package-lock.json ./
RUN npm ci
COPY compositor/tsconfig.json ./
COPY compositor/src ./src
RUN npm run build:api && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app/compositor
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    FFMPEG_PATH=/opt/ffmpeg/bin/ffmpeg

# Tiny COPY so BuildKit cannot start chromium apt until `build` finished.
COPY --from=build /app/compositor/package.json /tmp/build-sentinel

# Debian ffmpeg is built without NVENC. BtbN gpl includes h264_nvenc + libx264 + openssl (RTMPS).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    curl \
    xz-utils \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libssl3 \
    libx11-xcb1 \
    libxss1 \
    libegl1 \
    libgles2 \
    libgbm1 \
    libgl1 \
    libva2 \
    libva-drm2 \
    libvulkan1 \
  && curl -fsSL -o /tmp/ffmpeg.tar.xz \
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz" \
  && mkdir -p /opt/ffmpeg \
  && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1 \
  && ln -sf /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg \
  && ln -sf /opt/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe \
  && /opt/ffmpeg/bin/ffmpeg -hide_banner -encoders | grep -q h264_nvenc \
  && rm -f /tmp/ffmpeg.tar.xz \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/build-sentinel

COPY --from=build /app/compositor/node_modules ./node_modules
COPY --from=build /app/compositor/dist ./dist
COPY --from=build /app/compositor/page/dist ./page/dist
COPY --from=build /app/shared/stream-quality /app/shared/stream-quality

RUN mkdir -p /app/compositor/recordings
VOLUME ["/app/compositor/recordings"]
EXPOSE 3002
CMD ["node", "dist/main.js"]
