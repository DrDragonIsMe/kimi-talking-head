#!/bin/bash
LOG=/root/aigc_apps/guthrie_run/monitor.log
COMFY_LOG=/root/aigc_apps/InfiniteTalk/comfyui.prev.log
LIPSYNC_LOG=/root/aigc_apps/guthrie_run/lipsync.log
echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Monitor started" >> "$LOG"
while true; do
  NOW=$(date +%Y-%m-%d\ %H:%M:%S)
  IDX=$(grep "current_condframe_index" "$COMFY_LOG" 2>/dev/null | tail -1 | sed "s/.*current_condframe_index://")
  RUNNING=$(curl -s http://127.0.0.1:8188/queue | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('queue_running',[])))" 2>/dev/null)
  GPU=$(timeout 5 nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d " ")
  TAIL=$(tail -n 1 "$LIPSYNC_LOG" 2>/dev/null)
  printf "[%s] idx=%s queue_running=%s gpu=%s tail=%s\n" "$NOW" "$IDX" "$RUNNING" "$GPU" "$TAIL" >> "$LOG"
  if ! pgrep -f "generate_segments.py" >/dev/null; then
    echo "[$NOW] generate_segments.py no longer running; exiting monitor" >> "$LOG"
    break
  fi
  sleep 60
done
