#!/bin/bash
# Comprehensive test suite for pipeline state machine (scripts/lib/state.sh)
# Usage: bash scripts/test_pipeline_state.sh
# Each test prints [PASS] or [FAIL] with a description.
# Final summary: PASSED: X, FAILED: Y, TOTAL: Z

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/state.sh"

# ---------------------------------------------------------------------------
# Test infrastructure
# ---------------------------------------------------------------------------

PASSED=0
FAILED=0
TOTAL=0
TEST_DIR=""

setup() {
  TEST_DIR=$(mktemp -d /tmp/test_pipeline_state_XXXXX)
}

teardown() {
  if [[ -n "$TEST_DIR" && -d "$TEST_DIR" ]]; then
    rm -rf "$TEST_DIR"
  fi
}

# Increment counters and print result
# Usage: pass_test "description"
pass_test() {
  echo "  [PASS] $1"
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
}

# Usage: fail_test "description" ["optional detail"]
fail_test() {
  local detail="${2:-}"
  if [[ -n "$detail" ]]; then
    echo "  [FAIL] $1 — $detail"
  else
    echo "  [FAIL] $1"
  fi
  FAILED=$((FAILED + 1))
  TOTAL=$((TOTAL + 1))
}

# Assert two values are equal.  If not, calls fail_test with detail.
# Usage: assert_eq "expected" "actual" "test description"
assert_eq() {
  local expected="$1" actual="$2" desc="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass_test "$desc"
  else
    fail_test "$desc" "expected '$expected', got '$actual'"
  fi
}

# Assert command succeeds (returns 0).  set -e is disabled inside conditionals.
# Usage: assert_ok command arg1 arg2 ... -- "test description"
assert_ok() {
  local args=()
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      break
    fi
    args+=("$1")
    shift
  done
  local desc="$1"
  if "${args[@]}"; then
    pass_test "$desc"
  else
    fail_test "$desc" "command returned non-zero"
  fi
}

# Assert command fails (returns non-zero).
# Usage: assert_fail command arg1 arg2 ... -- "test description"
assert_fail() {
  local args=()
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      break
    fi
    args+=("$1")
    shift
  done
  local desc="$1"
  if "${args[@]}"; then
    fail_test "$desc" "expected non-zero, got 0"
  else
    pass_test "$desc"
  fi
}

# Assert a value is non-empty.
# Usage: assert_nonempty "value" "test description"
assert_nonempty() {
  local val="$1" desc="$2"
  if [[ -n "$val" ]]; then
    pass_test "$desc"
  else
    fail_test "$desc" "value is empty"
  fi
}

# Assert a value is empty.
# Usage: assert_empty "value" "test description"
assert_empty() {
  local val="$1" desc="$2"
  if [[ -z "$val" ]]; then
    pass_test "$desc"
  else
    fail_test "$desc" "expected empty, got '$val'"
  fi
}

# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

# ---- 1. init_state ----
test_init_state_creates_file() {
  init_state "$TEST_DIR"
  local f
  f=$(state_file "$TEST_DIR")
  if [[ -f "$f" ]]; then
    pass_test "init_state creates state file"
  else
    fail_test "init_state creates state file" "file not found: $f"
  fi
}

test_init_state_all_phases_pending() {
  init_state "$TEST_DIR"
  for phase in "${PHASES[@]}"; do
    local s
    s=$(get_phase "$TEST_DIR" "$phase" status)
    if [[ "$s" != "pending" ]]; then
      fail_test "init_state: phase '$phase' is '$s', expected 'pending'"
      return
    fi
  done
  pass_test "init_state: all phases are pending"
}

test_init_state_sets_default_fields() {
  init_state "$TEST_DIR"
  local phase="script"
  # get_phase normalizes JSON null to empty string (jq -r '// empty')
  assert_eq "0"  "$(get_phase "$TEST_DIR" "$phase" attempt)" "init_state: attempt defaults to 0"
  assert_empty     "$(get_phase "$TEST_DIR" "$phase" started_at)" "init_state: started_at defaults to empty (JSON null)"
  assert_empty     "$(get_phase "$TEST_DIR" "$phase" completed_at)" "init_state: completed_at defaults to empty (JSON null)"
  assert_empty     "$(get_phase "$TEST_DIR" "$phase" output)" "init_state: output defaults to empty (JSON null)"
  assert_empty     "$(get_phase "$TEST_DIR" "$phase" error)" "init_state: error defaults to empty (JSON null)"
}

# ---- 2. get_phase ----
test_get_phase_status() {
  init_state "$TEST_DIR"
  assert_eq "pending" "$(get_phase "$TEST_DIR" "tts" status)" "get_phase: retrieves status for tts"
}

test_get_phase_attempt() {
  init_state "$TEST_DIR"
  assert_eq "0" "$(get_phase "$TEST_DIR" "render" attempt)" "get_phase: retrieves attempt for render"
}

# ---- 3. set_phase ----
test_set_phase_updates_status() {
  init_state "$TEST_DIR"
  set_phase "$TEST_DIR" "script" "completed" "out.txt"
  assert_eq "completed" "$(get_phase "$TEST_DIR" "script" status)" "set_phase: updates status to completed"
}

test_set_phase_sets_output() {
  init_state "$TEST_DIR"
  set_phase "$TEST_DIR" "script" "completed" "out.txt"
  assert_eq "out.txt" "$(get_phase "$TEST_DIR" "script" output)" "set_phase: sets output field"
}

# ---- 4. mark_running ----
test_mark_running_status() {
  init_state "$TEST_DIR"
  mark_running "$TEST_DIR" "tts"
  assert_eq "running" "$(get_phase "$TEST_DIR" "tts" status)" "mark_running: sets status to running"
}

test_mark_running_increments_attempt() {
  init_state "$TEST_DIR"
  mark_running "$TEST_DIR" "tts"
  assert_eq "1" "$(get_phase "$TEST_DIR" "tts" attempt)" "mark_running: attempt becomes 1"
  mark_running "$TEST_DIR" "tts"
  assert_eq "2" "$(get_phase "$TEST_DIR" "tts" attempt)" "mark_running: attempt increments to 2"
}

test_mark_running_sets_started_at() {
  init_state "$TEST_DIR"
  mark_running "$TEST_DIR" "tts"
  assert_nonempty "$(get_phase "$TEST_DIR" "tts" started_at)" "mark_running: started_at is set"
}

# ---- 5. mark_completed ----
test_mark_completed_status() {
  init_state "$TEST_DIR"
  mark_completed "$TEST_DIR" "whisper" "/tmp/out.json"
  assert_eq "completed" "$(get_phase "$TEST_DIR" "whisper" status)" "mark_completed: sets status to completed"
}

test_mark_completed_sets_output() {
  init_state "$TEST_DIR"
  mark_completed "$TEST_DIR" "whisper" "/tmp/out.json"
  assert_eq "/tmp/out.json" "$(get_phase "$TEST_DIR" "whisper" output)" "mark_completed: sets output field"
}

test_mark_completed_sets_completed_at() {
  init_state "$TEST_DIR"
  mark_completed "$TEST_DIR" "whisper"
  assert_nonempty "$(get_phase "$TEST_DIR" "whisper" completed_at)" "mark_completed: completed_at is set"
}

# ---- 6. mark_failed ----
test_mark_failed_status() {
  init_state "$TEST_DIR"
  mark_failed "$TEST_DIR" "lipsync" "GPU out of memory"
  assert_eq "failed" "$(get_phase "$TEST_DIR" "lipsync" status)" "mark_failed: sets status to failed"
}

test_mark_failed_preserves_error() {
  init_state "$TEST_DIR"
  mark_failed "$TEST_DIR" "lipsync" "GPU out of memory"
  assert_eq "GPU out of memory" "$(get_phase "$TEST_DIR" "lipsync" error)" "mark_failed: preserves error message"
}

test_mark_failed_error_null_when_empty() {
  init_state "$TEST_DIR"
  mark_failed "$TEST_DIR" "lipsync" ""
  # get_phase normalizes JSON null to empty string
  assert_empty "$(get_phase "$TEST_DIR" "lipsync" error)" "mark_failed: error is empty when empty string given (JSON null)"
}

# ---- 7. is_phase_completed ----
test_is_phase_completed_true() {
  init_state "$TEST_DIR"
  local out="$TEST_DIR/output.txt"
  touch "$out"
  echo "content" > "$out"
  mark_completed "$TEST_DIR" "script" "$out"
  if is_phase_completed "$TEST_DIR" "script" "$out"; then
    pass_test "is_phase_completed: returns true when status=completed and file exists"
  else
    fail_test "is_phase_completed: returns true when status=completed and file exists"
  fi
}

test_is_phase_completed_false_when_not_completed() {
  init_state "$TEST_DIR"
  if is_phase_completed "$TEST_DIR" "script" "/tmp/nonexistent"; then
    fail_test "is_phase_completed: returns false when status is not completed"
  else
    pass_test "is_phase_completed: returns false when status is not completed"
  fi
}

test_is_phase_completed_false_when_file_missing() {
  init_state "$TEST_DIR"
  mark_completed "$TEST_DIR" "script" "/tmp/test_pipeline_nonexistent_file_xyz"
  if is_phase_completed "$TEST_DIR" "script" "/tmp/test_pipeline_nonexistent_file_xyz"; then
    fail_test "is_phase_completed: returns false when output file does not exist"
  else
    pass_test "is_phase_completed: returns false when output file does not exist"
  fi
}

test_is_phase_completed_false_when_file_empty() {
  init_state "$TEST_DIR"
  local out="$TEST_DIR/empty.txt"
  touch "$out"  # create empty file
  mark_completed "$TEST_DIR" "script" "$out"
  if is_phase_completed "$TEST_DIR" "script" "$out"; then
    fail_test "is_phase_completed: returns false when output file is empty"
  else
    pass_test "is_phase_completed: returns false when output file is empty"
  fi
}

test_is_phase_completed_skips_file_check_when_no_output() {
  init_state "$TEST_DIR"
  mark_completed "$TEST_DIR" "script" ""  # no output file
  if is_phase_completed "$TEST_DIR" "script" ""; then
    pass_test "is_phase_completed: returns true when completed and no output file specified"
  else
    fail_test "is_phase_completed: returns true when completed and no output file specified"
  fi
}

# ---- 8. print_state ----
test_print_state_output() {
  init_state "$TEST_DIR"
  local out
  out=$(print_state "$TEST_DIR" 2>&1)
  if echo "$out" | grep -q "Pipeline state"; then
    pass_test "print_state: outputs header"
  else
    fail_test "print_state: outputs header" "missing 'Pipeline state'"
  fi
  # Verify all phases appear
  for phase in "${PHASES[@]}"; do
    if echo "$out" | grep -q "$phase"; then
      :  # found
    else
      fail_test "print_state: includes phase '$phase'"
      return
    fi
  done
  pass_test "print_state: includes all phases"
}

# ---------------------------------------------------------------------------
# Robustness tests
# ---------------------------------------------------------------------------

# 9. init_state twice should NOT overwrite existing state
test_init_state_idempotent() {
  init_state "$TEST_DIR"
  # Change a phase so we can detect overwrite
  mark_completed "$TEST_DIR" "tts" "/tmp/tts_out.wav"
  # Call init_state again
  init_state "$TEST_DIR"
  # Phase should still be completed
  assert_eq "completed" "$(get_phase "$TEST_DIR" "tts" status)" "init_state twice: does NOT overwrite existing state"
}

# 10. set_phase with empty output should keep previous output value
test_set_phase_empty_output_preserves_previous() {
  init_state "$TEST_DIR"
  set_phase "$TEST_DIR" "script" "running" "first_output.txt"
  assert_eq "first_output.txt" "$(get_phase "$TEST_DIR" "script" output)" "set_phase: initial output set"
  # Now call set_phase with empty output
  set_phase "$TEST_DIR" "script" "completed" "" ""
  assert_eq "first_output.txt" "$(get_phase "$TEST_DIR" "script" output)" "set_phase: empty output preserves previous value"
}

# 11. Concurrent reads should work (read state while another process writes)
test_concurrent_reads() {
  init_state "$TEST_DIR"
  local f
  f=$(state_file "$TEST_DIR")
  local errors=0

  # Writer: rapidly update the state in background
  (
    for i in $(seq 1 50); do
      set_phase "$TEST_DIR" "script" "running" "" "" 2>/dev/null || true
      set_phase "$TEST_DIR" "script" "completed" "" "" 2>/dev/null || true
    done
  ) &
  local writer_pid=$!

  # Reader: read the state file many times while writer is active
  for i in $(seq 1 30); do
    if ! get_phase "$TEST_DIR" "script" status > /dev/null 2>&1; then
      errors=$((errors + 1))
    fi
  done

  wait "$writer_pid" 2>/dev/null || true

  if [[ $errors -eq 0 ]]; then
    pass_test "concurrent reads: all reads succeeded during concurrent writes"
  else
    fail_test "concurrent reads: $errors read failures during concurrent writes"
  fi
}

# 12. State file with corrupted JSON should be handled gracefully
test_corrupted_json() {
  init_state "$TEST_DIR"
  local f
  f=$(state_file "$TEST_DIR")
  # Corrupt the JSON
  echo "this is not json {{{" > "$f"
  local result
  result=$(get_phase "$TEST_DIR" "script" status)
  assert_empty "$result" "corrupted JSON: get_phase returns empty string"
}

test_corrupted_json_set_phase_handled() {
  init_state "$TEST_DIR"
  local f
  f=$(state_file "$TEST_DIR")
  echo "this is not json {{{" > "$f"
  # set_phase should fail but not crash the script
  if set_phase "$TEST_DIR" "script" "running" "" "" 2>/dev/null; then
    pass_test "corrupted JSON: set_phase does not crash (may succeed or fail)"
  else
    pass_test "corrupted JSON: set_phase does not crash (may succeed or fail)"
  fi
}

# 13. Setting unknown phase should not crash
test_set_unknown_phase() {
  init_state "$TEST_DIR"
  # set_phase on unknown phase — jq will set it, which is fine
  if set_phase "$TEST_DIR" "nonexistent_phase" "running" "" "" 2>/dev/null; then
    pass_test "unknown phase: set_phase on unknown phase does not crash"
  else
    pass_test "unknown phase: set_phase on unknown phase does not crash"
  fi
}

# 14. Getting status for unknown phase should return empty string
test_get_unknown_phase() {
  init_state "$TEST_DIR"
  local result
  result=$(get_phase "$TEST_DIR" "nonexistent_phase" status)
  assert_empty "$result" "unknown phase: get_phase returns empty string"
}

# 15. Phase started_at should be set when marked running
test_started_at_set_on_running() {
  init_state "$TEST_DIR"
  mark_running "$TEST_DIR" "visuals"
  assert_nonempty "$(get_phase "$TEST_DIR" "visuals" started_at)" "started_at: set when marked running"
}

# 16. Phase completed_at should be set when marked completed
test_completed_at_set_on_completed() {
  init_state "$TEST_DIR"
  mark_completed "$TEST_DIR" "postprocess"
  assert_nonempty "$(get_phase "$TEST_DIR" "postprocess" completed_at)" "completed_at: set when marked completed"
}

# 17. Phase completed_at should NOT be set when marked running
test_completed_at_not_set_on_running() {
  init_state "$TEST_DIR"
  mark_running "$TEST_DIR" "storyboard"
  local val
  val=$(get_phase "$TEST_DIR" "storyboard" completed_at)
  if [[ "$val" == "null" || -z "$val" ]]; then
    pass_test "completed_at: NOT set when marked running"
  else
    fail_test "completed_at: NOT set when marked running" "got '$val'"
  fi
}

# 18. Phase completed_at should be set when marked failed (failed is a terminal state)
test_completed_at_set_on_failed() {
  init_state "$TEST_DIR"
  mark_failed "$TEST_DIR" "render" "some error"
  local val
  val=$(get_phase "$TEST_DIR" "render" completed_at)
  if [[ "$val" != "null" && -n "$val" ]]; then
    pass_test "completed_at: IS set when marked failed (failed is a terminal state)"
  else
    fail_test "completed_at: IS set when marked failed"
  fi
}

# 18b. Phase started_at should be set when mark_failed is called directly (without mark_running first)
test_started_at_set_on_failed_direct() {
  init_state "$TEST_DIR"
  mark_failed "$TEST_DIR" "render" "some error"
  local val
  val=$(get_phase "$TEST_DIR" "render" started_at)
  if [[ "$val" != "null" && -n "$val" ]]; then
    pass_test "started_at: IS set when mark_failed called directly (backfill)"
  else
    fail_test "started_at: IS set when mark_failed called directly"
  fi
}

# 19. Multiple phases can be in different states simultaneously
test_multiple_phases_different_states() {
  init_state "$TEST_DIR"
  mark_running "$TEST_DIR" "script"
  mark_completed "$TEST_DIR" "tts" "/tmp/tts.wav"
  mark_failed "$TEST_DIR" "whisper" "no audio"
  # pending phases remain untouched
  assert_eq "running"   "$(get_phase "$TEST_DIR" "script" status)"   "multiple phases: script is running"
  assert_eq "completed" "$(get_phase "$TEST_DIR" "tts" status)"     "multiple phases: tts is completed"
  assert_eq "failed"    "$(get_phase "$TEST_DIR" "whisper" status)"  "multiple phases: whisper is failed"
  assert_eq "pending"   "$(get_phase "$TEST_DIR" "subtitles" status)" "multiple phases: subtitles is still pending"
  assert_eq "pending"   "$(get_phase "$TEST_DIR" "render" status)"   "multiple phases: render is still pending"
}

# 20. mark_running does NOT change completed_at from previous completion
test_mark_running_does_not_clear_completed_at() {
  init_state "$TEST_DIR"
  mark_completed "$TEST_DIR" "script" "/tmp/out.txt"
  local prev_completed
  prev_completed=$(get_phase "$TEST_DIR" "script" completed_at)
  # Re-mark as running (simulating retry)
  mark_running "$TEST_DIR" "script"
  local after_completed
  after_completed=$(get_phase "$TEST_DIR" "script" completed_at)
  # completed_at should not have been cleared (it's only set, never cleared)
  if [[ "$after_completed" == "$prev_completed" ]]; then
    pass_test "mark_running: does not clear previously set completed_at"
  else
    fail_test "mark_running: does not clear previously set completed_at" "was '$prev_completed', now '$after_completed'"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo "===== Pipeline State Machine Tests ====="
  echo ""

  # ---- Basic functionality ----
  echo "--- init_state ---"
  setup
  test_init_state_creates_file
  test_init_state_all_phases_pending
  test_init_state_sets_default_fields
  teardown

  echo ""
  echo "--- get_phase ---"
  setup
  test_get_phase_status
  test_get_phase_attempt
  teardown

  echo ""
  echo "--- set_phase ---"
  setup
  test_set_phase_updates_status
  test_set_phase_sets_output
  teardown

  echo ""
  echo "--- mark_running ---"
  setup
  test_mark_running_status
  teardown

  setup
  test_mark_running_increments_attempt
  teardown

  setup
  test_mark_running_sets_started_at
  teardown

  echo ""
  echo "--- mark_completed ---"
  setup
  test_mark_completed_status
  test_mark_completed_sets_output
  test_mark_completed_sets_completed_at
  teardown

  echo ""
  echo "--- mark_failed ---"
  setup
  test_mark_failed_status
  test_mark_failed_preserves_error
  test_mark_failed_error_null_when_empty
  teardown

  echo ""
  echo "--- is_phase_completed ---"
  setup
  test_is_phase_completed_true
  test_is_phase_completed_false_when_not_completed
  test_is_phase_completed_false_when_file_missing
  test_is_phase_completed_false_when_file_empty
  test_is_phase_completed_skips_file_check_when_no_output
  teardown

  echo ""
  echo "--- print_state ---"
  setup
  test_print_state_output
  teardown

  echo ""
  echo "--- Robustness ---"
  setup
  test_init_state_idempotent
  teardown

  setup
  test_set_phase_empty_output_preserves_previous
  teardown

  setup
  test_concurrent_reads
  teardown

  setup
  test_corrupted_json
  test_corrupted_json_set_phase_handled
  teardown

  setup
  test_set_unknown_phase
  teardown

  setup
  test_get_unknown_phase
  teardown

  setup
  test_started_at_set_on_running
  teardown

  setup
  test_completed_at_set_on_completed
  teardown

  setup
  test_completed_at_not_set_on_running
  teardown

  setup
  test_completed_at_set_on_failed
  teardown

  setup
  test_started_at_set_on_failed_direct
  teardown

  setup
  test_multiple_phases_different_states
  teardown

  setup
  test_mark_running_does_not_clear_completed_at
  teardown

  echo ""
  echo "========================================"
  echo "PASSED: $PASSED, FAILED: $FAILED, TOTAL: $TOTAL"
  echo "========================================"

  if [[ $FAILED -gt 0 ]]; then
    exit 1
  fi
}

main "$@"