# Kimi CLI 口播视频生成 - Phase 4 工程化版

> 版本: 4.0  
> 核心特性: 服务器脚本仓库化、工程级字幕对齐、断点续跑、媒体复用、一键部署。

## 1. 一句话流程

```
文章 → 口播稿 → IndexTTS 音频 → Whisper 词级时间戳 → 原文对齐字幕
                                            ↓
分镜脚本 + 场景画面 ←──────────────────────┘
                                            ↓
InfiniteTalk 唇形同步 → Remotion 合成 → MP4 + 封面
```

## 2. 首次配置

```bash
git clone <repo> ~/kimi-talking-head
cd ~/kimi-talking-head
npm install

cp config/host_profile.example.json config/host_profile.json
cp config/servers.example.json      config/servers.json
cp .env.example                     .env          # 填 API key
```

在 `config/host_profile.json` 中配置：

- `host.photo_source`：主播照片路径
- `voice.reference_audio`：声音克隆参考音频
- `template`：`editorial` 或 `product-launch`
- `video_layout.hybrid.preset`：布局预设

在 `config/servers.json` 中配置主服务器 `host` / `port` / `user`，然后探测路径：

```bash
bash scripts/detect_paths.sh
```

## 3. 生成视频

完整流程：

```bash
bash scripts/pipeline.sh path/to/article.md my_video
```

产物：

- `output/my_video.mp4`
- `output/my_video_cover.png`

只改标题/风格，复用已有音频和唇形视频：

```bash
bash scripts/render_with_reused_media.sh \
  temp/old_video/article_raw.md \
  my_video_v2 \
  temp/old_video/audio.wav \
  temp/old_video/lip_synced_raw.mp4
```

该脚本会自动复用源 `script.txt` 和 `subtitles_raw.json`，避免新口播稿与旧音频不一致。

## 4. 流水线阶段

`scripts/pipeline.sh` 阶段与产物：

| 阶段 | 产物 | 强制重跑 |
|------|------|----------|
| `script` | `temp/<run>/script.txt` | `FORCE_SCRIPT=1` |
| `tts` | `temp/<run>/audio.wav` | `FORCE_TTS=1` |
| `whisper` | `temp/<run>/subtitles_raw.json` | `FORCE_WHISPER=1` |
| `subtitles` | `temp/<run>/subtitles.srt` | `FORCE_SUBTITLES=1` |
| `storyboard` | `temp/<run>/storyboard.json` | `FORCE_STORYBOARD=1` |
| `visuals` | `temp/<run>/scene_visuals.json` | `FORCE_VISUALS=1` |
| `lipsync` | `temp/<run>/lip_synced_raw.mp4` | `FORCE_LIPSYNC=1` |
| `postprocess` | `temp/<run>/lip_synced.mp4` | `FORCE_POSTPROCESS=1` |
| `render` | `output/<run>.mp4` + 封面 | `FORCE_RENDER=1` |

失败重跑会自动从失败阶段继续。

## 5. GPU 服务器部署

在服务器上：

```bash
git clone <repo> /tmp/kimi-talking-head
cd /tmp/kimi-talking-head/server
bash install.sh
```

然后按 [`server/MODEL_CHECKLIST.md`](../server/MODEL_CHECKLIST.md) 放置模型权重，再启动：

```bash
bash /root/aigc_apps/start.sh
```

服务器端脚本已全部纳入本仓库 `server/` 目录，部署后不要再在 `/root/aigc_apps/InfiniteTalk` 内执行 `git` 操作（会出现 dubious ownership 警告）。

## 6. 字幕对齐校验

`scripts/align_subtitles.py` 使用 Whisper 词级时间戳 + 原文字符级 LCS 映射。

- 输出字幕内容严格等于 `script.txt`。
- 匹配率 < 65% 直接报错退出。
- 复用旧音频时务必同时复用对应的 `script.txt` 和 `subtitles_raw.json`。

## 7. 故障排查

| 问题 | 解决 |
|---|---|
| 字幕与音频对不上 | 检查 `script.txt` 是否与 `audio.wav` 对应；复用媒体走 `render_with_reused_media.sh` |
| 字幕校准失败（match < 65%） | 脚本与音频不一致，重新生成 TTS 或复用正确的源稿 |
| ComfyUI numpy/opencv 报错 | 服务器执行 `pip install "numpy<2.2" "opencv-python>=4.10"` |
| SSH 连接失败 | 检查 `~/.ssh/config`，运行 `bash scripts/check_server.sh` |
| 服务器 git 报 `detected dubious ownership` | 不要在该目录操作 git，自定义脚本在本地 `server/` 维护 |

## 8. 常用命令

```bash
# 探测服务器
bash scripts/detect_paths.sh

# 检查服务器
bash scripts/check_server.sh

# 本地 Remotion 预览
npm run dev

# 手动渲染
npx remotion render src/index.tsx TalkingHeadVideo \
  --props public/props.json \
  --duration-in-frames <frames> \
  output/manual.mp4
```
