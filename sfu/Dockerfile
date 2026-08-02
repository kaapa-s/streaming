FROM node:22-slim AS deps
WORKDIR /app
# mediasoup prebuilds often fail on slim; local worker build needs pip + a C++ toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY shared/join-token /app/shared/join-token
RUN cd /app/shared/join-token && npm ci && npm run build
COPY sfu/package.json sfu/package-lock.json /app/sfu/
WORKDIR /app/sfu
RUN npm ci --omit=dev

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY shared/join-token /app/shared/join-token
RUN cd /app/shared/join-token && npm ci && npm run build
COPY sfu/package.json sfu/package-lock.json /app/sfu/
WORKDIR /app/sfu
RUN npm ci
COPY sfu/tsconfig.json /app/sfu/
COPY sfu/src /app/sfu/src
RUN npm run build

FROM node:22-slim
WORKDIR /app/sfu
ENV NODE_ENV=production
COPY --from=deps /app/sfu/node_modules ./node_modules
COPY --from=build /app/sfu/dist ./dist
COPY --from=deps /app/shared/join-token /app/shared/join-token
EXPOSE 3001
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp
CMD ["node", "dist/main.js"]
