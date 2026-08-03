FROM nginx:alpine
RUN apk add --no-cache openssl
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY 40-selfsigned.sh /docker-entrypoint.d/40-selfsigned.sh
RUN chmod +x /docker-entrypoint.d/40-selfsigned.sh \
  && rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80 443
