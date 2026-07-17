#!/bin/bash
# MuseTalk lip-sync runner for kimi-talking-head.
# Usage: bash scripts/musetalk.sh <video_input> <audio_input> <video_output>
# The video_input is the host template video (e.g. assets/host/me.mp4).
set -e

source "$(dirname "${BASH_SOURCE[0]}")/lib/remote_job.sh"

VIDEO_INPUT=$1
AUDIO_INPUT=$2
VIDEO_OUTPUT=$3

CONFIG="config/servers.json"
PROFILE="${PROFILE:-config/host_profile.json}"
RUN_ID="${PIPELINE_RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
SSH_OPTS="$REMOTE_JOB_SSH_OPTS"

VIDEO_BASENAME=$(basename "$VIDEO_INPUT")
AUDIO_BASENAME=$(basename "$AUDIO_INPUT")

# ──────────────────────────────────────────────────────────────
# 1. Read MuseTalk parameters from host_profile
# ──────────────────────────────────────────────────────────────
VERSION=$(jq -r '.musetalk.version // "v15"' "$PROFILE")
BBOX_SHIFT=$(jq -r '.musetalk.bbox_shift // 0' "$PROFILE")
FPS=$(jq -r '.musetalk.fps // 25' "$PROFILE")
BATCH_SIZE=$(jq -r '.musetalk.batch_size // 1' "$PROFILE")
POLL_INTERVAL=$(jq -r '.musetalk.remote_poll_interval // 30' "$PROFILE")
MAX_POLL_MINUTES=$(jq -r '.musetalk.remote_max_poll_minutes // 180' "$PROFILE")

echo "🎭 MuseTalk 参数: version=$VERSION | bbox_shift=$BBOX_SHIFT | fps=$FPS | batch_size=$BATCH_SIZE"

# ──────────────────────────────────────────────────────────────
# 2. Upload video template and audio to server
# ──────────────────────────────────────────────────────────────
echo "🎭 上传 MuseTalk 素材到服务器..."
SERVER_INFO=$(bash scripts/upload_to_server.sh "$VIDEO_INPUT" "input/$VIDEO_BASENAME")
HOST=$(echo "$SERVER_INFO" | cut -d: -f1)
PORT=$(echo "$SERVER_INFO" | cut -d: -f2)
USER=$(echo "$SERVER_INFO" | cut -d: -f3)
WORKSPACE=$(echo "$SERVER_INFO" | cut -d: -f4)
remote_job_init "$HOST" "$PORT" "$USER"

bash scripts/upload_to_server.sh "$AUDIO_INPUT" "input/$AUDIO_BASENAME"

# ──────────────────────────────────────────────────────────────
# 3. Resolve MuseTalk path and python env on server
# ──────────────────────────────────────────────────────────────
if [ "$HOST" = "$(jq -r '.primary.host' $CONFIG)" ]; then
    MUSETALK_PATH=$(jq -r '.primary.musetalk_path' $CONFIG)
    MUSETALK_VENV=$(jq -r '.primary.musetalk_python_env' $CONFIG)
else
    MUSETALK_PATH=$(jq -r '.backup.musetalk_path' $CONFIG)
    MUSETALK_VENV=$(jq -r '.backup.musetalk_python_env' $CONFIG)
fi

if [ -z "$MUSETALK_PATH" ] || [ "$MUSETALK_PATH" = "null" ]; then
    echo "❌ 未配置 MuseTalk 路径，请先运行 bash scripts/detect_paths.sh 或在 config/servers.json 中设置 musetalk_path" >&2
    exit 1
fi

ACTIVATE_CMD=$(remote_job_activate_cmd "$MUSETALK_VENV" "/root/miniconda3")

# ──────────────────────────────────────────────────────────────
# 4. Prepare remote paths and preprocess template video
# ──────────────────────────────────────────────────────────────
REMOTE_INPUT_VIDEO="$WORKSPACE/input/$VIDEO_BASENAME"
REMOTE_INPUT_AUDIO="$WORKSPACE/input/$AUDIO_BASENAME"
REMOTE_OUTPUT_DIR="$WORKSPACE/output"
REMOTE_CONFIG="$MUSETALK_PATH/configs/inference/pipeline_${RUN_ID}.yaml"
REMOTE_PROCESSED_VIDEO="$WORKSPACE/input/video_${RUN_ID}_processed.mp4"
# MuseTalk writes to <result_dir>/<version>/output.mp4 when result_name is set
REMOTE_OUTPUT_VIDEO="$REMOTE_OUTPUT_DIR/${VERSION}/output.mp4"
REMOTE_STATUS="$REMOTE_OUTPUT_DIR/musetalk_${RUN_ID}.status"
REMOTE_PID="$REMOTE_OUTPUT_DIR/musetalk_${RUN_ID}.pid"
REMOTE_LOG="$REMOTE_OUTPUT_DIR/musetalk_${RUN_ID}.log"
REMOTE_RUNNER="$REMOTE_OUTPUT_DIR/musetalk_${RUN_ID}.sh"

AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO_INPUT" 2>/dev/null || echo "0")

echo "🎭 远端预处理模板视频（对齐音频时长 $AUDIO_DURATION s，转 ${FPS}fps）..."
ssh -p $PORT $SSH_OPTS $USER@$HOST << EOF
    set -e
    mkdir -p "$REMOTE_OUTPUT_DIR"
    TEMPLATE_DURATION=\$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$REMOTE_INPUT_VIDEO" 2>/dev/null || echo "0")
    echo "模板时长: \$TEMPLATE_DURATION s"

    if [ "\$(echo "\$TEMPLATE_DURATION < $AUDIO_DURATION" | bc -l)" = "1" ]; then
        echo "模板短于音频，循环拼接..."
        LOOP_COUNT=\$(awk -v ad="$AUDIO_DURATION" -v td="\$TEMPLATE_DURATION" 'BEGIN { n=int(ad/td)+2; if(n<2) n=2; print n }')
        ffmpeg -y -stream_loop \$LOOP_COUNT -i "$REMOTE_INPUT_VIDEO" \
            -vf "fps=$FPS,scale='min(1280,iw)':-2" \
            -t "$AUDIO_DURATION" -an -c:v libx264 -pix_fmt yuv420p -crf 18 \
            "$REMOTE_PROCESSED_VIDEO"
    else
        echo "模板不短于音频，直接截断..."
        ffmpeg -y -i "$REMOTE_INPUT_VIDEO" \
            -vf "fps=$FPS,scale='min(1280,iw)':-2" \
            -t "$AUDIO_DURATION" -an -c:v libx264 -pix_fmt yuv420p -crf 18 \
            "$REMOTE_PROCESSED_VIDEO"
    fi
EOF

# ──────────────────────────────────────────────────────────────
# 5. Generate MuseTalk inference YAML on the server
# ──────────────────────────────────────────────────────────────
echo "🎭 生成 MuseTalk 推理配置..."
# MuseTalk expects each task under a key; result_name lets us predict the output file.
ssh -p $PORT $SSH_OPTS $USER@$HOST "cat > $REMOTE_CONFIG << 'YAMLEOF'
task_0:
  video_path: $REMOTE_PROCESSED_VIDEO
  audio_path: $REMOTE_INPUT_AUDIO
  result_name: output.mp4
YAMLEOF" < /dev/null

# ──────────────────────────────────────────────────────────────
# 6. Build and submit remote MuseTalk inference job
# ──────────────────────────────────────────────────────────────
echo "🎭 执行 MuseTalk 唇形同步..."
echo "   使用路径: $MUSETALK_PATH"

# Version-specific model defaults
if [ "$VERSION" = "v15" ] || [ "$VERSION" = "1.5" ]; then
    UNET_MODEL="models/musetalkV15/unet.pth"
    UNET_CONFIG="models/musetalkV15/musetalk.json"
    VERSION_ARG="v15"
else
    UNET_MODEL="models/musetalk/pytorch_model.bin"
    UNET_CONFIG="models/musetalk/musetalk.json"
    VERSION_ARG="v1"
fi

printf -v ACTIVATE_CMD_Q '%q' "$ACTIVATE_CMD"
printf -v MUSETALK_PATH_Q '%q' "$MUSETALK_PATH"
printf -v REMOTE_STATUS_Q '%q' "$REMOTE_STATUS"

echo "🚀 通过 nohup 提交远端 MuseTalk 任务..."
REMOTE_PID_VALUE=$(remote_job_submit "$REMOTE_STATUS" "$REMOTE_PID" "$REMOTE_LOG" "$REMOTE_RUNNER" << EOF
#!/bin/bash
set -e
ACTIVATE_CMD=$ACTIVATE_CMD_Q
MUSETALK_PATH=$MUSETALK_PATH_Q
REMOTE_STATUS=$REMOTE_STATUS_Q
trap 'code=\$?; echo "\$code" > "$REMOTE_STATUS"; exit "\$code"' EXIT
if [ -n "\$ACTIVATE_CMD" ]; then
    eval "\$ACTIVATE_CMD"
fi
cd "\$MUSETALK_PATH"
python -m scripts.inference \
    --inference_config "$REMOTE_CONFIG" \
    --bbox_shift $BBOX_SHIFT \
    --version $VERSION_ARG \
    --result_dir "$REMOTE_OUTPUT_DIR" \
    --unet_model_path "$UNET_MODEL" \
    --unet_config "$UNET_CONFIG" \
    > >(tee -a "$REMOTE_LOG.stdout") 2> >(tee -a "$REMOTE_LOG.stderr" >&2)
EOF
)

if [ -z "$REMOTE_PID_VALUE" ]; then
    echo "❌ 远端 MuseTalk 任务未能启动" >&2
    exit 1
fi
echo "🧵 后台任务已启动，PID: $REMOTE_PID_VALUE"

# ──────────────────────────────────────────────────────────────
# 7. Poll remote job status
# ──────────────────────────────────────────────────────────────
remote_job_poll "MuseTalk" "$REMOTE_STATUS" "$REMOTE_PID_VALUE" "$REMOTE_OUTPUT_VIDEO" "$REMOTE_LOG" \
    "$REMOTE_LOG.stderr" "$POLL_INTERVAL" "$MAX_POLL_MINUTES"

# ──────────────────────────────────────────────────────────────
# 8. Download result
# ──────────────────────────────────────────────────────────────
echo "📥 下载 MuseTalk 唇形同步视频..."
scp -P $PORT $SSH_OPTS "$USER@$HOST:$REMOTE_OUTPUT_VIDEO" "$VIDEO_OUTPUT"

echo "✅ MuseTalk 完成: $VIDEO_OUTPUT"
