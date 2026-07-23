# Server Deployment

This directory contains everything needed to deploy the GPU server side of `kimi-talking-head` on a fresh Ubuntu machine.

## What runs on the server

| Service | Path on server | Purpose |
|---------|----------------|---------|
| ComfyUI + InfiniteTalk | `/root/aigc_apps/InfiniteTalk` | Lip-sync video generation (`lip_synced_raw.mp4`) via InfiniteTalk |
| MuseTalk | `/root/aigc_apps/MuseTalk` (or `<data-disk>/aigc_apps/MuseTalk`) | Lip-sync video generation (`lip_synced_raw.mp4`) via MuseTalk |
| IndexTTS + remote worker | `/root/aigc_apps/index-tts` | Voice-cloned TTS audio (`audio.wav`) |

The local Mac console orchestrates everything: it uploads images/audio, submits remote jobs, downloads results, and renders the final video with Remotion.

## Quick deploy

```bash
# On the GPU server (Ubuntu 22.04/24.04, NVIDIA driver installed)
git clone <this-repo> /tmp/kimi-talking-head
cd /tmp/kimi-talking-head/server
bash install.sh
```

`install.sh` will:

1. Install system dependencies (`git`, `ffmpeg`, `python3-venv`, …).
2. Clone/refresh ComfyUI into `/root/aigc_apps/InfiniteTalk`.
3. Create a ComfyUI venv and install PyTorch + requirements.
4. Install custom nodes: `InfiniteTalk`, `ComfyUI-WanVideoWrapper`, `ComfyUI-VideoHelperSuite`, `ComfyUI-KJNodes`, `ComfyUI-Manager`.
5. Clone/refresh IndexTTS into `/root/aigc_apps/index-tts` and install it in a Python 3.10 venv.
6. Copy our `remote_worker.py` wrapper into the IndexTTS root.
7. Clone/refresh MuseTalk into `/root/aigc_apps/MuseTalk` (or a data disk if system disk is full) and install its Python 3.10 venv with PyTorch + MMLab dependencies.
8. Copy `start.sh` / `env.sh` to `/root/aigc_apps/` and create standard symlinks.

### 版本锁定（可选）

`server/versions.env` 控制 install.sh 检出的依赖版本：各 `*_REF` 留空时跟随上游 HEAD（历史行为）；填入实测通过的 commit/tag 后，安装会检出该固定版本，避免上游 HEAD 漂移导致环境不可复现。建议新服务器验证通过后，把各仓库实际检出的 commit 回填到 `versions.env` 并提交。

## Download models

Models are too large to bundle. See [`MODEL_CHECKLIST.md`](MODEL_CHECKLIST.md) for the exact file list and destinations.

## Start services

### ComfyUI / InfiniteTalk

```bash
ssh root@<server>
bash /root/aigc_apps/start.sh
```

ComfyUI listens on `0.0.0.0:8188`.

### IndexTTS remote worker

`scripts/tts_index.sh` starts the worker automatically per job via SSH. To test it manually:

```bash
cd /root/aigc_apps/index-tts
source .venv/bin/activate
cat <<'EOF' | python remote_worker.py
{
  "model_dir": "checkpoints",
  "device": "cuda:0",
  "use_fp16": false,
  "use_cuda_kernel": false,
  "use_torch_compile": false,
  "reference_wav": "path/to/reference.wav",
  "jobs": [{"text": "你好，这是测试。", "out": "/tmp/test.wav"}]
}
EOF
```

## Configure local project

After the server is up and models are in place, on your local Mac run:

```bash
bash scripts/detect_paths.sh
```

This updates `config/servers.json` with the detected server paths. Copy `config/servers.example.json` to `config/servers.json` first if needed.

## MuseTalk vs InfiniteTalk

The local pipeline chooses the engine via `config/host_profile.json`:

```json
{
  "lipsync": { "engine": "infinitetalk" }
}
```

Set it to `"musetalk"` to use MuseTalk. MuseTalk requires `host.video_source` (a template video such as `assets/host/me.mp4`) instead of a static photo.

## Operations

Day-to-day runbooks (restarts, log locations, health checks, model symlinks) are in [`server_maintenance.md`](server_maintenance.md).

## 关于服务器生图（2026-07 调研结论）

调研问题：场景画面能否改由服务器 ComfyUI 生图，成本是否低于 bl/ark 生图。结论：**保持现状**（pexels 免费库存 + bl/ark 兜底），原因：

- bl/ark 生图单价极低（wanx2.1-t2i 0.14–0.20 元/张、seedream-3.0 0.259 元/张，且各有 500 张免费额度），当前 AI 生图仅作兜底、实际触发极少；省下的钱可忽略。
- pipeline 的 visuals 与唇形同步阶段并行执行，ComfyUI 生图会与 MuseTalk/InfiniteTalk 争抢 GPU 显存，可能 OOM 或拖慢唇形，需串行化或限流，工程代价大于收益。
- 服务器端无 t2i checkpoint（`models/diffusion_models/` 只有 InfiniteTalk / Wan2.1 I2V 视频模型），需额外下载 SDXL/可图并维护。

迁移触发信号：日均 ≥20 条视频、外部 API 限流成为主要故障、或要求内网/离线部署。届时实施路径：下载可图/SDXL checkpoint → `prepare_scene_visuals.js` 新增 `comfy` provider（:8188 workflow API）→ 解决 GPU 争抢（串行或 `--lowvram` 限流）。

待办（服务器开机后执行一次，结果回填到本节）：

```bash
ssh -p 54365 root@8.149.64.203 \
  "nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader; \
   df -h /root | tail -1; \
   ls /root/aigc_apps/InfiniteTalk/models/diffusion_models/"
```

- GPU 型号/显存：待核实
- `/root` 磁盘余量：待核实
- diffusion_models 现有内容：待核实

## Files in this directory

| File | Description |
|------|-------------|
| `install.sh` | One-shot server setup script |
| `MODEL_CHECKLIST.md` | Required model files and locations |
| `server_maintenance.md` | Operational runbooks |
| `comfyui/start.sh` | ComfyUI startup script copied to `/root/aigc_apps/start.sh` |
| `comfyui/env.sh` | Environment helper copied to `/root/aigc_apps/env.sh` |
| `comfyui/env.sh` | Environment helper copied to `/root/aigc_apps/env.sh` |
| `comfyui/monitor.sh` | Optional remote-job monitor |
| `comfyui/README.md` | ComfyUI server scripts doc |
| `index-tts/remote_worker.py` | JSON-stdio wrapper that `scripts/tts_index.sh` talks to |
| `index-tts/README.md` | IndexTTS worker doc |
