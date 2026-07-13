#!/bin/bash
set -eo pipefail
# 注意：不开启 -u，避免远端返回空值时触发 unbound variable

TEXT_FILE=$1
OUTPUT_AUDIO=$2
CONFIG="config/servers.json"
PROFILE="${PROFILE:-config/host_profile.json}"
RUN_ID="${PIPELINE_RUN_ID:-$(date +%Y%m%d_%H%M%S)}"

TEXT=$(cat "$TEXT_FILE" | tr '\n' ' ' | sed 's/  */ /g')
REFERENCE_AUDIO=$(jq -r '.voice.reference_audio' $PROFILE)

REF_BASENAME=$(basename "$REFERENCE_AUDIO")
echo "🎙️ 上传参考音频到服务器..."
SERVER_INFO=$(bash scripts/upload_to_server.sh "$REFERENCE_AUDIO" "voice_ref/$REF_BASENAME")
HOST=$(echo "$SERVER_INFO" | cut -d: -f1)
PORT=$(echo "$SERVER_INFO" | cut -d: -f2)
USER=$(echo "$SERVER_INFO" | cut -d: -f3)
WORKSPACE=$(echo "$SERVER_INFO" | cut -d: -f4)

if [ "$HOST" = "$(jq -r '.primary.host' $CONFIG)" ]; then
    TTS_PATH=$(jq -r '.primary.tts_path' $CONFIG)
    TTS_VENV=$(jq -r '.primary.tts_python_env' $CONFIG)
else
    TTS_PATH=$(jq -r '.backup.tts_path' $CONFIG)
    TTS_VENV=$(jq -r '.backup.tts_python_env' $CONFIG)
fi

TTS_ROOT=$(dirname "$TTS_PATH")
MODEL_DIR="$TTS_ROOT/checkpoints"

echo "🎙️ 在服务器生成 TTS 音频..."
echo "   TTS 路径: $TTS_PATH"
echo "   TTS 根目录: $TTS_ROOT"
echo "   模型目录: $MODEL_DIR"

if [ -n "$TTS_VENV" ] && [ "$TTS_VENV" != "" ] && [ "$TTS_VENV" != "null" ]; then
    if echo "$TTS_VENV" | grep -q "activate"; then
        ACTIVATE_CMD="source $TTS_VENV"
    else
        ACTIVATE_CMD="conda activate $TTS_VENV"
    fi
else
    ACTIVATE_CMD=""
fi

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
ssh -p $PORT $USER@$HOST << EOF
    set -e
    mkdir -p "$WORKSPACE/output"
    rm -f "$REMOTE_STATUS" "$REMOTE_PID" "$REMOTE_LOG" "$REMOTE_JOB" "$REMOTE_RUNNER"
    printf '%s' '$JOB_B64' | base64 -d > "$REMOTE_JOB"
    cat > "$REMOTE_RUNNER" << 'REMOTE_RUNNER_EOF'
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
REMOTE_RUNNER_EOF
    chmod +x "$REMOTE_RUNNER"
    nohup bash "$REMOTE_RUNNER" > "$REMOTE_LOG" 2>&1 </dev/null &
    echo \$! > "$REMOTE_PID"
EOF

REMOTE_PID_VALUE=$(ssh -p $PORT $USER@$HOST "cat '$REMOTE_PID' 2>/dev/null || echo ''")
if [ -z "$REMOTE_PID_VALUE" ]; then
    echo "❌ 远端 TTS 任务未能启动" >&2
    exit 1
fi
echo "🧵 后台任务已启动，PID: $REMOTE_PID_VALUE"

poll_count=0
max_poll=$((MAX_POLL_MINUTES * 60 / POLL_INTERVAL))

while true; do
    poll_count=$((poll_count + 1))
    if [ "$poll_count" -gt "$max_poll" ]; then
        echo "❌ 远端 TTS 任务超时（>${MAX_POLL_MINUTES}分钟），强制终止" >&2
        ssh -p $PORT $USER@$HOST "kill '$REMOTE_PID_VALUE' 2>/dev/null || true" || true
        exit 1
    fi

    STATUS_OUTPUT=$(ssh -p $PORT $USER@$HOST "
        set -e
        if [ -f '$REMOTE_STATUS' ]; then
            printf 'status=%s\n' \"\$(cat '$REMOTE_STATUS')\"
        elif kill -0 '$REMOTE_PID_VALUE' 2>/dev/null; then
            if [ -f '$REMOTE_OUTPUT' ]; then
                SIZE=\$(wc -c < '$REMOTE_OUTPUT' 2>/dev/null || echo 0)
                printf 'running size=%s\n' \"\$SIZE\"
            else
                printf 'running size=0\n'
            fi
        else
            printf 'missing_status\n'
        fi
    " 2>/dev/null || echo "ssh_failed")

    echo "⏳ TTS 状态: $STATUS_OUTPUT"

    case "$STATUS_OUTPUT" in
        status=0*)
            REMOTE_SUMMARY=$(ssh -p $PORT $USER@$HOST "
                set -e
                if [ ! -s '$REMOTE_OUTPUT' ]; then
                    echo 'missing_output'
                    exit 0
                fi
                SIZE=\$(wc -c < '$REMOTE_OUTPUT' 2>/dev/null || echo 0)
                DURATION=\$(ffprobe -v error -show_entries format=duration -of csv=p=0 '$REMOTE_OUTPUT' 2>/dev/null || echo 0)
                if grep -Eq 'Traceback \(most recent call last\)|Error:' '$REMOTE_LOG' 2>/dev/null; then
                    echo \"warning size=\$SIZE duration=\$DURATION\"
                else
                    echo \"ok size=\$SIZE duration=\$DURATION\"
                fi
            " 2>/dev/null || echo "ssh_failed")
            echo "✅ 远端 TTS 任务完成（$REMOTE_SUMMARY）"
            break
            ;;
        status=*)
            echo "❌ 远端 TTS 任务失败，日志尾部如下：" >&2
            ssh -p $PORT $USER@$HOST "tail -n 80 '$REMOTE_LOG' '$REMOTE_LOG.stderr' 2>/dev/null" >&2 || true
            exit 1
            ;;
        running*)
            sleep "$POLL_INTERVAL"
            ;;
        ssh_failed|missing_status)
            echo "⚠️ 无法获取远端 TTS 状态，稍后重试..."
            sleep "$POLL_INTERVAL"
            ;;
        *)
            echo "❌ 远端 TTS 任务状态异常：$STATUS_OUTPUT" >&2
            ssh -p $PORT $USER@$HOST "tail -n 80 '$REMOTE_LOG' '$REMOTE_LOG.stderr' 2>/dev/null" >&2 || true
            exit 1
            ;;
    esac
done

echo "📥 下载 TTS 音频到本地..."
scp -P $PORT "$USER@$HOST:$REMOTE_OUTPUT" "$OUTPUT_AUDIO"

if ! has_valid_local_audio "$OUTPUT_AUDIO"; then
    echo "❌ 下载后的 TTS 音频无效或时长过短: $OUTPUT_AUDIO" >&2
    exit 1
fi

echo "✅ TTS 完成: $OUTPUT_AUDIO"
