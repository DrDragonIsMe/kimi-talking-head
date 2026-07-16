#!/bin/bash
set -e

CONFIG="config/servers.json"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS="-o ServerAliveInterval=60 -o ServerAliveCountMax=7"

detect_on_server() {
    local HOST=$1
    local PORT=$2
    local USER=$3
    local SERVER_TYPE=$4

    echo "🔍 探测 $SERVER_TYPE 服务器 ($USER@$HOST:$PORT)..."

    if ! ssh -p $PORT -o ConnectTimeout=5 -o BatchMode=yes -o ServerAliveInterval=60 -o ServerAliveCountMax=7 $USER@$HOST "echo OK" >/dev/null 2>&1; then
        echo "  ❌ $SERVER_TYPE 服务器无法连接"
        return 1
    fi

    echo "  ✅ SSH 连接正常"

    echo "  🔍 探测 IndexTTS..."
    local TTS_PATH=$(ssh -p $PORT $SSH_OPTS $USER@$HOST "
        for path in /root/workspace/index-tts /home/root/workspace/index-tts /root/workspace/InfiniteTalk/index-tts /home/\$USER/index-tts /opt/IndexTTS /usr/local/IndexTTS ~/IndexTTS /data/IndexTTS; do
            if [ -f \"\$path/test_infer.py\" ] || [ -f \"\$path/inference.py\" ] || [ -f \"\$path/tts.py\" ] || [ -f \"\$path/generate.py\" ]; then
                echo \"\$path/indextts\"
                exit 0
            fi
        done
        find / -maxdepth 5 -name 'test_infer.py' -path '*index-tts*' 2>/dev/null | head -1 | xargs dirname 2>/dev/null
        find / -maxdepth 5 -name 'inference.py' -path '*IndexTTS*' 2>/dev/null | head -1 | xargs dirname 2>/dev/null
    " 2>/dev/null)

    if [ -z "$TTS_PATH" ]; then
        echo "  ⚠️ 未找到 IndexTTS，尝试更深层搜索..."
        TTS_PATH=$(ssh -p $PORT $SSH_OPTS $USER@$HOST "
            find / -maxdepth 6 -name '*.py' -path '*indextts*' 2>/dev/null | head -5
            find / -maxdepth 6 -name '*.py' -path '*IndexTTS*' 2>/dev/null | head -5
        " 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
    fi

    echo "  🔍 探测 InfiniteTalk..."
    local INFINITE_PATH=$(ssh -p $PORT $SSH_OPTS $USER@$HOST "
        for path in /root/workspace/InfiniteTalk /home/\$USER/InfiniteTalk /opt/InfiniteTalk /usr/local/InfiniteTalk ~/InfiniteTalk /data/InfiniteTalk; do
            if [ -f \"\$path/generate_infinitetalk.py\" ] || [ -f \"\$path/run.py\" ] || [ -f \"\$path/inference.py\" ] || [ -f \"\$path/infinitetalk.py\" ]; then
                echo \"\$path\"
                exit 0
            fi
        done
        find / -maxdepth 5 -name 'generate_infinitetalk.py' -path '*InfiniteTalk*' 2>/dev/null | head -1 | xargs dirname 2>/dev/null
    " 2>/dev/null)

    if [ -z "$INFINITE_PATH" ]; then
        echo "  ⚠️ 未找到 InfiniteTalk，尝试更深层搜索..."
        INFINITE_PATH=$(ssh -p $PORT $SSH_OPTS $USER@$HOST "
            find / -maxdepth 6 -name '*.py' -path '*infinitetalk*' 2>/dev/null | head -5
            find / -maxdepth 6 -name '*.py' -path '*InfiniteTalk*' 2>/dev/null | head -5
        " 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
    fi

    echo "  🔍 探测 Python 虚拟环境..."
    local TTS_VENV=""
    local INFINITE_VENV=""

    if [ -n "$TTS_PATH" ]; then
        local TTS_ROOT=$(dirname "$TTS_PATH")
        TTS_VENV=$(ssh -p $PORT $SSH_OPTS $USER@$HOST "
            TTS_PARENT=\$(dirname '$TTS_PATH')
            for venv in '$TTS_ROOT/.venv/bin/activate' '$TTS_ROOT/venv/bin/activate' '$TTS_ROOT/env/bin/activate' \"\$TTS_PARENT/.venv/bin/activate\" \"\$TTS_PARENT/venv/bin/activate\" \"\$TTS_PARENT/env/bin/activate\"; do
                [ -f \"\$venv\" ] && echo \"\$venv\" && exit 0
            done
            # conda env list 第二列是环境名
            conda env list 2>/dev/null | grep -iE 'indextts|multitalk' | awk '{print \$1}' | head -1
        " 2>/dev/null)
    fi

    if [ -n "$INFINITE_PATH" ]; then
        INFINITE_VENV=$(ssh -p $PORT $SSH_OPTS $USER@$HOST "
            INFINITE_PARENT=\$(dirname '$INFINITE_PATH')
            for venv in '$INFINITE_PATH/venv/bin/activate' '$INFINITE_PATH/.venv/bin/activate' '$INFINITE_PATH/env/bin/activate' \"\$INFINITE_PARENT/venv/bin/activate\" \"\$INFINITE_PARENT/.venv/bin/activate\" \"\$INFINITE_PARENT/env/bin/activate\"; do
                [ -f \"\$venv\" ] && echo \"\$venv\" && exit 0
            done
            # conda env list 第二列是环境名
            conda env list 2>/dev/null | grep -iE 'multitalk|infinitetalk' | awk '{print \$1}' | head -1
        " 2>/dev/null)
    fi

    local WORKSPACE=$(ssh -p $PORT $SSH_OPTS $USER@$HOST "
        for ws in /tmp/infinitetalk_workspace /tmp/indextts_workspace /tmp/ai_workspace /tmp/workspace; do
            mkdir -p \$ws 2>/dev/null && echo \$ws && exit 0
        done
        echo /tmp/workspace
    " 2>/dev/null)

    echo "  📋 探测结果:"
    echo "     IndexTTS 路径: ${TTS_PATH:-未找到}"
    echo "     InfiniteTalk 路径: ${INFINITE_PATH:-未找到}"
    echo "     TTS 虚拟环境: ${TTS_VENV:-未找到}"
    echo "     InfiniteTalk 虚拟环境: ${INFINITE_VENV:-未找到}"
    echo "     工作目录: $WORKSPACE"

    if [ "$SERVER_TYPE" = "primary" ]; then
        jq --arg tts "$TTS_PATH" --arg tts_venv "$TTS_VENV" \
           --arg infinite "$INFINITE_PATH" --arg infinite_venv "$INFINITE_VENV" \
           --arg ws "$WORKSPACE" \
           '.primary.tts_path = $tts |
            .primary.tts_workspace = $ws |
            .primary.tts_python_env = $tts_venv |
            .primary.infinitetalk_path = $infinite |
            .primary.infinitetalk_workspace = $ws |
            .primary.infinitetalk_python_env = $infinite_venv |
            .primary.detected = true' \
           "$CONFIG" > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "$CONFIG"
    else
        jq --arg tts "$TTS_PATH" --arg tts_venv "$TTS_VENV" \
           --arg infinite "$INFINITE_PATH" --arg infinite_venv "$INFINITE_VENV" \
           --arg ws "$WORKSPACE" \
           '.backup.tts_path = $tts |
            .backup.tts_workspace = $ws |
            .backup.tts_python_env = $tts_venv |
            .backup.infinitetalk_path = $infinite |
            .backup.infinitetalk_workspace = $ws |
            .backup.infinitetalk_python_env = $infinite_venv |
            .backup.detected = true' \
           "$CONFIG" > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "$CONFIG"
    fi

    echo "  ✅ $SERVER_TYPE 配置已更新"
    return 0
}

echo "══════════════════════════════════════════════════════════════"
echo "🔍 开始自动探测服务器路径"
echo "══════════════════════════════════════════════════════════════"
echo ""

PRIMARY_HOST=$(jq -r '.primary.host' "$CONFIG")
PRIMARY_PORT=$(jq -r '.primary.port' "$CONFIG")
PRIMARY_USER=$(jq -r '.primary.user' "$CONFIG")
BACKUP_HOST=$(jq -r '.backup.host' "$CONFIG")
BACKUP_PORT=$(jq -r '.backup.port' "$CONFIG")
BACKUP_USER=$(jq -r '.backup.user' "$CONFIG")

detect_on_server "$PRIMARY_HOST" "$PRIMARY_PORT" "$PRIMARY_USER" "primary"
echo ""

detect_on_server "$BACKUP_HOST" "$BACKUP_PORT" "$BACKUP_USER" "backup"
echo ""

echo "══════════════════════════════════════════════════════════════"
echo "📋 探测完成，配置摘要:"
echo "══════════════════════════════════════════════════════════════"
cat "$CONFIG" | jq '.'

PRIMARY_DETECTED=$(jq -r '.primary.detected' "$CONFIG")
BACKUP_DETECTED=$(jq -r '.backup.detected' "$CONFIG")

if [ "$PRIMARY_DETECTED" = "false" ] && [ "$BACKUP_DETECTED" = "false" ]; then
    echo ""
    echo "❌ 警告: 两台服务器均无法连接或未找到服务"
    exit 1
fi

echo ""
echo "✅ 探测完成，可以开始生成视频"
