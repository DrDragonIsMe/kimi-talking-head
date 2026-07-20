#!/bin/bash
# Tests for scripts/lib/validate_config.sh — host 配置 pre-flight 校验（建议12）。
# Usage: bash scripts/test_validate_config.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATE="$SCRIPT_DIR/lib/validate_config.sh"

PASSED=0
FAILED=0
TEST_DIR=$(mktemp -d /tmp/test_validate_config_XXXXX)
trap 'rm -rf "$TEST_DIR"' EXIT

pass_test() { echo "  [PASS] $1"; PASSED=$((PASSED + 1)); }
fail_test() { echo "  [FAIL] $1 — $2"; FAILED=$((FAILED + 1)); }

# 期望退出码 0
assert_ok() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    pass_test "$desc"
  else
    fail_test "$desc" "expected exit 0"
  fi
}

# 期望退出码非 0，且 stderr 包含指定文本
assert_fail_with_msg() {
  local desc="$1" needle="$2"; shift 2
  local err
  err=$("$@" 2>&1 >/dev/null) && {
    fail_test "$desc" "expected non-zero exit, got 0"
    return
  }
  if echo "$err" | grep -q "$needle"; then
    pass_test "$desc"
  else
    fail_test "$desc" "stderr missing '$needle': $err"
  fi
}

echo "===== validate_config.sh Tests ====="

# 1. 合法 dna → 退出 0
for dna in classic loud keynote cream editorial documentary; do
  cat > "$TEST_DIR/p.json" << EOF
{"content_overlay": {"subtitles": {"dna": "$dna"}}}
EOF
  assert_ok "valid dna '$dna' passes" bash "$VALIDATE" "$TEST_DIR/p.json"
done

# 2. 未配置 dna → 默认 classic，退出 0
echo '{}' > "$TEST_DIR/p.json"
assert_ok "missing dna defaults to classic and passes" bash "$VALIDATE" "$TEST_DIR/p.json"

# 3. 非法 dna → 退出 1，报错包含可选值
cat > "$TEST_DIR/p.json" << 'EOF'
{"content_overlay": {"subtitles": {"dna": "fancy"}}}
EOF
assert_fail_with_msg "invalid dna 'fancy' fails with clear message" "classic | loud | keynote | cream | editorial | documentary" \
  bash "$VALIDATE" "$TEST_DIR/p.json"

# 4. 配置文件不存在 → 退出 1
assert_fail_with_msg "missing profile file fails" "不存在" bash "$VALIDATE" "$TEST_DIR/nonexistent.json"

# 5. 非法 JSON → 退出 1
echo 'not json {{{' > "$TEST_DIR/bad.json"
assert_fail_with_msg "invalid JSON fails" "合法 JSON" bash "$VALIDATE" "$TEST_DIR/bad.json"

# 6. 缺少参数 → 退出 1
assert_fail_with_msg "missing argument fails" "用法" bash "$VALIDATE"

echo ""
echo "========================================"
echo "PASSED: $PASSED, FAILED: $FAILED"
echo "========================================"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
