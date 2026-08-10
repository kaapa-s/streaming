FROM node:22-alpine AS build
WORKDIR /app

COPY shared/canvas-compositor /app/shared/canvas-compositor
COPY shared/sfu-client /app/shared/sfu-client
COPY shared/stream-quality /app/shared/stream-quality
RUN cd /app/shared/stream-quality && npm ci && npm run build \
  && cd /app/shared/canvas-compositor && npm ci && npm run build \
  && cd /app/shared/sfu-client && npm ci && npm run build

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/app_proxy.conf /etc/nginx/app_proxy.conf
COPY web/default.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80 443
