# Kimi CLI 口播视频生成 - Phase 2 动态视觉版

> 版本: 2.1
> 创建时间: 2026-07-12
> 核心特性: 自动探测服务器路径 + 文章内容驱动动态视觉（关键词触发背景效果 + 字幕高亮）

---

## 一、项目概览

本系统实现"文章 -> 口播视频"的全自动化流水线，**Phase 2 新增**：

- 文章内容实时分析，每句匹配关键词触发不同背景视觉效果
- 关键词在字幕中高亮放大显示
- 5 种场景效果：数据增长、风险危机、解决方案、人才组织、AI未来

```
用户文章 (Markdown/纯文本)
    |
    v
[本地预处理] -> 优化为口播稿，分段
    |
    v
[主/从服务器] -> IndexTTS 克隆声音生成音频
    |
    v
[主/从服务器] -> MuseTalk 照片+音频 -> 唇形同步视频
    |
    v
[本地] -> Whisper 生成带时间轴字幕
    |
    v
[本地 Remotion] -> 合成：唇形视频 + 动态字幕（关键词高亮） + 动态背景（场景切换） + 薪灵AI产品结尾
    |
    v
成品 MP4 (1080x1920, 竖屏)
```

---

## 二、服务器环境说明

| 机器 | 角色 | SSH 地址 | 服务 |
|------|------|----------|------|
| 主节点 | 主 | `ssh root@8.152.242.29 -p 58349` | IndexTTS + MuseTalk |
| 从节点 | 备份 | `ssh xylon@192.168.1.10` | IndexTTS + MuseTalk |
| 本地 | 控制台 | macOS | Kimi CLI + Remotion + Whisper |

**重要**: 两台服务器上 IndexTTS 和 MuseTalk 的安装路径**不相同**，系统在首次运行时自动探测，探测结果缓存到 `config/servers.json` 供后续使用。

---

## 三、素材清单与存放位置

| 素材 | 文件 | 存放路径 | 说明 |
|------|------|----------|------|
| 人物照片 | me.jpg | `assets/host/me.jpg` | MuseTalk 输入源，建议 512x512 正面清晰照 |
| 克隆声音 | me.m4a | `assets/voice/me.m4a` | IndexTTS 声音克隆参考音频，建议 10-30 秒清晰人声 |
| 品牌 Logo | logo.png | `assets/logo.png` | 薪灵AI Logo，建议透明背景 PNG |
| 产品信息 | - | 硬编码在 `src/components/ProductEndcard.tsx` | 见第四节 |

### 产品信息（薪灵AI）

```yaml
Brand: 薪灵AI
Tagline: 薪人薪事的AI引擎
Slogan: 把人力数据，变成组织决策
CTA: 看薪灵如何重构你的人力系统
Pills:
  - 预测离职
  - 智能定薪
  - 组织诊断
  - 人才画像
  - 合规风控
```

---

## 四、完整目录结构

```
~/kimi-talking-head/
├── .kimi/
│   └── pipeline.md              # 本文件（Kimi CLI 执行文档）
│
├── assets/
│   ├── host/
│   │   └── me.jpg               # 用户人物照片（MuseTalk 源）
│   ├── voice/
│   │   └── me.m4a               # 用户声音克隆参考（IndexTTS 源）
│   ├── bgm/
│   │   └── bgm_light.mp3        # 可选：轻背景音乐
│   └── logo.png                 # 薪灵AI Logo
│
├── config/
│   ├── host_profile.json        # 主播/声音/风格配置
│   └── servers.json             # 服务器配置（含探测到的实际路径）
│
├── scripts/
│   ├── pipeline.sh              # 主控流水线（一键执行）
│   ├── tts_index.sh             # IndexTTS 调用（自动主从切换）
│   ├── musetalk.sh              # MuseTalk 唇形同步（自动主从切换）
│   ├── whisper_local.sh         # 本地 Whisper 字幕生成
│   ├── upload_to_server.sh      # SCP 上传（含主从故障转移）
│   ├── check_server.sh          # 服务器健康检查
│   └── detect_paths.sh          # 自动探测服务器路径
│
├── src/
│   ├── components/
│   │   ├── effects/             # Phase 2 新增：动态效果组件
│   │   │   ├── ChartLines.tsx   # 数据增长：上升曲线 + 数字粒子
│   │   │   ├── PulseWarning.tsx # 风险危机：红色脉冲 + 警告条纹
│   │   │   ├── GridFlow.tsx     # 解决方案：流动网格 + 连接节点
│   │   │   ├── WarmGlow.tsx     # 人才组织：温暖光晕 + 人物剪影
│   │   │   └── CyberParticles.tsx # AI未来：赛博粒子 + 神经网络
│   │   ├── DynamicBackground.tsx  # Phase 2 新增：动态背景切换
│   │   ├── Subtitles.tsx        # Phase 2 修改：增加关键词高亮
│   │   ├── ProductEndcard.tsx   # 产品结尾卡片（薪灵AI）
│   │   ├── LogoWatermark.tsx    # 品牌水印
│   │   ├── Background.tsx       # 基础背景（备用）
│   │   ├── TalkingHead.tsx      # 人像层
│   │   └── SceneIndicator.tsx   # Phase 2 新增：场景标签（可选）
│   ├── utils/
│   │   └── keywordMatcher.ts    # Phase 2 新增：关键词匹配 + 视觉样式映射
│   ├── hooks/
│   │   ├── useSubtitles.ts      # SRT 字幕解析 Hook
│   │   └── useAudioDuration.ts  # 音频时长计算 Hook
│   ├── public/                  # Remotion 静态资源（运行时生成）
│   └── index.tsx                # Phase 2 修改：接入动态背景
│
├── temp/                        # 临时文件（音频、字幕、中间视频）
│   ├── article.md               # 原始文章
│   ├── script.txt               # 口播稿
│   ├── audio.wav                # TTS 生成音频
│   ├── subtitles.srt            # Whisper 生成字幕
│   ├── lip_synced.mp4           # MuseTalk 唇形视频
│   └── props.json               # Remotion 动态参数
│
├── output/                      # 成品视频输出
│
├── package.json                 # Node 依赖
├── tsconfig.json                # TypeScript 配置
└── remotion.config.ts           # Remotion 配置
```

---

## 五、配置文件内容

### 5.1 config/servers.json（初始模板，探测后自动更新）

```json
{
  "primary": {
    "host": "8.152.242.29",
    "port": 58349,
    "user": "root",
    "detected": false,
    "tts_path": "",
    "tts_workspace": "",
    "tts_python_env": "",
    "musetalk_path": "",
    "musetalk_workspace": "",
    "musetalk_python_env": ""
  },
  "backup": {
    "host": "192.168.1.10",
    "port": 22,
    "user": "xylon",
    "detected": false,
    "tts_path": "",
    "tts_workspace": "",
    "tts_python_env": "",
    "musetalk_path": "",
    "musetalk_workspace": "",
    "musetalk_python_env": ""
  },
  "local": {
    "project_dir": "~/kimi-talking-head",
    "temp_dir": "~/kimi-talking-head/temp",
    "output_dir": "~/kimi-talking-head/output"
  }
}
```

### 5.2 config/host_profile.json

```json
{
  "host": {
    "name": "默认主播",
    "photo_source": "assets/host/me.jpg",
    "position": "center",
    "display_size": { "width": 720, "height": 960 },
    "border_radius": 24
  },
  "voice": {
    "engine": "indextts",
    "reference_audio": "assets/voice/me.m4a",
    "speed": 1.0,
    "pitch": 0,
    "emotion": "neutral",
    "format": "wav"
  },
  "musetalk": {
    "enable": true,
    "lip_quality": "high",
    "face_enhance": true,
    "bbox_shift": 0
  },
  "product": {
    "brand": "薪灵AI",
    "tagline": "薪人薪事的AI引擎",
    "slogan": "把人力数据，变成组织决策",
    "cta": "看薪灵如何重构你的人力系统",
    "pills": ["预测离职", "智能定薪", "组织诊断", "人才画像", "合规风控"],
    "primary_color": "#00D4FF",
    "secondary_color": "#7B61FF",
    "accent_color": "#FF6B6B",
    "bg_gradient": ["#0a0a1a", "#1a1a3e"]
  },
  "style": {
    "theme": "dark",
    "subtitle_font": "Noto Sans SC",
    "subtitle_size": 44,
    "subtitle_weight": 700,
    "subtitle_position": "bottom",
    "highlight_style": "neon",
    "highlight_color": "#00D4FF",
    "inactive_color": "rgba(255,255,255,0.35)",
    "bgm_volume": 0.12,
    "endcard_duration_seconds": 6
  },
  "output": {
    "resolution": "1080x1920",
    "fps": 30,
    "bitrate": "8M",
    "codec": "h264"
  }
}
```

---

## 六、脚本文件内容

### 6.1 scripts/detect_paths.sh

```bash
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
            if [ -f "\$path/inference.py" ] || [ -f "\$path/tts.py" ] || [ -f "\$path/generate.py" ]; then
                echo "\$path"
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
            if [ -f "\$path/run.py" ] || [ -f "\$path/inference.py" ] || [ -f "\$path/musetalk.py" ]; then
                echo "\$path"
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
            for venv in \$TTS_PATH/venv/bin/activate \$TTS_PATH/.venv/bin/activate \$TTS_PATH/env/bin/activate; do
                [ -f "\$venv" ] && echo "\$venv" && exit 0
            done
            conda env list 2>/dev/null | grep -i indextts | awk '{print \$NF}' | head -1
        " 2>/dev/null)
    fi

    if [ -n "$MUSE_PATH" ]; then
        MUSE_VENV=$(ssh -p $PORT $USER@$HOST "
            for venv in \$MUSE_PATH/venv/bin/activate \$MUSE_PATH/.venv/bin/activate \$MUSE_PATH/env/bin/activate; do
                [ -f "\$venv" ] && echo "\$venv" && exit 0
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
```

### 6.2 scripts/check_server.sh

```bash
#!/bin/bash
SERVER_TYPE=${1:-primary}
CONFIG="config/servers.json"

if [ "$SERVER_TYPE" = "primary" ]; then
    HOST=$(jq -r '.primary.host' $CONFIG)
    PORT=$(jq -r '.primary.port' $CONFIG)
    USER=$(jq -r '.primary.user' $CONFIG)
    DETECTED=$(jq -r '.primary.detected' $CONFIG)
else
    HOST=$(jq -r '.backup.host' $CONFIG)
    PORT=$(jq -r '.backup.port' $CONFIG)
    USER=$(jq -r '.backup.user' $CONFIG)
    DETECTED=$(jq -r '.backup.detected' $CONFIG)
fi

if [ "$DETECTED" != "true" ]; then
    echo "NOT_DETECTED"
    exit 1
fi

if ssh -p $PORT -o ConnectTimeout=3 -o BatchMode=yes $USER@$HOST "echo OK" >/dev/null 2>&1; then
    echo "AVAILABLE:$HOST:$PORT:$USER"
    exit 0
else
    echo "UNAVAILABLE"
    exit 1
fi
```

### 6.3 scripts/upload_to_server.sh

```bash
#!/bin/bash
set -e

LOCAL_FILE=$1
REMOTE_REL_PATH=$2
CONFIG="config/servers.json"

if SERVER_INFO=$(bash scripts/check_server.sh primary 2>/dev/null); then
    HOST=$(echo "$SERVER_INFO" | cut -d: -f2)
    PORT=$(echo "$SERVER_INFO" | cut -d: -f3)
    USER=$(echo "$SERVER_INFO" | cut -d: -f4)
    WORKSPACE=$(jq -r '.primary.tts_workspace' $CONFIG)
    echo "📤 使用主节点: $HOST:$PORT" >&2
else
    echo "⚠️ 主节点不可用，尝试从节点..." >&2
    if SERVER_INFO=$(bash scripts/check_server.sh backup 2>/dev/null); then
        HOST=$(echo "$SERVER_INFO" | cut -d: -f2)
        PORT=$(echo "$SERVER_INFO" | cut -d: -f3)
        USER=$(echo "$SERVER_INFO" | cut -d: -f4)
        WORKSPACE=$(jq -r '.backup.tts_workspace' $CONFIG)
        echo "📤 使用从节点: $HOST:$PORT" >&2
    else
        echo "❌ 所有节点不可用" >&2
        exit 1
    fi
fi

REMOTE_DIR="$WORKSPACE/$(dirname $REMOTE_REL_PATH)"
ssh -p $PORT $USER@$HOST "mkdir -p $REMOTE_DIR"
scp -P $PORT "$LOCAL_FILE" "$USER@$HOST:$WORKSPACE/$REMOTE_REL_PATH"

echo "$HOST:$PORT:$USER:$WORKSPACE"
```

### 6.4 scripts/tts_index.sh

```bash
#!/bin/bash
set -e

TEXT_FILE=$1
OUTPUT_AUDIO=$2
CONFIG="config/servers.json"
PROFILE="config/host_profile.json"

TEXT=$(cat "$TEXT_FILE" | tr '\n' ' ' | sed 's/  */ /g')
REFERENCE_AUDIO=$(jq -r '.voice.reference_audio' $PROFILE)
SPEED=$(jq -r '.voice.speed' $PROFILE)

REF_BASENAME=$(basename "$REFERENCE_AUDIO")
echo "🎙️ 上传参考音频到服务器..."
SERVER_INFO=$(bash scripts/upload_to_server.sh "$REFERENCE_AUDIO" "voice_ref/$REF_BASENAME")
HOST=$(echo "$SERVER_INFO" | cut -d: -f1)
PORT=$(echo "$SERVER_INFO" | cut -d: -f2)
USER=$(echo "$SERVER_INFO" | cut -d: -f3)
WORKSPACE=$(echo "$SERVER_INFO" | cut -d: -f4)

if [ "$HOST" = "$(jq -r '.primary.host' $CONFIG)" ]; then
    TTS_PATH=$(jq -r '.primary.tts_path' $CONFIG)
    TTS_VENV=$(jq -r '.primary.tts_python_env' $CONFIG)
else
    TTS_PATH=$(jq -r '.backup.tts_path' $CONFIG)
    TTS_VENV=$(jq -r '.backup.tts_python_env' $CONFIG)
fi

echo "🎙️ 在服务器生成 TTS 音频..."
echo "   使用路径: $TTS_PATH"

if [ -n "$TTS_VENV" ] && [ "$TTS_VENV" != "" ] && [ "$TTS_VENV" != "null" ]; then
    if echo "$TTS_VENV" | grep -q "activate"; then
        ACTIVATE_CMD="source $TTS_VENV"
    else
        ACTIVATE_CMD="conda activate $TTS_VENV"
    fi
else
    ACTIVATE_CMD="echo '使用系统 Python'"
fi

INFERENCE_SCRIPT=$(ssh -p $PORT $USER@$HOST "
    cd $TTS_PATH
    for script in inference.py tts.py generate.py run.py; do
        [ -f "\$script" ] && echo "\$script" && exit 0
    done
    ls *.py | head -1
" 2>/dev/null)

echo "   推理脚本: $INFERENCE_SCRIPT"

ssh -p $PORT $USER@$HOST << EOF
    $ACTIVATE_CMD
    cd $TTS_PATH
    if python $INFERENCE_SCRIPT --help 2>&1 | grep -q "reference"; then
        python $INFERENCE_SCRIPT \
            --text "$TEXT" \
            --reference "$WORKSPACE/voice_ref/$REF_BASENAME" \
            --output "$WORKSPACE/tts_output.wav" \
            --speed $SPEED
    elif python $INFERENCE_SCRIPT --help 2>&1 | grep -q "ref"; then
        python $INFERENCE_SCRIPT \
            --text "$TEXT" \
            --ref "$WORKSPACE/voice_ref/$REF_BASENAME" \
            --out "$WORKSPACE/tts_output.wav"
    else
        python $INFERENCE_SCRIPT \
            "$TEXT" \
            "$WORKSPACE/voice_ref/$REF_BASENAME" \
            "$WORKSPACE/tts_output.wav"
    fi
EOF

echo "📥 下载 TTS 音频到本地..."
scp -P $PORT "$USER@$HOST:$WORKSPACE/tts_output.wav" "$OUTPUT_AUDIO"

echo "✅ TTS 完成: $OUTPUT_AUDIO"
```

### 6.5 scripts/musetalk.sh

```bash
#!/bin/bash
set -e

PHOTO_INPUT=$1
AUDIO_INPUT=$2
VIDEO_OUTPUT=$3
CONFIG="config/servers.json"
PROFILE="config/host_profile.json"

LIP_QUALITY=$(jq -r '.musetalk.lip_quality' $PROFILE)
FACE_ENHANCE=$(jq -r '.musetalk.face_enhance' $PROFILE)

PHOTO_BASENAME=$(basename "$PHOTO_INPUT")
AUDIO_BASENAME=$(basename "$AUDIO_INPUT")

echo "👄 上传素材到服务器..."
SERVER_INFO=$(bash scripts/upload_to_server.sh "$PHOTO_INPUT" "input/$PHOTO_BASENAME")
HOST=$(echo "$SERVER_INFO" | cut -d: -f1)
PORT=$(echo "$SERVER_INFO" | cut -d: -f2)
USER=$(echo "$SERVER_INFO" | cut -d: -f3)
WORKSPACE=$(echo "$SERVER_INFO" | cut -d: -f4)

bash scripts/upload_to_server.sh "$AUDIO_INPUT" "input/$AUDIO_BASENAME"

if [ "$HOST" = "$(jq -r '.primary.host' $CONFIG)" ]; then
    MUSE_PATH=$(jq -r '.primary.musetalk_path' $CONFIG)
    MUSE_VENV=$(jq -r '.primary.musetalk_python_env' $CONFIG)
else
    MUSE_PATH=$(jq -r '.backup.musetalk_path' $CONFIG)
    MUSE_VENV=$(jq -r '.backup.musetalk_python_env' $CONFIG)
fi

echo "👄 执行 MuseTalk 唇形同步..."
echo "   使用路径: $MUSE_PATH"

if [ -n "$MUSE_VENV" ] && [ "$MUSE_VENV" != "" ] && [ "$MUSE_VENV" != "null" ]; then
    if echo "$MUSE_VENV" | grep -q "activate"; then
        ACTIVATE_CMD="source $MUSE_VENV"
    else
        ACTIVATE_CMD="conda activate $MUSE_VENV"
    fi
else
    ACTIVATE_CMD="echo '使用系统 Python'"
fi

RUN_SCRIPT=$(ssh -p $PORT $USER@$HOST "
    cd $MUSE_PATH
    for script in run.py inference.py musetalk.py main.py; do
        [ -f "\$script" ] && echo "\$script" && exit 0
    done
    ls *.py | head -1
" 2>/dev/null)

echo "   运行脚本: $RUN_SCRIPT"

ENHANCE_FLAG=""
if [ "$FACE_ENHANCE" = "true" ]; then
    ENHANCE_FLAG="--face_enhance"
fi

ssh -p $PORT $USER@$HOST << EOF
    $ACTIVATE_CMD
    cd $MUSE_PATH
    if python $RUN_SCRIPT --help 2>&1 | grep -q "source_image"; then
        python $RUN_SCRIPT \
            --source_image "$WORKSPACE/input/$PHOTO_BASENAME" \
            --driven_audio "$WORKSPACE/input/$AUDIO_BASENAME" \
            --output "$WORKSPACE/output/lip_synced.mp4" \
            --quality $LIP_QUALITY \
            $ENHANCE_FLAG
    elif python $RUN_SCRIPT --help 2>&1 | grep -q "img"; then
        python $RUN_SCRIPT \
            --img "$WORKSPACE/input/$PHOTO_BASENAME" \
            --audio "$WORKSPACE/input/$AUDIO_BASENAME" \
            --out "$WORKSPACE/output/lip_synced.mp4"
    else
        python $RUN_SCRIPT \
            "$WORKSPACE/input/$PHOTO_BASENAME" \
            "$WORKSPACE/input/$AUDIO_BASENAME" \
            "$WORKSPACE/output/lip_synced.mp4"
    fi
EOF

echo "📥 下载唇形同步视频..."
scp -P $PORT "$USER@$HOST:$WORKSPACE/output/lip_synced.mp4" "$VIDEO_OUTPUT"

echo "✅ MuseTalk 完成: $VIDEO_OUTPUT"
```

### 6.6 scripts/whisper_local.sh

```bash
#!/bin/bash
set -e

AUDIO_INPUT=$1
OUTPUT_DIR=$2
MODEL=${3:-medium}

whisper "$AUDIO_INPUT" \
    --model "$MODEL" \
    --language zh \
    --output_format srt \
    --output_dir "$OUTPUT_DIR"

echo "✅ 字幕生成完成"
```

### 6.7 scripts/pipeline.sh

```bash
#!/bin/bash
set -e

ARTICLE_FILE=$1
OUTPUT_NAME=${2:-video_$(date +%Y%m%d_%H%M%S)}
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_DIR="$PROJECT_DIR/temp"
OUTPUT_DIR="$PROJECT_DIR/output"
PROFILE="$PROJECT_DIR/config/host_profile.json"
CONFIG="$PROJECT_DIR/config/servers.json"

mkdir -p "$TEMP_DIR" "$OUTPUT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     🎬 薪灵AI 口播视频生成流水线（Phase 2 动态视觉版）           ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║ 文章: $(basename "$ARTICLE_FILE")"
echo "║ 输出: $OUTPUT_NAME.mp4"
echo "║ 特性: 文章内容驱动动态背景 + 关键词高亮"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

PRIMARY_DETECTED=$(jq -r '.primary.detected' "$CONFIG" 2>/dev/null || echo "false")
BACKUP_DETECTED=$(jq -r '.backup.detected' "$CONFIG" 2>/dev/null || echo "false")

if [ "$PRIMARY_DETECTED" != "true" ] && [ "$BACKUP_DETECTED" != "true" ]; then
    echo "🔍 首次运行，自动探测服务器路径..."
    bash "$PROJECT_DIR/scripts/detect_paths.sh"
    echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 STEP 1: 文本预处理"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cp "$ARTICLE_FILE" "$TEMP_DIR/article_raw.md"

cat "$TEMP_DIR/article_raw.md" | \
    sed 's/# //g' | \
    sed 's/## //g' | \
    sed 's/\*\*//g' | \
    sed 's/\*//g' | \
    sed 's/\`//g' | \
    tr '\n' ' ' | \
    sed 's/  */ /g' | \
    sed 's/^ *//;s/ *$//' \
    > "$TEMP_DIR/script.txt"

SCRIPT_TEXT=$(cat "$TEMP_DIR/script.txt")
echo "口播稿长度: ${#SCRIPT_TEXT} 字符"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎙️  STEP 2: IndexTTS 声音克隆"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

bash "$PROJECT_DIR/scripts/tts_index.sh" "$TEMP_DIR/script.txt" "$TEMP_DIR/audio.wav"
AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TEMP_DIR/audio.wav")
AUDIO_FRAMES=$(echo "$AUDIO_DURATION * 30" | bc | cut -d. -f1)
echo "音频时长: ${AUDIO_DURATION}s | 帧数: $AUDIO_FRAMES"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 STEP 3: 生成字幕"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

bash "$PROJECT_DIR/scripts/whisper_local.sh" "$TEMP_DIR/audio.wav" "$TEMP_DIR"
mv "$TEMP_DIR/audio.srt" "$TEMP_DIR/subtitles.srt"
echo "字幕文件: $TEMP_DIR/subtitles.srt"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "👄 STEP 4: MuseTalk 唇形同步"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HOST_PHOTO=$(jq -r '.host.photo_source' $PROFILE)
bash "$PROJECT_DIR/scripts/musetalk.sh" "$PROJECT_DIR/$HOST_PHOTO" "$TEMP_DIR/audio.wav" "$TEMP_DIR/lip_synced.mp4"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎨 STEP 5: Remotion 视频合成（动态背景 + 关键词高亮）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ENDCARD_SEC=$(jq -r '.style.endcard_duration_seconds' $PROFILE)
ENDCARD_FRAMES=$(echo "$ENDCARD_SEC * 30" | bc | cut -d. -f1)
TOTAL_FRAMES=$(echo "$AUDIO_FRAMES + $ENDCARD_FRAMES" | bc)

mkdir -p "$PROJECT_DIR/public"
cp "$TEMP_DIR/lip_synced.mp4" "$PROJECT_DIR/public/host_video.mp4"
cp "$TEMP_DIR/audio.wav" "$PROJECT_DIR/public/audio.wav"
cp "$TEMP_DIR/subtitles.srt" "$PROJECT_DIR/public/subtitles.srt"

cat > "$PROJECT_DIR/public/props.json" << EOF
{
  "audioPath": "audio.wav",
  "srtPath": "subtitles.srt",
  "hostVideoPath": "host_video.mp4",
  "talkingDurationFrames": $AUDIO_FRAMES,
  "endcardDurationFrames": $ENDCARD_FRAMES,
  "totalDurationFrames": $TOTAL_FRAMES
}
EOF

cd "$PROJECT_DIR"
npx remotion render src/index.tsx TalkingHeadVideo \
    --props public/props.json \
    --duration-in-frames $TOTAL_FRAMES \
    "$OUTPUT_DIR/${OUTPUT_NAME}.mp4"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                      ✅ 生成完成！                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║ 输出文件: $OUTPUT_DIR/${OUTPUT_NAME}.mp4"
echo "║ 视频时长: $(echo "scale=1; $TOTAL_FRAMES / 30" | bc)s"
echo "║ 分辨率: 1080x1920"
echo "║ 特性: 动态背景 + 关键词高亮"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
```


---

## 七、Phase 2 新增/修改文件

### 7.1 src/utils/keywordMatcher.ts（新增）

```typescript
export interface SceneStyle {
  id: string;
  label: string;
  bgColor: string;
  accentColor: string;
  effect: 'chart-lines' | 'pulse-warning' | 'grid-flow' | 'warm-glow' | 'cyber-particles';
  highlightColor: string;
  keywords: string[];
}

export const SCENE_STYLES: Record<string, SceneStyle> = {
  data: {
    id: 'data',
    label: '数据增长',
    bgColor: '#0a1628',
    accentColor: '#00D4FF',
    effect: 'chart-lines',
    highlightColor: '#00D4FF',
    keywords: ['增长', '提升', '数据', '指标', '效率', '提高', '上升', '增加', '翻倍', 'ROI', '转化率', '业绩', '营收', '利润', 'GMV', 'DAU', '留存', '增长率', '同比', '环比', 'KPI', '完成率', '达成'],
  },
  risk: {
    id: 'risk',
    label: '风险危机',
    bgColor: '#1a0a0a',
    accentColor: '#FF4444',
    effect: 'pulse-warning',
    highlightColor: '#FF6B6B',
    keywords: ['离职', '风险', '问题', '挑战', '危机', '流失', '痛点', '困境', '难题', '瓶颈', '下滑', '下降', '亏损', '裁员', '纠纷', '合规', '违规', '仲裁', '诉讼', '赔偿', '成本', '浪费', '低效', '混乱'],
  },
  solution: {
    id: 'solution',
    label: '解决方案',
    bgColor: '#0a0a2e',
    accentColor: '#7B61FF',
    effect: 'grid-flow',
    highlightColor: '#7B61FF',
    keywords: ['解决', '方案', '系统', '工具', '重构', '优化', '升级', '改造', '落地', '实施', '部署', '上线', '打通', '整合', '一体化', '数字化', '自动化', '平台', '引擎', '模块', '功能'],
  },
  people: {
    id: 'people',
    label: '人才组织',
    bgColor: '#1a1a0a',
    accentColor: '#FFB347',
    effect: 'warm-glow',
    highlightColor: '#FFB347',
    keywords: ['团队', '人才', '组织', '员工', '人', 'HR', '招聘', '培养', '晋升', '绩效', '薪酬', '福利', '文化', '凝聚力', '归属感', '敬业度', '满意度', '体验', '关怀', '成长', '发展', '梯队', '储备'],
  },
  future: {
    id: 'future',
    label: 'AI未来',
    bgColor: '#0a1a0a',
    accentColor: '#00FF88',
    effect: 'cyber-particles',
    highlightColor: '#00FF88',
    keywords: ['AI', '智能', '未来', '自动', '预测', '模型', '算法', '机器学习', '深度学习', '大模型', 'GPT', '重构', '颠覆', '革命', '下一代', '前沿', '创新', '神经网络', 'NLP', '生成式', 'Agent', '数字员工'],
  },
};

export const DEFAULT_STYLE = SCENE_STYLES.data;

export function matchSceneStyle(text: string): SceneStyle {
  const scores: Record<string, number> = {};

  for (const [key, style] of Object.entries(SCENE_STYLES)) {
    scores[key] = 0;
    for (const keyword of style.keywords) {
      const regex = new RegExp(keyword, 'gi');
      const matches = text.match(regex);
      if (matches) {
        scores[key] += matches.length;
      }
    }
  }

  let bestKey = 'data';
  let bestScore = 0;
  for (const [key, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestScore > 0 ? SCENE_STYLES[bestKey] : DEFAULT_STYLE;
}

export function extractHighlightWords(text: string, style: SceneStyle): string[] {
  const words: string[] = [];
  for (const keyword of style.keywords) {
    if (text.includes(keyword)) {
      words.push(keyword);
    }
  }
  const numbers = text.match(/\d+%?|\d+\.\d+%?/g);
  if (numbers) {
    words.push(...numbers);
  }
  return [...new Set(words)];
}
```

### 7.2 src/components/effects/ChartLines.tsx（新增）

```tsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export const ChartLines: React.FC = () => {
  const frame = useCurrentFrame();

  const lines = Array.from({ length: 5 }, (_, i) => {
    const offset = i * 40;
    const progress = interpolate(frame, [0 + offset, 120 + offset], [0, 1], {
      extrapolateRight: 'clamp',
    });

    const points = Array.from({ length: 20 }, (_, j) => {
      const x = (j / 19) * 100;
      const baseY = 80 - (j / 19) * 60;
      const noise = Math.sin(j * 0.5 + frame * 0.02 + i) * 5;
      return `${x},${baseY + noise}`;
    }).join(' ');

    return (
      <polyline
        key={i}
        points={points}
        fill="none"
        stroke="#00D4FF"
        strokeWidth="1"
        opacity={0.15 + i * 0.05}
        strokeDasharray="1000"
        strokeDashoffset={1000 - progress * 1000}
      />
    );
  });

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
      }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {lines}
      {Array.from({ length: 8 }, (_, i) => {
        const y = 20 + Math.random() * 60;
        const x = interpolate(frame, [0, 180], [-10, 110], { extrapolateRight: 'clamp' });
        return (
          <text
            key={`num-${i}`}
            x={x + i * 15}
            y={y}
            fill="#00D4FF"
            fontSize="3"
            opacity={0.3}
          >
            {['+23%', '↑15%', '2.4x', '98%', '+47', '3.2x', '↑89%', '1.8x'][i]}
          </text>
        );
      })}
    </svg>
  );
};
```

### 7.3 src/components/effects/PulseWarning.tsx（新增）

```tsx
import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';

export const PulseWarning: React.FC = () => {
  const frame = useCurrentFrame();

  const pulse = interpolate(frame % 30, [0, 15, 30], [0.3, 0.8, 0.3], {
    easing: Easing.inOut(Easing.sin),
  });

  const shakeX = interpolate(frame % 10, [0, 5, 10], [0, 2, 0], {
    easing: Easing.inOut(Easing.sin),
  });

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      transform: `translateX(${shakeX}px)`,
    }}>
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: `radial-gradient(circle, rgba(255,68,68,${pulse}) 0%, transparent 70%)`,
        filter: 'blur(40px)',
      }} />

      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: `${i * 20}%`,
            left: 0,
            right: 0,
            height: 4,
            background: `linear-gradient(90deg, transparent, rgba(255,68,68,${0.1 + (i % 2) * 0.1}), transparent)`,
            transform: `translateX(${Math.sin(frame * 0.05 + i) * 20}px)`,
          }}
        />
      ))}

      <div style={{
        position: 'absolute',
        top: '30%',
        right: '15%',
        fontSize: 120,
        color: 'rgba(255,68,68,0.08)',
        fontWeight: 900,
      }}>
        !
      </div>
    </div>
  );
};
```

### 7.4 src/components/effects/GridFlow.tsx（新增）

```tsx
import React from 'react';
import { useCurrentFrame } from 'remotion';

export const GridFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const offset = (frame * 0.8) % 100;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(123,97,255,0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(123,97,255,0.08) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        transform: `translateY(${offset}px)`,
      }} />

      {Array.from({ length: 12 }, (_, i) => {
        const x = 10 + (i % 4) * 25;
        const y = 10 + Math.floor(i / 4) * 30;
        const pulse = Math.sin(frame * 0.03 + i) * 0.5 + 0.5;

        return (
          <div key={i}>
            <div style={{
              position: 'absolute',
              left: `${x}%`,
              top: `${y}%`,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: `rgba(123,97,255,${0.3 + pulse * 0.4})`,
              boxShadow: `0 0 15px rgba(123,97,255,${pulse * 0.5})`,
            }} />
            {i < 8 && (
              <div style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                width: `${25}%`,
                height: 1,
                background: `linear-gradient(90deg, rgba(123,97,255,0.2), transparent)`,
                transform: `rotate(${Math.atan2(30, 25) * (i % 2 === 0 ? 1 : -1)}rad)`,
                transformOrigin: 'left center',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
};
```

### 7.5 src/components/effects/WarmGlow.tsx（新增）

```tsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export const WarmGlow: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 600,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(255,179,71,0.12) 0%, transparent 70%)',
        filter: 'blur(60px)',
      }} />

      {Array.from({ length: 6 }, (_, i) => {
        const x = 15 + i * 14;
        const baseY = 60 + Math.sin(frame * 0.01 + i * 1.2) * 10;
        const opacity = 0.08 + Math.sin(frame * 0.02 + i) * 0.04;
        const scale = 0.8 + Math.sin(frame * 0.015 + i * 0.5) * 0.2;

        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${x}%`,
            top: `${baseY}%`,
            width: 40 * scale,
            height: 60 * scale,
            opacity,
          }}>
            <svg viewBox="0 0 40 60" fill="rgba(255,179,71,0.3)">
              <circle cx="20" cy="12" r="10" />
              <path d="M10 25 Q20 20 30 25 L32 55 Q20 58 8 55 Z" />
            </svg>
          </div>
        );
      })}

      <svg style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.1,
      }}>
        <path
          d="M 200 400 Q 300 300 400 400 T 600 400"
          fill="none"
          stroke="#FFB347"
          strokeWidth="2"
          strokeDasharray="10 5"
          strokeDashoffset={-frame * 0.5}
        />
      </svg>
    </div>
  );
};
```

### 7.6 src/components/effects/CyberParticles.tsx（新增）

```tsx
import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

export const CyberParticles: React.FC = () => {
  const frame = useCurrentFrame();

  const particles = Array.from({ length: 30 }, (_, i) => {
    const seed = i * 137.5;
    const x = (seed % 100);
    const y = ((seed * 7) % 100);
    const size = 2 + (seed % 4);
    const speed = 0.3 + (seed % 5) * 0.1;
    const currentY = (y + frame * speed) % 100;
    const opacity = interpolate(currentY, [0, 50, 100], [0, 0.6, 0], { extrapolate: 'clamp' });

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${currentY}%`,
          width: size,
          height: size,
          borderRadius: '50%',
          background: '#00FF88',
          opacity,
          boxShadow: `0 0 ${size * 2}px rgba(0,255,136,${opacity})`,
        }}
      />
    );
  });

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {particles}

      <svg style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.15,
      }}>
        {Array.from({ length: 8 }, (_, i) => {
          const x1 = 20 + (i % 3) * 30;
          const y1 = 20 + Math.floor(i / 3) * 30;
          const x2 = x1 + 15 + Math.sin(frame * 0.01 + i) * 10;
          const y2 = y1 + 15 + Math.cos(frame * 0.01 + i) * 10;

          return (
            <line
              key={i}
              x1={`${x1}%`}
              y1={`${y1}%`}
              x2={`${x2}%`}
              y2={`${y2}%`}
              stroke="#00FF88"
              strokeWidth="1"
              opacity={0.3 + Math.sin(frame * 0.02 + i) * 0.2}
            />
          );
        })}
      </svg>

      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height: 2,
        background: 'linear-gradient(90deg, transparent, rgba(0,255,136,0.3), transparent)',
        top: `${(frame * 0.3) % 100}%`,
      }} />
    </div>
  );
};
```

### 7.7 src/components/DynamicBackground.tsx（新增）

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { useSubtitles } from '../hooks/useSubtitles';
import { matchSceneStyle } from '../utils/keywordMatcher';
import { ChartLines } from './effects/ChartLines';
import { PulseWarning } from './effects/PulseWarning';
import { GridFlow } from './effects/GridFlow';
import { WarmGlow } from './effects/WarmGlow';
import { CyberParticles } from './effects/CyberParticles';

const EFFECT_COMPONENTS = {
  'chart-lines': ChartLines,
  'pulse-warning': PulseWarning,
  'grid-flow': GridFlow,
  'warm-glow': WarmGlow,
  'cyber-particles': CyberParticles,
};

interface DynamicBackgroundProps {
  srtPath: string;
}

export const DynamicBackground: React.FC<DynamicBackgroundProps> = ({ srtPath }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const subtitles = useSubtitles(srtPath);

  const currentCue = subtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );

  const style = currentCue ? matchSceneStyle(currentCue.text) : null;
  const EffectComponent = style ? EFFECT_COMPONENTS[style.effect] : null;

  const baseColor = style ? style.bgColor : '#0a0a1a';

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: `linear-gradient(180deg, ${baseColor} 0%, #0a0a1a 100%)`,
      transition: 'background 0.5s ease',
    }}>
      {EffectComponent && <EffectComponent />}

      {style && (
        <div style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 800,
          height: 500,
          borderRadius: '50%',
          background: `radial-gradient(ellipse, ${style.accentColor}15 0%, transparent 70%)`,
          filter: 'blur(80px)',
          transition: 'all 0.5s ease',
        }} />
      )}
    </div>
  );
};
```

### 7.8 src/components/Subtitles.tsx（修改）

```tsx
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { useSubtitles } from '../hooks/useSubtitles';
import { matchSceneStyle, extractHighlightWords } from '../utils/keywordMatcher';

interface SubtitlesProps {
  srtPath: string;
}

export const Subtitles: React.FC<SubtitlesProps> = ({ srtPath }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const subtitles = useSubtitles(srtPath);

  const currentCue = subtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );

  if (!currentCue) return null;

  const style = matchSceneStyle(currentCue.text);
  const highlightWords = extractHighlightWords(currentCue.text, style);

  const progress = (currentTime - currentCue.start) / (currentCue.end - currentCue.start);
  const charIndex = Math.floor(progress * currentCue.text.length);

  const renderText = () => {
    const text = currentCue.text;
    let result: React.ReactNode[] = [];
    let remaining = text;
    let keyIndex = 0;

    for (const word of highlightWords) {
      const idx = remaining.indexOf(word);
      if (idx !== -1) {
        if (idx > 0) {
          const normalText = remaining.slice(0, idx);
          const normalRead = normalText.slice(0, Math.max(0, charIndex - (text.length - remaining.length)));
          const normalUnread = normalText.slice(Math.max(0, charIndex - (text.length - remaining.length)));

          result.push(
            <span key={`n-${keyIndex++}`}>
              <span style={{ color: '#fff' }}>{normalRead}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>{normalUnread}</span>
            </span>
          );
        }

        const wordStart = text.length - remaining.length + idx;
        const wordReadLen = Math.max(0, charIndex - wordStart);
        const wordRead = word.slice(0, wordReadLen);
        const wordUnread = word.slice(wordReadLen);

        result.push(
          <span
            key={`h-${keyIndex++}`}
            style={{
              color: style.highlightColor,
              textShadow: `0 0 20px ${style.highlightColor}80, 0 0 40px ${style.highlightColor}40`,
              fontWeight: 800,
              fontSize: '1.1em',
            }}
          >
            {wordRead}
            <span style={{ opacity: 0.4 }}>{wordUnread}</span>
          </span>
        );

        remaining = remaining.slice(idx + word.length);
      }
    }

    if (remaining.length > 0) {
      const readLen = Math.max(0, charIndex - (text.length - remaining.length));
      result.push(
        <span key={`n-${keyIndex++}`}>
          <span style={{ color: '#fff' }}>{remaining.slice(0, readLen)}</span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>{remaining.slice(readLen)}</span>
        </span>
      );
    }

    return result;
  };

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 100,
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontFamily: '"Noto Sans SC", "PingFang SC", sans-serif',
          fontWeight: 700,
          lineHeight: 1.6,
          textAlign: 'center',
          maxWidth: '90%',
          padding: '16px 32px',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: 16,
          backdropFilter: 'blur(10px)',
          border: `1px solid ${style.accentColor}30`,
          transition: 'border-color 0.5s ease',
        }}
      >
        {renderText()}
      </div>
    </AbsoluteFill>
  );
};
```

### 7.9 src/components/SceneIndicator.tsx（新增，可选）

```tsx
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { useSubtitles } from '../hooks/useSubtitles';
import { matchSceneStyle } from '../utils/keywordMatcher';

interface SceneIndicatorProps {
  srtPath: string;
}

export const SceneIndicator: React.FC<SceneIndicatorProps> = ({ srtPath }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const currentTime = frame / fps;
  const subtitles = useSubtitles(srtPath);

  const currentCue = subtitles.find(
    cue => currentTime >= cue.start && currentTime <= cue.end
  );

  if (!currentCue) return null;

  const style = matchSceneStyle(currentCue.text);

  return (
    <div style={{
      position: 'absolute',
      top: 40,
      left: 40,
      padding: '8px 16px',
      borderRadius: 100,
      background: `${style.accentColor}20`,
      border: `1px solid ${style.accentColor}40`,
      color: style.accentColor,
      fontSize: 14,
      fontWeight: 600,
      letterSpacing: 1,
      backdropFilter: 'blur(10px)',
      transition: 'all 0.5s ease',
    }}>
      {style.label}
    </div>
  );
};
```

### 7.10 src/components/LogoWatermark.tsx（不变）

```tsx
import React from 'react';
import { AbsoluteFill, staticFile } from 'remotion';

export const LogoWatermark: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        padding: '24px 32px',
        pointerEvents: 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        opacity: 0.7,
      }}>
        <img
          src={staticFile('logo.png')}
          style={{ width: 28, height: 28, borderRadius: 6 }}
          alt="logo"
        />
        <span style={{
          fontSize: 16,
          color: '#fff',
          fontWeight: 600,
          letterSpacing: 1,
        }}>
          薪灵AI
        </span>
      </div>
    </AbsoluteFill>
  );
};
```

### 7.11 src/components/Background.tsx（备用，不变）

```tsx
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const offset = (frame * 0.5) % 200;

  return (
    <AbsoluteFill style={{ zIndex: -1 }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, #0a0a1a 0%, #12122a 50%, #0a0a1a 100%)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
        transform: `translateY(${offset}px)`,
      }} />
      <div style={{
        position: 'absolute',
        top: -200,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 800,
        height: 400,
        background: 'radial-gradient(ellipse, rgba(0,212,255,0.08) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />
    </AbsoluteFill>
  );
};
```

### 7.12 src/components/ProductEndcard.tsx（不变）

```tsx
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

interface ProductEndcardProps {
  startFrame: number;
  durationFrames: number;
}

const PRODUCT = {
  brand: '薪灵AI',
  tagline: '薪人薪事的AI引擎',
  slogan: '把人力数据，变成组织决策',
  cta: '看薪灵如何重构你的人力系统',
  pills: ['预测离职', '智能定薪', '组织诊断', '人才画像', '合规风控'],
  colors: {
    primary: '#00D4FF',
    secondary: '#7B61FF',
    accent: '#FF6B6B',
    bg: ['#0a0a1a', '#1a1a3e'],
  }
};

export const ProductEndcard: React.FC<ProductEndcardProps> = ({ startFrame, durationFrames }) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;

  const opacity = interpolate(localFrame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const scale = interpolate(localFrame, [0, 20], [0.9, 1], { easing: Easing.out(Easing.cubic) });
  const yOffset = interpolate(localFrame, [0, 20], [30, 0], { easing: Easing.out(Easing.cubic) });

  const glowIntensity = interpolate(localFrame, [0, durationFrames], [0.3, 1], { extrapolateRight: 'clamp' });

  const ctaOpacity = interpolate(localFrame, [30, 45], [0, 1], { extrapolateRight: 'clamp' });
  const ctaScale = interpolate(localFrame, [30, 50], [0.8, 1], { easing: Easing.out(Easing.back(1.5)) });

  const getPillDelay = (index: number) => 40 + index * 8;
  const getPillOpacity = (index: number) => interpolate(
    localFrame,
    [getPillDelay(index), getPillDelay(index) + 12],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );
  const getPillX = (index: number) => interpolate(
    localFrame,
    [getPillDelay(index), getPillDelay(index) + 12],
    [20, 0],
    { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }
  );

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `scale(${scale}) translateY(${yOffset}px)`,
        background: `linear-gradient(180deg, ${PRODUCT.colors.bg[0]} 0%, ${PRODUCT.colors.bg[1]} 100%)`,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
      }}
    >
      <div style={{
        position: 'absolute',
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${PRODUCT.colors.primary}20 0%, transparent 70%)`,
        filter: 'blur(60px)',
        opacity: glowIntensity,
      }} />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        marginBottom: 24,
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: `linear-gradient(135deg, ${PRODUCT.colors.primary}, ${PRODUCT.colors.secondary})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          fontWeight: 800,
          color: '#fff',
          boxShadow: `0 0 40px ${PRODUCT.colors.primary}60`,
        }}>
          薪
        </div>
        <div>
          <div style={{
            fontSize: 52,
            fontWeight: 800,
            color: '#fff',
            letterSpacing: 2,
            textShadow: `0 0 30px ${PRODUCT.colors.primary}80`,
          }}>
            {PRODUCT.brand}
          </div>
          <div style={{
            fontSize: 22,
            color: PRODUCT.colors.primary,
            fontWeight: 500,
            marginTop: 4,
          }}>
            {PRODUCT.tagline}
          </div>
        </div>
      </div>

      <div style={{
        fontSize: 36,
        color: 'rgba(255,255,255,0.9)',
        fontWeight: 600,
        marginBottom: 40,
        textAlign: 'center',
        padding: '0 60px',
        lineHeight: 1.5,
      }}>
        {PRODUCT.slogan}
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 12,
        maxWidth: 800,
        marginBottom: 48,
        padding: '0 40px',
      }}>
        {PRODUCT.pills.map((pill, index) => (
          <div
            key={pill}
            style={{
              opacity: getPillOpacity(index),
              transform: `translateX(${getPillX(index)}px)`,
              padding: '10px 24px',
              borderRadius: 100,
              background: 'rgba(255,255,255,0.08)',
              border: `1px solid ${PRODUCT.colors.primary}40`,
              color: '#fff',
              fontSize: 20,
              fontWeight: 500,
              backdropFilter: 'blur(10px)',
            }}
          >
            {pill}
          </div>
        ))}
      </div>

      <div style={{
        opacity: ctaOpacity,
        transform: `scale(${ctaScale})`,
      }}>
        <div style={{
          padding: '18px 48px',
          borderRadius: 100,
          background: `linear-gradient(90deg, ${PRODUCT.colors.primary}, ${PRODUCT.colors.secondary})`,
          color: '#fff',
          fontSize: 26,
          fontWeight: 700,
          boxShadow: `0 8px 32px ${PRODUCT.colors.primary}50`,
          cursor: 'pointer',
        }}>
          {PRODUCT.cta}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 60,
        width: 200,
        height: 3,
        borderRadius: 2,
        background: `linear-gradient(90deg, transparent, ${PRODUCT.colors.primary}, transparent)`,
      }} />
    </AbsoluteFill>
  );
};
```

### 7.13 src/hooks/useSubtitles.ts（不变）

```typescript
import { useMemo } from 'react';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export const useSubtitles = (srtPath: string): SubtitleCue[] => {
  return useMemo(() => {
    const fs = require('fs');
    const path = require('path');

    const content = fs.readFileSync(
      path.join(process.cwd(), 'public', srtPath),
      'utf-8'
    );

    const cues: SubtitleCue[] = [];
    const blocks = content.trim().split(/\n\n+/);

    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 3) continue;

      const timeLine = lines[1];
      const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '');

      const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
      if (!timeMatch) continue;

      const parseTime = (t: string) => {
        const [h, m, s, ms] = t.replace(',', ':').split(':').map(Number);
        return h * 3600 + m * 60 + s + ms / 1000;
      };

      cues.push({
        start: parseTime(timeMatch[1]),
        end: parseTime(timeMatch[2]),
        text: text.trim(),
      });
    }

    return cues;
  }, [srtPath]);
};
```

### 7.14 src/index.tsx（修改）

```tsx
import React from 'react';
import { Composition, AbsoluteFill, Video, Audio, staticFile } from 'remotion';
import { DynamicBackground } from './components/DynamicBackground';
import { Subtitles } from './components/Subtitles';
import { ProductEndcard } from './components/ProductEndcard';
import { LogoWatermark } from './components/LogoWatermark';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TalkingHeadVideo"
      component={TalkingHeadVideo}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        audioPath: 'audio.wav',
        srtPath: 'subtitles.srt',
        hostVideoPath: 'host_video.mp4',
        talkingDurationFrames: 600,
        endcardDurationFrames: 180,
        totalDurationFrames: 780,
      }}
    />
  );
};

const TalkingHeadVideo: React.FC<{
  audioPath: string;
  srtPath: string;
  hostVideoPath: string;
  talkingDurationFrames: number;
  endcardDurationFrames: number;
  totalDurationFrames: number;
}> = ({
  audioPath,
  srtPath,
  hostVideoPath,
  talkingDurationFrames,
  endcardDurationFrames,
  totalDurationFrames,
}) => {
  const frame = useCurrentFrame();
  const isEndcard = frame >= talkingDurationFrames;

  return (
    <AbsoluteFill style={{ background: '#0a0a1a' }}>
      <Audio src={staticFile(audioPath)} />

      {!isEndcard ? (
        <>
          <DynamicBackground srtPath={srtPath} />

          <Video
            src={staticFile(hostVideoPath)}
            style={{
              position: 'absolute',
              left: '50%',
              top: 180,
              width: 720,
              height: 960,
              transform: 'translateX(-50%)',
              borderRadius: 24,
              objectFit: 'cover',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          />

          <Subtitles srtPath={srtPath} />
        </>
      ) : (
        <ProductEndcard
          startFrame={talkingDurationFrames}
          durationFrames={endcardDurationFrames}
        />
      )}

      <LogoWatermark />
    </AbsoluteFill>
  );
};
```


---

## 八、初始化命令（Kimi CLI 执行）

当用户首次设置时，执行以下命令：

```bash
# 1. 创建项目目录
mkdir -p ~/kimi-talking-head && cd ~/kimi-talking-head

# 2. 创建完整目录结构
mkdir -p assets/{host,voice,bgm} config scripts src/{components/effects,utils,hooks,public} temp output .kimi

# 3. 初始化 Remotion
npx create-remotion@latest . --template=blank --overwrite --skip-install

# 4. 安装依赖
npm install remotion@latest @remotion/cli@latest
npm install -D @types/node typescript

# 5. 安装 Python 依赖（本地 Whisper）
pip install openai-whisper

# 6. 确保脚本可执行
chmod +x scripts/*.sh

# 7. 检查 SSH 信任关系
echo "检查主节点..."
ssh -o ConnectTimeout=3 root@8.152.242.29 -p 58349 "echo '主节点连接正常'" || echo '主节点连接失败，请检查 SSH 密钥'

echo "检查从节点..."
ssh -o ConnectTimeout=3 xylon@192.168.1.10 "echo '从节点连接正常'" || echo '从节点连接失败，请检查 SSH 密钥'

# 8. 验证素材存在
ls -la assets/host/me.jpg
ls -la assets/voice/me.m4a
ls -la assets/logo.png

# 9. 首次运行路径探测
echo "🔍 开始自动探测服务器路径..."
bash scripts/detect_paths.sh

echo "✅ 初始化完成"
```

---

## 九、日常使用流程

用户只需提供文章，Kimi CLI 执行：

```bash
# 用户输入文章保存到:
echo "用户文章内容..." > ~/kimi-talking-head/temp/article.md

# 执行流水线（首次会自动探测路径，后续使用缓存配置）
cd ~/kimi-talking-head
bash scripts/pipeline.sh temp/article.md my_video

# 输出: ~/kimi-talking-head/output/my_video.mp4
```

---

## 十、动态视觉效果说明

### 10.1 场景触发规则

| 场景 | 触发关键词 | 背景效果 | 字幕高亮色 |
|------|-----------|---------|-----------|
| 数据增长 | 增长、提升、数据、指标、效率、ROI、转化率、业绩、营收 | 上升曲线 + 数字粒子 | 青色 #00D4FF |
| 风险危机 | 离职、风险、问题、挑战、危机、流失、痛点、合规、违规 | 红色脉冲 + 警告条纹 | 红色 #FF6B6B |
| 解决方案 | 解决、方案、系统、工具、重构、优化、数字化、自动化 | 流动网格 + 连接节点 | 紫色 #7B61FF |
| 人才组织 | 团队、人才、组织、员工、HR、招聘、绩效、薪酬、文化 | 温暖光晕 + 人物剪影 | 暖色 #FFB347 |
| AI未来 | AI、智能、未来、预测、模型、算法、机器学习、大模型 | 赛博粒子 + 神经网络 | 绿色 #00FF88 |

### 10.2 效果演示

假设文章是：

> "今年Q3，我们团队离职率飙升到25%，这是一个巨大的挑战。但薪灵AI的预测离职模型，可以提前3个月识别高风险员工，帮助HR主动干预。通过智能定薪和组织诊断，我们帮企业把人力数据变成组织决策。"

**视频动态变化**：

| 时间 | 句子 | 背景效果 | 字幕高亮 |
|------|------|---------|---------|
| 0-3s | "离职率飙升到25%" | 红色脉冲 + 警告条纹 | "离职率"、"25%" 红色放大 |
| 3-6s | "巨大的挑战" | 红色脉冲持续 | "挑战" 红色 |
| 6-10s | "薪灵AI的预测离职模型" | 蓝紫科技网格流动 | "薪灵AI"、"预测离职" 紫色高亮 |
| 10-13s | "提前3个月识别" | 网格加速 + 连接节点 | "3个月" 数字放大 |
| 13-17s | "智能定薪和组织诊断" | 蓝紫网格 + 节点闪烁 | "智能定薪"、"组织诊断" 紫色 |
| 17-20s | "人力数据变成组织决策" | 暖色光晕 + 人物剪影 | "人力数据"、"组织决策" 暖色 |

---

## 十一、故障处理

| 故障 | 处理 |
|------|------|
| 首次运行未探测到路径 | 执行 `bash scripts/detect_paths.sh` 手动探测 |
| 主节点 SSH 失败 | 自动切换到从节点，脚本内置故障转移 |
| IndexTTS 生成失败 | 检查 `assets/voice/me.m4a` 是否存在且有效 |
| MuseTalk 唇形不同步 | 检查 `assets/host/me.jpg` 是否为正面清晰照片 |
| Whisper 字幕错位 | 检查音频质量，必要时使用 `--model large` |
| 服务器路径变更 | 删除 `config/servers.json` 中的 `detected` 标记，重新探测 |
| 动态背景不切换 | 检查 `src/utils/keywordMatcher.ts` 关键词是否覆盖文章内容 |

---

## 十二、文件清单（Kimi CLI 需生成）

Kimi CLI 需要创建以下文件（按本文档内容）：

1. `config/servers.json`
2. `config/host_profile.json`
3. `scripts/detect_paths.sh` — 新增：自动探测服务器路径
4. `scripts/check_server.sh`
5. `scripts/upload_to_server.sh`
6. `scripts/tts_index.sh` — 更新：使用探测到的路径
7. `scripts/musetalk.sh` — 更新：使用探测到的路径
8. `scripts/whisper_local.sh`
9. `scripts/pipeline.sh` — 更新：首次运行自动探测 + Phase 2 动态视觉
10. `src/utils/keywordMatcher.ts` — Phase 2 新增：关键词匹配
11. `src/components/effects/ChartLines.tsx` — Phase 2 新增
12. `src/components/effects/PulseWarning.tsx` — Phase 2 新增
13. `src/components/effects/GridFlow.tsx` — Phase 2 新增
14. `src/components/effects/WarmGlow.tsx` — Phase 2 新增
15. `src/components/effects/CyberParticles.tsx` — Phase 2 新增
16. `src/components/DynamicBackground.tsx` — Phase 2 新增
17. `src/components/Subtitles.tsx` — Phase 2 修改：关键词高亮
18. `src/components/SceneIndicator.tsx` — Phase 2 新增（可选）
19. `src/components/ProductEndcard.tsx`
20. `src/components/LogoWatermark.tsx`
21. `src/components/Background.tsx`
22. `src/hooks/useSubtitles.ts`
23. `src/index.tsx` — Phase 2 修改：接入动态背景
24. `package.json`（Remotion 初始化后修改）
25. `.kimi/pipeline.md`（本文件）

---

> 执行指令：
> 1. 按本文档创建所有文件和目录
> 2. 确保脚本可执行（chmod +x）
> 3. 验证 SSH 连接
> 4. 运行 `bash scripts/detect_paths.sh` 自动探测两台服务器上的 IndexTTS 和 MuseTalk 实际路径
> 5. 探测完成后，等待用户提供文章进行视频生成
> 6. 每次生成时，如果 `config/servers.json` 中 `detected` 为 true，直接使用缓存路径；如果为 false，先执行探测
> 7. 视频生成时，Remotion 会根据文章内容实时切换背景效果和字幕高亮
