#!/bin/bash
# 测试用假 pipeline：在 stub_pipeline.sh 的基础上额外把 HOST_PROFILE 环境变量
# 写入 <workdir>/host_profile_env.txt，供测试验证 server → pipeline 的主播配置传递。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/stub_pipeline.sh" "$@"

OUTPUT_NAME=${2:-}
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
mkdir -p "$PROJECT_DIR/temp/$OUTPUT_NAME"
printf '%s' "${HOST_PROFILE:-}" > "$PROJECT_DIR/temp/$OUTPUT_NAME/host_profile_env.txt"
