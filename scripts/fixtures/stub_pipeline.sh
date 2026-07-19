#!/bin/bash
# 测试用假 pipeline：秒回成功并伪造 pipeline 产物。
# 兼容两种调用签名（只取前两个参数）：
#   pipeline.sh <article> <outputName> [profile]
#   render_with_reused_media.sh <article> <outputName> <audio> <lip> [profile]
set -euo pipefail

ARTICLE_FILE=${1:-}
OUTPUT_NAME=${2:-}
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORK_DIR="$PROJECT_DIR/temp/$OUTPUT_NAME"
OUTPUT_DIR="$PROJECT_DIR/output"

if [[ -z "$ARTICLE_FILE" || -z "$OUTPUT_NAME" ]]; then
  echo "用法: stub_pipeline.sh <article> <outputName> [...]" >&2
  exit 1
fi

sleep 0.2

mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

# 9 阶段全部 completed 的状态文件
{
  printf '{\n'
  first=1
  for phase in script tts whisper subtitles storyboard visuals lipsync postprocess render; do
    if [[ $first -eq 0 ]]; then printf ',\n'; fi
    first=0
    printf '  "%s": {"status":"completed","started_at":"2026-01-01T00:00:00Z","completed_at":"2026-01-01T00:00:01Z","output":null,"attempt":1,"error":null}' "$phase"
  done
  printf '\n}\n'
} > "$WORK_DIR/.pipeline_state.json"

# 伪造媒体（Rebuild 的前置条件）与产物（server 成功校验：video>10000B、cover>5000B）
head -c 1024 /dev/zero > "$WORK_DIR/audio.wav"
head -c 1024 /dev/zero > "$WORK_DIR/lip_synced_raw.mp4"
head -c 20000 /dev/zero > "$OUTPUT_DIR/$OUTPUT_NAME.mp4"
head -c 10000 /dev/zero > "$OUTPUT_DIR/${OUTPUT_NAME}_cover.png"

echo "stub pipeline done: $OUTPUT_NAME"
