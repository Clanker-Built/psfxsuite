# Postfix test container for development
FROM alpine:3.19

RUN apk add --no-cache \
    postfix \
    postfix-pcre \
    cyrus-sasl \
    rsyslog \
    supervisor \
    openssl \
    inotify-tools

# Copy configuration
COPY main.cf /etc/postfix/main.cf
COPY master.cf /etc/postfix/master.cf
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
COPY config-watcher.sh /usr/local/bin/config-watcher.sh

RUN chmod +x /entrypoint.sh /usr/local/bin/config-watcher.sh

# Create mail directories
RUN mkdir -p /var/spool/postfix && \
    mkdir -p /var/log && \
    touch /var/log/maillog

EXPOSE 25 587

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
