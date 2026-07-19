#!/bin/bash
# 测试用慢速假 pipeline：一直睡眠，用于验证 stop（SIGTERM 进程组）。
set -euo pipefail
echo "slow stub started: ${2:-unknown}"
sleep 30
