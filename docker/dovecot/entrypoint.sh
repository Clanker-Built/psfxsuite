#!/bin/sh
set -e

# Create necessary directories
mkdir -p /var/mail
mkdir -p /var/run/dovecot
mkdir -p /var/log/dovecot

# Set permissions
chown -R dovecot:dovecot /var/mail
chown -R dovecot:dovecot /var/run/dovecot
chown -R dovecot:dovecot /var/log/dovecot

# Create users file if it doesn't exist
if [ ! -f /etc/dovecot/users ]; then
    touch /etc/dovecot/users
    chmod 600 /etc/dovecot/users
fi

# Create passwd file if it doesn't exist
if [ ! -f /etc/dovecot/passwd ]; then
    touch /etc/dovecot/passwd
    chmod 600 /etc/dovecot/passwd
fi

echo "Dovecot starting..."
exec "$@"
