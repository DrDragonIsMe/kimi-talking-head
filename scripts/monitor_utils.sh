#!/bin/bash
# 流水线监控工具：记录阶段状态到工作目录，供外部监控/重跑使用

MONITOR_DIR=""
MONITOR_RUN_ID=""
MONITOR_WORK_DIR=""

monitor_init() {
    MONITOR_DIR="$1"
    MONITOR_RUN_ID="$2"
    MONITOR_WORK_DIR="${3:-}"
    mkdir -p "$MONITOR_DIR"
    cat > "$MONITOR_DIR/run.json" << EOF
{
  "runId": "$MONITOR_RUN_ID",
  "workDir": "$MONITOR_WORK_DIR",
  "startTime": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "running"
}
EOF
}

monitor_phase() {
    local phase="$1"
    local status="$2"
    local message="$3"
    local payload="${4:-{}}"

    if [ -z "$MONITOR_DIR" ]; then
        return 0
    fi

    mkdir -p "$MONITOR_DIR/phases"
    local phase_file="$MONITOR_DIR/phases/${phase}.json"
    cat > "$phase_file" << EOF
{
  "phase": "$phase",
  "status": "$status",
  "message": "$message",
  "time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload": $payload
}
EOF

    # 更新总状态
    if [ "$status" = "failed" ]; then
        jq --arg phase "$phase" --arg message "$message" '
          .status = "failed" |
          .failedPhase = $phase |
          .errorMessage = $message |
          .endTime = (now | localtime | strftime("%Y-%m-%dT%H:%M:%SZ"))
        ' "$MONITOR_DIR/run.json" > "$MONITOR_DIR/run.json.tmp" && mv "$MONITOR_DIR/run.json.tmp" "$MONITOR_DIR/run.json"
    elif [ "$status" = "completed" ] && [ "$phase" = "pipeline" ]; then
        jq '
          .status = "completed" |
          .endTime = (now | localtime | strftime("%Y-%m-%dT%H:%M:%SZ"))
        ' "$MONITOR_DIR/run.json" > "$MONITOR_DIR/run.json.tmp" && mv "$MONITOR_DIR/run.json.tmp" "$MONITOR_DIR/run.json"
    fi

    # 桌面通知（仅在 macOS 且 PIPELINE_MONITOR_NOTIFY=1 时）
    if [ "${PIPELINE_MONITOR_NOTIFY:-0}" = "1" ] && command -v osascript >/dev/null 2>&1; then
        local notify_title="薪灵AI 流水线"
        local notify_body="[$phase] $message"
        osascript -e "display notification \"$notify_body\" with title \"$notify_title\"" 2>/dev/null || true
    fi
}
