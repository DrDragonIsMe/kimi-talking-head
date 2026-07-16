#!/bin/bash
# Ensure only one instance of a named monitor/background task is running.
# This prevents the waste caused by accidentally starting duplicate progress
# checkers, GPU probes, or other long-running background helpers.
#
# Usage:
#   bash scripts/ensure_single_monitor.sh <name> <command...>
#
# Example:
#   bash scripts/ensure_single_monitor.sh lipsync-progress \
#     "sleep 300 && ssh ... 'tail -n 20 lipsync.log'"
#
# The helper stores PIDs in temp/.monitors/<name>.pid. If the recorded PID is
# still alive, the request is rejected. Stale PID files are cleaned up
# automatically.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR_DIR="$PROJECT_DIR/temp/.monitors"
mkdir -p "$MONITOR_DIR"

if [[ $# -lt 2 ]]; then
  echo "用法: bash scripts/ensure_single_monitor.sh <name> <command...>" >&2
  exit 1
fi

NAME="$1"
shift
PID_FILE="$MONITOR_DIR/${NAME}.pid"

# Reject names that could escape the monitor directory.
if [[ "$NAME" == *"/"* || "$NAME" == *".."* ]]; then
  echo "❌ monitor name must not contain / or .." >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "⚠️  monitor '$NAME' is already running (PID=$OLD_PID), skipping duplicate start."
    exit 0
  else
    echo "🧹 stale monitor lock for '$NAME' (PID=$OLD_PID), removing."
    rm -f "$PID_FILE"
  fi
fi

# Run the requested command in the background and record its PID.
nohup bash -c "$*" >/dev/null 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
echo "✅ monitor '$NAME' started (PID=$PID)."
