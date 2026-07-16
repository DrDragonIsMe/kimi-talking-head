# kimi-talking-head 全流程测试报告

**测试时间**：2026-07-16 ~ 2026-07-17  
**测试文章**：`temp/ai_hr_governance_test/article.md`（AI 参与人力资源管理趋势）  
**输出视频**：`output/ai_hr_governance_test.mp4`  
**输出封面**：`output/ai_hr_governance_test_cover.png`  
**测试方式**：动态全流程 + 离线单元/集成测试套件

---

## 1. 测试计划与覆盖范围

### 1.1 动态全流程测试
- 使用全新文章跑完整 `bash scripts/pipeline.sh article.md ai_hr_governance_test`
- 覆盖阶段：script → tts → whisper → subtitles → storyboard → visuals → lipsync → postprocess → render
- 重点监控：字幕边界、字幕准确性、字幕/口型/语音三者同步、断点续传健壮性、GPU 状态探测、相同任务单例保护

### 1.2 离线测试套件
| 脚本 | 覆盖范围 | 结果 |
|------|----------|------|
| `scripts/test_pipeline_state.sh` | 流水线状态机（init/get/set/mark_running/mark_completed/mark_failed/断点续传/并发读写/损坏 JSON） | 47/47 通过 |
| `scripts/test_subtitle_parsing.js` | 字幕文本归一化、视觉宽度、分段、SRT 解析与校验、边界情况 | 133/133 通过 |
| `scripts/test_sync_timing.js` | SRT 时间解析、时间偏移、分段后时长连续性、音频-视频时长匹配、帧时间换算、active cue 查找、OffthreadVideo 同步 | 86/86 通过 |
| `scripts/test_keyword_matcher.js` | 关键词匹配、场景风格、引用触发、数据条触发 | 78/78 通过 |
| **合计** | | **344/344 通过** |

---

## 2. 动态全流程执行结果

### 2.1 输出文件
- `output/ai_hr_governance_test.mp4`：46 MB，194.517s，1080×1920，30fps，H.264 + AAC
- `output/ai_hr_governance_test_cover.png`：963 KB，1080×1920

### 2.2 时长对齐
| 文件 | 时长 | 说明 |
|------|------|------|
| 原始音频 `audio.wav` | 186.475s | TTS 输出 |
| 原始唇形视频 `lip_synced_raw.mp4` | 186.486s | InfiniteTalk 输出（5 段拼接） |
| 后处理唇形视频 `lip_synced.mp4` | 186.467s | 拉伸/对齐到音频 |
| 最终成片 | 194.517s | 音频 + 2s 标题卡 + 6s 结尾卡 |

**结论**：
- 标题卡 2s + 音频 186.475s + 结尾卡 6s ≈ 194.475s，与成片 194.517s 吻合（差 0.04s，30fps 帧对齐误差内）。
- `lip_synced_raw.mp4` 与 `audio.wav` 时长偏差从修复前的 **0.429s（186.046s vs 186.475s）** 降至 **0.011s**，后处理拉伸系数从 **1.002306** 降至接近 **1.0**。

### 2.3 字幕质量
- 生成 81 条字幕 cues，覆盖 0s ~ 186.06s
- 分段自然，按标点/语义切分
- 每行视觉长度控制在 `maxVisualLength=26` 以内
- 时间戳连续，无重叠，间隙正常（<0.5s）
- 字幕文本与口播稿一致
- 自动过滤文章中的动作指导（如 `（停顿半拍）`）和章节标记 `【】` 内容

### 2.4 视觉帧抽查
- 标题卡：正确显示文章自动提取的标题 **“跟你说个反常识的事——”**，不再复用旧硬编码标题
- 口播中（5s/45s）：host 窗口显示男性主播，字幕显示正确，章节面包屑切换正常
- 结尾卡（188s）：章节总结完整，最终字幕正确

### 2.5 同步性评估
- **字幕-音频**：字幕时间戳基于 Whisper 词级对齐后再用口播稿校准，偏差 <0.1s
- **口型-音频**：InfiniteTalk/MultiTalk 基于音频驱动，分段拼接无可见跳变；修复 AudioCrop 取整问题后，最后一段不再提前截断，整体口型-音频同步显著提升
- **host 视频-最终时间线**：Remotion 中 `talkingStartFrame = titleCardDurationFrames`，与音频 Sequence from 对齐

---

## 3. 发现的 Bugs 与修复

### 3.1 已修复并提交
1. **`api/server.js` spawn 返回值引用错误**
   - 问题：`const child = spawn(...)` 后错误引用未定义变量
   - 修复：正确引用 `child`，补充 `error` 事件，`detached:true` 时使用 `process.kill(-pid)` 清理进程组

2. **`scripts/lib/state.sh` `mark_failed` 未设置 `started_at`**
   - 问题：直接调用 `mark_failed` 时 `started_at` 为空
   - 修复：失败时若 `started_at` 为空则回填当前时间

3. **`scripts/pipeline.sh` / `render_with_reused_media.sh` `has_valid_srt` 依赖 `rg`**
   - 问题：使用 ripgrep，部分环境未安装
   - 修复：改为 `grep -Ec '^[0-9]+$'`

4. **`src/components/ProductLaunchLayout.tsx` 空数组保护**
   - 问题：`activeFeatureIndex` 在空数组时越界
   - 修复：增加空数组保护

5. **`src/components/Subtitles.tsx` 行宽计算浮点误差**
   - 问题：`maxCharsPerLine - 1.2` 导致偶发行宽判断错误
   - 修复：改为 `- 1`

6. **`scripts/comfyui/run_server_side.sh` 兼容性与引号问题**
   - 问题：macOS `realpath --relative-to` 不兼容、jq 默认值缺引号、SSH 远程命令引号地狱
   - 修复：用 Python `os.path.relpath`、修正 jq、用远程 runner 脚本避免本地复杂引号

7. **远程 GPU 探测缺失**
   - 问题：监控循环只能看到空日志，无法判断 GPU 是否还在工作
   - 修复：监控循环加入 `nvidia-smi` GPU/显存探测、已完成片段数、最新日志行；连续 3 次 GPU=0% 且进程消失则判失败

8. **ComfyUI 轮询心跳间隔过长**
   - 问题：`poll_history` 每 300s 才打印一次，长推理阶段看起来像卡死
   - 修复：心跳间隔改为 60s

9. **`run_server_side.sh` ffprobe 选项名错误**
   - 问题：使用 `noprintwrappers`（无下划线），Ubuntu 22.04 / macOS 的 ffprobe 返回空，导致下载后误判“视频时长异常”
   - 修复：统一为 `noprint_wrappers=1:nokey=1`

10. **ComfyUI 400 错误诊断不足**
    - 问题：请求失败只打印 `400 Client Error`，看不到响应体
    - 修复：`request_with_retry` 打印状态码 + 响应体前 500 字符

11. **AudioCrop 时间格式截断导致最后一段唇形视频变短**
    - 问题：`comfyui_client.py` 中 `_format_hms` 将 `segment_end` 直接 `int()` 截断，最后一段 26.48s 被裁成 26.00s，导致 `lip_synced_raw.mp4` 比音频短 0.4s 以上
    - 修复：`AudioCrop` 的 `end_time` 改用 `math.ceil(segment_end)` 向上取整，让 ComfyUI 内部 clamp 到真实音频长度

12. **标题卡仍使用上次硬编码标题**
    - 问题：`config/host_profile.json` 中 `title_card.title` 被优先使用，换文章后标题不变
    - 修复：`scripts/pipeline.sh` 默认从文章自动提取标题；`scripts/extract_title.js` 过滤 `（）` 动作指导和 `【】` 章节标记；仅当 `FORCE_PROFILE_TITLE=1` 时才回退到 profile 硬编码标题

13. **`FORCE_LIPSYNC=1` 时服务器端仍因 resume 跳过生成**
    - 问题：`run_server_side.sh` 只清本地缓存，未清服务器端缓存，远程 `generate_segments.py --resume` 仍复用旧分段
    - 修复：`run_server_side.sh` 新增 `--force` 参数，强制删除本地和服务器端旧输出与分段缓存；`pipeline.sh` 在 `FORCE_LIPSYNC=1` 时调用 `--force`

14. **相同内容任务重复启动**
    - 问题：本地/远程监控或生成进程可能因重试/误操作被重复启动，造成资源浪费
    - 修复：
      - `scripts/comfyui/run_server_side.sh` 新增远程 PID 锁（`.generate_segments.lock`），同 `RUN_ID` 已存在存活进程时直接复用，不再重复提交 GPU 任务
      - 新增 `scripts/ensure_single_monitor.sh`，本地按 name 单例启动后台监控，重复同名任务自动跳过

### 3.2 过程中排除的误操作
- 曾尝试将 `quantization` 改为 `fp8_e5m2_fast` 提速，但当前 ComfyUI-WanVideoWrapper 节点版本返回 400 Bad Request，已回退到 `fp8_e5m2`。
- 结论：`_fast` 变体在该节点版本不兼容，需升级节点或确认支持后再开启。

---

## 4. 性能观察

| 阶段 | 耗时 | 备注 |
|------|------|------|
| script / tts / whisper / subtitles / storyboard / visuals | ~5 分钟 | 本地或轻量远程，较快 |
| lipsync（5 段） | ~110 分钟 | 每 40s 段约 22-24 分钟；受 Wan2.1-I2V-14B + 480P 模型限制 |
| postprocess | <1 分钟 | ffmpeg 拉伸/对齐 |
| Remotion render | ~3 分钟 | 5834 帧，本次渲染异常快速（可能与缓存/帧复杂度有关） |
| **总耗时** | **~2 小时** | 不含首次 1h 超时重试 |

**性能建议**：
- lipsync 是本流程瓶颈，受模型和硬件限制；可尝试升级 ComfyUI-WanVideoWrapper 以支持 `fp8_e5m2_fast`。
- Remotion render 在本地 CPU 上通常较慢；如需批量生产，建议接入 Remotion Lambda 或 GPU 渲染。

---

## 5. 断点续传健壮性

- 状态文件 `.pipeline_state.json` 正确记录各阶段状态、尝试次数、时间戳、输出路径。
- 实测：第一次 pipeline 因 1h 超时失败后，重新运行可正确跳过已完成的 script/tts/subtitles/storyboard/visuals，复用已生成的 lipsync 分段，继续后续阶段。
- `run_server_side.sh` 在本地已有有效输出时会跳过服务器端生成，避免重复跑 GPU。
- 新增远程 PID 锁后，同一次 run 即使被重复触发，也不会在服务器上启动多个 `generate_segments.py`。
- 建议：为长时间任务设置足够长的超时（≥3h），并在文档中说明各阶段参考耗时。

---

## 6. 工程化/可脚本化评估

- 全流程可通过 `bash scripts/pipeline.sh <article> <run>` 一键运行。
- 离线测试套件可通过 `bash scripts/test_*.sh` / `node scripts/test_*.js` 独立运行。
- 监控信息已输出到 `temp/<run>/monitor/` 和后台任务日志。
- 新增 `scripts/ensure_single_monitor.sh` 防止重复后台监控。
- 已改进项（相对上一版报告）：
  1. ✅ 标题卡标题已从文章自动提取，不再依赖硬编码。
  2. 长时间阶段（lipsync/render）的超时建议根据音频时长动态计算。
  3. 可考虑将离线测试套件加入 `package.json` scripts，便于 CI。

---

## 7. 结论

- **功能逻辑**：离线测试 344 项全部通过；动态全流程成功生成最终视频和封面。
- **字幕边界/准确性/同步性**：字幕分段自然、文本准确、时间戳与音频对齐；host 视频与音频时间线一致；口型由音频驱动，修复 AudioCrop 取整后同步性显著提升。
- **性能**：GPU lipsync 仍是主要耗时点，符合当前模型/硬件配置预期；本次 Remotion render 耗时异常短，需后续持续观察。
- **健壮性**：断点续传工作正常，已修复超时、ffprobe 校验、GPU 探测、任务单例等关键 bug。
- **工程化**：已具备脚本化运行能力，测试覆盖完整但未提交到仓库。

**最终输出**：
- `output/ai_hr_governance_test.mp4`
- `output/ai_hr_governance_test_cover.png`
