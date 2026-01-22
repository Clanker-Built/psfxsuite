#!/bin/sh
set -e

# Fix permissions on /etc/postfix if running as root initially
# This handles the case where the volume is owned by root
if [ "$(id -u)" = "0" ]; then
    # Ensure postfixrelay user can write to postfix config
    chown -R postfixrelay:postfixrelay /etc/postfix 2>/dev/null || true
    chmod -R u+rw /etc/postfix 2>/dev/null || true

    # Ensure data directory is writable
    chown -R postfixrelay:postfixrelay /data 2>/dev/null || true

    # Drop privileges and run as postfixrelay
    exec su-exec postfixrelay "$@"
else
    # Already running as non-root, just exec
    exec "$@"
fi
