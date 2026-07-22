#!/bin/bash
# Test suite for remote job helpers (scripts/lib/remote_job.sh)
# Usage: bash scripts/test_remote_job.sh
# Uses fake ssh/scp executables (in a temp dir prepended to PATH) so the poll
# and submit logic can be tested without a real GPU server.
# Each test prints [PASS] or [FAIL] with a description.
# Final summary: PASSED: X, FAILED: Y, TOTAL: Z

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/remote_job.sh"

# ---------------------------------------------------------------------------
# Test infrastructure
# ---------------------------------------------------------------------------

PASSED=0
FAILED=0
TOTAL=0
TEST_DIR=""

setup() {
  TEST_DIR=$(mktemp -d /tmp/test_remote_job_XXXXX)
  mkdir -p "$TEST_DIR/bin"
  : > "$TEST_DIR/invocations.log"
  : > "$TEST_DIR/queries"

  # Fake ssh: dispatch on the remote command string (last argument).
  # Behavior is driven by $SSH_STUB_DIR/mode for status queries.
  # SSH_STUB_DOWN=<substring> 时，凡 target 含该子串的主机一律连接失败（exit 255），
  # 供 worker 池“不可达跳过”用例使用。
  cat > "$TEST_DIR/bin/ssh" << 'STUB_EOF'
#!/bin/bash
log="$SSH_STUB_DIR/invocations.log"
cmd=""
target=""
for arg in "$@"; do
  case "$arg" in *@*) target="$arg" ;; esac
  cmd="$arg"
done

if [ -n "${SSH_STUB_DOWN:-}" ] && [[ "$target" == *"$SSH_STUB_DOWN"* ]]; then
  echo "down:$target" >> "$log"
  exit 255
fi

if [ "$cmd" = "$target" ]; then
  # heredoc submit form: stdin carries the script to execute remotely
  echo "submit" >> "$log"
  cat > "$SSH_STUB_DIR/submit_script.txt"
  exit "${SSH_STUB_SUBMIT_RC:-0}"
fi

case "$cmd" in
  *missing_status*)
    echo "query" >> "$log"
    echo x >> "$SSH_STUB_DIR/queries"
    n=$(wc -l < "$SSH_STUB_DIR/queries" | tr -d ' ')
    mode=$(cat "$SSH_STUB_DIR/mode")
    case "$mode" in
      down) exit 255 ;;
      done) printf 'status=0\n' ;;
      failed) printf 'status=1\n' ;;
      running) printf 'running size=100\n' ;;
      running_then_done)
        if [ "$n" -ge 2 ]; then printf 'status=0\n'; else printf 'running size=100\n'; fi ;;
      missing_then_done)
        if [ "$n" -ge 6 ]; then printf 'status=0\n'; else printf 'missing_status\n'; fi ;;
      *) printf 'missing_status\n' ;;
    esac
    ;;
  *ffprobe*)
    echo "summary" >> "$log"
    echo "ok size=100 duration=4" ;;
  *"cat '"*)
    echo "getpid" >> "$log"
    # 模拟远端 shell 启动横幅混入 stdout（见 SSH_STUB_DIR/banner）
    if [ -f "$SSH_STUB_DIR/banner" ]; then
      printf 'Starting to run /root/aigc_apps/InfiniteTalk...\n'
    fi
    # 模拟横幅里混入纯数字行（见 SSH_STUB_DIR/banner_numeric），
    # 数字在真 PID 之前输出，tail -n 1 应仍取到最后一个数字行（真 PID）
    if [ -f "$SSH_STUB_DIR/banner_numeric" ]; then
      printf '2\n20260720\n'
    fi
    echo "4242" ;;
  *tail*)
    echo "tail" >> "$log"
    echo "fake log tail line" ;;
  *kill*)
    echo "kill" >> "$log"
    exit 0 ;;
  *)
    echo "other" >> "$log"
    exit 0 ;;
esac
STUB_EOF
  chmod +x "$TEST_DIR/bin/ssh"

  # Fake scp: record and succeed.
  cat > "$TEST_DIR/bin/scp" << 'STUB_EOF'
#!/bin/bash
echo "scp $*" >> "$SSH_STUB_DIR/invocations.log"
exit 0
STUB_EOF
  chmod +x "$TEST_DIR/bin/scp"

  export SSH_STUB_DIR="$TEST_DIR"
  export PATH="$TEST_DIR/bin:$PATH"
}

teardown() {
  if [[ -n "$TEST_DIR" && -d "$TEST_DIR" ]]; then
    rm -rf "$TEST_DIR"
  fi
  TEST_DIR=""
}

pass_test() {
  echo "  [PASS] $1"
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
}

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

# Usage: assert_eq "expected" "actual" "description"
assert_eq() {
  local expected="$1" actual="$2" desc="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass_test "$desc"
  else
    fail_test "$desc" "expected '$expected', got '$actual'"
  fi
}

# Usage: assert_contains "haystack" "needle" "description"
assert_contains() {
  local haystack="$1" needle="$2" desc="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass_test "$desc"
  else
    fail_test "$desc" "output missing '$needle'"
  fi
}

# Usage: assert_file_contains "file" "needle" "description"
assert_file_contains() {
  local file="$1" needle="$2" desc="$3"
  if [[ -f "$file" ]] && grep -qF "$needle" "$file"; then
    pass_test "$desc"
  else
    fail_test "$desc" "file missing '$needle'"
  fi
}

# Count lines of a given kind in the stub invocation log.
count_in_log() {
  grep -c "^$1\$" "$SSH_STUB_DIR/invocations.log" 2>/dev/null || true
}

# Run remote_job_poll in a subshell, capturing combined output and exit code.
# Sets globals POLL_OUT and POLL_RC.
run_poll() {
  if POLL_OUT=$( ( remote_job_poll "$@" ) 2>&1 ); then
    POLL_RC=0
  else
    POLL_RC=$?
  fi
}

POLL_OUT=""
POLL_RC=0

# Standard remote file paths used across poll tests
R_STATUS="/ws/output/job_1.status"
R_PID="/ws/output/job_1.pid"
R_LOG="/ws/output/job_1.log"
R_RUNNER="/ws/output/job_1.sh"
R_OUT="/ws/output/result.bin"

# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

# ---- 1. Unified SSH/SCP options ----
test_ssh_opts_include_batchmode() {
  assert_contains "$REMOTE_JOB_SSH_OPTS" "-o BatchMode=yes" "ssh opts: includes BatchMode=yes"
}

test_ssh_opts_include_connect_timeout() {
  assert_contains "$REMOTE_JOB_SSH_OPTS" "-o ConnectTimeout=10" "ssh opts: includes ConnectTimeout=10"
}

test_ssh_opts_keep_server_alive() {
  assert_contains "$REMOTE_JOB_SSH_OPTS" "-o ServerAliveInterval=60 -o ServerAliveCountMax=7" "ssh opts: keeps original ServerAlive options"
}

# ---- 2. remote_job_activate_cmd ----
test_activate_empty() {
  assert_eq "" "$(remote_job_activate_cmd "")" "activate_cmd: empty venv -> empty command"
}

test_activate_null() {
  assert_eq "" "$(remote_job_activate_cmd "null")" "activate_cmd: 'null' -> empty command"
}

test_activate_source_passthrough() {
  assert_eq "source /opt/venv/bin/activate && export FOO=1" \
    "$(remote_job_activate_cmd "source /opt/venv/bin/activate && export FOO=1")" \
    "activate_cmd: 'source ...' used as-is"
}

test_activate_conda_envs_path() {
  assert_eq 'source "/root/miniconda3/etc/profile.d/conda.sh" && conda activate "tts"' \
    "$(remote_job_activate_cmd "/root/miniconda3/envs/tts/bin/activate")" \
    "activate_cmd: .../envs/<name>/bin/activate -> conda shell hook"
}

test_activate_absolute_path() {
  assert_eq "source /root/aigc_apps/index-tts/.venv/bin/activate" \
    "$(remote_job_activate_cmd "/root/aigc_apps/index-tts/.venv/bin/activate")" \
    "activate_cmd: absolute venv path -> source <path>"
}

test_activate_bare_name_with_root() {
  assert_eq "source /root/miniconda3/etc/profile.d/conda.sh && conda activate multitalk" \
    "$(remote_job_activate_cmd "multitalk" "/root/miniconda3")" \
    "activate_cmd: bare env name + fallback root -> conda.sh + activate"
}

test_activate_bare_name_without_root() {
  assert_eq "conda activate multitalk" \
    "$(remote_job_activate_cmd "multitalk")" \
    "activate_cmd: bare env name w/o fallback root -> plain conda activate"
}

# ---- 3. remote_job_submit ----
test_submit_returns_remote_pid() {
  remote_job_init "example.com" "22" "root"
  local pid
  pid=$(remote_job_submit "$R_STATUS" "$R_PID" "$R_LOG" "$R_RUNNER" << 'EOF'
#!/bin/bash
set -e
echo "runner body marker"
EOF
)
  assert_eq "4242" "$pid" "submit: outputs remote PID read from pid file"
}

test_submit_pid_ignores_remote_banner() {
  remote_job_init "example.com" "22" "root"
  touch "$SSH_STUB_DIR/banner"
  local pid
  pid=$(remote_job_submit "$R_STATUS" "$R_PID" "$R_LOG" "$R_RUNNER" << 'EOF'
body
EOF
)
  assert_eq "4242" "$pid" "submit: pid readback ignores remote shell banner noise"
}

test_pid_extraction_with_noisy_banner() {
  remote_job_init "example.com" "22" "root"
  touch "$SSH_STUB_DIR/banner_numeric"
  local pid
  pid=$(remote_job_submit "$R_STATUS" "$R_PID" "$R_LOG" "$R_RUNNER" << 'EOF'
body
EOF
)
  assert_eq "4242" "$pid" "submit: pid readback ignores numeric banner lines before real pid"
}

test_submit_script_structure() {
  remote_job_init "example.com" "22" "root"
  remote_job_submit "$R_STATUS" "$R_PID" "$R_LOG" "$R_RUNNER" "/ws/output/job_1.json" \
    "printf '%s' 'QUJD' | base64 -d > \"/ws/output/job_1.json\"" << 'EOF' > /dev/null
#!/bin/bash
set -e
python remote_worker.py < "$REMOTE_JOB"
EOF
  local f="$SSH_STUB_DIR/submit_script.txt"
  assert_file_contains "$f" 'mkdir -p "/ws/output"' "submit: mkdirs remote output dir"
  assert_file_contains "$f" 'rm -f "/ws/output/job_1.status" "/ws/output/job_1.pid" "/ws/output/job_1.log" "/ws/output/job_1.sh" /ws/output/job_1.json' "submit: rm -f status/pid/log/runner + extra file"
  assert_file_contains "$f" "printf '%s' 'QUJD' | base64 -d > \"/ws/output/job_1.json\"" "submit: runs pre-runner command"
  assert_file_contains "$f" "cat > \"/ws/output/job_1.sh\" << 'REMOTE_RUNNER_EOF'" "submit: writes runner via quoted heredoc"
  assert_file_contains "$f" 'python remote_worker.py < "$REMOTE_JOB"' "submit: runner body passed through verbatim"
  assert_file_contains "$f" 'nohup bash "/ws/output/job_1.sh" > "/ws/output/job_1.log" 2>&1 </dev/null &' "submit: nohup launch line"
  assert_file_contains "$f" 'echo $! > "/ws/output/job_1.pid"' "submit: records background PID"
}

test_submit_ssh_failure_propagates() {
  remote_job_init "example.com" "22" "root"
  local rc=0
  ( export SSH_STUB_SUBMIT_RC=255
    remote_job_submit "$R_STATUS" "$R_PID" "$R_LOG" "$R_RUNNER" << 'EOF' > /dev/null
body
EOF
  ) || rc=$?
  assert_eq "255" "$rc" "submit: ssh failure returns non-zero"
}

# ---- 4. poll: success path ----
test_poll_success() {
  echo "running_then_done" > "$SSH_STUB_DIR/mode"
  remote_job_init "example.com" "22" "root"
  run_poll "TTS" "$R_STATUS" "4242" "$R_OUT" "$R_LOG" "$R_LOG" 1 1
  assert_eq "0" "$POLL_RC" "poll success: returns 0 when status=0"
  assert_contains "$POLL_OUT" "✅ 远端 TTS 任务完成（ok size=100 duration=4）" "poll success: prints completion summary"
  assert_eq "2" "$(wc -l < "$SSH_STUB_DIR/queries" | tr -d ' ')" "poll success: queried twice (running, then done)"
  assert_eq "1" "$(count_in_log summary)" "poll success: summary fetched once"
}

# ---- 5. poll: remote job failure path ----
test_poll_remote_failure() {
  echo "failed" > "$SSH_STUB_DIR/mode"
  remote_job_init "example.com" "22" "root"
  run_poll "TTS" "$R_STATUS" "4242" "$R_OUT" "$R_LOG" "$R_LOG" 1 1
  assert_eq "1" "$POLL_RC" "poll failure: exits 1 when status!=0"
  assert_contains "$POLL_OUT" "❌ 远端 TTS 任务失败" "poll failure: prints failure message"
  assert_eq "1" "$(count_in_log tail)" "poll failure: tails remote logs"
}

# ---- 6. poll: ssh circuit breaker ----
test_poll_ssh_circuit_breaker() {
  echo "down" > "$SSH_STUB_DIR/mode"
  remote_job_init "example.com" "22" "root"
  run_poll "InfiniteTalk" "$R_STATUS" "4242" "$R_OUT" "$R_LOG" "$R_LOG.stderr" 1 1
  assert_eq "1" "$POLL_RC" "poll breaker: exits 1 after consecutive ssh failures"
  assert_eq "5" "$(wc -l < "$SSH_STUB_DIR/queries" | tr -d ' ')" "poll breaker: stops after exactly 5 failed queries"
  assert_contains "$POLL_OUT" "连续 5 次 SSH 失败" "poll breaker: prints circuit-breaker message"
  assert_eq "0" "$(count_in_log kill)" "poll breaker: does not attempt kill (network down)"
}

# ---- 7. poll: timeout path ----
test_poll_timeout() {
  echo "running" > "$SSH_STUB_DIR/mode"
  remote_job_init "example.com" "22" "root"
  # interval 120s + 1 minute budget -> max_poll = 0, so the timeout fires
  # before the first query (keeps the test fast).
  run_poll "MuseTalk" "$R_STATUS" "4242" "$R_OUT" "$R_LOG" "$R_LOG.stderr" 120 1
  assert_eq "1" "$POLL_RC" "poll timeout: exits 1 when poll budget exhausted"
  assert_contains "$POLL_OUT" "❌ 远端 MuseTalk 任务超时（>1分钟），强制终止" "poll timeout: prints timeout message"
  assert_eq "1" "$(count_in_log kill)" "poll timeout: kills remote pid"
  assert_eq "0" "$(wc -l < "$SSH_STUB_DIR/queries" | tr -d ' ')" "poll timeout: no status query after budget exhausted"
}

# ---- 8. poll: missing_status does not trip the ssh circuit breaker ----
test_poll_missing_status_not_ssh_failure() {
  echo "missing_then_done" > "$SSH_STUB_DIR/mode"
  remote_job_init "example.com" "22" "root"
  run_poll "TTS" "$R_STATUS" "4242" "$R_OUT" "$R_LOG" "$R_LOG" 1 1
  assert_eq "0" "$POLL_RC" "poll missing_status: recovers and completes (not counted as ssh failure)"
  assert_eq "6" "$(wc -l < "$SSH_STUB_DIR/queries" | tr -d ' ')" "poll missing_status: kept querying past the breaker threshold"
}

# ---- 9. remote_job_select_worker（P2-12 worker 池选择） ----
write_workers_config() {
  cat > "$SSH_STUB_DIR/servers.json" << 'EOF'
{
  "primary": {"host": "primary.example", "port": 22, "user": "root"},
  "workers": [
    {"name": "w1", "host": "w1.example", "port": 22, "user": "gpu"},
    {"name": "w2", "host": "w2.example", "port": 2200, "user": "ubuntu"}
  ]
}
EOF
}

reset_rr() {
  export REMOTE_JOB_RR_STATE="$SSH_STUB_DIR/rr"
  rm -f "$REMOTE_JOB_RR_STATE"
}

test_select_first_healthy_worker() {
  write_workers_config
  reset_rr
  local out
  out=$(remote_job_select_worker "$SSH_STUB_DIR/servers.json")
  assert_eq "0 w1.example 22 gpu" "$out" "select: picks first healthy worker"
  assert_eq "1" "$(cat "$REMOTE_JOB_RR_STATE")" "select: round-robin cursor advanced to next"
}

test_select_round_robins() {
  write_workers_config
  reset_rr
  remote_job_select_worker "$SSH_STUB_DIR/servers.json" > /dev/null
  local out
  out=$(remote_job_select_worker "$SSH_STUB_DIR/servers.json")
  assert_eq "1 w2.example 2200 ubuntu" "$out" "select: round-robins to next worker on second call"
}

test_select_skips_unreachable() {
  write_workers_config
  reset_rr
  local out
  out=$(SSH_STUB_DOWN="w1.example" remote_job_select_worker "$SSH_STUB_DIR/servers.json")
  assert_eq "1 w2.example 2200 ubuntu" "$out" "select: skips unreachable worker"
}

test_select_fallback_all_down() {
  write_workers_config
  reset_rr
  local out
  out=$(SSH_STUB_DOWN=".example" remote_job_select_worker "$SSH_STUB_DIR/servers.json" 2>"$SSH_STUB_DIR/select_err.log")
  assert_eq "primary primary.example 22 root" "$out" "select: all workers down falls back to primary"
  assert_file_contains "$SSH_STUB_DIR/select_err.log" "回退 primary" "select: fallback prints clear log line"
}

test_select_no_workers_array() {
  cat > "$SSH_STUB_DIR/servers.json" << 'EOF'
{"primary": {"host": "primary.example", "port": 22, "user": "root"}}
EOF
  reset_rr
  local out
  out=$(remote_job_select_worker "$SSH_STUB_DIR/servers.json")
  assert_eq "primary primary.example 22 root" "$out" "select: no workers array falls back to primary"
}

test_select_empty_workers_array() {
  cat > "$SSH_STUB_DIR/servers.json" << 'EOF'
{"primary": {"host": "primary.example", "port": 22, "user": "root"}, "workers": []}
EOF
  reset_rr
  local out
  out=$(remote_job_select_worker "$SSH_STUB_DIR/servers.json")
  assert_eq "primary primary.example 22 root" "$out" "select: empty workers array falls back to primary"
}

# --- remote_job_scp（scp 重试）---
# 用 SCP_STUB_FAIL_TIMES 控制 fake scp 前 N 次失败，验证重试与耗尽行为。

_stub_scp_flaky() {
  cat > "$SSH_STUB_DIR/bin/scp" << 'STUB_EOF'
#!/bin/bash
echo "scp $*" >> "$SSH_STUB_DIR/invocations.log"
count=$(wc -l < "$SSH_STUB_DIR/scp_attempts" 2>/dev/null | tr -d ' ')
count=${count:-0}
echo x >> "$SSH_STUB_DIR/scp_attempts"
if [ "$count" -lt "${SCP_STUB_FAIL_TIMES:-0}" ]; then
  echo "scp: Connection closed" >&2
  exit 1
fi
exit 0
STUB_EOF
  chmod +x "$SSH_STUB_DIR/bin/scp"
  : > "$SSH_STUB_DIR/scp_attempts"
}

test_scp_first_try_success() {
  _stub_scp_flaky
  export SCP_STUB_FAIL_TIMES=0 REMOTE_JOB_SCP_RETRY_DELAY=0
  if remote_job_scp local.wav "root@host.example:/tmp/out.wav" 22; then
    pass_test "scp: first-try success returns 0"
  else
    fail_test "scp: first-try success returns 0"
  fi
  local lines
  lines=$(grep -c '^scp ' "$SSH_STUB_DIR/invocations.log" || true)
  assert_eq "1" "$lines" "scp: first-try success attempts once"
  unset SCP_STUB_FAIL_TIMES
}

test_scp_retry_then_success() {
  _stub_scp_flaky
  export SCP_STUB_FAIL_TIMES=2 REMOTE_JOB_SCP_RETRY_DELAY=0
  if remote_job_scp local.wav "root@host.example:/tmp/out.wav" 22 2>/dev/null; then
    pass_test "scp: retry succeeds after 2 failures"
  else
    fail_test "scp: retry succeeds after 2 failures"
  fi
  local lines
  lines=$(grep -c '^scp ' "$SSH_STUB_DIR/invocations.log" || true)
  assert_eq "3" "$lines" "scp: retried up to 3 attempts"
  unset SCP_STUB_FAIL_TIMES
}

test_scp_exhausts_retries() {
  _stub_scp_flaky
  export SCP_STUB_FAIL_TIMES=99 REMOTE_JOB_SCP_RETRY_DELAY=0 REMOTE_JOB_SCP_RETRIES=3
  if remote_job_scp local.wav "root@host.example:/tmp/out.wav" 22 2>/dev/null; then
    fail_test "scp: exhausts retries returns non-zero"
  else
    pass_test "scp: exhausts retries returns non-zero"
  fi
  local lines
  lines=$(grep -c '^scp ' "$SSH_STUB_DIR/invocations.log" || true)
  assert_eq "3" "$lines" "scp: stops after exactly 3 attempts"
  unset SCP_STUB_FAIL_TIMES REMOTE_JOB_SCP_RETRIES
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo "===== Remote Job Helper Tests ====="
  echo ""

  echo "--- SSH/SCP options ---"
  test_ssh_opts_include_batchmode
  test_ssh_opts_include_connect_timeout
  test_ssh_opts_keep_server_alive

  echo ""
  echo "--- remote_job_activate_cmd ---"
  test_activate_empty
  test_activate_null
  test_activate_source_passthrough
  test_activate_conda_envs_path
  test_activate_absolute_path
  test_activate_bare_name_with_root
  test_activate_bare_name_without_root

  echo ""
  echo "--- remote_job_submit ---"
  setup
  test_submit_returns_remote_pid
  teardown

  setup
  test_submit_pid_ignores_remote_banner
  teardown

  setup
  test_pid_extraction_with_noisy_banner
  teardown

  setup
  test_submit_script_structure
  teardown

  setup
  test_submit_ssh_failure_propagates
  teardown

  echo ""
  echo "--- remote_job_poll ---"
  setup
  test_poll_success
  teardown

  setup
  test_poll_remote_failure
  teardown

  setup
  test_poll_ssh_circuit_breaker
  teardown

  setup
  test_poll_timeout
  teardown

  setup
  test_poll_missing_status_not_ssh_failure
  teardown

  echo ""
  echo "--- remote_job_scp ---"
  setup
  test_scp_first_try_success
  teardown

  setup
  test_scp_retry_then_success
  teardown

  setup
  test_scp_exhausts_retries
  teardown

  echo ""
  echo "--- remote_job_select_worker ---"
  setup
  test_select_first_healthy_worker
  test_select_round_robins
  test_select_skips_unreachable
  test_select_fallback_all_down
  test_select_no_workers_array
  test_select_empty_workers_array
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
