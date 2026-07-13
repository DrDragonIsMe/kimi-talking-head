#!/bin/bash
# 监控流水线状态（占位实现，可扩展为 WebUI/通知服务）
set -euo pipefail

MONITOR_DIR="${1:-./temp/monitor}"
INTERVAL="${2:-5}"

if [ ! -d "$MONITOR_DIR" ]; then
  echo "监控目录不存在: $MONITOR_DIR"
  exit 1
fi

echo "👀 开始监控流水线状态: $MONITOR_DIR"
echo "按 Ctrl+C 退出"

while true; do
  clear
  echo "═══════════════════════════════════════════════════"
  echo "  薪灵AI 流水线监控"
  echo "═══════════════════════════════════════════════════"
  if [ -f "$MONITOR_DIR/run.json" ]; then
    cat "$MONITOR_DIR/run.json" | jq .
  fi
  echo ""
  echo "阶段状态:"
  if [ -d "$MONITOR_DIR/phases" ]; then
    for f in "$MONITOR_DIR/phases"/*.json; do
      [ -f "$f" ] || continue
      printf "  - %-20s %s\n" "$(basename "$f" .json)" "$(jq -r '[.status, .message] | join(" | ")' "$f")"
    done
  fi
  sleep "$INTERVAL"
done
