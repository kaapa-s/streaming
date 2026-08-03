FROM certbot/certbot:v2.11.0
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY renew.sh /renew.sh
COPY reload-hook.sh /reload-hook.sh
RUN chmod +x /renew.sh /reload-hook.sh
ENTRYPOINT ["/bin/sh", "/renew.sh"]
