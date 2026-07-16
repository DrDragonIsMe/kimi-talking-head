# Server Deployment

This directory contains everything needed to deploy the GPU server side of `kimi-talking-head` on a fresh Ubuntu machine.

## What runs on the server

| Service | Path on server | Purpose |
|---------|----------------|---------|
| ComfyUI + InfiniteTalk | `/root/aigc_apps/InfiniteTalk` | Lip-sync video generation (`lip_synced_raw.mp4`) |
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
7. Copy `start.sh` / `env.sh` to `/root/aigc_apps/` and create standard symlinks.

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

## Operations

Day-to-day runbooks (restarts, log locations, health checks, model symlinks) are in [`server_maintenance.md`](server_maintenance.md).

## Files in this directory

| File | Description |
|------|-------------|
| `install.sh` | One-shot server setup script |
| `MODEL_CHECKLIST.md` | Required model files and locations |
| `server_maintenance.md` | Operational runbooks |
| `comfyui/start.sh` | ComfyUI startup script copied to `/root/aigc_apps/start.sh` |
| `comfyui/env.sh` | Environment helper copied to `/root/aigc_apps/env.sh` |
| `comfyui/monitor.sh` | Optional remote-job monitor |
| `comfyui/README.md` | ComfyUI server scripts doc |
| `index-tts/remote_worker.py` | JSON-stdio wrapper that `scripts/tts_index.sh` talks to |
| `index-tts/README.md` | IndexTTS worker doc |
