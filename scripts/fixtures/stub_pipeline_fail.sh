#!/bin/bash
# 测试用失败 pipeline：模拟阶段崩溃——除非注入 FORCE_RENDER=1（模拟定点重跑），否则立即失败。
# 与 api/server.js 的 /retry {phase} 配合使用：retry {phase:'render'} 会注入 FORCE_RENDER=1。
set -euo pipefail

if [ "${FORCE_RENDER:-0}" != "1" ]; then
  echo "stub pipeline failed: ${2:-unknown} (set FORCE_RENDER=1 to succeed)" >&2
  exit 1
fi

exec bash "$(dirname "$0")/stub_pipeline.sh" "$@"
