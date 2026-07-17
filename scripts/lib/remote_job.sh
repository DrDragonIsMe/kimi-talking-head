#!/bin/bash
# Remote GPU job helpers for kimi-talking-head.
# Provides: unified ssh/scp options, conda env activation command resolution,
# nohup background job submission, and status polling with timeout plus an
# ssh-failure circuit breaker.
#
# Sourced by scripts/tts_index.sh, scripts/infinitetalk.sh, scripts/musetalk.sh.
# 不要在这里 set 任何 shell 选项（-e/-u/pipefail），以免影响调用方。

# 统一 SSH/SCP 选项：BatchMode 避免认证异常时挂住等密码输入，ConnectTimeout
# 让网络故障快速失败，ServerAlive* 保留各脚本原有的长任务连接保活。
REMOTE_JOB_SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=60 -o ServerAliveCountMax=7"

# 状态轮询中连续 ssh 失败多少次后熔断退出（调用方可在 source 前覆盖）。
REMOTE_JOB_MAX_SSH_FAILURES="${REMOTE_JOB_MAX_SSH_FAILURES:-5}"

# 连接参数，由 remote_job_init 设置。
REMOTE_JOB_HOST=""
REMOTE_JOB_PORT=""
REMOTE_JOB_USER=""

# 设置后续 submit/poll 使用的目标服务器连接参数。
# 用法: remote_job_init <host> <port> <user>
remote_job_init() {
    REMOTE_JOB_HOST="$1"
    REMOTE_JOB_PORT="$2"
    REMOTE_JOB_USER="$3"
}

# 将配置中的 python 环境值解析为远端激活命令，结果输出到 stdout（可为空串）。
# 用法: remote_job_activate_cmd <venv> [fallback_conda_root]
#   venv 形态（按优先级）：
#     空串/"null"                      -> 空串（远端跳过激活）
#     "source ..."                     -> 原样使用
#     .../envs/<name>/bin/activate     -> source "<root>/etc/profile.d/conda.sh" && conda activate "<name>"
#     绝对路径或本地存在的文件          -> source <venv>
#     含 "activate" 的其他相对路径      -> source <venv>
#     裸环境名                         -> 给了 fallback_conda_root 时:
#                                         source <root>/etc/profile.d/conda.sh && conda activate <name>
#                                         否则: conda activate <name>
remote_job_activate_cmd() {
    local venv="$1"
    local conda_root="${2:-}"
    if [ -z "$venv" ] || [ "$venv" = "null" ]; then
        printf ''
        return 0
    fi
    if echo "$venv" | grep -qE "^source"; then
        printf '%s' "$venv"
        return 0
    fi
    if [[ "$venv" =~ /envs/([^/]+)/bin/activate$ ]]; then
        local env_name="${BASH_REMATCH[1]}"
        local root="${venv%/envs/$env_name/bin/activate}"
        printf 'source "%s/etc/profile.d/conda.sh" && conda activate "%s"' "$root" "$env_name"
        return 0
    fi
    if [ -f "$venv" ] || echo "$venv" | grep -qE "^/"; then
        printf 'source %s' "$venv"
        return 0
    fi
    if echo "$venv" | grep -q "activate"; then
        printf 'source %s' "$venv"
        return 0
    fi
    if [ -n "$conda_root" ]; then
        printf 'source %s/etc/profile.d/conda.sh && conda activate %s' "$conda_root" "$venv"
    else
        printf 'conda activate %s' "$venv"
    fi
}

# 通过 nohup 提交远端后台任务。
# 用法: remote_job_submit <status_file> <pid_file> <log_file> <runner_file> [extra_rm] [pre_runner_cmd]
#   runner 脚本正文从 stdin 读取（调用方用未加引号的 heredoc 传入，
#   本地变量在传入前已展开，与原先外层层 heredoc 的展开时机一致）。
#   extra_rm        — 额外要在提交前 rm -f 的远端文件（可空）。
#   pre_runner_cmd  — 写入 runner 之前要在远端执行的额外命令（可空）。
# 成功时 stdout 输出远端 PID（可能为空串，由调用方检查）；ssh 失败返回非零。
remote_job_submit() {
    local status_file="$1" pid_file="$2" log_file="$3" runner_file="$4"
    local extra_rm="${5:-}" pre_runner_cmd="${6:-}"
    local output_dir
    output_dir=$(dirname "$status_file")
    local runner_body
    runner_body=$(cat)

    # 显式捕获提交 ssh 的返回码，不依赖调用方的 set -e（在 &&/|| 上下文中 -e 会被抑制）
    local submit_rc=0
    ssh -p "$REMOTE_JOB_PORT" $REMOTE_JOB_SSH_OPTS "$REMOTE_JOB_USER@$REMOTE_JOB_HOST" << EOF || submit_rc=$?
    set -e
    mkdir -p "$output_dir"
    rm -f "$status_file" "$pid_file" "$log_file" "$runner_file" $extra_rm
    $pre_runner_cmd
    cat > "$runner_file" << 'REMOTE_RUNNER_EOF'
$runner_body
REMOTE_RUNNER_EOF
    chmod +x "$runner_file"
    nohup bash "$runner_file" > "$log_file" 2>&1 </dev/null &
    echo \$! > "$pid_file"
EOF
    if [ "$submit_rc" -ne 0 ]; then
        return "$submit_rc"
    fi

    ssh -p "$REMOTE_JOB_PORT" $REMOTE_JOB_SSH_OPTS "$REMOTE_JOB_USER@$REMOTE_JOB_HOST" "cat '$pid_file' 2>/dev/null || echo ''"
}

# 轮询远端任务状态直到完成。
# 用法: remote_job_poll <label> <status_file> <pid_value> <output_file> <log_file>
#                       <error_grep_target> <poll_interval_sec> <max_poll_minutes>
#   label             — 日志中的任务名（TTS / InfiniteTalk / MuseTalk）。
#   error_grep_target — 完成后 grep 致命错误（Traceback|Error:）的远端日志文件，
#                       由各调用方指定（TTS 查主日志，唇形同步查 .stderr）。
# 完成（status=0）返回 0；远端失败/超时/状态异常/连续 ssh 失败熔断时 exit 1
# （与原内联实现一致，直接终止整个脚本）。
remote_job_poll() {
    local label="$1" status_file="$2" pid_value="$3" output_file="$4" log_file="$5"
    local grep_target="$6" poll_interval="$7" max_poll_minutes="$8"
    local max_ssh_failures="$REMOTE_JOB_MAX_SSH_FAILURES"

    local poll_count=0
    local max_poll=$((max_poll_minutes * 60 / poll_interval))
    local ssh_failures=0
    local status_output remote_summary

    while true; do
        poll_count=$((poll_count + 1))
        if [ "$poll_count" -gt "$max_poll" ]; then
            echo "❌ 远端 $label 任务超时（>${max_poll_minutes}分钟），强制终止" >&2
            ssh -p "$REMOTE_JOB_PORT" $REMOTE_JOB_SSH_OPTS "$REMOTE_JOB_USER@$REMOTE_JOB_HOST" "kill '$pid_value' 2>/dev/null || true" || true
            exit 1
        fi

        status_output=$(ssh -p "$REMOTE_JOB_PORT" $REMOTE_JOB_SSH_OPTS "$REMOTE_JOB_USER@$REMOTE_JOB_HOST" "
            set -e
            if [ -f '$status_file' ]; then
                printf 'status=%s\n' \"\$(cat '$status_file')\"
            elif kill -0 '$pid_value' 2>/dev/null; then
                if [ -f '$output_file' ]; then
                    SIZE=\$(wc -c < '$output_file' 2>/dev/null || echo 0)
                    printf 'running size=%s\n' \"\$SIZE\"
                else
                    printf 'running size=0\n'
                fi
            else
                printf 'missing_status\n'
            fi
        " 2>/dev/null || echo "ssh_failed")

        echo "⏳ $label 状态: $status_output"

        case "$status_output" in
            status=0*)
                remote_summary=$(ssh -p "$REMOTE_JOB_PORT" $REMOTE_JOB_SSH_OPTS "$REMOTE_JOB_USER@$REMOTE_JOB_HOST" "
                    set -e
                    if [ ! -s '$output_file' ]; then
                        echo 'missing_output'
                        exit 0
                    fi
                    SIZE=\$(wc -c < '$output_file' 2>/dev/null || echo 0)
                    DURATION=\$(ffprobe -v error -show_entries format=duration -of csv=p=0 '$output_file' 2>/dev/null || echo 0)
                    if grep -Eq 'Traceback \(most recent call last\)|Error:' '$grep_target' 2>/dev/null; then
                        echo \"warning size=\$SIZE duration=\$DURATION\"
                    else
                        echo \"ok size=\$SIZE duration=\$DURATION\"
                    fi
                " 2>/dev/null || echo "ssh_failed")
                echo "✅ 远端 $label 任务完成（${remote_summary}）"
                break
                ;;
            status=*)
                echo "❌ 远端 $label 任务失败，日志尾部如下：" >&2
                ssh -p "$REMOTE_JOB_PORT" $REMOTE_JOB_SSH_OPTS "$REMOTE_JOB_USER@$REMOTE_JOB_HOST" "tail -n 80 '$log_file' '$log_file.stderr' 2>/dev/null" >&2 || true
                exit 1
                ;;
            running*)
                ssh_failures=0
                sleep "$poll_interval"
                ;;
            ssh_failed)
                ssh_failures=$((ssh_failures + 1))
                if [ "$ssh_failures" -ge "$max_ssh_failures" ]; then
                    echo "❌ 远端 $label 状态查询连续 $ssh_failures 次 SSH 失败，判定为网络故障，终止等待（远端任务可能仍在运行）" >&2
                    exit 1
                fi
                echo "⚠️ 无法获取远端 $label 状态，稍后重试..." >&2
                sleep "$poll_interval"
                ;;
            missing_status)
                # ssh 本身成功（进程已死但还没写 status），不计入 ssh 熔断
                ssh_failures=0
                echo "⚠️ 无法获取远端 $label 状态，稍后重试..." >&2
                sleep "$poll_interval"
                ;;
            *)
                echo "❌ 远端 $label 任务状态异常：$status_output" >&2
                ssh -p "$REMOTE_JOB_PORT" $REMOTE_JOB_SSH_OPTS "$REMOTE_JOB_USER@$REMOTE_JOB_HOST" "tail -n 80 '$log_file' '$log_file.stderr' 2>/dev/null" >&2 || true
                exit 1
                ;;
        esac
    done
}
