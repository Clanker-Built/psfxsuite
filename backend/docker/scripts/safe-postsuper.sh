#!/bin/bash
# Wrapper script for postsuper with queue ID validation
# This script validates queue IDs before passing to postsuper

set -euo pipefail

# Queue ID must be 10-12 uppercase hex characters
QUEUEID_REGEX='^[A-F0-9]{10,12}$'

usage() {
    echo "Usage: $0 -h|-H|-d QUEUE_ID"
    echo "  -h QUEUE_ID  Hold message"
    echo "  -H QUEUE_ID  Release message from hold"
    echo "  -d QUEUE_ID  Delete message"
    exit 1
}

if [ $# -ne 2 ]; then
    usage
fi

ACTION="$1"
QUEUE_ID="$2"

# Validate action
case "$ACTION" in
    -h|-H|-d)
        ;;
    *)
        echo "Error: Invalid action '$ACTION'" >&2
        exit 1
        ;;
esac

# Validate queue ID format
if [[ ! "$QUEUE_ID" =~ $QUEUEID_REGEX ]]; then
    echo "Error: Invalid queue ID format '$QUEUE_ID'" >&2
    exit 1
fi

# Execute postsuper with validated parameters
exec /usr/sbin/postsuper "$ACTION" "$QUEUE_ID"
