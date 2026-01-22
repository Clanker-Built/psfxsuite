#!/bin/sh
set -e

# Apply environment variables to postfix config
if [ -n "$POSTFIX_MYHOSTNAME" ]; then
    postconf -e "myhostname=$POSTFIX_MYHOSTNAME"
fi

if [ -n "$POSTFIX_MYDOMAIN" ]; then
    postconf -e "mydomain=$POSTFIX_MYDOMAIN"
fi

if [ -n "$POSTFIX_RELAYHOST" ]; then
    postconf -e "relayhost=$POSTFIX_RELAYHOST"
fi

# Ensure mail directories exist with correct permissions
postfix set-permissions

# Generate aliases database
newaliases || true

# Create self-signed certificate if not present
if [ ! -f /etc/ssl/certs/ssl-cert-snakeoil.pem ]; then
    mkdir -p /etc/ssl/certs /etc/ssl/private
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/ssl/private/ssl-cert-snakeoil.key \
        -out /etc/ssl/certs/ssl-cert-snakeoil.pem \
        -subj "/CN=mail.local"
fi

exec "$@"
