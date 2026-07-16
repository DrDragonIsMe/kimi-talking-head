#!/bin/bash
set -e

LOCAL_FILE=$1
REMOTE_REL_PATH=$2
CONFIG="config/servers.json"
SSH_OPTS="-o ServerAliveInterval=60 -o ServerAliveCountMax=7"

if SERVER_INFO=$(bash scripts/check_server.sh primary 2>/dev/null); then
    HOST=$(echo "$SERVER_INFO" | cut -d: -f2)
    PORT=$(echo "$SERVER_INFO" | cut -d: -f3)
    USER=$(echo "$SERVER_INFO" | cut -d: -f4)
    WORKSPACE=$(jq -r '.primary.tts_workspace' $CONFIG)
    echo "📤 使用主节点: $HOST:$PORT" >&2
else
    echo "⚠️ 主节点不可用，尝试从节点..." >&2
    if SERVER_INFO=$(bash scripts/check_server.sh backup 2>/dev/null); then
        HOST=$(echo "$SERVER_INFO" | cut -d: -f2)
        PORT=$(echo "$SERVER_INFO" | cut -d: -f3)
        USER=$(echo "$SERVER_INFO" | cut -d: -f4)
        WORKSPACE=$(jq -r '.backup.tts_workspace' $CONFIG)
        echo "📤 使用从节点: $HOST:$PORT" >&2
    else
        echo "❌ 所有节点不可用" >&2
        exit 1
    fi
fi

REMOTE_DIR="$WORKSPACE/$(dirname $REMOTE_REL_PATH)"
ssh -p $PORT $SSH_OPTS $USER@$HOST "mkdir -p $REMOTE_DIR"
scp -P $PORT -o ServerAliveInterval=60 -o ServerAliveCountMax=7 "$LOCAL_FILE" "$USER@$HOST:$WORKSPACE/$REMOTE_REL_PATH"

echo "$HOST:$PORT:$USER:$WORKSPACE"
