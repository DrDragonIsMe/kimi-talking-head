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
LOCAL_SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

COMFYUI_REPO="${GITHUB_MIRROR}https://github.com/comfyanonymous/ComfyUI.git"
INFINITETALK_REPO="${GITHUB_MIRROR}https://github.com/MeiGen-AI/InfiniteTalk.git"
WANVIDEO_REPO="${GITHUB_MIRROR}https://github.com/kijai/ComfyUI-WanVideoWrapper.git"
VIDEO_HELPER_REPO="${GITHUB_MIRROR}https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"
KJ_NODES_REPO="${GITHUB_MIRROR}https://github.com/kijai/ComfyUI-KJNodes.git"
MANAGER_REPO="${GITHUB_MIRROR}https://github.com/ltdrdata/ComfyUI-Manager.git"
INDEX_TTS_REPO="${GITHUB_MIRROR}https://github.com/index-tts/index-tts.git"

echo "══════════════════════════════════════════════════════════════"
echo "🚀 部署 kimi-talking-head 服务器端环境"
echo "══════════════════════════════════════════════════════════════"
echo "ComfyUI 目录: $COMFYUI_DIR"
echo "IndexTTS 目录: $INDEX_TTS_DIR"
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
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip wheel setuptools

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
python3.10 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel setuptools
pip install -e .

# Copy our remote worker wrapper into the IndexTTS root
cp "$LOCAL_SERVER_DIR/index-tts/remote_worker.py" "$INDEX_TTS_DIR/remote_worker.py"

# ──────────────────────────────────────────────────────────────
# 5. Top-level convenience scripts / symlinks
# ──────────────────────────────────────────────────────────────
echo "📦 5/6 创建顶层启动脚本..."
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
# 6. Validation
# ──────────────────────────────────────────────────────────────
echo "📦 6/6 校验环境..."
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
