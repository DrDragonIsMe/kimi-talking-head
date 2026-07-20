# kimi-talking-head 升级建议

> 基于源码全面审查与测试覆盖分析，按架构/测试/性能/可靠性/功能五个维度组织。
> 每条建议包含：问题描述、当前状态、建议方案、实施步骤、影响范围、预估工作量。

---

## 执行状态（2026-07-20 更新）

全部 20 项已于 2026-07-20 完成实施，`npm test` 全量通过。关键实现位置：

| 编号 | 状态 | 关键实现位置 |
|------|------|------------|
| 1 | ✅ 完成 | `scripts/lib/subtitle_segmentation.js`（+ 同级 `.d.ts`）；`scripts/parse_srt.js` / `src/hooks/useSubtitles.ts` / `src/utils/keywordMatcher.ts` 均改为引用，`findSplitIndex` 统一为增强版 |
| 2 | ✅ 完成 | `src/utils/keywordMatcher.ts`（`normalizeTriggerText` 改显式 Unicode 码点列表，新增覆盖 「」＂＇‹›«»） |
| 3 | ✅ 完成 | `tsconfig.json`（启用 `noUnusedLocals` + `noUnusedParameters`）、`src/index.tsx`（清理死 props） |
| 4 | ✅ 完成 | `scripts/test_validate_subtitles.js`（已接入 `npm test` 与 `test:fast`） |
| 5 | ✅ 完成 | `api/events.js`（`SSE_KEEPALIVE_MS` 可覆盖，默认 25000）、`scripts/test_api_server.js`（保活帧用例） |
| 6 | ✅ 完成 | `scripts/test_remote_job.sh`（数字 banner 干扰用例；现有 `tail -n 1` 逻辑被证明健壮，`scripts/lib/remote_job.sh` 未改） |
| 7 | ✅ 完成 | `api/job-store.js`（`listJobs`/`getJob` 内存缓存，mtime 校验失效） |
| 8 | ✅ 完成 | `api/server.js`（`readPipelineState` 按 `(mtimeMs,size)` 指纹缓存） |
| 9 | ✅ 完成 | `package.json`（`test:fast`，跳过 `test_api_server.js` 与 `tsc`） |
| 10 | ✅ 完成 | `api/versioning.js`（`prepareReuseWorkdir` 改用 `fs.cpSync`，移除 `cp -cR`/`cp -R` 回退） |
| 11 | ✅ 完成 | `api/server.js` / `api/job-store.js`（版本记录 `webhookDelivery {status,attempts,lastAttemptAt,lastError}`，启动恢复 pending 投递并防重复） |
| 12 | ✅ 完成 | `scripts/lib/validate_config.sh`（pipeline pre-flight 校验 DNA id，无效报错退出） |
| 13 | ✅ 完成 | `api/server.js`（`hostProfile` 校验 + `HOST_PROFILE` 注入）、`api/job-store.js`、`scripts/pipeline.sh`（位置参数 > `HOST_PROFILE` > 默认 profile）、`api/public/`（主播下拉） |
| 14 | ✅ 完成 | `scripts/validate_article.js`（退出码 + stdout JSON）；pipeline 默认警告（`STRICT_ARTICLE_CHECK=1` 阻断）；`POST /api/v1/jobs` 400 拒绝（`ARTICLE_VALIDATE_MODE=warn` 降级，`ARTICLE_VALIDATE_SCRIPT` 覆盖脚本路径） |
| 15 | ✅ 完成 | `api/versioning.js`（`estimateCost`）、`GET /api/v1/jobs/:id` 返回 `costEstimate`、前端 Run 按钮旁展示 |
| 16 | ✅ 完成 | `scripts/pipeline.sh`（`--scale=0.33` → `temp/<run>/preview.mp4`，跳过 BGM/音效）、SSE `preview_ready`、`GET /api/v1/jobs/:id/preview`（Range）、前端预览播放器自动替换 |
| 17 | ✅ 完成 | 新增依赖 `node-cron`；`POST/DELETE /api/v1/jobs/:id/schedule`、`POST /api/v1/trigger/:token`（token 即凭证，注册在鉴权中间件之前）；启动恢复所有 schedule；前端定时任务管理 UI |
| 18 | ✅ 完成 | `scripts/build_scene_visuals_from_existing.js`（query/prompt sha1 → `public/scene_visuals/_cache/`，命中建符号链接，LRU 500 文件/2GB，`SCENE_VISUALS_CACHE_DIR` 可覆盖）、`.gitignore` |
| 19 | ✅ 完成 | `PUT script` 自动备份 `script.v{N}.txt`；`GET /api/v1/jobs/:id/script/versions`、`GET /api/v1/jobs/:id/script?version=N`；前端版本下拉（历史只读） |
| 20 | ✅ 完成 | `src/index.tsx` 注册 `TalkingHeadVideoSquare`（1080×1080）；`PortraitHybridLayout`/`TitleCard` 正方形分支；`/api/v1/config` aspects 加 `1:1`；pipeline 按 aspect 映射 composition |

> 与原文方案的偏差：
> - 第 1 项共享模块落在 `scripts/lib/subtitle_segmentation.js`（纯 JS + 同级 `.d.ts`）而非 `src/utils/subtitleSegmentation.ts`，以便 Node 脚本直接 `require`、TS 侧直接 `import`。
> - 第 6 项测试证明现有 `grep -oE '^[0-9]+$' | tail -n 1` 提取逻辑在数字 banner 干扰下已健壮，`remote_job.sh` 无需加固。
> - 第 20 项仅落地 1:1 正方形格式；原文提到的平台特定编码参数（crf/h265）未实施。

---

## 一、架构层面

### 1. 字幕分段逻辑三份实现需统一

**问题**：`parse_srt.js`、`useSubtitles.ts`、`keywordMatcher.ts` 各自内联了 `findSplitIndex` / `splitLongUnit` / `tokenizeCueText` 等函数，但实现细节不一致：

| 文件 | `findSplitIndex` 版本 | 差异 |
|------|----------------------|------|
| `parse_srt.js` | 简化版 | 无 `lastPreferredBreakWidth` 预算检查，无悬挂标点处理 |
| `useSubtitles.ts` | 简化版 | 同上 |
| `keywordMatcher.ts` | 增强版 | 有预算检查 + 悬挂标点容差（`cut` 循环最多合并 2 个标点） |

**后果**：同一段文字在解析 SRT（`parse_srt.js`）和格式化字幕卡片（`keywordMatcher.ts` 的 `formatSubtitleLines`）时会出现不同的断行结果，导致字幕卡片溢出或留白不一致。

**方案**：提取到 `src/utils/subtitleSegmentation.ts`（纯函数，无副作用），三处删除内联实现改为 import。

**实施步骤**：
1. 在 `src/utils/` 下新建 `subtitleSegmentation.ts`，以 `keywordMatcher.ts` 的增强版实现为基准，导出 `findSplitIndex`、`splitLongUnit`、`tokenizeCueText`、`groupUnits`、`segmentCue`、`getCharVisualWidth`、`getVisualLength`、`normalizeSubtitleText`、`isMeaningfulUnit`、`splitByDelimiters`
2. 更新 `useSubtitles.ts` 改为从新模块 import，删除内联函数
3. 更新 `parse_srt.js` 改为 `require` 新模块（需确认 Node.js 可直接 require 该 TS 编译产物或改用 JS 版本）
4. 更新 `keywordMatcher.ts` 删除内联的 `splitByDelimiters`、`getCharVisualWidth`、`getVisualLength`、`findSplitIndex`、`forceWrapLines` 等函数，改为 import
5. 更新 `test_subtitle_parsing.js` 和 `test_sync_timing.js` 的内联函数，改为引用新模块
6. 运行 `npm test` 确认全部通过

**影响**：`parse_srt.js`、`useSubtitles.ts`、`keywordMatcher.ts`、`test_subtitle_parsing.js`、`test_sync_timing.js`

**工作量**：中（~3h）

---

### 2. `normalizeTriggerText` 正则表达式需加固

**问题**：`keywordMatcher.ts:96` 的正则 `[\s""''"'"'""]` 混合了多种 Unicode 引号变体，肉眼难以审计是否遗漏了某个字符。如果 LLM 输出含有 `‹›«»` 等不在此列表中的引号，匹配会静默失败。

**方案**：改用显式列表 + 注释说明每个字符的来源。

**实施步骤**：
1. 将当前正则中的字符逐一分解为 Unicode 码点列表：
   - `\s` — 空白符
   - `\u201C` (`"`) — 左双引号
   - `\u201D` (`"`) — 右双引号
   - `\u2018` (`'`) — 左单引号
   - `\u2019` (`'`) — 右单引号
   - `\u300C` (`"`) — 日文/中文左书名号
   - `\u300D` (`"`) — 日文/中文右书名号
   - `\uFF02` (`"`) — 全角双引号
   - `\uFF07` (`'`) — 全角单引号
2. 在代码中添加注释说明每个字符的 Unicode 名称和来源
3. 如果需要更彻底的方案，改用 `String.prototype.normalize('NFKD')` 将全角字符转为半角后再处理
4. 在 `test_keyword_matcher.js` 中增加 Unicode 引号变体的测试用例（`‹›«»` 等边缘字符）

**影响**：`keywordMatcher.ts`、`test_keyword_matcher.js`

**工作量**：小（~1h）

---

### 3. Remotion 组件 Props 未使用字段需清理

**问题**：`TalkingHeadClassicLayout` 接收了 `chapters`、`primaryColor`、`secondaryColor` 等 props 但在解构时丢弃（`src/index.tsx:432-440`）。TypeScript 不报错是因为 `React.FC` 允许多余 props，但这是运行时死代码。

**方案**：启用 `noUnusedParameters` 并在 `tsconfig.json` 中设为 `true`，或手动清理未使用的 props。

**实施步骤**：
1. 在 `tsconfig.json` 中设置 `"noUnusedLocals": true` 和 `"noUnusedParameters": true`
2. 运行 `npx tsc --noEmit` 获取所有未使用变量的列表
3. 逐个修复：删除未使用的 props 或添加 `_` 前缀标记有意保留
4. 对于 `TalkingHeadClassicLayout`，删除 `chapters`、`primaryColor`、`secondaryColor` 参数
5. 确认 `npm test` 全部通过

**影响**：`tsconfig.json`、`src/index.tsx`、可能涉及其他组件

**工作量**：中（~2h）

---

## 二、测试覆盖

### 4. 缺少 `validate_subtitles.js` 的直接测试

**问题**：`test_subtitle_parsing.js` 和 `test_sync_timing.js` 各有一份内联的 `validateSubtitles` 拷贝。真正的 `scripts/validate_subtitles.js` 作为独立 CLI 脚本，从未被直接测试过，内联版本可能与其 CLI 行为不一致。

**方案**：新增 `test_validate_subtitles.js`，通过子进程调用 `scripts/validate_subtitles.js` 并验证退出码和 stderr 输出。

**实施步骤**：
1. 新建 `scripts/test_validate_subtitles.js`
2. 测试用例：
   - 合法字幕 JSON → 退出码 0
   - 非法字幕（空数组、非数组、end<=start）→ 退出码 1
   - 词级时间戳非法（回退、越界）→ 退出码 1
   - 文件不存在 → 退出码 1
3. 加入 `package.json` 的 `npm test` 链路
4. 运行确认全部通过

**影响**：新增 1 个测试文件，`package.json`

**工作量**：小（~1h）

---

### 5. SSE 保活帧未测试

**问题**：`api/events.js` 的 `setInterval` 每 25 秒发送 `: ka\n\n` 注释帧保活。当前测试只验证了连接建立和数据推送，没有验证保活帧的发送。

**方案**：在 `test_api_server.js` 中增加 SSE 保活帧测试。

**实施步骤**：
1. 在 `test_api_server.js` 的 SSE 测试部分增加一个测试用例
2. 连接 SSE 端点，等待 30 秒（超过 25 秒保活间隔）
3. 验证收到的数据中包含 `ka` 注释帧
4. 注意：`PROGRESS_WATCH_MS` 默认为 3 秒，可能在保活期间触发进度事件，需要区分保活帧和进度帧

**影响**：`test_api_server.js`

**工作量**：小（~0.5h）

---

### 6. `remote_job.sh` 的 PID 解析边界测试

**问题**：`remote_job_submit` 使用 `grep -oE '^[0-9]+$' | tail -n 1` 提取 PID。如果远端 shell 启动时打印了包含数字的 banner（如 "Starting 2 services..."），`tail -n 1` 可能取到错误的数字行。

**方案**：在 `test_remote_job.sh` 中增加多数字行干扰的 mock 测试。

**实施步骤**：
1. 修改 `test_remote_job.sh` 中的 fake `ssh` stub，增加一个模式：`cat` 命令返回多行数字（模拟 banner 干扰）
2. 添加测试用例：`test_pid_extraction_with_noisy_banner`
3. 验证 `remote_job_submit` 提取的 PID 是真正的 PID（4242），而非 banner 中的数字

**影响**：`test_remote_job.sh`、`scripts/lib/remote_job.sh`（可能需要加固）

**工作量**：小（~1h）

---

## 三、性能与资源

### 7. `listJobs` 每次全量扫描目录

**问题**：`api/job-store.js` 的 `listJobs` 每次调用都 `readdirSync` + 逐个 `readFileSync` 读取所有 job 的 `state.json`。任务数超过 200 后，列表接口响应会线性变慢。

**方案**：引入内存缓存 + 文件变更监听。

**实施步骤**：
1. 在 `job-store.js` 中增加 `Map<string, { job: object, mtime: number }>` 缓存
2. `createJob`/`updateJob`/`deleteJob` 时同步更新缓存
3. `listJobs` 优先从缓存读取，仅在缓存未命中时回退文件读取
4. 可选：使用 `fs.watch` 监听 `api/jobs/` 目录变更，自动刷新缓存
5. 注意：`listJobs` 的排序逻辑（按 `createdAt` 降序）需要在缓存层面维护

**影响**：`api/job-store.js`

**工作量**：中（~2h）

---

### 8. `readPipelineState` 没有缓存

**问题**：SSE 进度轮询（`PROGRESS_WATCH_MS` 默认 3s）每次调用 `readPipelineState` 都重新读取并解析 JSON。活跃任务多时磁盘 I/O 压力大。

**方案**：在 `progressFingerprints` 旁边缓存解析后的 state 对象。

**实施步骤**：
1. 在 `api/server.js` 中增加 `Map<jobId, { state, fingerprint }>` 缓存
2. `watchProgress` 先计算指纹，仅在指纹变化时调用 `readPipelineState` 并更新缓存
3. `GET /api/v1/jobs/:id` 详情接口也可复用此缓存

**影响**：`api/server.js`

**工作量**：小（~1h）

---

### 9. `npm test` 串行链路需拆分

**问题**：16 个套件串行执行，API 测试需启动真实服务器，整个链路耗时约 30-60 秒。中间套件失败后，后面套件不执行。

**方案**：增加 `npm run test:fast` 只跑纯函数测试（跳过 API 集成测试和 TypeScript 检查）。

**实施步骤**：
1. 在 `package.json` 中新增 `test:fast` 脚本：
   ```
   "test:fast": "node scripts/test_subtitle_parsing.js && node scripts/test_sync_timing.js && node scripts/test_keyword_matcher.js && node scripts/test_extract_title.js && node scripts/test_karaoke_words.js && node scripts/test_audio_pipeline.js && node scripts/test_scene_motion.js && node scripts/test_overlay_layout.js && node scripts/test_hero_state.js && node scripts/test_versioning.js && node scripts/test_caption_dna.js && bash scripts/test_pipeline_state.sh && bash scripts/test_remote_job.sh && node scripts/test_compositions.js"
   ```
2. 默认 `npm test` 保留完整链路
3. 更新 `README.md` 和 `RELIABILITY.md` 文档

**影响**：`package.json`、`README.md`

**工作量**：小（~0.5h）

---

## 四、可靠性与容错

### 10. `prepareReuseWorkdir` 的 `cp -cR` 平台兼容性

**问题**：`api/versioning.js:103` 使用 `cp -cR`（APFS clonefile），在 Linux 或旧版 macOS 上失败后回退到 `cp -R`。但回退路径的 `cp -R` 没有保留 `src/.` 语法，可能导致复制整个目录而非目录内容。

**方案**：改用 Node.js 原生 `fs.cpSync`（Node 16.7+）。

**实施步骤**：
1. 检查当前 Node.js 版本是否 ≥ 16.7（`package.json` 要求 Node ≥ 18，满足条件）
2. 将 `execFileSync('cp', ...)` 替换为 `fs.cpSync(src, dst, { recursive: true, dereference: true })`
3. 移除 try/catch 回退逻辑
4. 运行 `npm test` 确认 `test_versioning.js` 中的 `prepareReuseWorkdir` 测试通过

**影响**：`api/versioning.js`

**工作量**：小（~0.5h）

---

### 11. Webhook 投递在进程退出时丢失

**问题**：`retryOrFailWebhook` 使用 `setTimeout` 调度重试，`timer.unref()` 确保不阻塞进程退出。但如果进程在重试间隔内被 SIGTERM 杀掉，未完成的 webhook 投递永久丢失。

**方案**：将 webhook 投递状态持久化到 job state 的版本记录中，进程启动时扫描未完成的投递。

**实施步骤**：
1. 在版本记录中增加 `webhookDelivery` 字段：
   ```json
   {
     "webhookDelivery": {
       "status": "pending" | "delivered" | "failed",
       "attempts": 0,
       "lastAttemptAt": null,
       "lastError": null
     }
   }
   ```
2. `deliverWebhook` 每次尝试后更新 `webhookDelivery.attempts` 和 `lastAttemptAt`
3. 成功时更新 `status: "delivered"`，3 次失败后更新 `status: "failed"`
4. 在 `api/server.js` 启动时扫描所有 `webhookDelivery.status === "pending"` 的版本，恢复投递
5. 注意：需要防止重复投递（`webhookSent` Set 只在内存中，重启后丢失）

**影响**：`api/server.js`、`api/job-store.js`（版本记录 schema 变更）

**工作量**：中（~3h）

---

### 12. 字幕 DNA 缺少运行时校验

**问题**：`getCaptionDna` 对未知 id 只打印 `console.warn` 并回退 classic，但没有任何机制阻止无效 DNA id 进入 pipeline。如果 `host_profile.json` 写错了 DNA 名称，视频会静默渲染为 classic 风格。

**方案**：在 `pipeline.sh` 的 pre-flight 检查中加入 DNA id 校验。

**实施步骤**：
1. 在 `scripts/lib/` 下新建 `validate_config.sh`
2. 加入 DNA id 校验逻辑：读取 `content_overlay.subtitles.dna`，验证是否在 `classic|loud|keynote|cream|editorial|documentary` 中
3. 在 `pipeline.sh` 的 pre-flight 阶段调用此校验脚本
4. 无效时输出明确错误信息并退出，而非静默回退

**影响**：`scripts/pipeline.sh`、新增 `scripts/lib/validate_config.sh`

**工作量**：小（~1h）

---

## 五、业务功能增强

### 13. 多主播切换（P2 规划功能优先级提升）

**现状**：素材库 API（`GET /api/v1/assets`）已返回 `hosts` 列表，`config/hosts/` 目录已预留，但 pipeline 和渲染层始终使用 `config/host_profile.json` 的单一主播。

**方案**：完成多主播切换功能，允许每个任务选择不同主播。

**实施步骤**：
1. **后端**：在 `api/server.js` 的 `POST /api/v1/jobs` 中增加 `hostProfile` 参数（默认 `host_profile.json`）
2. **job store**：在 `createJob` 中增加 `hostProfile` 字段，存储所选主播配置文件名
3. **pipeline 集成**：`runPipeline` 使用 `config/hosts/<hostProfile>.json` 替代固定的 `host_profile.json`
4. **前端**：在新建任务表单中增加主播选择下拉框，数据源为 `GET /api/v1/assets` 返回的 `hosts` 数组
5. **测试**：在 `test_api_server.js` 中增加多主播切换测试

**影响**：`api/server.js`、`api/job-store.js`、`api/public/`（前端）、`test_api_server.js`

**工作量**：大（~8h）

---

### 14. 口播稿质量预检

**问题**：pipeline 直接对原始文章调用 LLM 生成口播稿，没有对文章质量做预检。如果文章过短、过长、或包含大量代码块/表格，生成的 TTS 音频可能质量很差，浪费 GPU 计算资源。

**方案**：在 `script` 阶段前增加 `validate_article` 阶段，对文章做基本质量检查。

**实施步骤**：
1. 新建 `scripts/validate_article.sh`（或 JS 脚本），检查项：
   - 有效字符数 ≥ 100（太短不适合口播）
   - 有效字符数 ≤ 10000（太长需分段）
   - 代码块占比 < 30%（代码不适合朗读）
   - 表格行数 < 10（表格朗读效果差）
   - 中文字符占比 ≥ 50%（当前 TTS 主要支持中文）
2. 在 `pipeline.sh` 的 `script` 阶段之前调用，不通过时输出警告（可配置是否阻断）
3. 在 `api/server.js` 的 `POST /api/v1/jobs` 时也做预检，提前反馈给用户
4. 测试：在 `test_api_server.js` 中增加文章质量预检的测试用例

**影响**：`scripts/pipeline.sh`、新增 `scripts/validate_article.js`、`api/server.js`、`test_api_server.js`

**工作量**：中（~3h）

---

### 15. 成本预估

**问题**：用户在运行 pipeline 前不知道会消耗多少 LLM token 和 GPU 时间。对于长文章，LLM 分镜生成可能消耗大量 token。

**方案**：在 run 之前提供成本预估（基于文章长度和配置）。

**实施步骤**：
1. 在 `api/versioning.js` 中新增 `estimateCost` 函数：
   - 输入：`articleText`（字数）、`configOverrides`（如 storyboard 是否启用 LLM）
   - 输出：预估的 LLM token 数、GPU 时间、总耗时
2. 估算公式：
   - 口播稿生成：约 3x 文章字符数 token
   - 分镜 LLM：约 8x 口播稿字符数 token（含 system prompt）
   - TTS：约 4 字/秒，按字符数推算音频时长
   - 唇形同步：约 2x 音频时长 GPU 时间
   - 渲染：约 1x 音频时长 CPU 时间
3. 在 `GET /api/v1/jobs/:id` 详情中返回 `costEstimate` 字段
4. 前端在 Run 按钮旁显示预估（如 "预计消耗 ~5000 token，约 8 分钟"）

**影响**：`api/versioning.js`、`api/server.js`、`api/public/`

**工作量**：中（~3h）

---

### 16. 渐进式渲染（低清预览 + 高清后台）

**问题**：当前渲染必须等待完整 1080p 视频生成后才能预览。对于长视频，用户等待时间长达数分钟。

**方案**：先快速渲染 360p 预览版，再后台渲染 1080p 成品。

**实施步骤**：
1. 在 `api/server.js` 的 `runPipeline` 中增加 `--preview` 阶段
2. 预览渲染：使用 `remotion render --scale=0.33`（360p），跳过 BGM 和音效，只渲染视频轨道
3. 预览完成后立即可通过 SSE 通知前端，前端显示可播放的预览
4. 后台继续渲染 1080p 成品
5. 配置项：`video_layout.preview.enabled`（默认 false，保持向后兼容）

**影响**：`api/server.js`、`scripts/pipeline.sh`、`api/public/`

**工作量**：大（~6h）

---

### 17. 定时任务与 Webhook 触发

**问题**：当前只能通过 Web UI 或 CLI 手动触发视频生成。用户可能希望定时生成（如每日新闻摘要）或通过外部系统触发（如 CMS 发布文章后自动生成视频）。

**方案**：增加 cron 表达式定时任务和 webhook 触发端点。

**实施步骤**：
1. 在 `api/job-store.js` 中增加 `scheduledJobs` 概念：任务可携带 `schedule` 字段（cron 表达式）
2. 在 `api/server.js` 启动时加载所有 `schedule` 任务，用 `node-cron` 库注册定时器
3. 新增 `POST /api/v1/jobs/:id/schedule` 和 `DELETE /api/v1/jobs/:id/schedule` 端点
4. 新增 `POST /api/v1/trigger/:token` 端点，接受外部 webhook 触发（带 token 鉴权），根据 token 查找对应的 job 模板并执行
5. 前端增加定时任务管理界面

**影响**：`api/server.js`、`api/job-store.js`、`api/public/`、新增依赖 `node-cron`

**工作量**：大（~10h）

---

### 18. 场景素材跨任务复用缓存

**问题**：多个视频可能使用相同的 Pexels 搜索结果或 AI 生成的场景图。当前每个任务独立下载/生成场景素材，浪费带宽和 API 额度。

**方案**：在 `public/scene_visuals/` 下增加全局缓存目录，按素材 hash 去重。

**实施步骤**：
1. 在 `scripts/build_scene_visuals_from_existing.js` 中增加缓存逻辑：
   - 素材下载前先计算 query/prompt 的 hash
   - 检查 `public/scene_visuals/_cache/<hash>.{jpg,mp4}` 是否存在
   - 存在则直接创建符号链接，跳过下载
2. 缓存目录 `.gitignore` 但保留在 `public/` 下供渲染使用
3. 增加缓存清理策略：LRU，最大 500 个文件或 2GB

**影响**：`scripts/build_scene_visuals_from_existing.js`、`.gitignore`

**工作量**：中（~3h）

---

### 19. 口播稿版本管理与 A/B 对比

**问题**：当前 script GET/PUT 只操作最新版本的 `script.txt`，没有历史版本记录。用户微调口播稿后无法回溯到之前的版本。

**方案**：在每次 PUT script 时自动备份旧版本。

**实施步骤**：
1. 在 `PUT /api/v1/jobs/:id/script` 中增加备份逻辑：
   - 写入前将现有 `script.txt` 复制为 `script.v{N}.txt`（N 为版本号）
2. 新增 `GET /api/v1/jobs/:id/script/versions` 端点，返回所有历史版本列表
3. 新增 `GET /api/v1/jobs/:id/script?version=N` 支持读取指定版本
4. 前端增加口播稿版本下拉选择器

**影响**：`api/server.js`、`api/public/`

**工作量**：中（~3h）

---

### 20. 输出格式扩展（正方形/故事格式）

**问题**：当前只支持 9:16 竖屏和 16:9 横屏。社交媒体平台（Instagram、TikTok）需要 1:1 正方形或 9:16 故事格式，且不同平台对码率、分辨率有不同要求。

**方案**：扩展 `video_layout.aspect` 支持更多格式，并在渲染时应用平台特定的编码参数。

**实施步骤**：
1. 在 `src/index.tsx` 中注册新的 Composition（如 `TalkingHeadVideoSquare` 1080×1080）
2. 在 `api/server.js` 的 `/api/v1/config` 枚举中增加 `1:1` 选项
3. 在 `PortraitHybridLayout` 和 `TitleCard` 中增加正方形布局分支
4. 在 `pipeline.sh` 的 render 阶段根据 `aspect` 选择对应的 Composition ID
5. 渲染参数：正方形使用 `remotion render --codec=h264 --crf=23`，故事格式使用 `--codec=h265`

**影响**：`src/index.tsx`、`src/components/PortraitHybridLayout.tsx`、`src/components/TitleCard.tsx`、`api/server.js`、`scripts/pipeline.sh`

**工作量**：大（~8h）

---

## 六、建议优先级排序

| 优先级 | 编号 | 建议 | 理由 |
|--------|------|------|------|
| **P0** | 1 | 字幕分段逻辑统一 | 直接影响渲染正确性，当前三份实现不一致 |
| **P0** | 10 | `cp -cR` 平台兼容 | Linux 服务器上可能失败，影响生产部署 |
| **P1** | 12 | DNA 运行时校验 | 配置错误静默降级，用户难以排查 |
| **P1** | 9 | `npm test` 拆分 | 提升开发效率，快速反馈 |
| **P1** | 14 | 口播稿质量预检 | 避免浪费 GPU 资源处理低质量文章 |
| **P2** | 13 | 多主播切换 | 产品规划中的功能，基础设施已就绪 |
| **P2** | 15 | 成本预估 | 提升用户体验，减少意外支出 |
| **P2** | 18 | 场景素材缓存 | 节省 API 额度和带宽 |
| **P3** | 3 | Props 清理 | 代码质量，不影响功能 |
| **P3** | 4-6 | 测试补充 | 测试覆盖完善 |
| **P3** | 7-8 | 性能优化 | 当前规模下影响不大，任务数增长后再处理 |
| **P3** | 11 | Webhook 持久化 | 边缘场景，当前 fire-and-forget 可接受 |
| **P3** | 16-20 | 功能增强 | 按产品需求排期 |

---

## 附录：实际变更文件清单（2026-07-20）

| 文件 | 涉及建议编号 |
|------|------------|
| `scripts/lib/subtitle_segmentation.js` / `scripts/lib/subtitle_segmentation.d.ts` | 🆕 1 |
| `scripts/parse_srt.js` | 1 |
| `src/hooks/useSubtitles.ts` | 1 |
| `src/utils/keywordMatcher.ts` | 1, 2 |
| `tsconfig.json` | 3 |
| `src/index.tsx` | 3, 20 |
| `scripts/test_validate_subtitles.js` | 🆕 4 |
| `scripts/test_validate_article.js` | 🆕 14 |
| `scripts/test_scene_visuals_cache.js` | 🆕 18 |
| `scripts/test_validate_config.sh` | 🆕 12 |
| `scripts/test_api_server.js` | 5, 11, 13, 14, 16, 17, 19 |
| `scripts/test_remote_job.sh` | 6 |
| `scripts/fixtures/stub_pipeline_env.sh` / `stub_validate_article_pass.js` / `stub_validate_article_fail.js` | 🆕 14（测试桩） |
| `api/job-store.js` | 7, 11, 13, 17 |
| `api/server.js` | 8, 11, 13, 14, 15, 16, 17, 19, 20 |
| `api/versioning.js` | 10, 15 |
| `api/public/`（前端） | 13, 15, 16, 17, 19 |
| `scripts/lib/validate_config.sh` | 🆕 12 |
| `scripts/pipeline.sh` | 12, 13, 14, 16, 20 |
| `scripts/validate_article.js` | 🆕 14 |
| `scripts/build_scene_visuals_from_existing.js` | 18 |
| `src/components/PortraitHybridLayout.tsx` | 20 |
| `src/components/TitleCard.tsx` | 20 |
| `package.json` | 9, 17（node-cron 依赖） |
| `.gitignore` | 18 |
| `openapi.yaml` | 13–17, 19, 20（API 文档，v2.3.0） |
| `README.md` / `RELIABILITY.md` / `AGENTS.md` / `.kimi/kimi_pipeline.md` | 文档同步 |

> 注：`scripts/lib/remote_job.sh` 未变更（第 6 项测试证明现有逻辑健壮）；`config/hosts/` 为多主播 profile 存放目录（按需创建，当前仓库中尚无文件，且未加入 `.gitignore`——存放含敏感信息的 profile 时需自行留意）。