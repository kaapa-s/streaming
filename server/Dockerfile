FROM node:22-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY shared/join-token /app/shared/join-token
RUN cd /app/shared/join-token && npm ci && npm run build
COPY server/package.json server/package-lock.json /app/server/
WORKDIR /app/server
RUN npm ci --omit=dev

FROM node:22-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY shared/join-token /app/shared/join-token
RUN cd /app/shared/join-token && npm ci && npm run build
COPY server/package.json server/package-lock.json /app/server/
WORKDIR /app/server
RUN npm ci
COPY server/tsconfig.json /app/server/
COPY server/src /app/server/src
RUN npm run build

FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libssl3 \
    libx11-xcb1 \
    libxss1 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=deps /app/shared/join-token /app/shared/join-token
RUN mkdir -p /app/server/recordings
VOLUME ["/app/server/recordings"]
EXPOSE 3000
CMD ["node", "dist/main.js"]
