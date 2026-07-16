#!/bin/bash
SERVER_TYPE=${1:-primary}
CONFIG="config/servers.json"

if [ "$SERVER_TYPE" = "primary" ]; then
    HOST=$(jq -r '.primary.host' $CONFIG)
    PORT=$(jq -r '.primary.port' $CONFIG)
    USER=$(jq -r '.primary.user' $CONFIG)
    DETECTED=$(jq -r '.primary.detected' $CONFIG)
else
    HOST=$(jq -r '.backup.host' $CONFIG)
    PORT=$(jq -r '.backup.port' $CONFIG)
    USER=$(jq -r '.backup.user' $CONFIG)
    DETECTED=$(jq -r '.backup.detected' $CONFIG)
fi

if [ "$DETECTED" != "true" ]; then
    echo "NOT_DETECTED"
    exit 1
fi

SSH_OPTS="-o ConnectTimeout=3 -o BatchMode=yes -o ServerAliveInterval=60 -o ServerAliveCountMax=7"

if ssh -p $PORT $SSH_OPTS $USER@$HOST "echo OK" >/dev/null 2>&1; then
    echo "AVAILABLE:$HOST:$PORT:$USER"
    exit 0
else
    echo "UNAVAILABLE"
    exit 1
fi
