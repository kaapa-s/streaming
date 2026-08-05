# Single build stage (not parallel deps+build+runtime apt). BuildKit otherwise
# runs chromium/ffmpeg apt, npm ci, and tsc together and OOMs small EC2 boxes.
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

# COPY before apt so Chromium/ffmpeg install cannot race the build stage.
COPY --from=build /app/compositor/node_modules ./node_modules
COPY --from=build /app/compositor/dist ./dist

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

RUN mkdir -p /app/compositor/recordings
VOLUME ["/app/compositor/recordings"]
EXPOSE 3002
CMD ["node", "dist/main.js"]
