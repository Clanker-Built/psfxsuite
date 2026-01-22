#!/bin/sh
# Watch for config changes and reload postfix

CONFIG_DIR="/etc/postfix"
RELOAD_DELAY=2

echo "Config watcher started, monitoring $CONFIG_DIR"

while true; do
    # Wait for any file changes in the config directory
    inotifywait -q -e modify,create,delete,move "$CONFIG_DIR" 2>/dev/null

    # Small delay to batch rapid changes
    sleep $RELOAD_DELAY

    echo "Config change detected, reloading postfix..."
    postfix reload 2>&1 || echo "Reload failed (postfix may not be ready yet)"
done
