#!/bin/bash
set -e

AUDIO_INPUT=$1
OUTPUT_DIR=$2
MODEL=${3:-${WHISPER_MODEL:-turbo}}

# Output both SRT and JSON. JSON includes word-level timestamps, which the
# subtitle aligner uses to map the exact script text onto the audio.
whisper "$AUDIO_INPUT" \
    --model "$MODEL" \
    --language zh \
    --output_format all \
    --word_timestamps True \
    --output_dir "$OUTPUT_DIR"

echo "✅ 字幕生成完成（SRT + JSON 带词级时间戳）"
