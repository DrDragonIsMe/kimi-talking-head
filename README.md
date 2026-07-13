# 薪灵AI 口播视频生成器

一键将文章（Markdown / 纯文本）转换为 1080×1920 竖屏口播视频。系统会自动完成文本预处理、AI 声音克隆、唇形同步、字幕生成与校准，并在 Remotion 中合成带动态背景、关键词高亮、下方观点 bullets 与品牌结尾卡的成片。

---

## 功能特性

- **文章输入**：支持 `.md` Markdown 与 `.txt` 纯文本两种输入格式。
- **声音克隆**：基于 IndexTTS，使用参考音频克隆主播声音。
- **唇形同步**：基于 MuseTalk，将主播照片与音频合成口型匹配的视频。
- **字幕自动校准**：Whisper 生成字幕后，用原文自动修正识别错误（如“心灵AI”→“薪灵AI”）。
- **动态视觉**：根据每句内容匹配场景色（数据青 / 风险红 / 方案紫 / 人才暖 / AI 绿）。
- **下方观点 bullets**：根据当前字幕自动提取关键信息，以多种样式显示在人像下方。
- **顶部进度面包屑**：根据场景自动提取章节标题，显示当前播放进度（1/6）。
- **品牌结尾卡**：统一品牌主色 `#00b498`，含 Logo、Slogan、能力 pills 与 CTA。
- **标题卡 + 封面图**：视频开头 2 秒标题卡，同时输出 1080×1920 封面 PNG，方便上传视频号时直接用作封面。
- **竖屏输出**：1080×1920、30fps，适配抖音/视频号/小红书。

---

## 环境要求

### 本地（控制台）

- macOS / Linux（当前在 macOS 上开发验证）
- Node.js ≥ 18
- npm
- Python 3
- FFmpeg
- ImageMagick（`convert` 命令）

### 服务器（首次运行自动探测）

- 主节点：IndexTTS + MuseTalk（已在 `8.152.242.29:58349` 部署）
- 从节点：可选备份节点
- 确保本地可通过 SSH 免密登录服务器

---

## 安装

```bash
# 1. 克隆项目
cd /Users/changxinglong/kimi-talking-head

# 2. 安装 Node 依赖
npm install

# 3. 配置 Kimi Code API（可选，用于 AI 生成口播稿与章节面包屑）
#    复制 .env.example 为 .env 并填写你的 API key
cp .env.example .env
#    编辑 .env：KIMI_CODE_API_KEY=sk-...

# 4. 首次运行会自动探测服务器路径
# 如需手动探测：
bash scripts/detect_paths.sh
```

---

## 目录结构

```
.
├── assets/
│   ├── host/me.jpg          # 主播照片（MuseTalk 输入）
│   ├── voice/me.m4a         # 声音克隆参考音频（10-30 秒清晰人声）
│   ├── bgm/                 # 可选背景音乐
│   └── logo.png             # 品牌 Logo
├── config/
│   ├── host_profile.json    # 主播、声音、风格、产品信息配置
│   └── servers.json         # 服务器路径（自动探测生成）
├── scripts/
│   ├── pipeline.sh          # 主控流水线（一键执行）
│   ├── generate_script.js   # 文章 → 口播稿（Kimi Code API 优先，失败回退本地）
│   ├── extract_chapters.js  # 从场景视觉提取章节面包屑（Kimi Code API 优先）
│   ├── preprocess_article.js # 本地文章预处理 fallback
│   ├── extract_title.js     # 从文章提取标题/副标题
│   ├── align_subtitles.py   # 字幕原文校准
│   ├── tts_index.sh         # IndexTTS 声音克隆
│   ├── musetalk.sh          # MuseTalk 唇形同步
│   ├── whisper_local.sh     # Whisper 本地字幕生成
│   └── parse_srt.js         # SRT 转 JSON（支持时间偏移）
├── src/
│   ├── components/          # Remotion 组件
│   ├── hooks/               # 字幕 hooks
│   ├── utils/               # 关键词匹配与 bullets 提取
│   └── index.tsx            # Remotion 根入口
├── public/                  # 渲染时静态资源（音频、视频、字幕、props）
├── temp/                    # 中间文件（每次运行会覆盖）
├── output/                  # 成片输出目录
└── README.md
```

---

## 配置说明

> 首次克隆后，请从示例文件创建本地配置（真实配置文件含 API Key / 服务器地址，已加入 `.gitignore` 不会提交）：
>
> ```bash
> cp config/host_profile.example.json config/host_profile.json
> cp config/servers.example.json config/servers.json
> ```

### `config/host_profile.json`

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
  "product": {
    "brand": "薪灵AI",
    "tagline": "薪人薪事的AI引擎",
    "slogan": "把人力数据，变成组织决策",
    "cta": "看薪灵如何重构你的人力系统",
    "pills": ["预测离职", "智能定薪", "组织诊断", "人才画像", "合规风控"],
    "primary_color": "#00b498",
    "secondary_color": "#00d4c8",
    "accent_color": "#00b498",
    "bg_gradient": ["#0a0a1a", "#0a1a16"]
  },
  "title_card": {
    "title": "",
    "subtitle": "",
    "duration_seconds": 2
  },
  "style": {
    "theme": "dark",
    "subtitle_font": "Noto Sans SC",
    "subtitle_size": 44,
    "subtitle_weight": 700,
    "subtitle_position": "bottom",
    "highlight_style": "neon",
    "highlight_color": "#00b498",
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

修改此文件即可更换主播照片、声音、品牌信息、主色调、字幕样式、标题卡、结尾卡时长等。

**标题卡规则**：
- 若 `title_card.title` 为空字符串，系统会自动从文章提取标题（Markdown 取 `# 标题`，纯文本取首行）。
- 若填写了 `title_card.title`，则优先使用配置值。
- `title_card.duration_seconds` 控制标题卡显示时长，默认 2 秒。
- 标题过长时会自动拆分为 `subtitle`。

### 画面布局 `video_layout`

`config/host_profile.json` 中可配置 `video_layout`，切换两种合成模式：

```json
{
  "video_layout": {
    "mode": "portrait-hybrid",
    "hybrid": {
      "mainVisualRatio": 0.58,
      "hostWindowWidth": 560,
      "hostWindowHeight": 640,
      "showSubtitles": true,
      "topicTag": { "enabled": true, "label": "核心解读" },
      "brandBadge": { "enabled": true }
    }
  }
}
```

- `mode`: `"portrait-hybrid"`（竖屏 hybrid：主视觉占上方约 58%，主播窗口在下方，底部大字幕，左上角话题标签）或 `"talking-head"`（经典口播布局：主播大窗口 + 下方 bullets）。
- 默认使用 `portrait-hybrid`，更适合抖音/视频号财经类口播。

### `config/servers.json`

首次运行 `scripts/petect_paths.sh` 会自动生成，包含 IndexTTS 与 MuseTalk 在服务器上的实际路径。无需手动编辑，除非服务器环境发生变化。

---

## 准备素材

1. **主播照片**：放入 `assets/host/me.jpg`
   - 建议 512×512 或以上，正面清晰，背景简洁。
   - MuseTalk 对正面照效果最佳。

2. **参考音频**：放入 `assets/voice/me.m4a`
   - 10-30 秒清晰人声，避免背景音乐和噪声。
   - 格式支持 `.m4a`、`.wav`、`.mp3` 等，具体以 IndexTTS 支持为准。

3. **品牌 Logo**：放入 `assets/logo.png`
   - 建议透明背景 PNG，正方形或接近正方形。

---

## 使用方法

### 1. 准备文章

支持 Markdown（`.md`）或纯文本（`.txt`）。

**Markdown 示例**（`article.md`）：

```markdown
# Q3 效率提升复盘

今年 **Q3** 我们团队效率提升了 *25%*，这是一个巨大的增长。

> 但离职风险依然存在，需要 HR 主动解决。

薪灵AI 的预测模型可以提前识别问题员工，帮助企业把人力数据变成组织决策。

- 预测离职
- 智能定薪
- 组织诊断
```

**纯文本示例**（`article.txt`）：

```text
今年Q3 我们团队效率提升了25%，这是一个巨大的增长。但离职风险依然存在，需要HR主动解决。薪灵AI的预测模型，可以提前识别问题员工，帮助企业把人力数据变成组织决策。
```

### 2. 运行流水线

```bash
bash scripts/pipeline.sh <文章路径> [输出文件名]
```

例如：

```bash
# Markdown 输入
bash scripts/pipeline.sh article.md q3_report

# 纯文本输入
bash scripts/pipeline.sh article.txt q3_report

# 不指定输出名，默认按时间戳命名
bash scripts/pipeline.sh article.md
```

### 3. 查看成片

流水线会同时输出视频与封面图：

```
output/q3_report.mp4
output/q3_report_cover.png
```

- 视频规格：1080×1920、30fps、竖屏。
- 封面图规格：1080×1920 PNG，可直接用作视频号/抖音封面。

**提示**：视频总时长 = 标题卡时长 + 口播音频时长 + 结尾卡时长。

---

## 流水线流程

```
文章 (.md / .txt)
    │
    ▼
[preprocess_article.js] 去除 Markdown 标记，生成口播稿 script.txt
    │
    ▼
[IndexTTS 服务器] 声音克隆 → temp/audio.wav
    │
    ▼
[Whisper 本地] 生成字幕 → temp/subtitles_raw.srt
[align_subtitles.py] 用 script.txt 校准 → temp/subtitles.srt
    │
    ▼
[MuseTalk 服务器] 照片 + 音频 → temp/lip_synced_raw.mp4
[FFmpeg 本地] 统一分辨率帧率 → temp/lip_synced.mp4
    │
    ▼
[Remotion 本地渲染]
  - 标题卡（视频开头 + 封面图）
  - 动态背景（按内容匹配场景色）
  - 人像视频
  - 字幕（关键词高亮，时间已偏移标题卡时长）
  - 下方 bullets
  - 品牌结尾卡
    │
    ▼
output/<name>.mp4
output/<name>_cover.png
```

---

## 自定义与进阶

### 切换视频模板

项目内置两套 Remotion 模板，通过 `config/host_profile.json` 顶层的 `template` 字段切换：

```json
{
  "template": "editorial"
}
```

| 模板 | 用途 | 特点 |
|------|------|------|
| `editorial`（默认） | 财经/商业口播解读 | 左右分栏标题卡、章节进度、观点 bullets |
| `product-launch` | 产品发布/营销 | 产品图标题卡、全屏轮播、数字卡片卖点、动态逐字字幕、CTA 结尾卡 |

切换到 `product-launch` 后，流水线会自动从产品文案中提取：
- `product.slogan`：一句话定位
- `product.cta`：行动号召
- `product.features`：3-5 个核心卖点

你也可以在 `config/host_profile.json` 的 `product` 字段中手动填写，自动提取结果会作为补充/覆盖。

### 修改品牌主色

编辑 `config/host_profile.json` 中的：

```json
"product": {
  "primary_color": "#00b498",
  "secondary_color": "#00d4c8",
  "accent_color": "#00b498"
}
```

主色会同步影响结尾卡、Logo 水印、部分 bullets 边框 glow。

### 修改标题卡

编辑 `config/host_profile.json` 中的：

```json
"title_card": {
  "title": "自定义标题",
  "subtitle": "自定义副标题",
  "duration_seconds": 2
}
```

也可直接修改 `src/components/TitleCard.tsx` 调整布局、字体大小、动画效果。

### 修改结尾卡文案

在 `config/host_profile.json` 的 `product` 字段修改 `brand`、`tagline`、`slogan`、`cta`、`pills`。`product-launch` 模板下，这些字段会优先从文案自动提取并注入 `public/props.json`，你也可以手动覆盖。

### 调整字幕样式

在 `config/host_profile.json` 的 `style` 字段中修改 `subtitle_size`、`subtitle_weight`、`highlight_color` 等。

### 调整 bullets 样式

`src/components/TalkingPoints.tsx` 内置了 4 套 bullets 样式（pill / list / card / outline），按当前字幕文本哈希自动切换。可在此文件中增删样式或调整 `fontSize`。

### 更换场景关键词

`src/utils/keywordMatcher.ts` 中的 `SCENE_STYLES` 定义了 5 种场景及其关键词。可按业务需要增删关键词或调整场景色。

---

## 工程化调用（HTTP API 服务）

除了直接运行 `bash scripts/pipeline.sh`，项目还内置了一个 HTTP API 服务，方便被内容中台、CMS、飞书机器人、钉钉机器人等外部系统以工程化方式调用。

### 启动 API 服务

```bash
npm run api
```

默认监听 `http://localhost:3456`。可通过环境变量调整：

```bash
PORT=8080 MAX_CONCURRENT=2 npm run api
```

- `PORT`：服务端口，默认 3456。
- `MAX_CONCURRENT`：同时运行的 pipeline 数量，默认 1（渲染吃资源，建议保持 1-2）。

### 创建视频生成任务

```bash
curl -X POST http://localhost:3456/api/v1/jobs \
  -F "article=@article.md" \
  -F "outputName=q3_report" \
  -F "config={\"product\":{\"primary_color\":\"#ff6b35\"}}"
```

请求参数（`multipart/form-data`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `article` | File | 是 | Markdown 或纯文本文件 |
| `outputName` | string | 否 | 输出文件名，默认自动生成 |
| `config` | JSON string | 否 | 覆盖 `config/host_profile.json` 的部分字段，支持深度合并 |

返回示例（`202 Accepted`）：

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "outputName": "q3_report",
  "outputs": {
    "video": "/api/v1/jobs/550e.../download/video",
    "cover": "/api/v1/jobs/550e.../download/cover"
  },
  "logs": {
    "stdout": "/api/v1/jobs/550e.../logs/stdout",
    "stderr": "/api/v1/jobs/550e.../logs/stderr"
  }
}
```

### 查询任务状态

```bash
curl http://localhost:3456/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000
```

状态包括：`pending`（排队中）、`running`（运行中）、`completed`（完成）、`failed`（失败）。

### 下载成片与封面

```bash
# 下载 MP4
curl -O -J http://localhost:3456/api/v1/jobs/550e.../download/video

# 下载封面 PNG
curl -O -J http://localhost:3456/api/v1/jobs/550e.../download/cover
```

### 查看日志

```bash
curl http://localhost:3456/api/v1/jobs/550e.../logs/stdout
curl http://localhost:3456/api/v1/jobs/550e.../logs/stderr
```

### 列出任务

```bash
curl "http://localhost:3456/api/v1/jobs?limit=10&offset=0"
```

### 并发控制

API 使用信号量控制同时执行的 pipeline 数量。超过并发上限的任务会进入 `pending` 状态排队，当前任务完成后自动执行。如需提高吞吐，可在多机上部署实例并前置负载均衡，或使用 Redis / 消息队列进一步解耦。

### 容器化部署

项目已提供 `Dockerfile` 与 `docker-compose.yml`，可直接打包为服务镜像：

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f talking-head-api
```

**前置条件**：

1. 容器内需要能通过 SSH 免密登录 `config/servers.json` 中配置的 IndexTTS / MuseTalk 服务器。
2. `docker-compose.yml` 已把宿主机的 `~/.ssh` 挂载到容器的 `/root/.ssh:ro`。
3. 素材（`assets/host/me.jpg`、`assets/voice/me.m4a`、`assets/logo.png`）需提前准备好。

**调用示例**：

```bash
curl -X POST http://localhost:3456/api/v1/jobs \
  -F "article=@article.md" \
  -F "outputName=docker_demo"
```

### 进阶：消息队列化

当前实现为本地内存队列。若需大规模生产部署，建议：

1. 将 `POST /api/v1/jobs` 改为把任务写入 Redis / RabbitMQ / Kafka。
2. 启动独立 worker 消费消息并调用 `api/job-store.js` + `scripts/pipeline.sh`。
3. worker 将进度回写到 Redis，API 层只负责读写任务元数据。

---

## 常见问题

### 1. 首次运行提示服务器未探测

```bash
bash scripts/detect_paths.sh
```

确保本地 SSH 已配置好对服务器的免密登录。

### 2. MuseTalk 服务端报 `save_dir_full` 错误

该报错来自服务器端脚本局部变量，通常不影响最终视频输出。若导致输出异常，请检查服务器上 MuseTalk 的 `results` 目录权限与磁盘空间。

### 3. 字幕仍有错字

检查 `temp/script.txt` 是否已正确生成。`scripts/align_subtitles.py` 会基于原文做字符级对齐；若口播稿本身有错，字幕也会沿用。

### 4. 视频渲染失败

- 确认 `public/` 目录下有 `audio.wav`、`host_video.mp4`、`subtitles.srt`、`props.json`。
- 运行 `npx tsc --noEmit` 检查 TypeScript 错误。
- 确认 Node 版本 ≥ 18。

### 5. 输出视频时长与音频不一致

检查 `config/host_profile.json` 中的 `endcard_duration_seconds`。总时长 = 音频时长 + 结尾卡时长。

---

## 技术栈

- [Remotion](https://www.remotion.dev/) — React 视频渲染
- [IndexTTS](https://github.com/index-tts/index-tts) — 声音克隆
- [MuseTalk](https://github.com/likemuuxi/MuseTalk) — 唇形同步
- [OpenAI Whisper](https://github.com/openai/whisper) — 语音识别
- FFmpeg / ImageMagick — 音视频后处理

---

## License

本项目为内部工具，未经授权请勿对外分发。
