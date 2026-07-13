#!/bin/bash
set -e

AUDIO_INPUT=$1
OUTPUT_DIR=$2
MODEL=${3:-medium}

whisper "$AUDIO_INPUT" \
    --model "$MODEL" \
    --language zh \
    --output_format srt \
    --output_dir "$OUTPUT_DIR"

echo "✅ 字幕生成完成"
