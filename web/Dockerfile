FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache openssl
COPY --from=build /app/dist /usr/share/nginx/html
COPY app_proxy.conf /etc/nginx/app_proxy.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY 40-selfsigned.sh /docker-entrypoint.d/40-selfsigned.sh
RUN chmod +x /docker-entrypoint.d/40-selfsigned.sh
# Remove the stock default site so only the rendered template is used.
RUN rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80 443
