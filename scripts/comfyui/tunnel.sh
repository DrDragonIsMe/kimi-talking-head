#!/bin/bash
set -euo pipefail

# Manage a persistent local -> ComfyUI SSH tunnel via launchd + autossh.
# Usage:
#   bash scripts/comfyui/tunnel.sh start   # load launchd service
#   bash scripts/comfyui/tunnel.sh stop    # unload launchd service
#   bash scripts/comfyui/tunnel.sh status  # show status and test http://localhost:8188

LABEL="com.kimi-talking-head.comfyui-tunnel"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

case "${1:-status}" in
  start|load)
    if [[ ! -f "$PLIST" ]]; then
      echo "❌ Plist not found: $PLIST"
      exit 1
    fi
    echo "🚀 Loading $LABEL ..."
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    sleep 2
    bash "$0" status
    ;;
  stop|unload)
    echo "🛑 Unloading $LABEL ..."
    launchctl unload "$PLIST" 2>/dev/null || true
    ;;
  status)
    if launchctl list "$LABEL" >/dev/null 2>&1; then
      echo "✅ $LABEL is loaded"
    else
      echo "⚠️  $LABEL is not loaded"
    fi
    if curl -s --max-time 3 http://localhost:8188/system_stats >/dev/null 2>&1; then
      echo "✅ http://localhost:8188 is reachable"
    else
      echo "❌ http://localhost:8188 is NOT reachable"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
