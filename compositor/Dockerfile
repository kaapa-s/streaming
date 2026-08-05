# Single build stage (not parallel deps+build+runtime apt). BuildKit otherwise
# races chromium/ffmpeg apt with npm/tsc and OOMs small EC2 boxes.
FROM node:22-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY compositor/package.json compositor/package-lock.json /app/compositor/
WORKDIR /app/compositor
RUN npm ci
COPY compositor/tsconfig.json /app/compositor/
COPY compositor/src /app/compositor/src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app/compositor
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Apt before COPY so unpacking chromium/ffmpeg does not share the writable
# layer peak with node_modules (matters on small EC2 disks).
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
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY --from=build /app/compositor/node_modules ./node_modules
COPY --from=build /app/compositor/dist ./dist

RUN mkdir -p /app/compositor/recordings
VOLUME ["/app/compositor/recordings"]
EXPOSE 3002
CMD ["node", "dist/main.js"]
