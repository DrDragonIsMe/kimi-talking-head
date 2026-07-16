# 薪灵AI 口播视频生成器

一键将文章（Markdown / 纯文本）转换为 1080×1920 竖屏口播视频。

```
文章 → 口播稿 → TTS 音频 → 唇形同步 → 字幕对齐 → Remotion 合成 → MP4
```

---

## 功能特性

- **文章输入**：`.md` 或 `.txt`，自动生成口播稿。
- **声音克隆**：基于 [IndexTTS2](https://github.com/index-tts/index-tts)，使用参考音频克隆主播声音。
- **唇形同步**：基于 [InfiniteTalk](https://github.com/MeiGen-AI/InfiniteTalk) 将主播照片与音频合成口型匹配视频。
- **工程级字幕**：Whisper 词级时间戳 + 口播稿字符级对齐，字幕内容严格等于原文，且自动校验稿音一致性。
- **竖屏分镜布局**：`portrait-hybrid` 模式支持 `default / host-focus / visual-focus / minimal / balanced` 五种预设。
- **动态视觉**：根据内容自动切换场景背景、关键词高亮、章节面包屑、观点 bullets、品牌结尾卡。
- **标题卡 + 封面图**：首帧 2 秒标题卡，同时输出 1080×1920 封面 PNG。
- **断点续跑**：每个阶段写入 `temp/<run>/.pipeline_state.json`，失败后可原地重跑。
- **媒体复用**：只改标题/风格时，可复用已有的 TTS 音频和原始唇形视频，跳过昂贵的 GPU 步骤。

---

## 环境要求

### 本地（控制台）

- macOS / Linux
- Node.js ≥ 18，npm
- Python 3
- FFmpeg，ImageMagick（`convert` 或 `magick`）
- SSH 免密登录到 GPU 服务器

### GPU 服务器

- Ubuntu 22.04/24.04
- NVIDIA GPU + 驱动
- 模型文件约 55 GB 磁盘空间

服务器部署脚本位于 [`server/install.sh`](server/install.sh)，详见 [`server/README.md`](server/README.md)、[`server/MODEL_CHECKLIST.md`](server/MODEL_CHECKLIST.md) 和 [`server/server_maintenance.md`](server/server_maintenance.md)。

---

## 安装

```bash
git clone <repo> ~/kimi-talking-head
cd ~/kimi-talking-head
npm install

# 复制示例配置
cp config/host_profile.example.json config/host_profile.json
cp config/servers.example.json config/servers.json

# 按需填写 .env
cp .env.example .env
```

首次运行前探测服务器路径：

```bash
bash scripts/detect_paths.sh
```

`config/servers.json` 会被自动更新；`config/host_profile.json` 需要手动填写主播照片、参考音频、品牌文案等。

---

## 快速开始

### 完整流程（新视频）

```bash
bash scripts/pipeline.sh path/to/article.md my_video
```

输出：`output/my_video.mp4` 和 `output/my_video_cover.png`。

### 只改标题/风格，复用已有音频和唇形视频

```bash
bash scripts/render_with_reused_media.sh \
  path/to/article.md \
  my_video_v2 \
  temp/my_video/audio.wav \
  temp/my_video/lip_synced_raw.mp4
```

该脚本会自动复用源口播稿，避免新口播稿与旧音频不匹配。

---

## 流水线阶段

`scripts/pipeline.sh` 依次执行：

| 阶段 | 说明 | 产物 |
|------|------|------|
| `script` | 文章 → 口播稿 | `temp/<run>/script.txt` |
| `tts` | IndexTTS 生成音频 | `temp/<run>/audio.wav` |
| `whisper` | Whisper 词级时间戳 | `temp/<run>/subtitles_raw.json` / `.srt` |
| `subtitles` | 口播稿字符级对齐 | `temp/<run>/subtitles.srt` |
| `storyboard` | 分镜脚本 | `temp/<run>/storyboard.json` |
| `visuals` | 场景画面准备 | `temp/<run>/scene_visuals.json` |
| `lipsync` | InfiniteTalk 唇形同步 | `temp/<run>/lip_synced_raw.mp4` |
| `postprocess` | 拉伸/对齐/统一格式 | `temp/<run>/lip_synced.mp4` |
| `render` | Remotion 合成 | `output/<run>.mp4` |

强制重跑某个阶段：

```bash
FORCE_SUBTITLES=1 bash scripts/pipeline.sh article.md my_video
```

可用 `FORCE_*` 变量：`FORCE_SCRIPT`, `FORCE_TTS`, `FORCE_WHISPER`, `FORCE_SUBTITLES`, `FORCE_STORYBOARD`, `FORCE_VISUALS`, `FORCE_LIPSYNC`, `FORCE_POSTPROCESS`, `FORCE_RENDER`。

---

## 关键配置

### `config/host_profile.json`

- `host.photo_source`：主播照片路径
- `voice.reference_audio`：参考音频路径
- `template`：`editorial` 或 `product-launch`
- `video_layout.mode`：`portrait-hybrid`
- `video_layout.hybrid.preset`：`default | host-focus | visual-focus | minimal | balanced`
- `title_card.title` / `title_card.duration_seconds`
- `product.*`：品牌文案、 pills、颜色

### `config/servers.json`

由 `detect_paths.sh` 自动维护，包含主/从服务器的 SSH 信息、IndexTTS 路径、InfiniteTalk 路径、Python 环境等。

---

## 服务器部署

在 GPU 服务器上：

```bash
git clone <repo> /tmp/kimi-talking-head
cd /tmp/kimi-talking-head/server
bash install.sh
```

然后下载模型（见 [`server/MODEL_CHECKLIST.md`](server/MODEL_CHECKLIST.md)），启动 ComfyUI：

```bash
bash /root/aigc_apps/start.sh
```

---

## 目录结构

```
.
├── assets/              # 主播照片、参考音频、Logo、BGM
├── config/              # 本地与服务器配置（*.json 不提交）
├── scripts/             # 流水线与工具脚本
│   ├── pipeline.sh
│   ├── render_with_reused_media.sh
│   ├── tts_index.sh
│   ├── comfyui/
│   └── lib/
├── server/              # GPU 服务器部署脚本与文档
├── src/                 # Remotion 组件
├── public/              # 运行时静态资源（渲染时生成）
├── temp/                # 中间产物（.gitignore）
└── output/              # 成品（.gitignore）
```

---

## 故障排查

- **字幕与音频对不上**：检查 `script.txt` 是否与 `audio.wav` 对应。复用媒体时务必使用 `render_with_reused_media.sh`，它会自动复用源口播稿。
- **字幕校准失败（match ratio < 65%）**：`script.txt` 与音频内容不一致。重新生成 TTS 或复用正确的源口播稿。
- **ComfyUI 启动报 numpy/opencv 错误**：在服务器执行 `pip install "numpy<2.2" "opencv-python>=4.10"`。
- **SSH 连接失败**：确保本地 `~/.ssh/config` 已配置免密登录，并运行 `bash scripts/detect_paths.sh`。

---

## 开发

本地组件开发：

```bash
npm run dev        # Remotion preview
npm run build      # TypeScript 检查
```

渲染指定视频：

```bash
npx remotion render src/index.tsx TalkingHeadVideo \
  --props public/props.json \
  --duration-in-frames 7034 \
  output/manual.mp4
```
