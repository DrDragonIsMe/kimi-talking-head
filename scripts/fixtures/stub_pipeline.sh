#!/bin/bash
# 测试用假 pipeline：秒回成功并伪造 pipeline 产物。
# 兼容两种调用签名（只取前两个参数）：
#   pipeline.sh <article> <outputName> [profile]
#   render_with_reused_media.sh <article> <outputName> <audio> <lip> [profile]
#
# 与 init_state 语义一致：.pipeline_state.json 已存在时不覆盖，
# 以便测试观察版本化重跑（api/versioning.js prepareReuseWorkdir）写入的阶段重置结果。
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

# 9 阶段全部 completed 的状态文件（已存在则不覆盖，同 init_state）
STATE_FILE="$WORK_DIR/.pipeline_state.json"
if [[ ! -f "$STATE_FILE" ]]; then
  {
    printf '{\n'
    first=1
    for phase in script tts whisper subtitles storyboard visuals lipsync postprocess render; do
      if [[ $first -eq 0 ]]; then printf ',\n'; fi
      first=0
      case "$phase" in
        script)      output="$WORK_DIR/script.txt" ;;
        tts)         output="$WORK_DIR/audio.wav" ;;
        whisper)     output="$WORK_DIR/subtitles_raw.json" ;;
        subtitles)   output="$WORK_DIR/subtitles.srt" ;;
        storyboard)  output="$WORK_DIR/storyboard.json" ;;
        visuals)     output="$WORK_DIR/scene_visuals.json" ;;
        lipsync)     output="$WORK_DIR/lip_synced_raw.mp4" ;;
        postprocess) output="$WORK_DIR/lip_synced.mp4" ;;
        render)      output="$OUTPUT_DIR/$OUTPUT_NAME.mp4" ;;
      esac
      printf '  "%s": {"status":"completed","started_at":"2026-01-01T00:00:00Z","completed_at":"2026-01-01T00:00:01Z","output":"%s","attempt":1,"error":null}' "$phase" "$output"
    done
    printf '\n}\n'
  } > "$STATE_FILE"
fi

# 伪造媒体（Rebuild 的前置条件）与产物（server 成功校验：video>10000B、cover>5000B）
head -c 1024 /dev/zero > "$WORK_DIR/audio.wav"
head -c 1024 /dev/zero > "$WORK_DIR/lip_synced_raw.mp4"
head -c 20000 /dev/zero > "$OUTPUT_DIR/$OUTPUT_NAME.mp4"
head -c 10000 /dev/zero > "$OUTPUT_DIR/${OUTPUT_NAME}_cover.png"

echo "stub pipeline done: $OUTPUT_NAME"
