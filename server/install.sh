#!/bin/bash
# Server-side deployment script for kimi-talking-head.
# Run this on a fresh Ubuntu 22.04/24.04 GPU server to install:
#   - ComfyUI (in /root/aigc_apps/InfiniteTalk)
#   - InfiniteTalk custom node
#   - WanVideoWrapper / VideoHelperSuite / KJNodes / Manager custom nodes
#   - IndexTTS + remote_worker.py (in /root/aigc_apps/index-tts)
#
# Usage:
#   bash server/install.sh
#
# Environment:
#   GITHUB_MIRROR - e.g. https://ghfast.top
#   HF_ENDPOINT   - e.g. https://hf-mirror.com
#   USE_CPU_ONLY  - set to 1 to skip CUDA PyTorch

set -euo pipefail

GITHUB_MIRROR="${GITHUB_MIRROR:-}"
HF_ENDPOINT="${HF_ENDPOINT:-}"
USE_CPU_ONLY="${USE_CPU_ONLY:-0}"

COMFYUI_DIR="${COMFYUI_DIR:-/root/aigc_apps/InfiniteTalk}"
INDEX_TTS_DIR="${INDEX_TTS_DIR:-/root/aigc_apps/index-tts}"
MUSETALK_DIR="${MUSETALK_DIR:-/root/aigc_apps/MuseTalk}"
LOCAL_SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

COMFYUI_REPO="${GITHUB_MIRROR}https://github.com/comfyanonymous/ComfyUI.git"
INFINITETALK_REPO="${GITHUB_MIRROR}https://github.com/MeiGen-AI/InfiniteTalk.git"
WANVIDEO_REPO="${GITHUB_MIRROR}https://github.com/kijai/ComfyUI-WanVideoWrapper.git"
VIDEO_HELPER_REPO="${GITHUB_MIRROR}https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"
KJ_NODES_REPO="${GITHUB_MIRROR}https://github.com/kijai/ComfyUI-KJNodes.git"
MANAGER_REPO="${GITHUB_MIRROR}https://github.com/ltdrdata/ComfyUI-Manager.git"
INDEX_TTS_REPO="${GITHUB_MIRROR}https://github.com/index-tts/index-tts.git"
MUSETALK_REPO="${GITHUB_MIRROR}https://github.com/TMElyralab/MuseTalk.git"

echo "══════════════════════════════════════════════════════════════"
echo "🚀 部署 kimi-talking-head 服务器端环境"
echo "══════════════════════════════════════════════════════════════"
echo "ComfyUI 目录: $COMFYUI_DIR"
echo "IndexTTS 目录: $INDEX_TTS_DIR"
echo "MuseTalk 目录: $MUSETALK_DIR"
echo "HF 镜像: ${HF_ENDPOINT:-无（官方）}"
echo ""

# ──────────────────────────────────────────────────────────────
# 1. System dependencies
# ──────────────────────────────────────────────────────────────
echo "📦 1/6 安装系统依赖..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
    git curl wget ffmpeg build-essential python3-dev python3-venv \
    python3.10 python3.10-venv python3.10-dev \
    python3-pip libgl1 libglib2.0-0 rsync jq

# ──────────────────────────────────────────────────────────────
# 2. ComfyUI base
# ──────────────────────────────────────────────────────────────
echo "📦 2/6 安装 ComfyUI..."
if [ -d "$COMFYUI_DIR/.git" ]; then
    cd "$COMFYUI_DIR"
    git pull --ff-only || true
else
    rm -rf "$COMFYUI_DIR"
    git clone --depth 1 "$COMFYUI_REPO" "$COMFYUI_DIR"
fi

cd "$COMFYUI_DIR"
if [ -x "$COMFYUI_DIR/venv/bin/python3" ]; then
    echo "   现有 ComfyUI venv 可用，跳过创建"
else
    rm -rf "$COMFYUI_DIR/venv"
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip wheel setuptools || true

# PyTorch with CUDA 12.6 (adjust for your driver)
if [ "$USE_CPU_ONLY" = "1" ]; then
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
else
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
fi

pip install -r requirements.txt

# ──────────────────────────────────────────────────────────────
# 3. Custom nodes
# ──────────────────────────────────────────────────────────────
echo "📦 3/6 安装自定义节点..."
mkdir -p custom_nodes
cd custom_nodes

clone_or_pull() {
    local dir=$1 url=$2
    if [ -d "$dir/.git" ]; then
        # Mark the directory safe to avoid "dubious ownership" failures when run as root
        git config --global --add safe.directory "$(cd "$dir" && pwd)" 2>/dev/null || true
        cd "$dir" && git pull --ff-only && cd ..
    else
        rm -rf "$dir"
        git clone --depth 1 "$url" "$dir"
    fi
}

clone_or_pull InfiniteTalk "$INFINITETALK_REPO"
clone_or_pull ComfyUI-WanVideoWrapper "$WANVIDEO_REPO"
clone_or_pull ComfyUI-VideoHelperSuite "$VIDEO_HELPER_REPO"
clone_or_pull ComfyUI-KJNodes "$KJ_NODES_REPO"
clone_or_pull ComfyUI-Manager "$MANAGER_REPO"

cd "$COMFYUI_DIR"
# Install per-node requirements where present
for req in custom_nodes/*/requirements.txt; do
    if [ -f "$req" ]; then
        echo "   安装依赖: $req"
        pip install -r "$req" || echo "   ⚠️ $req 部分依赖安装失败，请手动检查"
    fi
done

# Numpy/opencv compatibility guard (see RELIABILITY.md)
pip install "numpy<2.2" "opencv-python>=4.10" || true

# ──────────────────────────────────────────────────────────────
# 4. IndexTTS + remote worker wrapper
# ──────────────────────────────────────────────────────────────
echo "📦 4/6 安装 IndexTTS..."
if [ -d "$INDEX_TTS_DIR/.git" ]; then
    cd "$INDEX_TTS_DIR"
    git pull --ff-only || true
else
    rm -rf "$INDEX_TTS_DIR"
    git clone --depth 1 "$INDEX_TTS_REPO" "$INDEX_TTS_DIR"
fi

cd "$INDEX_TTS_DIR"
if [ -x "$INDEX_TTS_DIR/.venv/bin/python3" ]; then
    echo "   现有 IndexTTS venv 可用，跳过创建"
else
    rm -rf "$INDEX_TTS_DIR/.venv"
    python3.10 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip wheel setuptools || true
pip install -e .

# Copy our remote worker wrapper into the IndexTTS root
cp "$LOCAL_SERVER_DIR/index-tts/remote_worker.py" "$INDEX_TTS_DIR/remote_worker.py"

# ──────────────────────────────────────────────────────────────
# 5. MuseTalk
# ──────────────────────────────────────────────────────────────
echo "📦 5/7 安装 MuseTalk..."

# Disk space requirement in KB (conservative 25 GB)
MUSETALK_REQUIRED_KB=$((25 * 1024 * 1024))

select_musetalk_dir() {
    local default_dir=$1
    local default_fs
    default_fs=$(df -Pk "$default_dir" 2>/dev/null | awk 'NR==2 {print $4}')
    if [ -n "$default_fs" ] && [ "$default_fs" -ge "$MUSETALK_REQUIRED_KB" ]; then
        echo "$default_dir"
        return 0
    fi

    echo "⚠️  $default_dir 所在系统盘空间不足（需 ≥25GB），探测数据盘..." >&2
    for candidate in /data /mnt/data /mnt /home/data; do
        if [ -d "$candidate" ]; then
            local avail
            avail=$(df -Pk "$candidate" 2>/dev/null | awk 'NR==2 {print $4}')
            if [ -n "$avail" ] && [ "$avail" -ge "$MUSETALK_REQUIRED_KB" ]; then
                echo "${candidate}/aigc_apps/MuseTalk"
                return 0
            fi
        fi
    done

    echo "❌ 未找到空间 ≥25GB 的数据盘，MuseTalk 将尝试安装在 $default_dir，后续可能因空间不足失败" >&2
    echo "$default_dir"
}

MUSETALK_DIR=$(select_musetalk_dir "$MUSETALK_DIR")
mkdir -p "$(dirname "$MUSETALK_DIR")"

echo "   MuseTalk 将安装在: $MUSETALK_DIR"

if [ -d "$MUSETALK_DIR/.git" ]; then
    cd "$MUSETALK_DIR"
    git pull --ff-only || true
else
    rm -rf "$MUSETALK_DIR"
    git clone --depth 1 "$MUSETALK_REPO" "$MUSETALK_DIR"
fi

cd "$MUSETALK_DIR"
if [ -x "$MUSETALK_DIR/venv/bin/python3" ]; then
    echo "   现有 MuseTalk venv 可用，跳过创建"
else
    rm -rf "$MUSETALK_DIR/venv"
    python3.10 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip wheel setuptools || true

if [ "$USE_CPU_ONLY" = "1" ]; then
    pip install torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cpu
else
    pip install torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118
fi

pip install -r requirements.txt
pip install --no-cache-dir -U openmim
mim install mmengine
mim install "mmcv==2.0.1"
mim install "mmdet==3.1.0"
# chumpy needs to be built without isolation to access pip during its setup
pip install --no-build-isolation chumpy
mim install "mmpose==1.1.0"

# Workspace for remote jobs
mkdir -p /tmp/musetalk_workspace

# ──────────────────────────────────────────────────────────────
# 6. Top-level convenience scripts / symlinks
# ──────────────────────────────────────────────────────────────
echo "📦 6/7 创建顶层启动脚本..."
BASE_DIR=$(dirname "$COMFYUI_DIR")
cp "$LOCAL_SERVER_DIR/comfyui/start.sh" "$BASE_DIR/start.sh"
cp "$LOCAL_SERVER_DIR/comfyui/env.sh" "$BASE_DIR/env.sh"
chmod +x "$BASE_DIR/start.sh" "$BASE_DIR/env.sh"

ln -sf "$COMFYUI_DIR/input" "$BASE_DIR/input" || true
ln -sf "$COMFYUI_DIR/models" "$BASE_DIR/models" || true
ln -sf "$COMFYUI_DIR/output" "$BASE_DIR/output" || true

# Workspace for remote jobs
mkdir -p /tmp/infinitetalk_workspace

# ──────────────────────────────────────────────────────────────
# 7. Validation
# ──────────────────────────────────────────────────────────────
echo "📦 7/7 校验环境..."
cd "$COMFYUI_DIR"
source venv/bin/activate
python -c "import torch; print('torch', torch.__version__, 'cuda available', torch.cuda.is_available())" || true

if [ ! -f "$COMFYUI_DIR/custom_nodes/InfiniteTalk/infinitetalk/nodes.py" ]; then
    echo "❌ InfiniteTalk 节点未正确安装" >&2
    exit 1
fi
if [ ! -f "$INDEX_TTS_DIR/remote_worker.py" ]; then
    echo "❌ IndexTTS remote_worker.py 未正确安装" >&2
    exit 1
fi
if [ ! -f "$MUSETALK_DIR/scripts/inference.py" ]; then
    echo "❌ MuseTalk 未正确安装" >&2
    exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "✅ 服务器端环境部署完成"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "下一步："
echo "  1. 下载模型并放到 $COMFYUI_DIR/models/ 下"
echo "     详见 server/MODEL_CHECKLIST.md"
echo "  2. 启动 ComfyUI："
echo "     bash $BASE_DIR/start.sh"
echo "  3. 在本地运行："
echo "     bash scripts/detect_paths.sh"
echo ""
