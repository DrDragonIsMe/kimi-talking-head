#!/bin/bash
# render_with_reused_media.sh
# 复用已有的 TTS 音频和唇形同步视频，重新跑脚本、字幕、分镜、场景画面和 Remotion 渲染。
#
# 用法：
#   bash scripts/render_with_reused_media.sh \
#     <article.md> <output_name> <audio.wav> <lip_synced_raw.mp4> [profile.json]
#
# 说明：
# - 会从文章重新生成口播稿（script.txt）
# - 用已有音频重新 Whisper 出字幕，并用口播稿对齐
# - 重新生成分镜脚本（storyboard.json）和场景画面（scene_visuals/）
# - 复用原始唇形同步视频，只做后处理/格式统一
# - 最后调用 scripts/pipeline.sh 完成 Remotion 渲染

set -euo pipefail

ARTICLE_FILE=${1:-}
OUTPUT_NAME=${2:-}
AUDIO_SOURCE=${3:-}
LIPSYNC_RAW_SOURCE=${4:-}
PROFILE=${5:-config/host_profile.json}

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$PROJECT_DIR/temp/$OUTPUT_NAME"
OUTPUT_DIR="$PROJECT_DIR/output"

if [[ -z "$ARTICLE_FILE" || -z "$OUTPUT_NAME" || -z "$AUDIO_SOURCE" || -z "$LIPSYNC_RAW_SOURCE" ]]; then
  echo "用法: bash scripts/render_with_reused_media.sh <article.md> <output_name> <audio.wav> <lip_synced_raw.mp4> [profile.json]" >&2
  exit 1
fi

for f in "$ARTICLE_FILE" "$AUDIO_SOURCE" "$LIPSYNC_RAW_SOURCE" "$PROFILE"; do
  if [[ ! -s "$f" ]]; then
    echo "❌ 文件不存在或为空: $f" >&2
    exit 1
  fi
done

source "$PROJECT_DIR/scripts/lib/state.sh"

# 同名 run 复用时源与目标是同一文件，cp 会报 "are identical" 并中断脚本。
# macOS bash 3.2 不支持 test -ef，用 stat 比较设备号+inode（BSD/GNU 两态）。
copy_if_different() {
  local a b
  # 目标文件不存在时两条 stat 都会失败，命令替换的非零退出码会在 set -e 下中断脚本，
  # 用 || true 兜底（源文件存在性已由上方的 -s 检查保证）。
  a=$(stat -f '%d:%i' "$1" 2>/dev/null || stat -c '%d:%i' "$1" 2>/dev/null || true)
  b=$(stat -f '%d:%i' "$2" 2>/dev/null || stat -c '%d:%i' "$2" 2>/dev/null || true)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then
    return 0
  fi
  cp -f "$1" "$2"
}

has_valid_srt() {
    local file="$1"
    [ -s "$file" ] && grep -Ec '^[0-9]+$' "$file" 2>/dev/null | awk '{exit !($1 >= 3)}'
}

mkdir -p "$WORK_DIR" "$OUTPUT_DIR" "$PROJECT_DIR/public/scene_visuals/$OUTPUT_NAME"

# 1. 复用音频和原始唇形视频，并先算出音频时长
echo "🎙️  复用音频: $AUDIO_SOURCE"
copy_if_different "$AUDIO_SOURCE" "$WORK_DIR/audio.wav"

AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK_DIR/audio.wav")
AUDIO_FRAMES=$(echo "$AUDIO_DURATION * 30" | bc | cut -d. -f1)
TEMPLATE=$(jq -r '.template // "editorial"' "$PROFILE")
export AUDIO_DURATION
export AUDIO_FRAMES
export TEMPLATE

echo "🎬 复用原始唇形视频: $LIPSYNC_RAW_SOURCE"
copy_if_different "$LIPSYNC_RAW_SOURCE" "$WORK_DIR/lip_synced_raw.mp4"

# 2. 后处理：统一分辨率/帧率，并按比例拉伸唇形视频，使其时长严格等于音频
LIPSYNC_POST="$WORK_DIR/lip_synced.mp4"
RAW_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK_DIR/lip_synced_raw.mp4")
RATIO=$(echo "scale=6; $AUDIO_DURATION / $RAW_DURATION" | bc -l)
echo "🎨 后处理唇形视频：720x960 / 30fps，拉伸系数 $RATIO (音频 $AUDIO_DURATION s / 原始 $RAW_DURATION s)..."
ffmpeg -y -i "$WORK_DIR/lip_synced_raw.mp4" \
  -vf "setpts=PTS*$RATIO,scale=720:960:force_original_aspect_ratio=decrease,pad=720:960:(ow-iw)/2:(oh-ih)/2" \
  -r 30 -t "$AUDIO_DURATION" -c:v libx264 -pix_fmt yuv420p -an "$LIPSYNC_POST"

# 4. 初始化 state：只标记 tts / lipsync / postprocess 已完成
init_state "$WORK_DIR"

# 关键：复用的音频对应的是源工作目录里的口播稿，必须一起复用，
# 否则新文章重新生成的 script.txt 会和旧音频对不上，字幕就会错乱。
SOURCE_WORK_DIR="$(cd "$(dirname "$AUDIO_SOURCE")" && pwd)"
if [ -s "$SOURCE_WORK_DIR/script.txt" ]; then
    echo "📝 复用源口播稿: $SOURCE_WORK_DIR/script.txt"
    copy_if_different "$SOURCE_WORK_DIR/script.txt" "$WORK_DIR/script.txt"
    mark_completed "$WORK_DIR" script "$WORK_DIR/script.txt"
    # 同时复用原始 Whisper 输出，避免重复跑 ASR
    if [ -s "$SOURCE_WORK_DIR/subtitles_raw.json" ]; then
        echo "📝 复用源 Whisper JSON: $SOURCE_WORK_DIR/subtitles_raw.json"
        copy_if_different "$SOURCE_WORK_DIR/subtitles_raw.json" "$WORK_DIR/subtitles_raw.json"
    fi
    if has_valid_srt "$SOURCE_WORK_DIR/subtitles_raw.srt"; then
        echo "📝 复用源 Whisper SRT: $SOURCE_WORK_DIR/subtitles_raw.srt"
        copy_if_different "$SOURCE_WORK_DIR/subtitles_raw.srt" "$WORK_DIR/subtitles_raw.srt"
    fi
else
    echo "⚠️  未找到源口播稿 $SOURCE_WORK_DIR/script.txt，将重新生成（可能与音频不一致）" >&2
fi

mark_completed "$WORK_DIR" tts "$WORK_DIR/audio.wav"
mark_completed "$WORK_DIR" lipsync "$WORK_DIR/lip_synced_raw.mp4"
mark_completed "$WORK_DIR" postprocess "$WORK_DIR/lip_synced.mp4"

# 5. 调用原 pipeline，让它从 script / subtitles / storyboard / visuals / render 继续跑
echo ""
echo "🚀 启动 pipeline，复用音频与唇形视频，重新生成分镜与场景画面..."
exec bash "$PROJECT_DIR/scripts/pipeline.sh" "$ARTICLE_FILE" "$OUTPUT_NAME" "$PROFILE"
