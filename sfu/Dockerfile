# Single build stage — mediasoup's worker install is expensive; never run npm ci twice.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Prebuilt mediasoup-worker needs only ca-certificates for the GitHub download.
# python3/make/g++ remain as a fallback if no prebuild exists for this arch.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY shared/join-token /app/shared/join-token
RUN cd /app/shared/join-token && npm ci && npm run build

COPY sfu/package.json sfu/package-lock.json /app/sfu/
WORKDIR /app/sfu
RUN npm ci

COPY sfu/tsconfig.json /app/sfu/
COPY sfu/src /app/sfu/src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app/sfu
ENV NODE_ENV=production
COPY --from=build /app/sfu/node_modules ./node_modules
COPY --from=build /app/sfu/dist ./dist
COPY --from=build /app/shared/join-token /app/shared/join-token
EXPOSE 3001
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp
CMD ["node", "dist/main.js"]
