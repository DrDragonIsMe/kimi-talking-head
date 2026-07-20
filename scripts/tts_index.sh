#!/bin/bash
set -eo pipefail
# 注意：不开启 -u，避免远端返回空值时触发 unbound variable

source "$(dirname "${BASH_SOURCE[0]}")/lib/remote_job.sh"

TEXT_FILE=$1
OUTPUT_AUDIO=$2
CONFIG="config/servers.json"
PROFILE="${PROFILE:-config/host_profile.json}"
RUN_ID="${PIPELINE_RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
SSH_OPTS="$REMOTE_JOB_SSH_OPTS"

TEXT=$(cat "$TEXT_FILE" | tr '\n' ' ' | sed 's/  */ /g')
REFERENCE_AUDIO=$(jq -r '.voice.reference_audio' $PROFILE)

# IndexTTS 的 librosa 后端在服务器上可能不支持 m4a/mp3，先转换为 wav
REF_EXT=$(echo "${REFERENCE_AUDIO##*.}" | tr '[:upper:]' '[:lower:]')
if [ "$REF_EXT" != "wav" ]; then
    REF_BASENAME_NOEXT="$(basename "$REFERENCE_AUDIO" | sed 's/\.[^.]*$//').wav"
    REF_CONVERTED="${TEMP_DIR:-/tmp}/tts_ref_${RUN_ID}_${REF_BASENAME_NOEXT}"
    echo "🎙️ 转换参考音频为 WAV 格式: $REF_CONVERTED" >&2
    ffmpeg -y -i "$REFERENCE_AUDIO" -ar 24000 -ac 1 -c:a pcm_s16le "$REF_CONVERTED" >/dev/null 2>&1
    REFERENCE_AUDIO="$REF_CONVERTED"
fi

REF_BASENAME=$(basename "$REFERENCE_AUDIO")

# Pick a server that actually has IndexTTS installed (remote_worker.py present).
# Primary may only host InfiniteTalk lip-sync, so fall back to backup when needed.
# workers 池（P2-12）优先：remote_job_select_worker 做 round-robin + 可达性预检；
# 未配置 workers 时函数直接回退 primary，下面的 primary/backup 循环语义不变。
pick_tts_server() {
    local sel sel_key host port user tts_path workspace
    if sel=$(remote_job_select_worker "$CONFIG"); then
        sel_key=$(echo "$sel" | cut -d' ' -f1)
        host=$(echo "$sel" | cut -d' ' -f2)
        port=$(echo "$sel" | cut -d' ' -f3)
        user=$(echo "$sel" | cut -d' ' -f4)
        if [ "$sel_key" = "primary" ]; then
            tts_path=$(jq -r '.primary.tts_path // empty' $CONFIG)
            workspace=$(jq -r '.primary.tts_workspace // empty' $CONFIG)
        else
            tts_path=$(jq -r ".workers[$sel_key].tts_path // empty" $CONFIG)
            workspace=$(jq -r ".workers[$sel_key].tts_workspace // empty" $CONFIG)
        fi
        if [ -n "$tts_path" ] && [ "$tts_path" != "null" ]; then
            if ssh -p "$port" $SSH_OPTS "$user@$host" "[ -f \"$tts_path/remote_worker.py\" ]" 2>/dev/null; then
                echo "${sel_key}:${host}:${port}:${user}:${workspace}:${tts_path}"
                return 0
            fi
            # 只有真正从 workers 池选出节点时才需要回退；本来就是 primary 时提示语义要准确
            if [ "$sel_key" != "primary" ]; then
                echo "⚠️ workers[$sel_key] ($host) 缺少 remote_worker.py 或不可达，回退 primary/backup 选择逻辑" >&2
            else
                echo "⚠️ primary ($host) 缺少 remote_worker.py 或 SSH 不可达，继续尝试 backup" >&2
            fi
        fi
    fi
    for key in primary backup; do
        local host port user tts_path workspace
        host=$(jq -r ".${key}.host" $CONFIG)
        port=$(jq -r ".${key}.port" $CONFIG)
        user=$(jq -r ".${key}.user" $CONFIG)
        tts_path=$(jq -r ".${key}.tts_path" $CONFIG)
        workspace=$(jq -r ".${key}.tts_workspace" $CONFIG)
        if [ -z "$tts_path" ] || [ "$tts_path" = "null" ] || [ "$tts_path" = "" ]; then
            continue
        fi
        if ssh -p "$port" $SSH_OPTS "$user@$host" "[ -f \"$tts_path/remote_worker.py\" ]" 2>/dev/null; then
            echo "${key}:${host}:${port}:${user}:${workspace}:${tts_path}"
            return 0
        fi
        echo "⚠️ ${key} ($host) 缺少 remote_worker.py 或 SSH 不可达" >&2
    done
    return 1
}

SERVER_INFO=$(pick_tts_server) || true
if [ -z "$SERVER_INFO" ]; then
    echo "❌ 找不到可用的 IndexTTS 服务器（remote_worker.py 不存在或 SSH 不可达）" >&2
    echo "   排查: bash scripts/check_server.sh；或确认 config/servers.json 的 primary/backup/workers 配置" >&2
    exit 1
fi

SERVER_KEY=$(echo "$SERVER_INFO" | cut -d: -f1)
HOST=$(echo "$SERVER_INFO" | cut -d: -f2)
PORT=$(echo "$SERVER_INFO" | cut -d: -f3)
USER=$(echo "$SERVER_INFO" | cut -d: -f4)
WORKSPACE=$(echo "$SERVER_INFO" | cut -d: -f5)
TTS_PATH=$(echo "$SERVER_INFO" | cut -d: -f6)
# SERVER_KEY 为数字时是 workers 数组下标，否则是 primary/backup
if [[ "$SERVER_KEY" =~ ^[0-9]+$ ]]; then
    TTS_VENV=$(jq -r ".workers[$SERVER_KEY].tts_python_env // empty" $CONFIG)
else
    TTS_VENV=$(jq -r ".${SERVER_KEY}.tts_python_env" $CONFIG)
fi
remote_job_init "$HOST" "$PORT" "$USER"

echo "🎙️ 上传参考音频到服务器（$SERVER_KEY: $HOST:${PORT}）..."
REMOTE_DIR="$WORKSPACE/voice_ref"
ssh -p "$PORT" $SSH_OPTS "$USER@$HOST" "mkdir -p $REMOTE_DIR"
scp -P "$PORT" $SSH_OPTS "$REFERENCE_AUDIO" "$USER@$HOST:$REMOTE_DIR/$REF_BASENAME"

# TTS_PATH may be either the directory containing remote_worker.py or a wrapper
# script; derive the root directory accordingly.
if ssh -p "$PORT" $SSH_OPTS "$USER@$HOST" "[ -d \"$TTS_PATH\" ] && [ -f \"$TTS_PATH/remote_worker.py\" ]" 2>/dev/null; then
    TTS_ROOT="$TTS_PATH"
else
    TTS_ROOT=$(dirname "$TTS_PATH")
fi
MODEL_DIR="$TTS_ROOT/checkpoints"

echo "🎙️ 在服务器生成 TTS 音频..."
echo "   TTS 路径: $TTS_PATH"
echo "   TTS 根目录: $TTS_ROOT"
echo "   模型目录: $MODEL_DIR"

ACTIVATE_CMD=$(remote_job_activate_cmd "$TTS_VENV")

REMOTE_OUTPUT="$WORKSPACE/output/tts_output_${RUN_ID}.wav"
REMOTE_LOG="$WORKSPACE/output/tts_${RUN_ID}.log"
REMOTE_STATUS="$WORKSPACE/output/tts_${RUN_ID}.status"
REMOTE_PID="$WORKSPACE/output/tts_${RUN_ID}.pid"
REMOTE_JOB="$WORKSPACE/output/tts_${RUN_ID}.json"
REMOTE_RUNNER="$WORKSPACE/output/tts_${RUN_ID}.sh"
POLL_INTERVAL="${REMOTE_POLL_INTERVAL:-10}"
MAX_POLL_MINUTES="${REMOTE_MAX_POLL_MINUTES:-30}"

has_valid_local_audio() {
    local file="$1"
    if [ ! -s "$file" ]; then
        return 1
    fi
    local duration
    duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file" 2>/dev/null || echo "0")
    awk "BEGIN { exit !($duration > 1) }"
}

JOB_JSON=$(jq -n \
  --arg model_dir "$MODEL_DIR" \
  --arg reference_wav "$WORKSPACE/voice_ref/$REF_BASENAME" \
  --arg text "$TEXT" \
  --arg out "$REMOTE_OUTPUT" \
  '{
    model_dir: $model_dir,
    device: "cuda:0",
    use_fp16: false,
    use_cuda_kernel: false,
    use_torch_compile: false,
    reference_wav: $reference_wav,
    jobs: [
      {
        text: $text,
        out: $out
      }
    ]
  }'
)
JOB_B64=$(printf '%s' "$JOB_JSON" | base64 | tr -d '\n')

printf -v ACTIVATE_CMD_Q '%q' "$ACTIVATE_CMD"
printf -v TTS_ROOT_Q '%q' "$TTS_ROOT"
printf -v REMOTE_JOB_Q '%q' "$REMOTE_JOB"
printf -v REMOTE_STATUS_Q '%q' "$REMOTE_STATUS"

echo "🚀 通过 nohup 提交远端后台 TTS 任务..."
REMOTE_PID_VALUE=$(remote_job_submit "$REMOTE_STATUS" "$REMOTE_PID" "$REMOTE_LOG" "$REMOTE_RUNNER" "$REMOTE_JOB" \
    "printf '%s' '$JOB_B64' | base64 -d > \"$REMOTE_JOB\"" << EOF
#!/bin/bash
set -e
ACTIVATE_CMD=$ACTIVATE_CMD_Q
TTS_ROOT=$TTS_ROOT_Q
REMOTE_JOB=$REMOTE_JOB_Q
REMOTE_STATUS=$REMOTE_STATUS_Q
trap 'code=\$?; echo "\$code" > "$REMOTE_STATUS"; exit "\$code"' EXIT
if [ -n "\$ACTIVATE_CMD" ]; then
    eval "\$ACTIVATE_CMD"
fi
cd "\$TTS_ROOT"
python remote_worker.py < "\$REMOTE_JOB" > >(tee -a "${REMOTE_LOG}.stdout") 2> >(tee -a "${REMOTE_LOG}.stderr" >&2)
EOF
)

if [ -z "$REMOTE_PID_VALUE" ]; then
    echo "❌ 远端 TTS 任务未能启动" >&2
    exit 1
fi
echo "🧵 后台任务已启动，PID: $REMOTE_PID_VALUE"

remote_job_poll "TTS" "$REMOTE_STATUS" "$REMOTE_PID_VALUE" "$REMOTE_OUTPUT" "$REMOTE_LOG" \
    "$REMOTE_LOG" "$POLL_INTERVAL" "$MAX_POLL_MINUTES"

echo "📥 下载 TTS 音频到本地..."
scp -P $PORT $SSH_OPTS "$USER@$HOST:$REMOTE_OUTPUT" "$OUTPUT_AUDIO"

if ! has_valid_local_audio "$OUTPUT_AUDIO"; then
    echo "❌ 下载后的 TTS 音频无效或时长过短: $OUTPUT_AUDIO" >&2
    exit 1
fi

echo "✅ TTS 完成: $OUTPUT_AUDIO"
