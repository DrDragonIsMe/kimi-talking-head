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
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

: "${IMAGE:?--image required}"
: "${AUDIO:?--audio required}"
: "${OUTPUT:?--output required}"
: "${WORK_DIR:?--work-dir required}"

# Resolve paths relative to project dir
resolve() { realpath --relative-to="$PROJECT_DIR" "$(realpath "$1")"; }
CONFIG="$(resolve "$CONFIG")"
PROFILE="$(resolve "$PROFILE")"
WORKFLOW="$(resolve "$WORKFLOW")"
IMAGE="$(resolve "$IMAGE")"
AUDIO="$(resolve "$AUDIO")"
OUTPUT="$(resolve "$OUTPUT")"
WORK_DIR="$(resolve "$WORK_DIR")"

# Read primary server from config
HOST=$(jq -r '.primary.host // empty' "$CONFIG")
PORT=$(jq -r '.primary.port // 22' "$CONFIG")
USER=$(jq -r '.primary.user // root' "$CONFIG")
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

# If resume and local output already valid, skip entirely
if [[ "$RESUME" == "1" && -s "$LOCAL_OUTPUT" ]]; then
  DUR=$(ffprobe -v error -show_entries format=duration -of default=noprintwrappers=1:nokey=1 "$LOCAL_OUTPUT" 2>/dev/null || true)
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
run_remote "cd $REMOTE_DIR && source /root/aigc_apps/InfiniteTalk/venv/bin/activate && \
  nohup env PYTHONUNBUFFERED=1 python scripts/comfyui/generate_segments.py \
    --config $CONFIG \
    --profile $PROFILE \
    --workflow $WORKFLOW \
    --image $WORK_DIR/$(basename \"$IMAGE\") \
    --audio $WORK_DIR/$(basename \"$AUDIO\") \
    --output $WORK_DIR/$(basename \"$OUTPUT\") \
    --work-dir $WORK_DIR \
    --resume \
    > $REMOTE_LOG 2>&1 & echo \$!"

# Wait for remote process to start and log file to appear
for i in {1..30}; do
  if run_remote "test -f $REMOTE_LOG" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "⏳ 等待服务器生成完成..."
while true; do
  TAIL=$(run_remote "tail -n 20 $REMOTE_LOG 2>/dev/null || true")
  if echo "$TAIL" | grep -qE '\[Done\]|\[Cleanup\]|RuntimeError|Traceback|ERROR'; then
    break
  fi
  REMOTE_SIZE=$(run_remote "ls -lh $REMOTE_DIR/$OUTPUT 2>/dev/null | awk '{print \$5}' || echo n/a")
  echo "$(date '+%H:%M:%S') 服务器输出: $REMOTE_SIZE"
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
DUR=$(ffprobe -v error -show_entries format=duration -of default=noprintwrappers=1:nokey=1 "$LOCAL_OUTPUT" 2>/dev/null || true)
if [[ -z "$DUR" || "${DUR%.*}" -le 0 ]]; then
  echo "❌ 下载后的视频时长异常: $LOCAL_OUTPUT" >&2
  exit 1
fi
echo "✅ 本地输出时长: ${DUR}s"

if [[ "$KEEP_REMOTE" != "1" ]]; then
  echo "🧹 清理服务器端临时目录..."
  run_remote "rm -rf $REMOTE_DIR"
fi

echo "✅ 服务器端生成完成: $LOCAL_OUTPUT"
