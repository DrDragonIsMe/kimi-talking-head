#!/bin/bash
set -e

CONFIG="config/servers.json"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

detect_on_server() {
    local HOST=$1
    local PORT=$2
    local USER=$3
    local SERVER_TYPE=$4

    echo "🔍 探测 $SERVER_TYPE 服务器 ($USER@$HOST:$PORT)..."

    if ! ssh -p $PORT -o ConnectTimeout=5 -o BatchMode=yes $USER@$HOST "echo OK" >/dev/null 2>&1; then
        echo "  ❌ $SERVER_TYPE 服务器无法连接"
        return 1
    fi

    echo "  ✅ SSH 连接正常"

    echo "  🔍 探测 IndexTTS..."
    local TTS_PATH=$(ssh -p $PORT $USER@$HOST "
        for path in /root/IndexTTS /home/$USER/IndexTTS /opt/IndexTTS /usr/local/IndexTTS ~/IndexTTS /data/IndexTTS; do
            if [ -f \"\$path/inference.py\" ] || [ -f \"\$path/tts.py\" ] || [ -f \"\$path/generate.py\" ]; then
                echo \"\$path\"
                exit 0
            fi
        done
        find / -maxdepth 4 -name 'inference.py' -path '*IndexTTS*' 2>/dev/null | head -1 | xargs dirname 2>/dev/null
    " 2>/dev/null)

    if [ -z "$TTS_PATH" ]; then
        echo "  ⚠️ 未找到 IndexTTS，尝试更深层搜索..."
        TTS_PATH=$(ssh -p $PORT $USER@$HOST "
            find / -maxdepth 5 -name '*.py' -path '*indextts*' 2>/dev/null | head -5
            find / -maxdepth 5 -name '*.py' -path '*IndexTTS*' 2>/dev/null | head -5
        " 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
    fi

    echo "  🔍 探测 MuseTalk..."
    local MUSE_PATH=$(ssh -p $PORT $USER@$HOST "
        for path in /root/MuseTalk /home/$USER/MuseTalk /opt/MuseTalk /usr/local/MuseTalk ~/MuseTalk /data/MuseTalk; do
            if [ -f \"\$path/run.py\" ] || [ -f \"\$path/inference.py\" ] || [ -f \"\$path/musetalk.py\" ]; then
                echo \"\$path\"
                exit 0
            fi
        done
        find / -maxdepth 4 -name 'run.py' -path '*MuseTalk*' 2>/dev/null | head -1 | xargs dirname 2>/dev/null
    " 2>/dev/null)

    if [ -z "$MUSE_PATH" ]; then
        echo "  ⚠️ 未找到 MuseTalk，尝试更深层搜索..."
        MUSE_PATH=$(ssh -p $PORT $USER@$HOST "
            find / -maxdepth 5 -name '*.py' -path '*musetalk*' 2>/dev/null | head -5
            find / -maxdepth 5 -name '*.py' -path '*MuseTalk*' 2>/dev/null | head -5
        " 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
    fi

    echo "  🔍 探测 Python 虚拟环境..."
    local TTS_VENV=""
    local MUSE_VENV=""

    if [ -n "$TTS_PATH" ]; then
        TTS_VENV=$(ssh -p $PORT $USER@$HOST "
            TTS_PARENT=\$(dirname $TTS_PATH)
            for venv in $TTS_PATH/venv/bin/activate $TTS_PATH/.venv/bin/activate $TTS_PATH/env/bin/activate \$TTS_PARENT/venv/bin/activate \$TTS_PARENT/.venv/bin/activate \$TTS_PARENT/env/bin/activate; do
                [ -f \"\$venv\" ] && echo \"\$venv\" && exit 0
            done
            conda env list 2>/dev/null | grep -i indextts | awk '{print \$NF}' | head -1
        " 2>/dev/null)
    fi

    if [ -n "$MUSE_PATH" ]; then
        MUSE_VENV=$(ssh -p $PORT $USER@$HOST "
            MUSE_PARENT=\$(dirname $MUSE_PATH)
            for venv in $MUSE_PATH/venv/bin/activate $MUSE_PATH/.venv/bin/activate $MUSE_PATH/env/bin/activate \$MUSE_PARENT/venv/bin/activate \$MUSE_PARENT/.venv/bin/activate \$MUSE_PARENT/env/bin/activate; do
                [ -f \"\$venv\" ] && echo \"\$venv\" && exit 0
            done
            conda env list 2>/dev/null | grep -i musetalk | awk '{print \$NF}' | head -1
        " 2>/dev/null)
    fi

    local WORKSPACE=$(ssh -p $PORT $USER@$HOST "
        for ws in /tmp/musetalk_workspace /tmp/indextts_workspace /tmp/ai_workspace /tmp/workspace; do
            mkdir -p \$ws 2>/dev/null && echo \$ws && exit 0
        done
        echo /tmp/workspace
    " 2>/dev/null)

    echo "  📋 探测结果:"
    echo "     IndexTTS 路径: ${TTS_PATH:-未找到}"
    echo "     MuseTalk 路径: ${MUSE_PATH:-未找到}"
    echo "     TTS 虚拟环境: ${TTS_VENV:-未找到}"
    echo "     MuseTalk 虚拟环境: ${MUSE_VENV:-未找到}"
    echo "     工作目录: $WORKSPACE"

    if [ "$SERVER_TYPE" = "primary" ]; then
        jq --arg tts "$TTS_PATH" --arg tts_venv "$TTS_VENV" \
           --arg muse "$MUSE_PATH" --arg muse_venv "$MUSE_VENV" \
           --arg ws "$WORKSPACE" \
           '.primary.tts_path = $tts |
            .primary.tts_workspace = $ws |
            .primary.tts_python_env = $tts_venv |
            .primary.musetalk_path = $muse |
            .primary.musetalk_workspace = $ws |
            .primary.musetalk_python_env = $muse_venv |
            .primary.detected = true' \
           "$CONFIG" > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "$CONFIG"
    else
        jq --arg tts "$TTS_PATH" --arg tts_venv "$TTS_VENV" \
           --arg muse "$MUSE_PATH" --arg muse_venv "$MUSE_VENV" \
           --arg ws "$WORKSPACE" \
           '.backup.tts_path = $tts |
            .backup.tts_workspace = $ws |
            .backup.tts_python_env = $tts_venv |
            .backup.musetalk_path = $muse |
            .backup.musetalk_workspace = $ws |
            .backup.musetalk_python_env = $muse_venv |
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

detect_on_server "8.152.242.29" "58349" "root" "primary"
echo ""

detect_on_server "192.168.1.10" "22" "xylon" "backup"
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
