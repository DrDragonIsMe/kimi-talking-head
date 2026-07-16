#!/bin/bash
set -euo pipefail

# run_server_side.sh — run ComfyUI/InfiniteTalk generation directly on the ComfyUI host.
# This avoids long-lived SSH tunnels from the local machine.
#
# Usage:
#   bash scripts/comfyui/run_server_side.sh \
#       --config config/servers.json \
#       --profile config/host_profile.json \
#       --workflow scripts/comfyui/workflow_prompt.json \
#       --image temp/<run>/host_resized.jpg \
#       --audio temp/<run>/audio.wav \
#       --output temp/<run>/lip_synced_raw.mp4 \
#       --work-dir temp/<run>
#
# Environment:
#   COMFYUI_REMOTE_DIR   base directory on server (default: /root/aigc_apps/guthrie_run)
#   KEEP_REMOTE          if 1, do not delete remote work dir after download

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

CONFIG="${CONFIG:-config/servers.json}"
PROFILE="${PROFILE:-config/host_profile.json}"
WORKFLOW="${WORKFLOW:-scripts/comfyui/workflow_prompt.json}"
REMOTE_BASE="${COMFYUI_REMOTE_DIR:-/root/aigc_apps/guthrie_run}"
KEEP_REMOTE="${KEEP_REMOTE:-0}"
RESUME=0
FORCE=0

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2;;
    --profile) PROFILE="$2"; shift 2;;
    --workflow) WORKFLOW="$2"; shift 2;;
    --image) IMAGE="$2"; shift 2;;
    --audio) AUDIO="$2"; shift 2;;
    --output) OUTPUT="$2"; shift 2;;
    --work-dir) WORK_DIR="$2"; shift 2;;
    --resume) RESUME=1; shift;;
    --force) FORCE=1; shift;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

: "${IMAGE:?--image required}"
: "${AUDIO:?--audio required}"
: "${OUTPUT:?--output required}"
: "${WORK_DIR:?--work-dir required}"

# Resolve paths relative to project dir (portable: works on macOS and Linux).
set +H
resolve() { python3 -c "import os,sys; print(os.path.relpath(os.path.realpath(sys.argv[1]), os.path.realpath(sys.argv[2])))" "$1" "$PROJECT_DIR"; }
CONFIG="$(resolve "$CONFIG")"
PROFILE="$(resolve "$PROFILE")"
WORKFLOW="$(resolve "$WORKFLOW")"
IMAGE="$(resolve "$IMAGE")"
AUDIO="$(resolve "$AUDIO")"
OUTPUT="$(resolve "$OUTPUT")"
WORK_DIR="$(resolve "$WORK_DIR")"

# Read primary server from config
HOST=$(jq -r '.primary.host // empty' "$CONFIG")
PORT=$(jq -r '.primary.port // "22"' "$CONFIG")
USER=$(jq -r '.primary.user // "root"' "$CONFIG")
if [[ -z "$HOST" || "$HOST" == "null" ]]; then
  echo "❌ config/servers.json primary.host missing" >&2
  exit 1
fi

RUN_ID=$(basename "$WORK_DIR")
REMOTE_DIR="$REMOTE_BASE/$RUN_ID"
REMOTE_LOG="$REMOTE_DIR/lipsync.log"
LOCAL_OUTPUT="$PROJECT_DIR/$OUTPUT"

SSH_OPTS=(-o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=10)
RSYNC_SSH="ssh -p $PORT -o ConnectTimeout=10 -o BatchMode=yes"

run_remote() {
  ssh "${SSH_OPTS[@]}" -p "$PORT" "$USER@$HOST" "$@"
}

# If resume and local output already valid, skip entirely — unless force regeneration.
if [[ "$FORCE" == "1" ]]; then
  echo "🧹 --force 指定，清除已有本地输出与分段缓存"
  rm -f "$LOCAL_OUTPUT"
  rm -f "${LOCAL_OUTPUT%.mp4}"_seg*.mp4
  # Also clear any stale remote segments/output so the server does not reuse them.
  echo "🧹 --force 指定，清除服务器端旧输出与分段缓存"
  run_remote "rm -f $REMOTE_DIR/$OUTPUT ${REMOTE_DIR}/${WORK_DIR}/lip_synced_raw_seg*.mp4" || true
elif [[ "$RESUME" == "1" && -s "$LOCAL_OUTPUT" ]]; then
  DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$LOCAL_OUTPUT" 2>/dev/null || true)
  if [[ -n "$DUR" && "${DUR%.*}" -gt 0 ]]; then
    echo "♻️  本地已有有效输出，跳过服务器端生成: $LOCAL_OUTPUT"
    exit 0
  fi
fi

echo "🚀 准备服务器端生成环境: $USER@$HOST:$REMOTE_DIR"
run_remote "mkdir -p $REMOTE_DIR/scripts/comfyui $REMOTE_DIR/config $REMOTE_DIR/$WORK_DIR"

# Sync code, config and media incrementally
rsync -avz --delete -e "$RSYNC_SSH" \
  "$PROJECT_DIR/$WORKFLOW" \
  "$PROJECT_DIR/scripts/comfyui/comfyui_client.py" \
  "$PROJECT_DIR/scripts/comfyui/generate_segments.py" \
  "$USER@$HOST:$REMOTE_DIR/scripts/comfyui/"

rsync -avz --delete -e "$RSYNC_SSH" \
  "$PROJECT_DIR/$PROFILE" \
  "$PROJECT_DIR/$CONFIG" \
  "$USER@$HOST:$REMOTE_DIR/config/"

rsync -avz -e "$RSYNC_SSH" \
  "$PROJECT_DIR/$IMAGE" \
  "$PROJECT_DIR/$AUDIO" \
  "$USER@$HOST:$REMOTE_DIR/$WORK_DIR/"

echo "🎬 在服务器上启动生成（无 SSH 隧道）..."
REMOTE_RUNNER="$REMOTE_DIR/runner.sh"
REMOTE_LOCK="$REMOTE_DIR/.generate_segments.lock"
# Write a runner script on the remote side to avoid local quoting/escaping issues.
# The runner uses a PID lock so only ONE generate_segments.py process can run
# per RUN_ID. If a previous process is still alive, we attach to it instead of
# starting a duplicate, which would waste GPU memory and queue slots.
run_remote "cat > $REMOTE_RUNNER << 'REMOTE_EOF'
#!/bin/bash
set +u
cd $REMOTE_DIR
LOCK_FILE=\"$REMOTE_LOCK\"
if [[ -f \"\$LOCK_FILE\" ]]; then
  OLD_PID=\$(cat \"\$LOCK_FILE\" 2>/dev/null || true)
  if [[ -n \"\$OLD_PID\" ]] && ps -p \"\$OLD_PID\" >/dev/null 2>&1; then
    echo \"Found existing generator process PID=\$OLD_PID for run $RUN_ID, attaching instead of starting new one.\"
    echo \$OLD_PID
    exit 0
  else
    echo \"Stale lock file found (PID=\$OLD_PID not running), starting new process.\"
    rm -f \"\$LOCK_FILE\"
  fi
fi
source /root/aigc_apps/InfiniteTalk/venv/bin/activate
IMAGE_BASENAME=\$(basename $IMAGE)
AUDIO_BASENAME=\$(basename $AUDIO)
OUTPUT_BASENAME=\$(basename $OUTPUT)
nohup env PYTHONUNBUFFERED=1 python scripts/comfyui/generate_segments.py \
  --config $CONFIG \
  --profile $PROFILE \
  --workflow $WORKFLOW \
  --image $WORK_DIR/\$IMAGE_BASENAME \
  --audio $WORK_DIR/\$AUDIO_BASENAME \
  --output $WORK_DIR/\$OUTPUT_BASENAME \
  --work-dir $WORK_DIR \
  --resume \
  > $REMOTE_LOG 2>&1 &
PID=\$!
echo \$PID > \"\$LOCK_FILE\"
echo \$PID
REMOTE_EOF
chmod +x $REMOTE_RUNNER
bash $REMOTE_RUNNER"

# Wait for remote process to start and log file to appear
for i in {1..30}; do
  if run_remote "test -f $REMOTE_LOG" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "⏳ 等待服务器生成完成..."
GPU_ZERO_STREAK=0
MAX_GPU_ZERO_STREAK=3
CHECK_COUNT=0
while true; do
  TAIL=$(run_remote "tail -n 30 $REMOTE_LOG 2>/dev/null || true")
  if echo "$TAIL" | grep -qE '\[Done\]|\[Cleanup\]|RuntimeError|Traceback|ERROR'; then
    break
  fi

  # Probe GPU utilization and memory to distinguish "busy" from "dead".
  GPU_INFO=$(run_remote "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null || echo 'n/a, n/a, n/a'")
  GPU_UTIL=$(echo "$GPU_INFO" | cut -d',' -f1 | tr -d ' %')
  GPU_MEM=$(echo "$GPU_INFO" | cut -d',' -f2 | tr -d ' ')
  GPU_MEM_TOTAL=$(echo "$GPU_INFO" | cut -d',' -f3 | tr -d ' ')

  # Show latest log line (most informative) and progress metrics.
  LATEST_LOG_LINE=$(echo "$TAIL" | grep -v '^$' | tail -n 1)
  REMOTE_SIZE=$(run_remote "ls -lh $REMOTE_DIR/$OUTPUT 2>/dev/null | awk '{print \$5}' || echo n/a")
  SEG_COUNT=$(run_remote "ls $REMOTE_DIR/$WORK_DIR/lip_synced_raw_seg*.mp4 2>/dev/null | wc -l")
  echo "$(date '+%H:%M:%S') GPU=${GPU_UTIL}% MEM=${GPU_MEM}/${GPU_MEM_TOTAL} SEGS=${SEG_COUNT} SIZE=${REMOTE_SIZE} LOG: ${LATEST_LOG_LINE:-(no new log)}"

  # Stall detection: if GPU reads 0% for several consecutive checks while the
  # process still exists, the job may have hung or crashed silently.
  if [[ "$GPU_UTIL" =~ ^[0-9]+$ && "$GPU_UTIL" -eq 0 ]]; then
    GPU_ZERO_STREAK=$((GPU_ZERO_STREAK + 1))
    if [[ "$GPU_ZERO_STREAK" -ge "$MAX_GPU_ZERO_STREAK" ]]; then
      PID_ALIVE=$(run_remote "pgrep -f 'generate_segments.py.*$RUN_ID' >/dev/null && echo yes || echo no")
      if [[ "$PID_ALIVE" == "yes" ]]; then
        echo "⚠️  GPU utilization has been 0% for ${MAX_GPU_ZERO_STREAK} consecutive checks; process is still alive but may be stalled." >&2
      else
        echo "❌ GPU utilization has been 0% for ${MAX_GPU_ZERO_STREAK} consecutive checks and the generator process is gone." >&2
        run_remote "tail -n 120 $REMOTE_LOG" >&2
        exit 1
      fi
    fi
  else
    GPU_ZERO_STREAK=0
  fi

  CHECK_COUNT=$((CHECK_COUNT + 1))
  sleep 60
done

# Check success
if ! run_remote "test -f $REMOTE_DIR/$OUTPUT" 2>/dev/null; then
  echo "❌ 服务器端生成失败，日志如下：" >&2
  run_remote "tail -n 120 $REMOTE_LOG" >&2
  exit 1
fi

echo "⬇️  下载生成结果到本地..."
mkdir -p "$(dirname "$LOCAL_OUTPUT")"
rsync -avz -e "$RSYNC_SSH" "$USER@$HOST:$REMOTE_DIR/$OUTPUT" "$LOCAL_OUTPUT"

# Validate downloaded output
DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$LOCAL_OUTPUT" 2>/dev/null || true)
if [[ -z "$DUR" || "${DUR%.*}" -le 0 ]]; then
  echo "❌ 下载后的视频时长异常: $LOCAL_OUTPUT" >&2
  exit 1
fi
echo "✅ 本地输出时长: ${DUR}s"

# Remove the singleton lock now that generation finished successfully.
run_remote "rm -f $REMOTE_LOCK" >/dev/null 2>&1 || true

if [[ "$KEEP_REMOTE" != "1" ]]; then
  echo "🧹 清理服务器端临时目录..."
  run_remote "rm -rf $REMOTE_DIR"
fi

echo "✅ 服务器端生成完成: $LOCAL_OUTPUT"
