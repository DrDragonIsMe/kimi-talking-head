#!/bin/bash
# Host 配置 pre-flight 校验。
# 用法: bash scripts/lib/validate_config.sh <host_profile.json>
# 校验失败时输出明确错误并以退出码 1 终止（防止无效配置静默降级进入流水线）。

set -euo pipefail

PROFILE="${1:-}"
VALID_DNA="classic loud keynote cream editorial documentary"

if [ -z "$PROFILE" ]; then
    echo "用法: bash scripts/lib/validate_config.sh <host_profile.json>" >&2
    exit 1
fi

if [ ! -f "$PROFILE" ]; then
    echo "❌ 主播配置文件不存在: $PROFILE" >&2
    exit 1
fi

if ! jq empty "$PROFILE" 2>/dev/null; then
    echo "❌ 主播配置文件不是合法 JSON: $PROFILE" >&2
    exit 1
fi

# 字幕 DNA id 校验：未配置时按渲染层默认 classic 处理，视为合法。
DNA=$(jq -r '.content_overlay.subtitles.dna // "classic"' "$PROFILE")
if ! echo "$VALID_DNA" | tr ' ' '\n' | grep -qx "$DNA"; then
    echo "❌ content_overlay.subtitles.dna 无效: \"$DNA\"" >&2
    echo "   可选值: classic | loud | keynote | cream | editorial | documentary" >&2
    echo "   配置文件: $PROFILE" >&2
    exit 1
fi

echo "✅ host 配置校验通过（dna: ${DNA}）"
