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
- **词级卡拉 OK 字幕**：逐词入场 + 当前词强调，LLM 自动挑选 hero 词做全屏时刻；`classic / loud / keynote / cream / editorial / documentary` 六套字幕 DNA 可选，hero 全屏时刻由 `HeroOverlay` 统一渲染、任意 DNA 下均与入场音效同步可见。
- **场景运动与交叉淡化**：场景画面 Ken Burns 缓推/平移，场景间 fade/wipe/zoom 三种转场确定性轮换。
- **视频 B-roll**：`scene_visuals.media_type` 支持 `video / mixed`，Pexels 视频素材自动检索下载、按片段时长循环铺满场景，图片 provider 自动兜底。
- **音频可视化**：底部实时波形条（`visualizeAudio` 驱动，可关闭）。
- **BGM 与音效**：BGM 循环垫底、首尾淡入淡出；hero 时刻自动配入场音效（`assets/sfx/hero.*` 优先，缺失时 ffmpeg 合成兜底）。
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

### 1. 克隆并安装依赖

```bash
git clone <repo> ~/kimi-talking-head
cd ~/kimi-talking-head
npm install
```

### 2. 复制并填写配置

```bash
# 主播照片、参考音频、品牌文案等
cp config/host_profile.example.json config/host_profile.json

# 服务器连接信息
cp config/servers.example.json config/servers.json

# API Key、模型路径等环境变量
cp .env.example .env
```

编辑 `config/host_profile.json`，至少填写：

| 字段 | 说明 |
|------|------|
| `host.photo_source` | 主播照片路径 |
| `voice.reference_audio` | 声音克隆参考音频路径 |
| `template` | `editorial` 或 `product-launch` |
| `video_layout.hybrid.preset` | `default / host-focus / visual-focus / minimal / balanced` |
| `title_card.title` | 视频标题 |
| `product.*` | 品牌文案、颜色、结尾卡信息 |

### 3. 探测服务器路径

```bash
bash scripts/detect_paths.sh
```

`config/servers.json` 会被自动更新；`config/host_profile.json` 需要手动填写。

---

## 快速开始

### 完整流程：文档 → 视频

```bash
bash scripts/pipeline.sh path/to/article.md my_video
```

- `path/to/article.md`：你的 Markdown / 纯文本文章
- `my_video`：输出名称，决定 `temp/my_video/` 和 `output/my_video.*`

输出产物：

- `output/my_video.mp4`：最终 1080×1920 竖屏口播视频
- `output/my_video_cover.png`：1080×1920 封面图

### 媒体复用：只改标题/风格，跳过 GPU

如果你已经跑过一次 `my_video`，现在只想换标题、换配色、换模板或修改口播稿文字，可以复用已有的 TTS 音频和原始唇形视频，避免重新跑 IndexTTS 和 InfiniteTalk：

```bash
bash scripts/render_with_reused_media.sh \
  path/to/article.md \
  my_video_v2 \
  temp/my_video/audio.wav \
  temp/my_video/lip_synced_raw.mp4
```

该脚本会：

1. 复用 `audio.wav` 和 `lip_synced_raw.mp4`
2. 重新 Whisper 生成字幕并用口播稿对齐
3. 重新生成分镜和场景画面
4. 用新的 `host_profile.json` 配置重新 Remotion 渲染

> ⚠️ 注意：复用媒体时务必使用 `render_with_reused_media.sh`，不要直接用 `pipeline.sh`。该脚本会自动复用源口播稿，避免新口播稿与旧音频不匹配。

### 强制重跑某个阶段

流水线默认断点续跑。如果想强制重新生成某个阶段：

```bash
FORCE_SUBTITLES=1 bash scripts/pipeline.sh article.md my_video
```

可用 `FORCE_*` 变量：

`FORCE_SCRIPT`, `FORCE_TTS`, `FORCE_WHISPER`, `FORCE_SUBTITLES`, `FORCE_STORYBOARD`, `FORCE_VISUALS`, `FORCE_LIPSYNC`, `FORCE_POSTPROCESS`, `FORCE_RENDER`

> 提示：`FORCE_STORYBOARD=1` 会自动触发 `FORCE_VISUALS=1`，因为分镜变化后场景画面通常也需要重生成。

---

## 常用命令速查

| 目的 | 命令 |
|------|------|
| 完整生成新视频 | `bash scripts/pipeline.sh path/to/article.md my_video` |
| 复用音频/唇视频重新渲染 | `bash scripts/render_with_reused_media.sh article.md my_video_v2 temp/my_video/audio.wav temp/my_video/lip_synced_raw.mp4` |
| 探测服务器路径 | `bash scripts/detect_paths.sh` |
| 强制重跑字幕阶段 | `FORCE_SUBTITLES=1 bash scripts/pipeline.sh article.md my_video` |
| 预览 Remotion 组件 | `npm run dev` |
| TypeScript 检查 | `npm run build` |
| 启动 Web 管理后台 | `npm run web`（http://localhost:3456） |

---

## Web 管理后台

`npm run web`（等价 `npm run api`）启动管理后台，浏览器打开 http://localhost:3456：

- **任务列表**：状态徽章（draft/queued/running/completed/failed/cancelled）、9 阶段进度条、行内停止/删除，运行中自动轮询。
- **新建任务**：粘贴文章或上传 `.md/.txt`，可直接运行或存为草稿后再调参。
- **任务详情**：
  - **Run** 全量重跑 / **Rebuild** 复用已有音频与唇形视频快速重渲（样式迭代不走 GPU）/ **Stop** / **Clone** 克隆变体 / **Delete**（可选同时清理产物）。
  - 在线 Preview（支持拖动进度）+ 封面 + 下载；阶段步进器 + 实时日志。
  - 分组参数表单（字幕 DNA/字号、布局预设/卡片缩放、BGM/音效、标题覆盖），写入任务级 `configOverrides`，与 `config/host_profile.json` 深合并；支持裸 JSON 高级模式。
  - 文章在线编辑。

> ⚠️ 后台无鉴权，仅面向本机使用，不要暴露到公网。

### HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/jobs` | 创建任务：multipart（`article` 文件）或 JSON `{outputName, articleText, config, run}`；`run:false` 存草稿 |
| `GET` | `/api/v1/jobs` | 任务列表（含阶段进度、hasMedia、队列位置） |
| `GET` | `/api/v1/jobs/:id` | 任务详情（含完整阶段状态、configOverrides、文章） |
| `PATCH` | `/api/v1/jobs/:id` | 调整 outputName / configOverrides / 文章（运行中 409） |
| `DELETE` | `/api/v1/jobs/:id` | 删除任务；`?purge=1` 同时清理 `temp/` 与 `output/` 产物 |
| `POST` | `/api/v1/jobs/:id/run` | 全量重跑（pipeline.sh） |
| `POST` | `/api/v1/jobs/:id/rebuild` | 复用媒体快速重渲（render_with_reused_media.sh） |
| `POST` | `/api/v1/jobs/:id/stop` | 停止（排队中取消 / 运行中杀进程组） |
| `POST` | `/api/v1/jobs/:id/clone` | 克隆任务（可带新 outputName/config/run） |
| `GET` | `/api/v1/jobs/:id/preview/:file` | 在线预览 video/cover（支持 Range 拖动） |
| `GET` | `/api/v1/jobs/:id/download/:file` | 下载 video/cover |
| `GET` | `/api/v1/jobs/:id/logs/:type` | stdout/stderr 日志流 |
| `GET` | `/api/v1/config` | 基础配置（脱敏）+ 表单枚举（字幕 DNA/布局预设/素材类型） |

并发由 `MAX_CONCURRENT`（默认 1）控制，多余任务进入队列。

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

---

## 关键配置

### `config/host_profile.json`

- `host.photo_source`：主播照片路径
- `voice.reference_audio`：参考音频路径
- `template`：`editorial` 或 `product-launch`
- `video_layout.mode`：`portrait-hybrid`
- `video_layout.hybrid.preset`：`default | host-focus | visual-focus | minimal | balanced`
- `title_card.title` / `title_card.duration_seconds`
- `content_overlay.subtitles.dna`：字幕 DNA，`classic`（默认整句卡片）/ `loud`（逐词冲击 + hero 全屏）/ `keynote`（发布式揭示 + hero wipe-up）/ `cream`（暖奶油诗意）/ `editorial`（杂志衬线）/ `documentary`（纪实庄重）。hero 关键词全屏时刻由 `HeroOverlay` 统一渲染，任意 DNA 下都会与入场音效同步出现
- `style.bgm` / `style.bgm_volume`：BGM 路径与音量（默认 0.12，置 0 关闭）
- `style.sfx_enabled` / `style.sfx_volume`：hero 入场音效开关与音量
- `scene_visuals.media_type`：场景素材类型，`image`（默认）/ `video`（全视频 B-roll）/ `mixed`（奇偶交替）
- `video_layout.hybrid.showProgressBar`：底部线性进度条（默认开）
- `video_layout.hybrid.showWaveform`：底部音频波形条（默认开）
- `video_layout.hybrid.chapterCardScale`：章节观点卡片整体缩放系数（卡宽、内边距、字号同比，默认 1.3）；卡片堆叠起点为画布高度 1/6 处
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

| 问题 | 解决方案 |
|------|----------|
| 字幕与音频对不上 | 检查 `script.txt` 是否与 `audio.wav` 对应。复用媒体时务必使用 `render_with_reused_media.sh`。 |
| 字幕校准失败（match ratio < 65%） | `script.txt` 与音频内容不一致。重新生成 TTS 或复用正确的源口播稿。 |
| ComfyUI 启动报 numpy/opencv 错误 | 在服务器执行 `pip install "numpy<2.2" "opencv-python>=4.10"`。 |
| SSH 连接失败 | 确保本地 `~/.ssh/config` 已配置免密登录，并运行 `bash scripts/detect_paths.sh`。 |
| 阶段失败后重跑 | 直接重新执行原命令，流水线会自动从失败阶段继续。 |

---

## 开发

本地组件开发：

```bash
npm run dev        # Remotion 预览
npm run build      # TypeScript 检查
```

测试：

| 目的 | 命令 |
|------|------|
| 全部离线套件 + 类型检查 | `npm test` |
| 视觉回归（SSIM 像素对比） | `npm run test:visual` |
| 有意变更模板后重落基线 | `UPDATE_BASELINE=1 npm run test:visual` |
| 单独跑某个套件 | `node scripts/test_karaoke_words.js` 等 |

渲染指定视频（高级）：

```bash
npx remotion render src/index.tsx TalkingHeadVideo \
  --props public/props.json \
  --duration-in-frames 7034 \
  output/manual.mp4
```
