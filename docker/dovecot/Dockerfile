# Dovecot IMAP/POP3 server for PSFX Suite
FROM alpine:3.19

RUN apk add --no-cache \
    dovecot \
    dovecot-lmtpd \
    dovecot-pop3d \
    dovecot-pigeonhole-plugin

# Copy configuration
COPY dovecot.conf /etc/dovecot/dovecot.conf
COPY conf.d/ /etc/dovecot/conf.d/
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

# Create mail directories
RUN mkdir -p /var/mail && \
    mkdir -p /var/log/dovecot && \
    chown -R dovecot:dovecot /var/mail

EXPOSE 143 993 110 995 24

ENTRYPOINT ["/entrypoint.sh"]
CMD ["dovecot", "-F"]
