#!/bin/bash
set -e

PHOTO_INPUT=$1
AUDIO_INPUT=$2
VIDEO_OUTPUT=$3
CONFIG="config/servers.json"
PROFILE="${PROFILE:-config/host_profile.json}"

PHOTO_BASENAME=$(basename "$PHOTO_INPUT")
AUDIO_BASENAME=$(basename "$AUDIO_INPUT")

echo "👄 上传素材到服务器..."
SERVER_INFO=$(bash scripts/upload_to_server.sh "$PHOTO_INPUT" "input/$PHOTO_BASENAME")
HOST=$(echo "$SERVER_INFO" | cut -d: -f1)
PORT=$(echo "$SERVER_INFO" | cut -d: -f2)
USER=$(echo "$SERVER_INFO" | cut -d: -f3)
WORKSPACE=$(echo "$SERVER_INFO" | cut -d: -f4)

bash scripts/upload_to_server.sh "$AUDIO_INPUT" "input/$AUDIO_BASENAME"

if [ "$HOST" = "$(jq -r '.primary.host' $CONFIG)" ]; then
    MUSE_PATH=$(jq -r '.primary.musetalk_path' $CONFIG)
    MUSE_VENV=$(jq -r '.primary.musetalk_python_env' $CONFIG)
else
    MUSE_PATH=$(jq -r '.backup.musetalk_path' $CONFIG)
    MUSE_VENV=$(jq -r '.backup.musetalk_python_env' $CONFIG)
fi

echo "👄 执行 MuseTalk 唇形同步..."
echo "   使用路径: $MUSE_PATH"

if [ -n "$MUSE_VENV" ] && [ "$MUSE_VENV" != "" ] && [ "$MUSE_VENV" != "null" ]; then
    if echo "$MUSE_VENV" | grep -q "activate"; then
        ACTIVATE_CMD="source $MUSE_VENV"
    else
        ACTIVATE_CMD="conda activate $MUSE_VENV"
    fi
else
    ACTIVATE_CMD="echo '使用系统 Python'"
fi

ssh -p $PORT $USER@$HOST << EOF
    cd $MUSE_PATH
    if [ -n "$MUSE_VENV" ] && [ "$MUSE_VENV" != "" ] && [ "$MUSE_VENV" != "null" ]; then
        $ACTIVATE_CMD
        python run.py \
            --video "$WORKSPACE/input/$PHOTO_BASENAME" \
            --audio "$WORKSPACE/input/$AUDIO_BASENAME" \
            --out "$WORKSPACE/output/lip_synced.mp4"
    else
        chmod +x run.py
        ./run.py \
            --video "$WORKSPACE/input/$PHOTO_BASENAME" \
            --audio "$WORKSPACE/input/$AUDIO_BASENAME" \
            --out "$WORKSPACE/output/lip_synced.mp4"
    fi
EOF

echo "📥 下载唇形同步视频..."
scp -P $PORT "$USER@$HOST:$WORKSPACE/output/lip_synced.mp4" "$VIDEO_OUTPUT"

echo "✅ MuseTalk 完成: $VIDEO_OUTPUT"
