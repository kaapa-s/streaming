FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY shared/join-token /app/shared/join-token
COPY shared/stream-quality /app/shared/stream-quality
RUN cd /app/shared/join-token && npm ci && npm run build \
  && cd /app/shared/stream-quality && npm ci && npm run build
COPY server/package.json server/package-lock.json /app/server/
WORKDIR /app/server
RUN npm ci --omit=dev

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY shared/join-token /app/shared/join-token
COPY shared/stream-quality /app/shared/stream-quality
RUN cd /app/shared/join-token && npm ci && npm run build \
  && cd /app/shared/stream-quality && npm ci && npm run build
COPY server/package.json server/package-lock.json /app/server/
WORKDIR /app/server
RUN npm ci
COPY server/tsconfig.json /app/server/
COPY server/src /app/server/src
RUN npm run build

FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=deps /app/shared/join-token /app/shared/join-token
COPY --from=deps /app/shared/stream-quality /app/shared/stream-quality
EXPOSE 3000
CMD ["node", "dist/main.js"]
