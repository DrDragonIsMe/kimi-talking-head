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
- **场景运动与交叉淡化**：场景画面 Ken Burns 缓推/平移（视频画面自动跳过，避免运动叠加发晃），场景间 fade/wipe/zoom 三种转场确定性轮换。
- **镜头级场景画面**：有分镜时按 storyboard 镜头合并成 6–15s 画面窗口（一句话一换，紧贴讲述内容），LLM 用整段口播 + 镜头描述生成检索词，stock 候选按匹配度重排；无分镜时回退 42s 定长切分。
- **视频 B-roll**：`scene_visuals.media_type` 支持 `video / mixed`（默认 mixed，奇偶交替）；Pexels 库存视频优先检索，搜不到时用 `bl` Seedance 按镜头 visual_prompt 生成 5s 竖屏视频兜底，图片 provider 最后兜底。
- **音频可视化**：底部实时波形条（`visualizeAudio` 驱动，可关闭）。
- **BGM 与音效**：BGM 循环垫底、首尾淡入淡出；hero 时刻自动配入场音效（`assets/sfx/hero.*` 优先，缺失时 ffmpeg 合成兜底）。
- **竖屏分镜布局**：`portrait-hybrid` 模式支持 `default / host-focus / visual-focus / minimal / balanced` 五种预设。
- **动态视觉**：根据内容自动切换场景背景、关键词高亮、章节面包屑、观点 bullets、品牌结尾卡。
- **标题卡 + 封面图**：首帧 2 秒标题卡，同时输出 1080×1920 封面 PNG。
- **断点续跑**：每个阶段写入 `temp/<run>/.pipeline_state.json`，失败后可原地重跑。
- **媒体复用**：只改标题/风格时，可复用已有的 TTS 音频和原始唇形视频，跳过昂贵的 GPU 步骤。
- **多比例输出**：`video_layout.aspect` 支持 `9:16`（默认 1080×1920）/ `16:9`（1920×1080）/ `1:1`（1080×1080 正方形），pipeline 自动选择对应 Remotion composition。
- **多主播**：每个任务可选择 `config/hosts/` 下的主播 profile（照片/音色/品牌文案独立），执行时经 `HOST_PROFILE` 环境变量注入 pipeline。
- **文章质量预检**：建任务与 pipeline `script` 阶段前自动检查文章长度、代码块/表格占比、中文占比，提前拦截不适合口播的输入。
- **成本预估**：Run 前按文章长度与配置估算 LLM token 与各阶段耗时，详情页 Run 按钮旁展示。
- **渐进式预览**：`video_layout.preview.enabled=true` 时 render 阶段先出 0.33 倍低清预览（跳过 BGM/音效），SSE 推送后即可在线播放，成品就绪自动替换。
- **定时任务与外部触发**：任务可绑定 cron 定时调度（node-cron），或通过 `POST /api/v1/trigger/<token>` 由外部系统触发。
- **口播稿版本**：每次保存口播稿自动备份历史版本（`script.v{N}.txt`），可随时只读回溯。
- **场景素材缓存**：Pexels/AI 场景素材（含视频）按 query+类型 哈希全局缓存（`public/scene_visuals/_cache/`，LRU 上限 500 文件/2GB），跨任务去重；下载与本地素材重建两条路径共用。

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
| 生成客户说素材池 | `npm run setup:customer`（或 `bash scripts/setup_customer_assets.sh`） |
| 强制重跑字幕阶段 | `FORCE_SUBTITLES=1 bash scripts/pipeline.sh article.md my_video` |
| 预览 Remotion 组件 | `npm run dev` |
| TypeScript 检查 | `npm run build` |
| 全量测试 / 快速回归 | `npm test` / `npm run test:fast` |
| 启动 Web 管理后台 | `npm run web`（http://localhost:3457） |

---

## Web 管理后台

`npm run web`（等价 `npm run api`）启动管理后台，浏览器打开 http://localhost:3457：

- **任务列表**：状态徽章（draft/queued/running/completed/failed/cancelled）、9 阶段进度条、行内停止/删除；支持按任务名搜索；SSE 实时推送刷新（服务端 watcher 跟踪阶段与日志指纹，运行中进度也实时；断线自动回退 3s 轮询）。
- **新建任务**：粘贴文章或上传 `.md/.txt`，创建草稿后进入详情页调参，确认无误再点 Run 执行（参数在每次执行时才合并生效）；高级配置自动预填上次项目的 overrides（可改）；支持批量模式（多篇文章用单独一行 `---` 分隔，自动编号命名）与配置模板套用；可选主播（下拉数据源为 `config/hosts/` 下的 profile，对应 `hostProfile` 字段）与 cron 定时。创建时自动做文章质量预检，不通过返回 400（`ARTICLE_VALIDATE_MODE=warn` 时降级为警告）。
- **任务详情**：
  - **Run** 全量重跑 / **Rebuild** 仅重渲 render 阶段（零 GPU 零 LLM）/ **重建 v(N+1)** 配置变更后按阶段复用重跑 / **Stop** / **Clone** 克隆变体 / **Delete**（可选同时清理产物）；按钮下方显示执行预估（近 20 次平均耗时，无样本时回退静态文案），Run 按钮旁另显示成本预估（按文章长度与配置估算的 LLM token 与各阶段耗时）。
  - 失败重试：最新版本失败时显示「重试」（断点续跑）与「指定阶段重跑」（`FORCE_<PHASE>=1` 定点重跑）。
  - 版本化运行：每次 run/rebuild 生成新版本（v1=outputName，vN=`<outputName>_vN`），旧版本产物保留；版本 chips 可切换预览/下载历史版本；≥2 个已完成版本时可展开「版本对比」，A/B 并排同步播放与拖动。
  - 阶段复用（没改的不重跑）：按文章与配置 diff 推导最早失效阶段（文章→script、voice→tts、字幕 segmentation→subtitles、scene_visuals→visuals、其它→render），克隆上一版本工作目录后只重跑失效及之后的阶段；阶段步进器每格显示耗时。
  - 口播稿微调：详情页直接编辑最新版本的 `script.txt`，可「从字幕重跑」（微调，不耗 GPU）或「从配音重跑」（改动大，耗 GPU）；每次保存自动备份为 `script.v{N}.txt`，版本下拉可只读查看历史版本。
  - 定时任务：详情页可设置/删除 cron 定时（node-cron 调度，服务重启后自动恢复，任务活跃中跳过本轮），并展示外部触发 URL（`POST /api/v1/trigger/<token>`，token 即凭证、无需 Bearer 鉴权），一键复制。
  - 配置模板：参数面板可「套用模板」（深合并进当前 overrides）、「存为模板」、「删除模板」；模板存于 `api/templates.json`（用户数据，不入 git）。
  - 在线 Preview（支持拖动进度）+ 封面 + 下载；实时日志。开启 `video_layout.preview.enabled` 时，render 阶段早期产出的低清预览（`temp/<run>/preview.mp4`）经 SSE 推送后先行可播，成品就绪自动替换。
  - 分组参数表单（字幕 DNA/字号、画面比例、布局预设/卡片缩放、BGM/音效、标题覆盖），写入任务级 `configOverrides`，与 `config/host_profile.json` 深合并；支持裸 JSON 高级模式。
  - 文章在线编辑。
- **多比例输出**：`video_layout.aspect` 支持三种比例——默认 `9:16` 竖屏（1080×1920）；`16:9` 横屏（1920×1080，`TalkingHeadVideoLandscape`：左场景画面、右竖长主播窗、底部全宽字幕条 + 横屏两栏标题卡）；`1:1` 正方形（1080×1080，`TalkingHeadVideoSquare`）。
- **素材库**（导航「素材库」，`#/assets`）：场景画面按 run 分组缩略图浏览、BGM 在线试听并可一键「应用到当前任务」（写入 `style.bgm`）、主播 profile 展示（新建任务可直接选用）。

> ⚠️ 后台默认无鉴权，仅面向本机使用；要暴露到非本机环境，先设置 `WEB_TOKENS` 启用多用户鉴权（见下）。

### 鉴权与多用户（P2-10，可选）

设置环境变量后重启后台即启用：

```bash
WEB_TOKENS="alice:tokenA,bob:tokenB" npm run web
```

- 所有 `/api/*` 与 `/assets/*` 路由要求 `Authorization: Bearer <token>`（媒体标签与 EventSource 用 `?access_token=` 回退）；`/health` 与静态页面保持公开。
- 任务按用户隔离：他人任务一律 404；模板分用户存储（`api/templates.<user>.json`）。
- 前端自动处理：fetch 自动带 token，401 时弹出令牌输入框（localStorage 持久化）。
- 未设置 `WEB_TOKENS` 时行为与之前完全一致（默认本机开发）。

### Webhook（P2-11）

任务创建（含批量）或 PATCH 时可设置 `webhookUrl`（http(s)，≤2048 字符）。每当一个版本到达终态（completed/failed/cancelled），后台向其 POST JSON `{jobId, outputName, version, status, error, finishedAt}`，最多 3 次尝试（1s/3s 退避，5s 超时）；失败不阻塞任务，最终写入该任务的 stderr 日志。投递状态持久化在版本记录的 `webhookDelivery {status, attempts, lastAttemptAt, lastError}` 字段中：服务重启后会自动恢复未完成的 `pending` 投递，已 `delivered` 的版本不会重复投递。全部端点见根目录 `openapi.yaml`（OpenAPI 3.0，v2.4.0）。

### 多主播切换

`config/hosts/` 下放置额外的主播 profile JSON（结构与 `config/host_profile.json` 相同）。新建任务时选择主播（API 字段 `hostProfile`，仅接受 `config/hosts/` 下已存在的纯 `.json` 文件名）；执行时后端以 `HOST_PROFILE` 绝对路径注入 pipeline。优先级：pipeline 第 3 个位置参数 > `HOST_PROFILE` 环境变量 > `config/host_profile.json`。

#### 内置双系列：CEO说 / 客户说

| 系列 | 配置 | 形象 | 音色 | 角标 |
|------|------|------|------|------|
| CEO说 | `config/host_profile.json`（默认） | `assets/host/me.jpg` + `me.mp4` | IndexTTS 克隆 `assets/voice/me.m4a` | 薪人薪事 CEO |
| 客户说 | `config/hosts/customer_female.json` | AI 合成人物视频池（`assets/host/customers/*.mp4`） | IndexTTS 克隆女声参考池（`assets/voice/customers/*.wav`） | 客户说 · 星*科技 · 李*涵 |

「客户说」每次运行都会**自动随机化**：

- 客户身份：随机姓氏 + 名字 + 职位 + 行业 + 公司名，姓名和公司名做脱敏处理（首尾字符保留，中间用 `*` 代替，如 `李*涵`、`星*科技`），显示在视频角标上。
- 人物形象：从 `assets/host/customers/` 随机挑选一段 640×640 的年轻女性口播模板视频。
- 声音参考：从 `assets/voice/customers/` 随机挑选一段变调女声参考音频，供 IndexTTS 克隆。

随机化逻辑在 `scripts/generate_customer_persona.js` 中实现；pipeline 启动时生成临时 `profile_effective.json`，只覆盖当前运行的形象/音色/角标，不污染原配置。

**调用方法**

1. **CLI**：「客户说」把 profile 作为第 3 个参数传给 pipeline；「CEO说」不传即可（默认配置）。

   ```bash
   # CEO说（默认）
   bash scripts/pipeline.sh article.txt my_run

   # 客户说（每次运行人物/声音/身份都会随机变化）
   bash scripts/pipeline.sh article.txt my_run config/hosts/customer_female.json

   # 等效写法：HOST_PROFILE 环境变量（绝对路径）
   HOST_PROFILE=$PWD/config/hosts/customer_female.json bash scripts/pipeline.sh article.txt my_run
   ```

2. **Web 管理后台**（`npm run api`）：新建任务表单的「主播」下拉选择对应 profile（数据源为 `GET /api/v1/assets` 返回的 `hosts` 列表，即 `config/hosts/` 下的 `.json` 文件）；不选则为 CEO说。

3. **API**：`POST /api/v1/jobs` 传 `hostProfile` 字段（仅接受 `config/hosts/` 下已存在的纯 `.json` 文件名，不是路径）：

   ```bash
   curl -X POST http://localhost:3457/api/v1/jobs \
     -H 'Content-Type: application/json' \
     -d '{"outputName":"my_run","articleText":"...","hostProfile":"customer_female.json","run":true}'
   ```

**注意事项**

- 优先级：pipeline 第 3 个位置参数 > `HOST_PROFILE` 环境变量 > `config/host_profile.json`。
- 两个系列的模板、字幕 DNA、布局、品牌色完全一致，只有形象、音色、角标不同；想改风格（如 DNA、布局）请改对应 profile 里的字段，互不影响。
- 「客户说」的形象/音色均为 AI 合成，无真人肖像权问题，可商用；「CEO说」使用真人素材，注意授权范围。
- `config/hosts/`、`assets/host/customers/`、`assets/voice/customers/`、`assets/host/*.mp4` 已入 `.gitignore`，不会误提交。
- 新增其他主播：复制任一 profile 到 `config/hosts/<名字>.json`，替换 `host.photo_source` / `host.video_source` / `voice.reference_audio` 三处即可，无需改代码；`scripts/lib/validate_config.sh` 会在 pipeline 启动时校验配置合法性。

**客户说素材生成**（新仓库或需要焕新形象/音色时执行一次）

```bash
# 一键生成人物视频池 + 女声参考音频池
bash scripts/setup_customer_assets.sh

# 或分步执行：
bash scripts/generate_customer_avatars.sh   # 12 段 640×640 女性口播模板视频 + 首帧照片
bash scripts/generate_customer_voices.sh  # 6 段变调女声参考音频
```

- `scripts/generate_customer_avatars.sh`：基于 `bl video generate`（`happyhorse-1.1-t2v`）批量生成年轻、漂亮、商务感女性 5s 口播视频，下载后统一缩放到 640×640、去掉音轨，并提取首帧作为照片 fallback。
- `scripts/generate_customer_voices.sh`：基于 `assets/voice/female_ref_jennifer.wav` 用 ffmpeg `asetrate+atempo+aresample` 生成 5 种不同音调的克隆参考音频，加上原始音色共 6 段。
- 生成产物在 `.gitignore` 中排除，不会污染仓库；换电脑时重新执行上述脚本即可获得同等效果。
- 想调整人物风格，修改 `scripts/generate_customer_avatars.sh` 顶部的 `PROMPTS` 数组后重新运行；想调整音色范围，修改 `scripts/generate_customer_voices.sh` 中的 `PITCHES` 数组。

替换素材后无需改配置的其他字段；建议先跑 `PROFILE=config/hosts/customer_female.json bash scripts/tts_index.sh <测试文本> /tmp/out.wav` 验证音色，再跑完整 pipeline。

### 成本预估

`GET /api/v1/jobs/:id` 返回 `costEstimate`（由 `api/versioning.js` 的 `estimateCost(articleText, configOverrides)` 计算）：按文章字数与配置估算 LLM token（口播稿/分镜）与各阶段秒数（TTS/唇形/渲染/总计），前端在 Run 按钮旁展示。仅为启发式估算值，非计费依据。

### 渐进式预览

`video_layout.preview.enabled=true` 时，render 阶段先以 `--scale=0.33` 渲染低清 `temp/<run>/preview.mp4`（跳过 BGM/音效，失败不阻塞正式渲染）；后端 watcher 检测到文件后经 SSE 推 `preview_ready`，前端立即显示预览播放器，成品就绪自动替换。`GET /api/v1/jobs/:id/preview` 提供预览流（支持 Range）。

### 定时任务与外部触发

- `POST /api/v1/jobs/:id/schedule` `{cron}` 设置定时（node-cron 校验，5 或 6 段表达式），`DELETE` 同路径移除；创建任务时也可直接携带 `schedule`。服务启动时自动恢复所有定时，任务活跃中跳过本轮。
- 每个任务创建时自动生成 `triggerToken`；`POST /api/v1/trigger/<token>` 无需 Bearer 鉴权（token 即凭证，路由注册在鉴权中间件之前），命中即发起一次全量 run（活跃中返回 409）。详情页可复制触发 URL。

### GPU 资源池（P2-12，可选）

`config/servers.json` 可新增 `workers` 数组（见 `config/servers.example.json` 注释示例）：TTS 等远程任务按 round-robin + SSH 可达性预检（ConnectTimeout=5）选 worker，跳过不可达者；未配置或全部不可达时回退 primary/backup 单服务器逻辑，行为与之前一致。

### 数据看板（P2-13）

导航「看板」（`#/stats`）：任务/版本/成功率卡片、近 14 天完成/失败条形图、full/rebuild 平均耗时、失败阶段分布（读最新失败版本工作目录的 state 文件，best-effort）。

### HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/jobs` | 创建任务：multipart（`article` 文件）或 JSON `{outputName, articleText, config, run, webhookUrl, hostProfile, schedule}`；`run:false` 存草稿；文章质量预检不通过返回 400（`ARTICLE_VALIDATE_MODE=warn` 降级为警告，`ARTICLE_VALIDATE_SCRIPT` 可覆盖校验脚本路径） |
| `POST` | `/api/v1/jobs/batch` | 批量创建：`{items: [{outputName?, articleText, config?}], run}`；逐条返回 `{ok, job|error}`，单条失败不中断 |
| `GET` | `/api/v1/jobs` | 任务列表（含阶段进度、hasMedia、队列位置） |
| `GET` | `/api/v1/jobs/:id` | 任务详情（含完整阶段状态、configOverrides、文章、versions、configDirty、hostProfile、schedule、triggerToken、costEstimate） |
| `PATCH` | `/api/v1/jobs/:id` | 调整 outputName / configOverrides / 文章（运行中 409） |
| `DELETE` | `/api/v1/jobs/:id` | 删除任务；`?purge=1` 同时清理所有版本的 `temp/` 与 `output/` 产物 |
| `POST` | `/api/v1/jobs/:id/run` | 新建版本全量重跑（pipeline.sh；N>1 时按 diff 复用上一版本未变更阶段；body 可选 `{fromPhase}` 手动指定失效起点） |
| `POST` | `/api/v1/jobs/:id/rebuild` | 新建版本（kind=rebuild）仅重渲 render 阶段，零 GPU 零 LLM（需已有音频+唇形视频） |
| `POST` | `/api/v1/jobs/:id/retry` | 失败重试：同一版本续跑（不产生新版本）；body 可选 `{phase}` 注入 `FORCE_<PHASE>=1` 定点重跑 |
| `POST` | `/api/v1/jobs/:id/stop` | 停止（排队中取消 / 运行中杀进程组） |
| `POST` | `/api/v1/jobs/:id/clone` | 克隆任务（可带新 outputName/config/run） |
| `GET` | `/api/v1/jobs/:id/script` | 读取最新版本的口播稿 `script.txt`（未生成 404）；`?version=N` 读历史备份 `script.v{N}.txt` |
| `PUT` | `/api/v1/jobs/:id/script` | 写回口播稿（运行中 409；纯文本不 sanitize；写入前自动备份旧稿为 `script.v{N}.txt`） |
| `GET` | `/api/v1/jobs/:id/script/versions` | 口播稿历史版本列表 |
| `GET` | `/api/v1/jobs/:id/preview` | 渐进式低清预览流（`temp/<run>/preview.mp4`，支持 Range；未产出 404） |
| `POST` | `/api/v1/jobs/:id/schedule` | 设置 cron 定时 `{cron}`（node-cron 校验，非法 400） |
| `DELETE` | `/api/v1/jobs/:id/schedule` | 移除定时 |
| `POST` | `/api/v1/trigger/:token` | 外部触发一次全量 run（token 即凭证，注册在鉴权中间件之前；任务活跃中 409） |
| `GET` | `/api/v1/jobs/:id/preview/:file` | 在线预览 video/cover（支持 Range 拖动；`?version=N` 指定版本，默认最新 completed 版本） |
| `GET` | `/api/v1/jobs/:id/download/:file` | 下载 video/cover（`?version=N` 同上） |
| `GET` | `/api/v1/jobs/:id/logs/:type` | stdout/stderr 日志流 |
| `GET` | `/api/v1/estimates` | 执行预估：最近 20 个已完成版本按 kind 分组的 `{avgSeconds, samples}` |
| `GET` | `/api/v1/stats` | 数据看板：`{totals, perDay(14d), avgDurationByKind, failureByPhase}`（鉴权开启时按用户隔离） |
| `GET` | `/api/v1/templates` | 配置模板列表（首次读取写入内置模板「知识科普」「发布会风」） |
| `POST` | `/api/v1/templates` | 新建/覆盖模板 `{name, overrides}`（name ≤40 字，按名 upsert） |
| `DELETE` | `/api/v1/templates/:name` | 删除模板 |
| `GET` | `/api/v1/events` | SSE 事件流：job 状态变更推送 `{type:'job', jobId, status, latestVersion}`；低清预览产出推送 `{type:'preview_ready', jobId, runName, preview}`；25s 注释帧保活（`SSE_KEEPALIVE_MS` 可调） |
| `GET` | `/api/v1/assets` | 素材库清单：场景画面（按 run 分组）+ BGM + 主播 profile；文件经 `/assets/scene/*`、`/assets/bgm/*` 静态挂载（containment + 扩展名白名单） |
| `GET` | `/api/v1/config` | 基础配置（脱敏）+ 表单枚举（字幕 DNA/布局预设/素材类型/画面比例）+ `lastJobOverrides`（最近任务的 overrides，供新建预填） |

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
- `video_layout.aspect`：`9:16`（默认 1080×1920）/ `16:9`（1920×1080）/ `1:1`（1080×1080），pipeline 按此选择 composition
- `video_layout.preview.enabled`：渐进式预览开关（默认 `false`），render 阶段先产 0.33 倍低清 `preview.mp4`
- `video_layout.hybrid.preset`：`default | host-focus | visual-focus | minimal | balanced`
- `title_card.title` / `title_card.duration_seconds`
- `content_overlay.subtitles.dna`：字幕 DNA，`classic`（默认整句卡片）/ `loud`（逐词冲击 + hero 全屏）/ `keynote`（发布式揭示 + hero wipe-up）/ `cream`（暖奶油诗意）/ `editorial`（杂志衬线）/ `documentary`（纪实庄重）。hero 关键词全屏时刻由 `HeroOverlay` 统一渲染，任意 DNA 下都会与入场音效同步出现
- `style.bgm` / `style.bgm_volume`：BGM 路径与音量（默认 0.12，置 0 关闭）
- `style.sfx_enabled` / `style.sfx_volume`：hero 入场音效开关与音量
- `scene_visuals.media_type`：场景素材类型，`image` / `video`（全视频 B-roll）/ `mixed`（默认，奇偶交替）；视频窗口按 `pexels_video → seedance_video → 图片链` 兜底
- `scene_visuals.seedance.*`：生成式视频配置。`backend`：`bl`（默认，百炼 `bl video generate`，720P/1080P）/ `ark`（火山方舟 Seedance 直连 API，模型 `ark_model` 默认 `doubao-seedance-1-0-pro-fast-251015`，`ark_resolution` 默认 `480p`，API key 读 `.env` 的 `ARK_API_KEY`）；`enabled=false` 时跳过生成式视频
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
| 全部离线套件 + 类型检查 | `npm test`（19 套件 + `tsc`，含字幕/同步/关键词/标题/卡拉OK/音频/场景运动/布局/hero/版本化/DNA/字幕校验/文章预检/素材缓存/API/状态机/DNA 配置校验/远程任务/组合守卫/TS 类型检查） |
| 快速回归（跳过 API 集成与 tsc） | `npm run test:fast`（18 套件） |
| 视觉回归（SSIM 像素对比） | `npm run test:visual` |
| 有意变更模板后重落基线 | `UPDATE_BASELINE=1 npm run test:visual` |
| 单独跑某个套件 | `node scripts/test_karaoke_words.js` 等 |

测试套件一览：

| 文件 | 覆盖范围 |
|------|---------|
| `test_subtitle_parsing.js` | SRT 解析、分段、校验（含词级时间戳） |
| `test_sync_timing.js` | 时间解析、偏移、同步校验、帧时间转换 |
| `test_keyword_matcher.js` | 场景风格匹配、关键词提取、字幕格式化 |
| `test_extract_title.js` | 标题提取、分句边界拆分 |
| `test_karaoke_words.js` | 词级对齐、hero 定位、sanitize |
| `test_audio_pipeline.js` | SFX 合成、BGM 配置、素材校验 |
| `test_scene_motion.js` | 场景窗口、Ken Burns 运动、转场轮换 |
| `test_overlay_layout.js` | 布局预设、序列轮换、holdCues |
| `test_hero_state.js` | hero 入场/驻留/退场时间轴 |
| `test_versioning.js` | hash、stableStringify、失效阶段推导、工作目录复用、耗时聚合 |
| `test_caption_dna.js` | 六套 DNA 文件完整性、字段校验、sanitizeOutputName |
| `test_validate_subtitles.js` | `validate_subtitles.js` CLI 直测（退出码、stderr、词级时间戳校验） |
| `test_validate_article.js` | 文章质量预检（长度/代码块/表格/中文占比，stub 脚本注入） |
| `test_scene_visuals_cache.js` | 场景素材缓存（hash 命中、符号链接、LRU 清理） |
| `test_scene_visuals_windows.js` | 镜头级画面窗口（分镜合并 6–15s、42s 回退）、stock 候选重排、缓存 key |
| `test_api_server.js` | 完整 API 集成测试（CRUD/run/rebuild/retry/版本化/鉴权/webhook/SSE 保活/多主播/文章预检/定时与 trigger/口播稿版本/预览） |
| `test_pipeline_state.sh` | 流水线状态机（init/get/set/mark/并发/容错） |
| `test_validate_config.sh` | DNA id 合法性预检（有效放行、无效报错退出） |
| `test_remote_job.sh` | 远端任务（SSH/SCP/提交/轮询/熔断/worker 池/数字 banner 干扰下的 PID 提取） |
| `test_compositions.js` | Remotion 组合注册守卫（竖屏/横屏/正方形尺寸） |
| `tsc --noEmit` | TypeScript 类型检查 |

渲染指定视频（高级）：

```bash
npx remotion render src/index.tsx TalkingHeadVideo \
  --props public/props.json \
  --duration-in-frames 7034 \
  output/manual.mp4
```
