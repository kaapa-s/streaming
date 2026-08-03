# Ubuntu 24.04 base: mediasoup picks a kernelN prebuild from the *host* kernel.
# Debian slim often rejects that binary (check exits ≠ 41), then falls back to a
# local C++ build which needs pip. Match the EC2 Ubuntu host so the prebuild works.
FROM node:22-bookworm-slim AS nodebins

FROM ubuntu:24.04 AS build
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_BREAK_SYSTEM_PACKAGES=1
COPY --from=nodebins /usr/local /usr/local
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    python3-setuptools \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/* \
  && node -v && npm -v

WORKDIR /app
COPY shared/join-token /app/shared/join-token
RUN cd /app/shared/join-token && npm ci && npm run build

COPY sfu/package.json sfu/package-lock.json /app/sfu/
WORKDIR /app/sfu
RUN npm ci

COPY sfu/tsconfig.json /app/sfu/
COPY sfu/src /app/sfu/src
RUN npm run build && npm prune --omit=dev

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production
COPY --from=nodebins /usr/local /usr/local
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/sfu
COPY --from=build /app/sfu/node_modules ./node_modules
COPY --from=build /app/sfu/dist ./dist
COPY --from=build /app/shared/join-token /app/shared/join-token
EXPOSE 3001
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp
CMD ["node", "dist/main.js"]
