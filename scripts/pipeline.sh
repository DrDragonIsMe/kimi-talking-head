#!/bin/bash
set -euo pipefail

ARTICLE_FILE=${1:-}
OUTPUT_NAME=${2:-video_$(date +%Y%m%d_%H%M%S)}
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_ROOT="$PROJECT_DIR/temp"
WORK_DIR="$TEMP_ROOT/$OUTPUT_NAME"
OUTPUT_DIR="$PROJECT_DIR/output"
# 主播配置：第 3 个位置参数 > HOST_PROFILE 环境变量（后端多主播切换传入，绝对路径）> 默认 config/host_profile.json
PROFILE="${3:-${HOST_PROFILE:-$PROJECT_DIR/config/host_profile.json}}"
CONFIG="$PROJECT_DIR/config/servers.json"

source "$PROJECT_DIR/scripts/monitor_utils.sh"
source "$PROJECT_DIR/scripts/lib/state.sh"

# Load local environment variables (API keys, etc.)
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

if [ -z "$ARTICLE_FILE" ]; then
    echo "用法: bash scripts/pipeline.sh <article_file> [output_name]" >&2
    exit 1
fi

if [ ! -f "$ARTICLE_FILE" ]; then
    echo "❌ 文章文件不存在: $ARTICLE_FILE" >&2
    exit 1
fi

# Pre-flight：host 配置校验（字幕 DNA 等），无效配置在此明确报错退出，
# 避免渲染层静默回退 classic 后用户难以排查。
bash "$PROJECT_DIR/scripts/lib/validate_config.sh" "$PROFILE"

export PIPELINE_RUN_ID="${PIPELINE_RUN_ID:-${OUTPUT_NAME}_$(date +%Y%m%d_%H%M%S)}"
export PROFILE
export WHISPER_MODEL="${WHISPER_MODEL:-turbo}"
if [ "$(uname -s)" = "Darwin" ]; then
    export PIPELINE_MONITOR_NOTIFY="${PIPELINE_MONITOR_NOTIFY:-1}"
else
    export PIPELINE_MONITOR_NOTIFY="${PIPELINE_MONITOR_NOTIFY:-0}"
fi

# Storyboard drives scene visuals; if we force-regenerate the storyboard,
# the downstream visuals are likely stale and should also be regenerated.
# 必须 export：prepare_scene_visuals.js 通过 process.env.FORCE_VISUALS 读取该值。
if [ "${FORCE_STORYBOARD:-0}" = "1" ]; then
    export FORCE_VISUALS=1
fi

mkdir -p "$TEMP_ROOT" "$WORK_DIR" "$OUTPUT_DIR"

init_state "$WORK_DIR"
print_state "$WORK_DIR"

monitor_init "$WORK_DIR/monitor" "$PIPELINE_RUN_ID" "$WORK_DIR"

CURRENT_PHASE="bootstrap"

pipeline_finish() {
    local exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        if [ -n "${CURRENT_PHASE:-}" ]; then
            mark_failed "$WORK_DIR" "$CURRENT_PHASE" "exit code $exit_code"
        fi
        monitor_phase "$CURRENT_PHASE" "failed" "流水线执行失败" "$(jq -cn --arg output "$OUTPUT_NAME" '{outputName: $output}')"
    else
        monitor_phase "pipeline" "completed" "整条流水线执行完成" "$(jq -cn --arg output "$OUTPUT_NAME" --arg workDir "$WORK_DIR" '{outputName: $output, workDir: $workDir}')"
    fi
}

trap pipeline_finish EXIT

log_step() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

probe_duration() {
    ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"
}

has_valid_audio() {
    local file="$1"
    if [ ! -s "$file" ]; then
        return 1
    fi
    local duration
    duration=$(probe_duration "$file" 2>/dev/null || echo "0")
    awk "BEGIN { exit !($duration > 1) }"
}

has_valid_srt() {
    local file="$1"
    if [ ! -s "$file" ]; then
        return 1
    fi
    local cue_count
    cue_count=$(grep -Ec '^[0-9]+$' "$file" 2>/dev/null || echo 0)
    [ "${cue_count:-0}" -ge 3 ]
}

has_valid_video() {
    local file="$1"
    local min_duration="$2"
    if [ ! -s "$file" ]; then
        return 1
    fi
    local duration
    duration=$(probe_duration "$file" 2>/dev/null || echo "0")
    awk "BEGIN { exit !($duration >= $min_duration) }"
}

has_valid_cover() {
    local file="$1"
    [ -s "$file" ] && [ "$(wc -c < "$file" 2>/dev/null || echo 0)" -ge 5000 ]
}

has_valid_scene_visuals() {
  local file="$1"
  if [ ! -s "$file" ]; then
    return 1
  fi
  node - "$file" <<'EOF' >/dev/null 2>&1
const fs = require('fs');
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
process.exit(Array.isArray(data) && data.length > 0 ? 0 : 1);
EOF
}

storyboard_enabled() {
  jq -e '.scene_visuals.storyboard.enabled // true' "$PROFILE" >/dev/null 2>&1
}

has_valid_storyboard() {
  local file="$1"
  if ! storyboard_enabled; then
    return 0
  fi
  if [ ! -s "$file" ]; then
    return 1
  fi
  node - "$file" <<'EOF' >/dev/null 2>&1
const fs = require('fs');
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
process.exit(Array.isArray(data) && data.length > 0 && data.every((s) => s.id && s.visual_prompt) ? 0 : 1);
EOF
}

video_matches_audio() {
    local video_file="$1"
    local audio_duration="$2"
    if [ ! -s "$video_file" ]; then
        return 1
    fi
    local video_duration
    video_duration=$(probe_duration "$video_file" 2>/dev/null || echo "0")
    awk "BEGIN { exit !($video_duration >= ($audio_duration * 0.90)) }"
}

resize_host_image() {
    local input_file="$1"
    local output_file="$2"
    if command -v magick >/dev/null 2>&1; then
        magick "$input_file" -resize 720x960^ -gravity center -extent 720x960 "$output_file"
    elif command -v convert >/dev/null 2>&1; then
        convert "$input_file" -resize 720x960^ -gravity center -extent 720x960 "$output_file"
    else
        echo "❌ 未找到 ImageMagick（magick/convert）" >&2
        exit 1
    fi
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     🎬 薪灵AI 口播视频生成流水线（Phase 2 动态视觉版）           ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║ 文章: $(basename "$ARTICLE_FILE")"
echo "║ 输出: $OUTPUT_NAME.mp4"
echo "║ 工作目录: $WORK_DIR"
echo "║ Run ID: $PIPELINE_RUN_ID"
echo "║ Whisper: $WHISPER_MODEL"
echo "║ 特性: 文章内容驱动动态背景 + 关键词高亮 + 断点续跑"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

monitor_phase "pipeline" "running" "流水线已启动" "$(jq -cn --arg output "$OUTPUT_NAME" --arg article "$ARTICLE_FILE" --arg workDir "$WORK_DIR" '{outputName: $output, articleFile: $article, workDir: $workDir}')"

PRIMARY_DETECTED=$(jq -r '.primary.detected' "$CONFIG" 2>/dev/null || echo "false")
BACKUP_DETECTED=$(jq -r '.backup.detected' "$CONFIG" 2>/dev/null || echo "false")

if [ "$PRIMARY_DETECTED" != "true" ] && [ "$BACKUP_DETECTED" != "true" ]; then
    echo "🔍 首次运行，自动探测服务器路径..."
    bash "$PROJECT_DIR/scripts/detect_paths.sh"
    echo ""
fi

CURRENT_PHASE="script"
if is_phase_completed "$WORK_DIR" script "$WORK_DIR/script.txt" && [ "${FORCE_SCRIPT:-0}" != "1" ]; then
    echo "♻️  state: script 已完成，跳过"
    SCRIPT_TEXT=$(cat "$WORK_DIR/script.txt")
else
    monitor_phase "preprocess" "running" "开始文本预处理" "$(jq -cn --arg article "$ARTICLE_FILE" '{articleFile: $article}')"
    log_step "📝 STEP 1: 文本预处理"
    mark_running "$WORK_DIR" script

    ARTICLE_FILE_ABS=$(cd "$(dirname "$ARTICLE_FILE")" && pwd)/$(basename "$ARTICLE_FILE")
    if [ "$ARTICLE_FILE_ABS" != "$WORK_DIR/article_raw.md" ]; then
        cp "$ARTICLE_FILE" "$WORK_DIR/article_raw.md"
    fi

    # 文章质量预检：默认仅警告不阻断，STRICT_ARTICLE_CHECK=1 时不通过即终止。
    ARTICLE_CHECK_EXIT=0
    ARTICLE_CHECK=$(node "$PROJECT_DIR/scripts/validate_article.js" "$WORK_DIR/article_raw.md") || ARTICLE_CHECK_EXIT=$?
    if [ "$ARTICLE_CHECK_EXIT" -ne 0 ]; then
        echo "⚠️  文章质量预检未通过:"
        echo "$ARTICLE_CHECK" | jq -r '.checks[]? | select(.ok == false) | "   - \(.name): \(.detail)"' 2>/dev/null || echo "$ARTICLE_CHECK"
        if [ "${STRICT_ARTICLE_CHECK:-0}" = "1" ]; then
            echo "❌ STRICT_ARTICLE_CHECK=1，文章质量预检未通过，终止流水线" >&2
            exit 1
        fi
        echo "   （默认仅警告；设置 STRICT_ARTICLE_CHECK=1 可强制阻断）"
    fi

    TEMPLATE=$(jq -r '.template // "editorial"' "$PROFILE")

    node "$PROJECT_DIR/scripts/generate_script.js" \
        "$WORK_DIR/article_raw.md" \
        "$WORK_DIR/script.txt" \
        "$TEMPLATE"

    SCRIPT_TEXT=$(cat "$WORK_DIR/script.txt")
    echo "口播稿长度: ${#SCRIPT_TEXT} 字符"
    echo ""
    mark_completed "$WORK_DIR" script "$WORK_DIR/script.txt"
    monitor_phase "preprocess" "completed" "文本预处理完成" "$(jq -cn --arg scriptFile "$WORK_DIR/script.txt" --arg chars "${#SCRIPT_TEXT}" '{scriptFile: $scriptFile, scriptChars: ($chars | tonumber)}')"
fi

# Ensure template is available even when script generation is skipped
TEMPLATE=${TEMPLATE:-$(jq -r '.template // "editorial"' "$PROFILE")}

CURRENT_PHASE="tts"
if is_phase_completed "$WORK_DIR" tts "$WORK_DIR/audio.wav" && [ "${FORCE_TTS:-0}" != "1" ]; then
    echo "♻️  state: tts 已完成，跳过"
else
    monitor_phase "tts" "running" "开始生成 TTS 音频" "$(jq -cn --arg target "$WORK_DIR/audio.wav" '{audioFile: $target}')"
    log_step "🎙️  STEP 2: IndexTTS 声音克隆"
    mark_running "$WORK_DIR" tts

    if has_valid_audio "$WORK_DIR/audio.wav" && [ "${FORCE_TTS:-0}" != "1" ]; then
        echo "♻️  复用已有音频: $WORK_DIR/audio.wav"
    else
        bash "$PROJECT_DIR/scripts/tts_index.sh" "$WORK_DIR/script.txt" "$WORK_DIR/audio.wav"
    fi

    AUDIO_DURATION=$(probe_duration "$WORK_DIR/audio.wav")
    AUDIO_FRAMES=$(echo "$AUDIO_DURATION * 30" | bc | cut -d. -f1)
    echo "音频时长: ${AUDIO_DURATION}s | 帧数: $AUDIO_FRAMES"
    echo ""
    mark_completed "$WORK_DIR" tts "$WORK_DIR/audio.wav"
    monitor_phase "tts" "completed" "TTS 音频已就绪" "$(jq -cn --arg audioFile "$WORK_DIR/audio.wav" --arg duration "$AUDIO_DURATION" --arg frames "$AUDIO_FRAMES" '{audioFile: $audioFile, durationSeconds: ($duration | tonumber), durationFrames: ($frames | tonumber)}')"
fi

# Ensure AUDIO_DURATION / AUDIO_FRAMES are available even when TTS is skipped
if [ -z "${AUDIO_DURATION:-}" ]; then
    AUDIO_DURATION=$(probe_duration "$WORK_DIR/audio.wav")
    AUDIO_FRAMES=$(echo "$AUDIO_DURATION * 30" | bc | cut -d. -f1)
fi

CURRENT_PHASE="parallel_media"
monitor_phase "parallel_media" "running" "并行生成字幕、场景画面与唇形视频" "$(jq -cn --arg subtitleFile "$WORK_DIR/subtitles.srt" --arg visuals "$WORK_DIR/scene_visuals.json" --arg lipSync "$WORK_DIR/lip_synced.mp4" '{subtitleFile: $subtitleFile, visualsFile: $visuals, lipSyncFile: $lipSync}')"
log_step "📝 STEP 3: 并行生成字幕、场景画面与唇形视频"

# 提前提取标题，场景画面与 render 阶段都需要。
# 默认从文章自动提取；只有显式设置 FORCE_PROFILE_TITLE=1 时才优先使用
# config/host_profile.json 中的硬编码标题。
if [ "${FORCE_PROFILE_TITLE:-0}" = "1" ]; then
    CONFIG_TITLE=$(jq -r '.title_card.title // ""' "$PROFILE")
    CONFIG_SUBTITLE=$(jq -r '.title_card.subtitle // ""' "$PROFILE")
    if [ -n "$CONFIG_TITLE" ]; then
        VIDEO_TITLE="$CONFIG_TITLE"
        VIDEO_SUBTITLE="$CONFIG_SUBTITLE"
    else
        EXTRACTED=$(node "$PROJECT_DIR/scripts/extract_title.js" "$ARTICLE_FILE" "本期分享")
        VIDEO_TITLE=$(echo "$EXTRACTED" | jq -r '.title')
        VIDEO_SUBTITLE=$(echo "$EXTRACTED" | jq -r '.subtitle')
    fi
else
    EXTRACTED=$(node "$PROJECT_DIR/scripts/extract_title.js" "$ARTICLE_FILE" "本期分享")
    VIDEO_TITLE=$(echo "$EXTRACTED" | jq -r '.title')
    VIDEO_SUBTITLE=$(echo "$EXTRACTED" | jq -r '.subtitle')
    # If extraction fails entirely, fall back to profile title if present
    if [ -z "$VIDEO_TITLE" ]; then
        VIDEO_TITLE=$(jq -r '.title_card.title // ""' "$PROFILE")
        VIDEO_SUBTITLE=$(jq -r '.title_card.subtitle // ""' "$PROFILE")
    fi
fi

VISUALS_JSON="$WORK_DIR/scene_visuals.json"
VISUALS_PUBLIC_DIR="$PROJECT_DIR/public/scene_visuals/$OUTPUT_NAME"

# 子任务 A：字幕生成 + 场景画面准备（两者都依赖字幕）
(
    set -e
    CURRENT_PHASE="subtitles"
    if is_phase_completed "$WORK_DIR" subtitles "$WORK_DIR/subtitles.srt" && [ "${FORCE_SUBTITLES:-0}" != "1" ]; then
        echo "♻️  state: subtitles 已完成，跳过"
    else
    monitor_phase "subtitles" "running" "开始生成并校准字幕" "$(jq -cn --arg subtitleFile "$WORK_DIR/subtitles.srt" '{subtitleFile: $subtitleFile}')"
    mark_running "$WORK_DIR" subtitles

    if has_valid_srt "$WORK_DIR/subtitles.srt" && [ "${FORCE_SUBTITLES:-0}" != "1" ]; then
        echo "♻️  复用已校准字幕: $WORK_DIR/subtitles.srt"
    else
        if ([ -s "$WORK_DIR/subtitles_raw.json" ] || has_valid_srt "$WORK_DIR/subtitles_raw.srt") && [ "${FORCE_WHISPER:-0}" != "1" ]; then
            echo "♻️  复用 Whisper 原始字幕，重新对齐原文"
        else
            bash "$PROJECT_DIR/scripts/whisper_local.sh" "$WORK_DIR/audio.wav" "$WORK_DIR" "$WHISPER_MODEL"
            if [ ! -f "$WORK_DIR/audio.srt" ]; then
                echo "❌ Whisper 未生成 audio.srt" >&2
                exit 1
            fi
            mv -f "$WORK_DIR/audio.srt" "$WORK_DIR/subtitles_raw.srt"
            if [ -f "$WORK_DIR/audio.json" ]; then
                mv -f "$WORK_DIR/audio.json" "$WORK_DIR/subtitles_raw.json"
            fi
        fi
        echo "📝 用原文校准字幕..."
        if [ -s "$WORK_DIR/subtitles_raw.json" ]; then
            RAW_INPUT="$WORK_DIR/subtitles_raw.json"
        else
            RAW_INPUT="$WORK_DIR/subtitles_raw.srt"
        fi
        if ! python3 "$PROJECT_DIR/scripts/align_subtitles.py" \
            "$WORK_DIR/script.txt" \
            "$RAW_INPUT" \
            "$WORK_DIR/subtitles.srt" \
            "$WORK_DIR/subtitles_words.json"; then
            echo "❌ 字幕校准失败：口播稿与音频内容不一致。" >&2
            echo "   当复用旧音频时，必须同时复用对应口播稿（script.txt）。" >&2
            exit 1
        fi
    fi

    echo "字幕文件: $WORK_DIR/subtitles.srt"
    mark_completed "$WORK_DIR" subtitles "$WORK_DIR/subtitles.srt"
    monitor_phase "subtitles" "completed" "字幕文件已就绪" "$(jq -cn --arg subtitleFile "$WORK_DIR/subtitles.srt" '{subtitleFile: $subtitleFile}')"
    fi

    STORYBOARD_JSON="${STORYBOARD_JSON:-$WORK_DIR/storyboard.json}"
    VISUALS_JSON="${VISUALS_JSON:-$WORK_DIR/scene_visuals.json}"

    CURRENT_PHASE="storyboard"
    if is_phase_completed "$WORK_DIR" storyboard "$STORYBOARD_JSON" && [ "${FORCE_STORYBOARD:-0}" != "1" ]; then
        echo "♻️  state: storyboard 已完成，跳过"
    else
        monitor_phase "storyboard" "running" "开始生成分镜脚本" "$(jq -cn --arg storyboard "$WORK_DIR/storyboard.json" '{storyboardFile: $storyboard}')"
        mark_running "$WORK_DIR" storyboard
        STORYBOARD_JSON="$WORK_DIR/storyboard.json"
        if has_valid_storyboard "$STORYBOARD_JSON" && [ "${FORCE_STORYBOARD:-0}" != "1" ]; then
            echo "♻️  复用已生成分镜脚本: $STORYBOARD_JSON"
        else
            node "$PROJECT_DIR/scripts/generate_storyboard.js" \
                "$WORK_DIR/subtitles.srt" \
                "$STORYBOARD_JSON" \
                "$PROFILE" \
                "$VIDEO_TITLE"
        fi
        if storyboard_enabled && ! has_valid_storyboard "$STORYBOARD_JSON"; then
            echo "❌ 分镜脚本生成失败或无效: $STORYBOARD_JSON" >&2
            exit 1
        fi
        mark_completed "$WORK_DIR" storyboard "$STORYBOARD_JSON"
        monitor_phase "storyboard" "completed" "分镜脚本已就绪" "$(jq -cn --arg storyboard "$STORYBOARD_JSON" '{storyboardFile: $storyboard}')"
    fi

    CURRENT_PHASE="visuals"
    if is_phase_completed "$WORK_DIR" visuals "$VISUALS_JSON" && [ "${FORCE_VISUALS:-0}" != "1" ]; then
        echo "♻️  state: visuals 已完成，跳过"
    else
        monitor_phase "visuals" "running" "开始准备正文场景画面" "$(jq -cn --arg visuals "$VISUALS_JSON" '{visualsFile: $visuals}')"
        mark_running "$WORK_DIR" visuals
        if has_valid_scene_visuals "$VISUALS_JSON" && [ "${FORCE_VISUALS:-0}" != "1" ]; then
            echo "♻️  复用已生成场景画面清单: $VISUALS_JSON"
        else
            mkdir -p "$VISUALS_PUBLIC_DIR"
            node "$PROJECT_DIR/scripts/prepare_scene_visuals.js" \
                "$WORK_DIR/subtitles.srt" \
                "$VISUALS_JSON" \
                "$VISUALS_PUBLIC_DIR" \
                "$VIDEO_TITLE" \
                "$PROFILE" \
                "$STORYBOARD_JSON"
        fi
        echo "场景画面清单: $VISUALS_JSON"
        mark_completed "$WORK_DIR" visuals "$VISUALS_JSON"
        monitor_phase "visuals" "completed" "正文场景画面已就绪" "$(jq -cn --arg visuals "$VISUALS_JSON" '{visualsFile: $visuals}')"
    fi
) &
SUBTITLES_VISUALS_PID=$!

# 子任务 B：主播素材准备 + 唇形同步 + FFmpeg 后处理
(
    set -e
    CURRENT_PHASE="lipsync"
    LIPSYNC_ENGINE=$(jq -r '.lipsync.engine // "infinitetalk"' "$PROFILE")
    echo "🎭 唇形同步引擎: $LIPSYNC_ENGINE"

    if is_phase_completed "$WORK_DIR" lipsync "$WORK_DIR/lip_synced_raw.mp4" && [ "${FORCE_LIPSYNC:-0}" != "1" ]; then
        echo "♻️  state: lipsync 已完成，跳过"
    else
        monitor_phase "lipsync" "running" "开始 $LIPSYNC_ENGINE 唇形同步" "$(jq -cn --arg engine "$LIPSYNC_ENGINE" --arg outputFile "$WORK_DIR/lip_synced_raw.mp4" '{engine: $engine, videoFile: $outputFile}')"
        mark_running "$WORK_DIR" lipsync

        case "$LIPSYNC_ENGINE" in
            infinitetalk)
                HOST_PHOTO=$(jq -r '.host.photo_source' "$PROFILE")
                HOST_RESIZED="$WORK_DIR/host_resized.jpg"

                if [ ! -s "$HOST_RESIZED" ]; then
                    echo "🖼️  缩放主播照片..."
                    resize_host_image "$PROJECT_DIR/$HOST_PHOTO" "$HOST_RESIZED"
                fi

                if video_matches_audio "$WORK_DIR/lip_synced_raw.mp4" "$AUDIO_DURATION" && [ "${FORCE_LIPSYNC:-0}" != "1" ]; then
                    echo "♻️  复用已有 InfiniteTalk 原始结果: $WORK_DIR/lip_synced_raw.mp4"
                else
                    # Prefer ComfyUI API on primary server when available, fallback to CLI
                    PRIMARY_IT_PATH=$(jq -r '.primary.infinitetalk_path // ""' "$CONFIG")
                    if [ -n "$PRIMARY_IT_PATH" ] && [ "$PRIMARY_IT_PATH" != "null" ]; then
                        USE_SERVER_SIDE=$(jq -r '.primary.use_server_side // "true"' "$CONFIG")
                        if [ "${PIPELINE_USE_SERVER_SIDE:-$USE_SERVER_SIDE}" = "true" ] || [ "${PIPELINE_USE_SERVER_SIDE:-$USE_SERVER_SIDE}" = "1" ]; then
                            echo "🎬 使用服务器端 ComfyUI API 进行 InfiniteTalk 唇形同步（无本地 SSH 隧道）..."
                            if [ "${FORCE_LIPSYNC:-0}" = "1" ]; then
                                echo "🧹 FORCE_LIPSYNC=1，强制重新生成，清除已有分段缓存与旧输出"
                                rm -f "$WORK_DIR"/lip_synced_raw_seg*.mp4
                                rm -f "$WORK_DIR"/lip_synced_raw.mp4
                                bash "$PROJECT_DIR/scripts/comfyui/run_server_side.sh" \
                                    --config "$CONFIG" \
                                    --profile "$PROFILE" \
                                    --workflow "$PROJECT_DIR/scripts/comfyui/workflow_prompt.json" \
                                    --image "$HOST_RESIZED" \
                                    --audio "$WORK_DIR/audio.wav" \
                                    --output "$WORK_DIR/lip_synced_raw.mp4" \
                                    --work-dir "$WORK_DIR" \
                                    --force
                            else
                                bash "$PROJECT_DIR/scripts/comfyui/run_server_side.sh" \
                                    --config "$CONFIG" \
                                    --profile "$PROFILE" \
                                    --workflow "$PROJECT_DIR/scripts/comfyui/workflow_prompt.json" \
                                    --image "$HOST_RESIZED" \
                                    --audio "$WORK_DIR/audio.wav" \
                                    --output "$WORK_DIR/lip_synced_raw.mp4" \
                                    --work-dir "$WORK_DIR" \
                                    --resume
                            fi
                        else
                            echo "🎬 使用本地 ComfyUI API 进行 InfiniteTalk 唇形同步（SSH 隧道）..."
                            GEN_ARGS=(
                                --config "$CONFIG"
                                --profile "$PROFILE"
                                --workflow "$PROJECT_DIR/scripts/comfyui/workflow_prompt.json"
                                --image "$HOST_RESIZED"
                                --audio "$WORK_DIR/audio.wav"
                                --output "$WORK_DIR/lip_synced_raw.mp4"
                                --work-dir "$WORK_DIR"
                                --use-tunnel
                            )
                            if [ "${FORCE_LIPSYNC:-0}" != "1" ]; then
                                GEN_ARGS+=(--resume)
                            else
                                echo "🧹 FORCE_LIPSYNC=1，清除已有分段缓存"
                                rm -f "$WORK_DIR"/lip_synced_raw_seg*.mp4
                            fi
                            python3 "$PROJECT_DIR/scripts/comfyui/generate_segments.py" "${GEN_ARGS[@]}"
                        fi
                    else
                        echo "🎬 使用 InfiniteTalk CLI 进行唇形同步..."
                        bash "$PROJECT_DIR/scripts/infinitetalk.sh" "$HOST_RESIZED" "$WORK_DIR/audio.wav" "$WORK_DIR/lip_synced_raw.mp4"
                    fi
                fi
                ;;

            musetalk)
                HOST_VIDEO=$(jq -r '.host.video_source // ""' "$PROFILE")
                if [ -z "$HOST_VIDEO" ] || [ "$HOST_VIDEO" = "null" ]; then
                    echo "❌ 使用 MuseTalk 时必须配置 host.video_source" >&2
                    exit 1
                fi
                HOST_VIDEO_PATH="$PROJECT_DIR/$HOST_VIDEO"
                if [ ! -f "$HOST_VIDEO_PATH" ]; then
                    echo "❌ 主播模板视频不存在: $HOST_VIDEO_PATH" >&2
                    exit 1
                fi

                if video_matches_audio "$WORK_DIR/lip_synced_raw.mp4" "$AUDIO_DURATION" && [ "${FORCE_LIPSYNC:-0}" != "1" ]; then
                    echo "♻️  复用已有 MuseTalk 原始结果: $WORK_DIR/lip_synced_raw.mp4"
                else
                    echo "🎬 使用 MuseTalk CLI 进行唇形同步..."
                    bash "$PROJECT_DIR/scripts/musetalk.sh" "$HOST_VIDEO_PATH" "$WORK_DIR/audio.wav" "$WORK_DIR/lip_synced_raw.mp4"
                fi
                ;;

            *)
                echo "❌ 未知的唇形同步引擎: $LIPSYNC_ENGINE" >&2
                exit 1
                ;;
        esac

        mark_completed "$WORK_DIR" lipsync "$WORK_DIR/lip_synced_raw.mp4"
        monitor_phase "lipsync" "completed" "$LIPSYNC_ENGINE 原始结果已就绪" "$(jq -cn --arg engine "$LIPSYNC_ENGINE" --arg rawVideo "$WORK_DIR/lip_synced_raw.mp4" '{engine: $engine, rawVideoFile: $rawVideo}')"
    fi

    CURRENT_PHASE="postprocess"
    if is_phase_completed "$WORK_DIR" postprocess "$WORK_DIR/lip_synced.mp4" && [ "${FORCE_POSTPROCESS:-0}" != "1" ]; then
        echo "♻️  state: postprocess 已完成，跳过"
    else
        echo "🎨 后处理唇形视频（统一分辨率与帧率）..."
        monitor_phase "postprocess" "running" "开始后处理唇形视频" "$(jq -cn --arg rawVideo "$WORK_DIR/lip_synced_raw.mp4" --arg outputFile "$WORK_DIR/lip_synced.mp4" '{rawVideoFile: $rawVideo, outputFile: $outputFile}')"
        mark_running "$WORK_DIR" postprocess
        if video_matches_audio "$WORK_DIR/lip_synced.mp4" "$AUDIO_DURATION" && [ "${FORCE_POSTPROCESS:-0}" != "1" ]; then
            echo "♻️  复用已有后处理视频: $WORK_DIR/lip_synced.mp4"
        else
            RAW_DURATION=$(probe_duration "$WORK_DIR/lip_synced_raw.mp4")
            RATIO=$(echo "scale=6; $AUDIO_DURATION / $RAW_DURATION" | bc -l)
            echo "⏱️  拉伸唇形视频以匹配音频 (系数 $RATIO, 音频 $AUDIO_DURATION s / 原始 $RAW_DURATION s)..."
            ffmpeg -y -i "$WORK_DIR/lip_synced_raw.mp4" \
                -vf "setpts=PTS*$RATIO,scale=720:960:force_original_aspect_ratio=decrease,pad=720:960:(ow-iw)/2:(oh-ih)/2" \
                -r 30 -t "$AUDIO_DURATION" -c:v libx264 -pix_fmt yuv420p -an "$WORK_DIR/lip_synced.mp4"
        fi
        mark_completed "$WORK_DIR" postprocess "$WORK_DIR/lip_synced.mp4"
        monitor_phase "postprocess" "completed" "后处理视频已就绪" "$(jq -cn --arg outputFile "$WORK_DIR/lip_synced.mp4" '{outputFile: $outputFile}')"
    fi
) &
LIPSYNC_PID=$!

# 逐个 wait 并保留各自退出码：bash 的多 PID wait 只返回最后一个 PID 的状态，
# 直接 wait A B 会吞掉子任务 A 的失败。
SUBTITLES_VISUALS_EXIT=0
LIPSYNC_EXIT=0
wait $SUBTITLES_VISUALS_PID || SUBTITLES_VISUALS_EXIT=$?
wait $LIPSYNC_PID || LIPSYNC_EXIT=$?
if [ "$SUBTITLES_VISUALS_EXIT" -ne 0 ] || [ "$LIPSYNC_EXIT" -ne 0 ]; then
    echo "❌ 并行子任务失败（字幕/画面子任务=${SUBTITLES_VISUALS_EXIT}，唇形子任务=${LIPSYNC_EXIT}）" >&2
    exit 1
fi

if ! has_valid_srt "$WORK_DIR/subtitles.srt"; then
    echo "❌ 字幕生成失败: $WORK_DIR/subtitles.srt" >&2
    exit 1
fi
if ! video_matches_audio "$WORK_DIR/lip_synced.mp4" "$AUDIO_DURATION"; then
    echo "❌ 唇形同步视频无效或时长不足: $WORK_DIR/lip_synced.mp4" >&2
    exit 1
fi
if ! has_valid_scene_visuals "$VISUALS_JSON"; then
    echo "❌ 场景画面清单无效: $VISUALS_JSON" >&2
    exit 1
fi

monitor_phase "parallel_media" "completed" "字幕、场景画面与唇形视频均已就绪" "$(jq -cn --arg subtitleFile "$WORK_DIR/subtitles.srt" --arg visuals "$VISUALS_JSON" --arg lipSync "$WORK_DIR/lip_synced.mp4" '{subtitleFile: $subtitleFile, visualsFile: $visuals, lipSyncFile: $lipSync}')"

CURRENT_PHASE="render_prepare"
monitor_phase "render_prepare" "running" "开始准备 Remotion 合成输入" "$(jq -cn --arg props "$PROJECT_DIR/public/props.json" '{propsFile: $props}')"
log_step "🎨 STEP 5: Remotion 视频合成（动态背景 + 关键词高亮）"

TITLE_CARD_SEC=$(jq -r '.title_card.duration_seconds // 2' "$PROFILE")
TITLE_CARD_FRAMES=$(echo "$TITLE_CARD_SEC * 30" | bc | cut -d. -f1)
ENDCARD_SEC=$(jq -r '.style.endcard_duration_seconds' "$PROFILE")
ENDCARD_FRAMES=$(echo "$ENDCARD_SEC * 30" | bc | cut -d. -f1)
TOTAL_FRAMES=$(echo "$TITLE_CARD_FRAMES + $AUDIO_FRAMES + $ENDCARD_FRAMES" | bc)

VIDEO_TITLE_JSON=$(echo "$VIDEO_TITLE" | jq -Rs '.[:-1]')
VIDEO_SUBTITLE_JSON=$(echo "$VIDEO_SUBTITLE" | jq -Rs '.[:-1]')
RAW_COVER_META=$(node "$PROJECT_DIR/scripts/extract_cover_copy.js" "$ARTICLE_FILE" 2>/dev/null || echo '{}')
COVER_META_JSON=$(echo "$RAW_COVER_META" | jq -c '.' 2>/dev/null || echo '{}')
RAW_DATA_BARS=$(node "$PROJECT_DIR/scripts/extract_data_bars.js" "$ARTICLE_FILE" "$PROFILE" 2>/dev/null || echo '[]')
DATA_BARS_JSON=$(echo "$RAW_DATA_BARS" | jq -c '.' 2>/dev/null || echo '[]')
RAW_QUOTE=$(node "$PROJECT_DIR/scripts/extract_quote.js" "$ARTICLE_FILE" 2>/dev/null || echo 'null')
QUOTE_HIGHLIGHT_JSON=$(echo "$RAW_QUOTE" | jq -c '.' 2>/dev/null || echo 'null')
PRODUCT_BRAND_JSON=$(jq -r '.product.brand // "薪灵AI"' "$PROFILE" | jq -Rs '.[:-1]')
PRODUCT_TAGLINE_JSON=$(jq -r '.product.tagline // "薪人薪事的AI引擎"' "$PROFILE" | jq -Rs '.[:-1]')
PRODUCT_PILLS_JSON=$(jq '.product.pills // ["文章转视频","声音克隆","唇形同步","自动字幕"]' "$PROFILE")

# 产品发布模板：提取卖点、CTA、Slogan
PRODUCT_FEATURES_JSON='[]'
PRODUCT_SLOGAN_JSON='""'
PRODUCT_CTA_JSON='""'
if [ "$TEMPLATE" = "product-launch" ]; then
  RAW_PRODUCT_FEATURES=$(node "$PROJECT_DIR/scripts/extract_product_features.js" "$ARTICLE_FILE" "$PROFILE" 2>/dev/null || echo '{}')
  PRODUCT_FEATURES_JSON=$(echo "$RAW_PRODUCT_FEATURES" | jq -c '.features // []' 2>/dev/null || echo '[]')
  PRODUCT_SLOGAN_JSON=$(echo "$RAW_PRODUCT_FEATURES" | jq -r '.slogan // ""' | jq -Rs '.[:-1]')
  PRODUCT_CTA_JSON=$(echo "$RAW_PRODUCT_FEATURES" | jq -r '.cta // ""' | jq -Rs '.[:-1]')
  echo "✅ 产品卖点已提取"
fi

node "$PROJECT_DIR/scripts/validate_content_overlay.js" "$PROFILE" >/dev/null
CONTENT_OVERLAY_JSON=$(jq '
  .content_overlay // {
    subtitles: {
      maxLines: 3,
      maxCharsPerLine: 24,
      fontSizeLarge: 56,
      fontSizeMedium: 48,
      fontSizeSmall: 40,
      headlineLabel: "零距离看懂财经",
      dna: "classic",
      segmentation: {
        maxSegmentSeconds: 3.2,
        minSegmentSeconds: 0.9,
        maxVisualLength: 26
      }
    },
    talkingPoints: {
      enabled: true,
      maxItems: 2,
      mainLabel: "观点拆解",
      secondaryLabel: "SUPPORTING POINT"
    },
    layout: {
      sequence: ["editorial-left", "editorial-right", "editorial-balanced"],
      holdCues: 3
    }
  }' "$PROFILE")
VIDEO_LAYOUT_JSON=$(jq '
  .video_layout // {
    mode: "portrait-hybrid",
    hybrid: {
      mainVisualRatio: 0.58,
      hostWindowWidth: 560,
      hostWindowHeight: 640,
      showSubtitles: true,
      topicTag: { enabled: true, label: "核心解读" },
      brandBadge: { enabled: true }
    }
  }' "$PROFILE")
SUBTITLE_SEGMENTATION_JSON=$(jq -c '
  .content_overlay.subtitles.segmentation // {
    maxSegmentSeconds: 3.2,
    minSegmentSeconds: 0.9,
    maxVisualLength: 26
  }' "$PROFILE")
SCENE_VISUALS_JSON=$(cat "$VISUALS_JSON" 2>/dev/null || echo '[]')

CHAPTERS_JSON_PATH="$WORK_DIR/chapters.json"
CHAPTERS_LOG_PATH="$WORK_DIR/chapters.log"
if node "$PROJECT_DIR/scripts/extract_chapters.js" "$VISUALS_JSON" "$CHAPTERS_JSON_PATH" >"$CHAPTERS_LOG_PATH" 2>&1; then
  echo "✅ 章节面包屑生成成功"
else
  echo "⚠️ 章节面包屑生成失败，已回退，详见 $CHAPTERS_LOG_PATH"
fi
CHAPTERS_JSON=$(cat "$CHAPTERS_JSON_PATH" 2>/dev/null || echo '[]')

# hero 时刻定位（增强项，失败不阻断流水线）
HERO_MOMENTS_JSON='[]'
HERO_STORYBOARD_JSON="${STORYBOARD_JSON:-$WORK_DIR/storyboard.json}"
if [ -s "$WORK_DIR/subtitles_words.json" ] && [ -s "$HERO_STORYBOARD_JSON" ]; then
    if node "$PROJECT_DIR/scripts/locate_hero_moments.js" \
        "$HERO_STORYBOARD_JSON" "$WORK_DIR/subtitles_words.json" \
        "$WORK_DIR/hero_moments.json" "0"; then
        HERO_MOMENTS_JSON=$(cat "$WORK_DIR/hero_moments.json" 2>/dev/null || echo '[]')
    else
        echo "⚠️  hero 时刻定位失败，按无 hero 继续"
    fi
fi

# BGM：style.bgm 存在且音量 > 0 时复制到 public 并注入 props
BGM_PATH_JSON='null'
BGM_VOLUME=$(jq -r '.style.bgm_volume // 0' "$PROFILE")
BGM_SOURCE=$(jq -r '.style.bgm // ""' "$PROFILE")
if [ -n "$BGM_SOURCE" ] && [ "$BGM_SOURCE" != "null" ] && [ -f "$PROJECT_DIR/$BGM_SOURCE" ] \
    && awk "BEGIN{exit !($BGM_VOLUME > 0)}"; then
    BGM_EXT="${BGM_SOURCE##*.}"
    cp -f "$PROJECT_DIR/$BGM_SOURCE" "$PROJECT_DIR/public/bgm.$BGM_EXT"
    BGM_PATH_JSON="\"bgm.$BGM_EXT\""
    echo "🎵 BGM 已启用: $BGM_SOURCE (volume=$BGM_VOLUME)"
fi

# hero 音效：assets/sfx/hero.* 存在则用素材，否则 ffmpeg 合成兜底（失败不阻断）
SFX_HERO_JSON='null'
SFX_ENABLED=$(jq -r '.style.sfx_enabled // true' "$PROFILE")
SFX_VOLUME=$(jq -r '.style.sfx_volume // 0.5' "$PROFILE")
if [ "$SFX_ENABLED" = "true" ]; then
    mkdir -p "$PROJECT_DIR/public/sfx"
    if [ -f "$PROJECT_DIR/assets/sfx/hero.wav" ]; then
        cp -f "$PROJECT_DIR/assets/sfx/hero.wav" "$PROJECT_DIR/public/sfx/hero.wav"
        SFX_HERO_JSON='"sfx/hero.wav"'
    elif [ -f "$PROJECT_DIR/assets/sfx/hero.mp3" ]; then
        cp -f "$PROJECT_DIR/assets/sfx/hero.mp3" "$PROJECT_DIR/public/sfx/hero.mp3"
        SFX_HERO_JSON='"sfx/hero.mp3"'
    elif ffmpeg -y -loglevel error -f lavfi \
        -i "aevalsrc='sin(2*PI*(600*exp(-t*10)+120)*t)*exp(-t*9)':s=44100:d=0.25" \
        "$PROJECT_DIR/public/sfx/hero_pop.wav"; then
        SFX_HERO_JSON='"sfx/hero_pop.wav"'
    else
        echo "⚠️  hero 音效合成失败，按无音效继续"
    fi
fi

echo "🎬 标题卡: $VIDEO_TITLE"
[ -n "$VIDEO_SUBTITLE" ] && echo "📝 副标题: $VIDEO_SUBTITLE"
echo ""

mkdir -p "$PROJECT_DIR/public"
cp "$WORK_DIR/lip_synced.mp4" "$PROJECT_DIR/public/host_video.mp4"
cp "$WORK_DIR/audio.wav" "$PROJECT_DIR/public/audio.wav"
cp "$WORK_DIR/subtitles.srt" "$PROJECT_DIR/public/subtitles.srt"

# 注意：字幕/词级/hero 时间都不加标题卡偏移——字幕组件在 <Sequence> 内
# 使用相对时间轴（0 = 音频起点），加偏移会导致字幕比语音慢 TITLE_CARD_SEC 秒。
SUBTITLE_SEGMENTATION_JSON="$SUBTITLE_SEGMENTATION_JSON" \
  node "$PROJECT_DIR/scripts/parse_srt.js" "$WORK_DIR/subtitles.srt" "$PROJECT_DIR/public/subtitles.json" "0" "$WORK_DIR/subtitles_words.json"
SUBTITLE_SEGMENTATION_JSON="$SUBTITLE_SEGMENTATION_JSON" \
  node "$PROJECT_DIR/scripts/validate_subtitles.js" "$PROJECT_DIR/public/subtitles.json"
SUBTITLES_JSON=$(cat "$PROJECT_DIR/public/subtitles.json")

# 多比例输出：profile 的 video_layout.aspect 决定渲染 composition（默认 9:16 竖屏）
ASPECT=$(jq -r '.video_layout.aspect // "9:16"' "$PROFILE")
case "$ASPECT" in
    "16:9")
        COMPOSITION_ID="TalkingHeadVideoLandscape"
        RESOLUTION_LABEL="1920x1080"
        ;;
    "1:1")
        COMPOSITION_ID="TalkingHeadVideoSquare"
        RESOLUTION_LABEL="1080x1080"
        ;;
    *)
        ASPECT="9:16"
        COMPOSITION_ID="TalkingHeadVideo"
        RESOLUTION_LABEL="1080x1920"
        ;;
esac
echo "🖼️  画面比例: ${ASPECT}（composition: ${COMPOSITION_ID}）"

# 确保 videoLayout 包含 template 与 aspect（props 与所选 composition 保持一致）
VIDEO_LAYOUT_WITH_TEMPLATE=$(echo "$VIDEO_LAYOUT_JSON" | jq --arg tmpl "$TEMPLATE" --arg aspect "$ASPECT" '.template = $tmpl | .aspect = $aspect')

cat > "$PROJECT_DIR/public/props.json" << EOF
{
  "audioPath": "audio.wav",
  "srtPath": "subtitles.srt",
  "subtitles": $SUBTITLES_JSON,
  "hostVideoPath": "host_video.mp4",
  "title": $VIDEO_TITLE_JSON,
  "subtitle": $VIDEO_SUBTITLE_JSON,
  "brand": $PRODUCT_BRAND_JSON,
  "tagline": $PRODUCT_TAGLINE_JSON,
  "slogan": $PRODUCT_SLOGAN_JSON,
  "cta": $PRODUCT_CTA_JSON,
  "pills": $PRODUCT_PILLS_JSON,
  "features": $PRODUCT_FEATURES_JSON,
  "coverMeta": $COVER_META_JSON,
  "sceneVisuals": $SCENE_VISUALS_JSON,
  "chapters": $CHAPTERS_JSON,
  "dataBars": $DATA_BARS_JSON,
  "quoteHighlight": $QUOTE_HIGHLIGHT_JSON,
  "heroMoments": $HERO_MOMENTS_JSON,
  "bgmPath": $BGM_PATH_JSON,
  "bgmVolume": $BGM_VOLUME,
  "sfxHeroPath": $SFX_HERO_JSON,
  "sfxVolume": $SFX_VOLUME,
  "contentOverlay": $CONTENT_OVERLAY_JSON,
  "videoLayout": $VIDEO_LAYOUT_WITH_TEMPLATE,
  "template": "$TEMPLATE",
  "titleCardDurationFrames": $TITLE_CARD_FRAMES,
  "talkingDurationFrames": $AUDIO_FRAMES,
  "endcardDurationFrames": $ENDCARD_FRAMES,
  "totalDurationFrames": $TOTAL_FRAMES,
  "primaryColor": "$(jq -r '.product.primary_color' "$PROFILE")",
  "secondaryColor": "$(jq -r '.product.secondary_color' "$PROFILE")"
}
EOF

# 渲染前 props 预检：结构/引用文件非法时在此终止，而不是渲染到一半才失败
node "$PROJECT_DIR/scripts/validate_props.js" "$PROJECT_DIR/public/props.json"

cd "$PROJECT_DIR"
EXPECTED_DURATION=$(awk "BEGIN { printf \"%.3f\", $TOTAL_FRAMES / 30 }")
MIN_VIDEO_DURATION=$(awk "BEGIN { printf \"%.3f\", $EXPECTED_DURATION * 0.95 }")
FINAL_VIDEO="$OUTPUT_DIR/${OUTPUT_NAME}.mp4"
FINAL_COVER="$OUTPUT_DIR/${OUTPUT_NAME}_cover.png"

# 根据 CPU 核心数设置 Remotion 并发，最高 8，避免内存不足
if command -v nproc >/dev/null 2>&1; then
    REMOTION_CONCURRENCY=$(nproc)
elif command -v sysctl >/dev/null 2>&1; then
    REMOTION_CONCURRENCY=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
else
    REMOTION_CONCURRENCY=4
fi
if [ "${REMOTION_CONCURRENCY:-0}" -gt 8 ]; then
    REMOTION_CONCURRENCY=8
fi
if [ "${REMOTION_CONCURRENCY:-0}" -lt 1 ]; then
    REMOTION_CONCURRENCY=1
fi

monitor_phase "render_prepare" "completed" "Remotion 输入文件已准备完成" "$(jq -cn --arg props "$PROJECT_DIR/public/props.json" --arg expected "$EXPECTED_DURATION" '{propsFile: $props, expectedDurationSeconds: ($expected | tonumber)}')"

if is_phase_completed "$WORK_DIR" render "$FINAL_VIDEO" && has_valid_cover "$FINAL_COVER" && [ "${FORCE_RENDER:-0}" != "1" ]; then
    echo "♻️  state: render 已完成，跳过"
    echo "♻️  复用已生成成片: $FINAL_VIDEO"
    echo "♻️  复用已生成封面: $FINAL_COVER"
else
    CURRENT_PHASE="render"
    monitor_phase "render" "running" "开始 Remotion 最终渲染" "$(jq -cn --arg outputFile "$FINAL_VIDEO" --arg coverFile "$FINAL_COVER" --arg totalFrames "$TOTAL_FRAMES" '{outputFile: $outputFile, coverFile: $coverFile, totalFrames: ($totalFrames | tonumber)}')"
    mark_running "$WORK_DIR" render

    # 渐进式渲染：video_layout.preview.enabled=true 时先出 0.33 倍低清预览
    # （跳过 BGM/音效，只渲染视频轨），路径硬约定为 temp/<run>/preview.mp4（后端监听）。
    PREVIEW_ENABLED=$(jq -r '.video_layout.preview.enabled // false' "$PROFILE")
    if [ "$PREVIEW_ENABLED" = "true" ]; then
        PREVIEW_VIDEO="$WORK_DIR/preview.mp4"
        PREVIEW_PROPS="$WORK_DIR/props_preview.json"
        echo "🚀 先生成低清预览: $PREVIEW_VIDEO"
        jq '.bgmPath = null | .sfxHeroPath = null' "$PROJECT_DIR/public/props.json" > "$PREVIEW_PROPS"
        if npx remotion render src/index.tsx "$COMPOSITION_ID" \
            --props "$PREVIEW_PROPS" \
            --duration-in-frames "$TOTAL_FRAMES" \
            --concurrency "$REMOTION_CONCURRENCY" \
            --scale=0.33 \
            "$PREVIEW_VIDEO"; then
            echo "✅ 低清预览已生成: $PREVIEW_VIDEO"
        else
            echo "⚠️  低清预览渲染失败，继续渲染正式成品"
        fi
    fi

    npx remotion render src/index.tsx "$COMPOSITION_ID" \
        --props public/props.json \
        --duration-in-frames "$TOTAL_FRAMES" \
        --concurrency "$REMOTION_CONCURRENCY" \
        "$FINAL_VIDEO"

    COVER_FRAME=$(echo "$TITLE_CARD_FRAMES / 2" | bc)
    npx remotion still src/index.tsx "$COMPOSITION_ID" \
        --props public/props.json \
        --frame "$COVER_FRAME" \
        "$FINAL_COVER"
    mark_completed "$WORK_DIR" render "$FINAL_VIDEO"
fi

if ! has_valid_video "$FINAL_VIDEO" "$MIN_VIDEO_DURATION"; then
    ACTUAL_DURATION=$(probe_duration "$FINAL_VIDEO" 2>/dev/null || echo "0")
    echo "❌ 最终成片无效或时长异常: ${FINAL_VIDEO}（expected >= ${MIN_VIDEO_DURATION}s, actual=${ACTUAL_DURATION}s）" >&2
    exit 1
fi

if ! has_valid_cover "$FINAL_COVER"; then
    echo "❌ 最终封面无效: $FINAL_COVER" >&2
    exit 1
fi

monitor_phase "render" "completed" "最终视频与封面已生成" "$(jq -cn --arg outputFile "$FINAL_VIDEO" --arg coverFile "$FINAL_COVER" --arg expected "$EXPECTED_DURATION" '{outputFile: $outputFile, coverFile: $coverFile, expectedDurationSeconds: ($expected | tonumber)}')"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                      ✅ 生成完成！                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║ 输出文件: $OUTPUT_DIR/${OUTPUT_NAME}.mp4"
echo "║ 封面图片: $OUTPUT_DIR/${OUTPUT_NAME}_cover.png"
echo "║ 工作目录: $WORK_DIR"
echo "║ 视频时长: $(echo "scale=1; $TOTAL_FRAMES / 30" | bc)s"
echo "║ 分辨率: ${RESOLUTION_LABEL}（比例 ${ASPECT}）"
echo "║ 特性: 标题卡 + 动态背景 + 关键词高亮 + 封面图"
echo "║ 监控目录: $WORK_DIR/monitor"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
