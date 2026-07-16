#!/bin/bash
# State machine helpers for resumable pipeline execution.
# Maintains a JSON state file in the work directory.

set -euo pipefail

PHASES=(script tts whisper subtitles storyboard visuals lipsync postprocess render)

state_file() {
  echo "$1/.pipeline_state.json"
}

init_state() {
  local work_dir="$1"
  local file
  file=$(state_file "$work_dir")
  if [[ -f "$file" ]]; then
    return 0
  fi
  mkdir -p "$work_dir"
  local obj="{}"
  for phase in "${PHASES[@]}"; do
    obj=$(echo "$obj" | jq --arg p "$phase" '.[$p] = {status: "pending", started_at: null, completed_at: null, output: null, attempt: 0, error: null}')
  done
  echo "$obj" | jq . > "$file"
}

get_phase() {
  local work_dir="$1" phase="$2" key="${3:-status}"
  local file
  file=$(state_file "$work_dir")
  jq -r --arg p "$phase" --arg k "$key" '.[$p][$k] // empty' "$file" 2>/dev/null || echo ""
}

set_phase() {
  local work_dir="$1" phase="$2" status="$3" output="${4:-}" error="${5:-}"
  local file
  file=$(state_file "$work_dir")
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local tmp
  tmp=$(mktemp)
  jq --arg p "$phase" --arg s "$status" --arg n "$now" \
     --arg o "$output" --arg e "$error" \
     '.[$p].status = $s |
      if $s == "running" then
        .[$p].started_at = $n
      else
        .[$p].completed_at = $n |
        if .[$p].started_at == null then .[$p].started_at = $n else . end
      end |
      .[$p].output = (if $o == "" then .[$p].output else $o end) |
      .[$p].error = (if $e == "" then null else $e end) |
      .[$p].attempt += (if $s == "running" then 1 else 0 end)' \
     "$file" > "$tmp" && mv "$tmp" "$file"
}

is_phase_completed() {
  local work_dir="$1" phase="$2" output="${3:-}"
  local status
  status=$(get_phase "$work_dir" "$phase" status)
  if [[ "$status" != "completed" ]]; then
    return 1
  fi
  if [[ -n "$output" && ! -s "$output" ]]; then
    return 1
  fi
  return 0
}

mark_running() {
  set_phase "$1" "$2" running
}

mark_completed() {
  set_phase "$1" "$2" completed "${3:-}"
}

mark_failed() {
  set_phase "$1" "$2" failed "" "${3:-}"
}

print_state() {
  local work_dir="$1"
  local file
  file=$(state_file "$work_dir")
  echo "📋 Pipeline state:"
  jq -r 'to_entries[] | "  \(.key): \(.value.status) (attempt \(.value.attempt))"' "$file"
}
