# 产品升级路线图（P0 / P1 / P2）

> 维护方式：每完成一项就在对应条目后标记 ✅ 并注明实现位置。本文件与 `README.md`、`AGENTS.md` 同步更新。

## P0 — 体验闭环

### P0-1 失败阶段重试 ✅（本轮实施，已落地）
- 痛点：pipeline 任一阶段失败（GPU 断连/LLM 超时），Web 上只能整体重跑。
- 方案：`POST /api/v1/jobs/:id/retry`（body 可选 `{phase}`）。默认在同一版本上续跑（state 机自动跳过 completed 阶段）；指定 phase 时注入 `FORCE_<PHASE>=1` 定点重跑。前端在 failed 状态显示「重试」按钮 + 阶段下拉。
- 依据：`scripts/pipeline.sh` 原生支持 `FORCE_SCRIPT/TTS/WHISPER/SUBTITLES/STORYBOARD/VISUALS/LIPSYNC/POSTPROCESS/RENDER`。
- 实现：`api/server.js`（`retryJob` + `/retry` 路由，版本记录带 `forcePhase`，`runPipeline` 注入 env）、`api/public/app.js`（失败时操作条出现重试行）。测试：`scripts/test_api_server.js` + `scripts/fixtures/stub_pipeline_fail.sh`。

### P0-2 成本与耗时可见 ✅（本轮实施，已落地）
- 痛点：用户不知道一次 Run 要多久、耗不耗 GPU。
- 方案：
  - 阶段步进器每格显示耗时（`.pipeline_state.json` 的 started_at/completed_at 差值，运行中显示进行时长）。
  - `GET /api/v1/estimates`：聚合最近 20 个已完成版本，按 kind(full/rebuild) 输出平均耗时与样本数；前端在 Run/重建按钮处展示"预计 ~X 分钟（近 Y 次平均）"，无样本时回退静态文案并标注 Rebuild 不耗 GPU。
- 实现：`api/versioning.js`（`aggregateEstimates`）、`api/server.js`（`/estimates` 路由）、`api/public/app.js`（`fmtSecs`/`fmtEstimate`，操作条预估文案 + 步进器耗时）。

### P0-3 Rebuild 瘦身：纯样式修改只重渲 ✅（本轮实施，已落地）
- 痛点：`render_with_reused_media.sh` 每次都重跑 storyboard（LLM）与场景检索，样式迭代 ~8min 且白烧 LLM。
- 方案：`/rebuild` 统一进版本化复用机制（`api/versioning.js`），强制 invalidation=`render`：克隆上一版工作目录，script→postprocess 全部保持 completed，pipeline 断点续跑只执行 render 阶段。效果：零 GPU、零 LLM，样式迭代 ~5min。
- 兼容：CLI 脚本 `render_with_reused_media.sh` 保留给命令行用户；server 的 `REBUILD_SCRIPT` 钩子移除。
- 实现：`api/server.js`（`queueJob` 对 kind=rebuild 固定 invalidation=render，`runPipeline` 统一 PIPELINE_SCRIPT）。测试断言 v(N+1) workdir 的 storyboard 保持 completed 且 storyboard.json 与上一版字节一致（无 LLM 重生成）。

### P0-4 口播稿微调快速重渲 ✅（本轮实施，已落地）
- 痛点：成片错一个词只能改文章全量重跑。
- 方案：
  - `GET/PUT /api/v1/jobs/:id/script` 读写最近版本 `temp/<runName>/script.txt`（非运行态；GET 未生成 404，PUT 不存在则创建）。
  - `/run` body 新增 `fromPhase`（覆盖自动 invalidation）：微调选 `subtitles`（旧音频 + 新稿重新对齐，match<65% 时 align 护栏失败）；改动大选 `tts`（重配音，耗 GPU）。版本 configSnapshot 记录 `{scriptEdited, fromPhase}`（configDirty 对比时剔除这两个元信息键）。
  - 前端详情页新增「口播稿」编辑区，保存后引导两个重跑入口。
- 实现：`api/server.js`（script GET/PUT 路由 + `queueJob({fromPhase})`）、`api/public/app.js`（口播稿 panel）。

## P1 — 效率与规模化

### P1-5 批量导入 + 配置模板 ✅（本轮实施，已落地）
- 批量：新建页支持多篇文章（多次粘贴/多文件）→ 批量建 draft；列表提供"全部运行"，队列串行执行（信号量现成）。
- 模板：`api/templates.json`（或 `config/templates/`）存命名预设（如「知识科普」= dna loud + chapterCardScale 1.5 + bgm 0.08）；新建页/详情页一键套用 = 写入 configOverrides。API：`GET/POST/DELETE /api/v1/templates`。
- 实现：`POST /api/v1/jobs/batch`（逐条校验、`{ok, job|error}` 逐项返回、run:true 经信号量串行）；模板存于 `api/templates.json`（已入 .gitignore，首次读取写入「知识科普」/「发布会风」两个内置模板，name ≤40 字按名 upsert）；前端 `#/new` 批量模式（`---` 分隔、自动编号）+ 模板下拉（深合并填入 JSON），详情参数面板「套用模板/存为模板/删除模板」。

### P1-6 多比例输出 ✅（本轮实施，已落地）
- Remotion 增加 16:9 composition（1920×1080，hybrid 布局横屏变体），`video_layout.aspect`（`9:16` 默认 | `16:9`）进 configOverrides 表单；渲染阶段按参数选 composition。封面同理。
- 工作量集中在 `src/index.tsx` 注册 + `PortraitHybridLayout` 横屏适配 + pipeline `TOTAL_FRAMES`/分辨率参数透传。
- 实现：`src/index.tsx`（`TalkingHeadVideoLandscape` 1920×1080，与竖屏共用根组件/默认 props/时长推导）；`PortraitHybridLayout` 横屏分支（左场景列 + FallingChapterCards、右竖长主播窗、底部全宽字幕条）；`TitleCard` 横屏两栏变体（左文案右主播）；`Subtitles` 增加 `cardWidth`/`cardMarginBottom`（竖屏默认值不变）；`scripts/pipeline.sh` 按 profile `video_layout.aspect` 选 composition 并把 aspect 注入 props（render 与 cover still 同走）；`/api/v1/config` 枚举 `aspects` + 详情参数表单「画面比例」；`scripts/test_compositions.js` 挂入 `npm test` 守卫两个 composition 的尺寸注册。竖屏基线 byte-identical（test:visual 验证）。

### P1-7 SSE 实时推送 ✅（本轮实施，已落地）
- server 增加 `GET /api/v1/events`（SSE）：job 状态变更、版本完成、日志行追加时推送；前端用 EventSource 替换 3s 轮询，断线回退轮询。
- 实现：`api/events.js`（subscribe/publish/closeAll，25s 保活帧）；server 在 `updateJobAndLatestVersion`（status 变更时）、`queueJob`/`retryJob`/草稿创建处发布 `{type:'job', jobId, status, latestVersion}`；前端 EventSource 全局单连接、消息 500ms 防抖触发当前视图重拉，onerror 回退 3s 轮询并 10s 后重连。日志行追加推送未做（前端日志仍按需拉取）。

### P1-8 素材库 ✅（本轮实施，已落地）
- 页面：`public/scene_visuals/` 已用素材浏览、`assets/bgm` 试听、多主播 profile（`config/hosts/*.json`）切换——任务级 overrides 指向不同 host profile 合并。
- 实现：`GET /api/v1/assets`（场景画面按 run 分组、每个 run 最多 12 个媒体、BGM 列表、`config/hosts/*.json` 缺失时回退单个「默认主播」条目）+ `/assets/scene/*`、`/assets/bgm/*` 静态挂载（resolve containment + 图片/视频/音频扩展名白名单）；前端 `#/assets` 页（缩略图、`<audio>` 试听、「应用到当前任务」= 深合并 `style.bgm` 后 PATCH configOverrides，顶栏新增「素材库」导航）。范围裁剪：多主播切换逻辑未做（P2，仅只读展示）。

### P1-9 版本对比 ✅（本轮实施，已落地）
- 详情页选两个版本并排 `<video>` 同步播放 + 关键帧缩略图条；数据全有，纯前端。
- 实现：`api/public/app.js` 详情页「版本对比」面板（≥2 个已完成版本才显示），A/B 下拉（默认最近两个已完成版本）、并排 `<video controls muted>`（`preview?version=N`）、「同步播放/暂停」、拖动滑条（A 为基准，timeupdate 漂移 >0.3s 对齐 B）。关键帧缩略图条未做（用滑条代替）。

## P2 — 平台化

### P2-10 鉴权与多用户 ✅（本轮实施，已落地）
- token 鉴权（`WEB_TOKEN` 环境变量，Express 中间件校验 Authorization header）；任务/产物按用户目录隔离（`api/jobs/<user>/<uuid>`）。是暴露非本机访问的前提。
- 实现：`api/server.js` 的 `authMiddleware`（`WEB_TOKENS="alice:tokenA,bob:tokenB"` 启用；Bearer + `?access_token=` 回退；`/health` 与静态页公开），job state 增 `owner`（创建时写入），全部 job 路由 + 列表/config/estimates/stats 按 owner 隔离（他人 404），模板按用户分文件 `api/templates.<user>.json`（鉴权关闭时仍用全局 `api/templates.json`），SSE 事件按 owner 过滤；前端令牌框（localStorage 持久化、401 自动弹出、fetch 自动带 Authorization，媒体/EventSource 用 `?access_token=`）。范围裁剪：按 owner 字段隔离而非按用户目录隔离（api/jobs 结构不变），未做用户管理/登录页/角色权限。

### P2-11 Webhook + OpenAPI ✅（本轮实施，已落地）
- 版本终态（completed/failed）时 POST 回调（job 级 `webhookUrl` 字段，重试 3 次）；补 OpenAPI yaml（端点已稳定）。
- 实现：job state 增 `webhookUrl`（create/batch/PATCH 可设置，http(s) ≤2048 校验，null 清除）；`updateJobAndLatestVersion` 在版本到达终态（completed/failed/cancelled）时 fire-and-forget 投递 `{jobId, outputName, version, status, error, finishedAt}`（http/https 原生模块，5s 超时，1s/3s 退避共 3 次，`(jobId,version,status)` 去重，失败写 job stderr 日志）；`openapi.yaml`（OpenAPI 3.0，覆盖全部端点 + bearerAuth）。范围裁剪：终态含 cancelled（比计划多一类，语义更完整）；无 webhook 签名/密钥。

### P2-12 GPU 资源池 ✅（本轮实施，已落地）
- `servers.json` 改为 worker 列表（多 GPU 机注册、健康检查），`remote_job.sh` 调度按队列分发；server 侧 MAX_CONCURRENT 按"本地 render 并发 + 远程 GPU 并发"拆分。
- 实现：`scripts/lib/remote_job.sh` 新增 `remote_job_select_worker`（`workers[]` 可选数组；round-robin 游标持久化在 `REMOTE_JOB_RR_STATE`，`ssh -o ConnectTimeout=5 <worker> true` 预检跳过不可达者，无配置/全挂回退 primary 并打日志）；`scripts/tts_index.sh` 的 `pick_tts_server` 优先走 worker 池（选中条目的 tts_path/tts_workspace/tts_python_env 生效，缺 remote_worker.py 回退旧逻辑）；`config/servers.example.json` 加注释示例；`scripts/test_remote_job.sh` 加 8 个 mock 用例。范围裁剪（保守/向后兼容）：`workers` 与原 primary/backup 并存而非替代；只有 tts_index.sh 接入选池（infinitetalk/musetalk/upload_to_server.sh 保持旧逻辑，后续按需同样接入）；MAX_CONCURRENT 拆分未做（本地串行足够）。

### P2-13 数据看板 ✅（本轮实施，已落地）
- 聚合 `api/jobs/*/state.json`：日产出、成功率、平均耗时、失败阶段分布，新页面 `#/stats`（只读，无需新存储）。
- 实现：`GET /api/v1/stats`（totals + 成功率、perDay 近 14 天完成/失败、avgDurationByKind、failureByPhase——读最新失败版本 workdir 的 `.pipeline_state.json` 里 failed 阶段，best-effort；鉴权开启时按 owner 隔离）；前端 `#/stats` 页（卡片 + 纯 CSS 条形图，导航「看板」）。

## 实施顺序

1. ~~**本轮**：P0-1 → P0-3 → P0-4 → P0-2（含测试与文档）~~ 已完成
2. ~~P1-5 → P1-7 → P1-9 → P1-6 → P1-8~~ 已完成（P1 全部落地）
3. ~~P2-10 → P2-11 → P2-12 → P2-13~~ 已完成（P2 全部落地，ROADMAP 收官）
