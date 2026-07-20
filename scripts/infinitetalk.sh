#!/bin/bash
set -e

source "$(dirname "${BASH_SOURCE[0]}")/lib/remote_job.sh"

PHOTO_INPUT=$1
AUDIO_INPUT=$2
VIDEO_OUTPUT=$3
CONFIG="config/servers.json"
PROFILE="${PROFILE:-config/host_profile.json}"
RUN_ID="${PIPELINE_RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
SSH_OPTS="$REMOTE_JOB_SSH_OPTS"

PHOTO_BASENAME=$(basename "$PHOTO_INPUT")
AUDIO_BASENAME=$(basename "$AUDIO_INPUT")

# 从 host_profile 读取 InfiniteTalk 参数，提供默认值
SIZE=$(jq -r '.infinitetalk.size // "infinitetalk-480"' "$PROFILE")
SAMPLE_STEPS=$(jq -r '.infinitetalk.sample_steps // 40' "$PROFILE")
MOTION_FRAME=$(jq -r '.infinitetalk.motion_frame // 9' "$PROFILE")
MODE=$(jq -r '.infinitetalk.mode // "streaming"' "$PROFILE")
TEXT_GUIDE_SCALE=$(jq -r '.infinitetalk.text_guide_scale // 5.0' "$PROFILE")
AUDIO_GUIDE_SCALE=$(jq -r '.infinitetalk.audio_guide_scale // 4.0' "$PROFILE")
NUM_PERSISTENT=$(jq -r '.infinitetalk.num_persistent_param_in_dit // 0' "$PROFILE")
QUANT=$(jq -r '.infinitetalk.quant // "fp8"' "$PROFILE")
QUANT_DIR=$(jq -r '.infinitetalk.quant_dir // "weights/InfiniteTalk/quant_models/infinitetalk_single_fp8.safetensors"' "$PROFILE")
USE_TEACACHE=$(jq -r '.infinitetalk.use_teacache // true' "$PROFILE")
TEACACHE_THRESH=$(jq -r '.infinitetalk.teacache_thresh // 0.2' "$PROFILE")
MAX_FRAME_NUM=$(jq -r '.infinitetalk.max_frame_num // 5000' "$PROFILE")
LORA_DIR=$(jq -r '.infinitetalk.lora_dir // ""' "$PROFILE")
LORA_SCALE=$(jq -r '.infinitetalk.lora_scale // 1.0' "$PROFILE")
SAMPLE_SHIFT=$(jq -r '.infinitetalk.sample_shift // 7' "$PROFILE")
USE_APG=$(jq -r '.infinitetalk.use_apg // false' "$PROFILE")

# InfiniteTalk 内部按 25fps 处理音频 embedding，帧数需满足 4n+1 且小于音频 embedding 长度
AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO_INPUT" 2>/dev/null || echo "0")
FRAME_NUM=$(awk -v dur="$AUDIO_DURATION" -v fps=25 'BEGIN {
    emb_len = dur * fps;
    # 留 2 帧余量，避免 audio embedding 长度不足
    n = int((emb_len - 2) / 4);
    if (n < 4) n = 4;
    print n * 4 + 1;
}')

if [ -n "$MAX_FRAME_NUM" ] && [ "$MAX_FRAME_NUM" != "null" ] && [ "$FRAME_NUM" -gt "$MAX_FRAME_NUM" ]; then
    echo "⚠️  计算帧数 $FRAME_NUM 超过最大限制 ${MAX_FRAME_NUM}，已截断" >&2
    FRAME_NUM=$MAX_FRAME_NUM
fi

echo "🎭 上传素材到服务器..."
SERVER_INFO=$(bash scripts/upload_to_server.sh "$PHOTO_INPUT" "input/$PHOTO_BASENAME")
HOST=$(echo "$SERVER_INFO" | cut -d: -f1)
PORT=$(echo "$SERVER_INFO" | cut -d: -f2)
USER=$(echo "$SERVER_INFO" | cut -d: -f3)
WORKSPACE=$(echo "$SERVER_INFO" | cut -d: -f4)
remote_job_init "$HOST" "$PORT" "$USER"

bash scripts/upload_to_server.sh "$AUDIO_INPUT" "input/$AUDIO_BASENAME"

if [ "$HOST" = "$(jq -r '.primary.host' $CONFIG)" ]; then
    INFINITE_PATH=$(jq -r '.primary.infinitetalk_path' $CONFIG)
    INFINITE_VENV=$(jq -r '.primary.infinitetalk_python_env' $CONFIG)
else
    INFINITE_PATH=$(jq -r '.backup.infinitetalk_path' $CONFIG)
    INFINITE_VENV=$(jq -r '.backup.infinitetalk_python_env' $CONFIG)
fi

# 激活 conda 环境时需要先 source conda.sh
ACTIVATE_CMD=$(remote_job_activate_cmd "$INFINITE_VENV" "/root/miniconda3")

echo "🎭 执行 InfiniteTalk 唇形同步..."
echo "   使用路径: $INFINITE_PATH"
echo "   分辨率: $SIZE | 采样步数: $SAMPLE_STEPS | 运动帧: $MOTION_FRAME | 模式: $MODE | 量化: $QUANT | TeaCache: $USE_TEACACHE | 帧数: $FRAME_NUM"

REMOTE_OUTPUT="$WORKSPACE/output/lip_synced_${RUN_ID}.mp4"
REMOTE_STATUS="$WORKSPACE/output/infinitetalk_${RUN_ID}.status"
REMOTE_PID="$WORKSPACE/output/infinitetalk_${RUN_ID}.pid"
REMOTE_LOG="$WORKSPACE/output/infinitetalk_${RUN_ID}.log"
REMOTE_RUNNER="$WORKSPACE/output/infinitetalk_${RUN_ID}.sh"
POLL_INTERVAL="${REMOTE_POLL_INTERVAL:-30}"
MAX_POLL_MINUTES="${REMOTE_MAX_POLL_MINUTES:-180}"

# 在服务器上创建 InfiniteTalk 输入 JSON
ssh -p $PORT $SSH_OPTS $USER@$HOST "mkdir -p $WORKSPACE/output" < /dev/null
ssh -p $PORT $SSH_OPTS $USER@$HOST "cat > $WORKSPACE/input_${RUN_ID}.json << 'JSONEOF'
{
  \"prompt\": \"A person is talking naturally, clear facial expressions and moderate head movements, stable upper body posture\",
  \"cond_video\": \"$WORKSPACE/input/$PHOTO_BASENAME\",
  \"cond_audio\": {
    \"person1\": \"$WORKSPACE/input/$AUDIO_BASENAME\"
  }
}
JSONEOF" < /dev/null

# 构建 generate_infinitetalk.py 命令
CMD_ARGS="--task infinitetalk-14B --ckpt_dir weights/Wan2.1-I2V-14B-480P --wav2vec_dir weights/chinese-wav2vec2-base --infinitetalk_dir weights/InfiniteTalk --quant $QUANT --quant_dir $QUANT_DIR --input_json $WORKSPACE/input_${RUN_ID}.json --size $SIZE --frame_num $FRAME_NUM --max_frame_num $MAX_FRAME_NUM --sample_steps $SAMPLE_STEPS --sample_shift $SAMPLE_SHIFT --mode $MODE --motion_frame $MOTION_FRAME --audio_mode localfile --sample_text_guide_scale $TEXT_GUIDE_SCALE --sample_audio_guide_scale $AUDIO_GUIDE_SCALE --num_persistent_param_in_dit $NUM_PERSISTENT"
if [ "$USE_TEACACHE" = "true" ]; then
    CMD_ARGS="$CMD_ARGS --use_teacache --teacache_thresh $TEACACHE_THRESH"
fi
if [ -n "$LORA_DIR" ] && [ "$LORA_DIR" != "null" ]; then
    CMD_ARGS="$CMD_ARGS --lora_dir $LORA_DIR --lora_scale $LORA_SCALE"
fi
if [ "$USE_APG" = "true" ]; then
    CMD_ARGS="$CMD_ARGS --use_apg"
fi
CMD_ARGS="$CMD_ARGS --save_file $WORKSPACE/output/lip_synced_${RUN_ID}"

printf -v ACTIVATE_CMD_Q '%q' "$ACTIVATE_CMD"
printf -v INFINITE_PATH_Q '%q' "$INFINITE_PATH"
printf -v CMD_ARGS_Q '%q' "$CMD_ARGS"
printf -v REMOTE_STATUS_Q '%q' "$REMOTE_STATUS"

echo "🚀 通过 nohup 提交远端后台 InfiniteTalk 任务..."
REMOTE_PID_VALUE=$(remote_job_submit "$REMOTE_STATUS" "$REMOTE_PID" "$REMOTE_LOG" "$REMOTE_RUNNER" << EOF
#!/bin/bash
set -e
ACTIVATE_CMD=$ACTIVATE_CMD_Q
INFINITE_PATH=$INFINITE_PATH_Q
CMD_ARGS=$CMD_ARGS_Q
REMOTE_STATUS=$REMOTE_STATUS_Q
trap 'code=\$?; echo "\$code" > "$REMOTE_STATUS"; exit "\$code"' EXIT
if [ -n "\$ACTIVATE_CMD" ]; then
    eval "\$ACTIVATE_CMD"
fi
export CUDA_HOME=/root/miniconda3/envs/multitalk
cd "\$INFINITE_PATH"
python generate_infinitetalk.py \$CMD_ARGS > >(tee -a "$REMOTE_LOG.stdout") 2> >(tee -a "$REMOTE_LOG.stderr" >&2)
EOF
)

if [ -z "$REMOTE_PID_VALUE" ]; then
    echo "❌ 远端 InfiniteTalk 任务未能启动" >&2
    exit 1
fi
echo "🧵 后台任务已启动，PID: $REMOTE_PID_VALUE"

remote_job_poll "InfiniteTalk" "$REMOTE_STATUS" "$REMOTE_PID_VALUE" "$REMOTE_OUTPUT" "$REMOTE_LOG" \
    "$REMOTE_LOG.stderr" "$POLL_INTERVAL" "$MAX_POLL_MINUTES"

echo "📥 下载唇形同步视频..."
scp -P $PORT $SSH_OPTS "$USER@$HOST:$REMOTE_OUTPUT" "$VIDEO_OUTPUT"

echo "✅ InfiniteTalk 完成: $VIDEO_OUTPUT"
