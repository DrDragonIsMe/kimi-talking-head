#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$PROJECT_DIR/assets/host/customers"
mkdir -p "$OUT_DIR"

PROMPTS=(
  "A stunning young Asian woman in her mid-20s, elegant and attractive, long wavy hair, wearing a stylish fitted blazer over a silk camisole, speaking naturally to camera, charming confident smile, soft studio lighting, clean light gray background, upper body portrait, realistic, 4k, no text, no watermark"
  "A beautiful young Asian businesswoman in her late 20s, ponytail, elegant makeup, wearing a modern white blouse, speaking to camera with a warm smile, professional yet attractive, soft lighting, light background, upper body shot, realistic, 4k, no text, no watermark"
  "A gorgeous young Asian woman in her early 20s, long straight black hair, subtle makeup, wearing a stylish pastel knit top, speaking naturally to camera, sweet confident expression, soft studio lighting, clean background, upper body portrait, realistic, 4k, no text, no watermark"
  "An attractive young Asian professional woman, short stylish bob hair, wearing a sleek black turtleneck, speaking to camera with a confident smile, elegant and modern, soft lighting, light gray background, upper body shot, realistic, 4k, no text, no watermark"
  "A pretty young Asian lady in her mid-20s, loose curls, wearing a fitted light blue shirt, speaking to camera with a gentle smile, youthful and elegant, soft studio lighting, clean background, upper body portrait, realistic, 4k, no text, no watermark"
  "A charming young Asian woman in her late 20s, straight shoulder-length hair with subtle highlights, wearing a cream-colored blazer, speaking naturally to camera, confident and attractive, soft lighting, light background, upper body shot, realistic, 4k, no text, no watermark"
)

TOTAL_VIDEOS=12
MAX_POLL_ATTEMPTS=60
POLL_INTERVAL=5

submit_video_task() {
  local prompt="$1"
  bl video generate \
    --prompt "$prompt" \
    --ratio 1:1 \
    --resolution 720P \
    --duration 5 \
    --watermark false \
    --no-wait \
    --output json 2>/dev/null | jq -r '.task_id // ""'
}

poll_video_task() {
  local task_id="$1"
  local attempt=0
  while [ "$attempt" -lt "$MAX_POLL_ATTEMPTS" ]; do
    local status_json="{}"
    status_json=$(bl video task get --task-id "$task_id" --output json 2>/dev/null || echo '{}')
    local task_status="UNKNOWN"
    task_status=$(echo "$status_json" | jq -r '.task_status // "UNKNOWN"')
    if [ "$task_status" = "SUCCEEDED" ]; then
      echo "SUCCEEDED"
      return 0
    elif [ "$task_status" = "FAILED" ]; then
      echo "FAILED"
      return 1
    fi
    echo "    [wait] task ${task_id:0:8}... status: $task_status"
    sleep "$POLL_INTERVAL"
    attempt=$((attempt + 1))
  done
  echo "TIMEOUT"
  return 1
}

echo "🧹 清理旧的人物形象素材..."
rm -f "$OUT_DIR"/customer_*.mp4 "$OUT_DIR"/customer_*.png

echo "🎬 开始用 bl video generate 生成 ${TOTAL_VIDEOS} 段年轻漂亮的人物视频..."

for i in $(seq 1 "$TOTAL_VIDEOS"); do
  num=$(printf "%02d" "$i")
  prompt_idx=$(( (i - 1) % ${#PROMPTS[@]} ))
  prompt="${PROMPTS[$prompt_idx]}"
  out_video="$OUT_DIR/customer_${num}.mp4"
  out_photo="$OUT_DIR/customer_${num}.png"

  echo ""
  echo "  [$i/$TOTAL_VIDEOS] 生成 customer_${num}.mp4 ..."

  # 提交异步任务
  task_id=""
  retries=0
  while [ -z "$task_id" ] && [ "$retries" -lt 5 ]; do
    task_id=$(submit_video_task "$prompt")
    if [ -z "$task_id" ]; then
      retries=$((retries + 1))
      echo "    ⚠️  提交失败，${retries}s 后重试..."
      sleep "$retries"
    fi
  done

  if [ -z "$task_id" ]; then
    echo "❌ 无法提交视频生成任务，跳过 customer_${num}" >&2
    continue
  fi
  echo "    🚀 任务 ID: $task_id"

  # 轮询到完成
  if ! poll_video_task "$task_id"; then
    echo "❌ 视频任务失败或超时，跳过 customer_${num}" >&2
    continue
  fi

  # 下载视频
  echo "    📥 下载视频..."
  if ! bl video download --task-id "$task_id" --out "$out_video" >/dev/null 2>&1; then
    echo "❌ 下载视频失败，跳过 customer_${num}" >&2
    continue
  fi

  # 缩放到 640x640，去掉音轨（MuseTalk 只需要视频）
  ffmpeg -y -loglevel error -i "$out_video" \
    -vf "scale=640:640:force_original_aspect_ratio=increase,crop=640:640,format=yuv420p" \
    -an -r 30 -c:v libx264 -pix_fmt yuv420p \
    "$OUT_DIR/customer_${num}_tmp.mp4" && \
    mv "$OUT_DIR/customer_${num}_tmp.mp4" "$out_video"

  # 提取首帧作为照片 fallback
  ffmpeg -y -loglevel error -i "$out_video" -ss 0 -vframes 1 "$out_photo"

  echo "    ✅ customer_${num} 完成"
done

echo ""
echo "✅ 客户说人物形象视频素材已生成："
ls -lh "$OUT_DIR"/customer_*.mp4 "$OUT_DIR"/customer_*.png 2>/dev/null || true
