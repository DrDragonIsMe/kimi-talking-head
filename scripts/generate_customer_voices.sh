#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$PROJECT_DIR/assets/voice/female_ref_jennifer.wav"
OUT_DIR="$PROJECT_DIR/assets/voice/customers"
mkdir -p "$OUT_DIR"

if [ ! -f "$SRC" ]; then
  echo "❌ 源参考音频不存在: $SRC" >&2
  exit 1
fi

SR=$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "$SRC")
SR=${SR:-24000}

echo "🎙️  基于 $SRC 生成变调女声参考音频池（sample_rate=${SR}）..."

# 原始音色作为基准
cp "$SRC" "$OUT_DIR/voice_00.wav"

# 不同音调/语速的变体（asetrate 变调 + atempo 补偿保持时长）
PITCHES=(0.92 0.96 1.04 1.08 1.12)
for i in "${!PITCHES[@]}"; do
  num=$(printf "%02d" "$((i + 1))")
  p="${PITCHES[$i]}"
  out="$OUT_DIR/voice_${num}.wav"
  echo "  生成 voice_${num}.wav (pitch factor $p)..."
  ffmpeg -y -loglevel error -i "$SRC" \
    -af "asetrate=${SR}*${p},atempo=1/${p},aresample=${SR}" \
    -ac 1 -c:a pcm_s16le "$out"
done

echo "✅ 女声参考音频池已生成："
ls -lh "$OUT_DIR"/voice_*.wav
