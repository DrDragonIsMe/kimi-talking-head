# Server Maintenance Runbooks

For the GPU server running ComfyUI/InfiniteTalk and IndexTTS.

## Service layout

```
/root/aigc_apps/
├── InfiniteTalk/           # ComfyUI + InfiniteTalk custom node
│   ├── venv/               # ComfyUI Python venv
│   ├── custom_nodes/InfiniteTalk/
│   ├── models/             # model weights (large, symlinked)
│   ├── input/ output/
│   └── main.py
├── index-tts/              # IndexTTS2 repo + remote_worker.py
│   ├── .venv/              # IndexTTS Python venv
│   └── checkpoints/        # model weights
├── start.sh                # ComfyUI launcher
└── env.sh                  # venv helper
```

## Start / stop ComfyUI

Start in a persistent session (use `tmux`/`screen`):

```bash
ssh -p <port> root@<server>
bash /root/aigc_apps/start.sh
```

Stop:

```bash
pkill -f "python main.py --disable-cuda-malloc"
```

## Check GPU health

```bash
nvidia-smi
```

If GPU util is 0% for a long time while a job is queued, check the ComfyUI log for OOM or model-loading errors.

## ComfyUI log locations

- Live log: stdout of the `start.sh` session.
- Pipeline remote log (server-side generation): `temp/<run>/remote_job_*/lipsync.log` on the local Mac.

## Model weights are via symlinks

The current server places large weights under `/wuying-pub/Comfyui/...` and symlinks them into `/root/aigc_apps/InfiniteTalk/models/`. Do **not** copy weights into this repo; keep symlinks.

If `install.sh` is run on a fresh server, place weights manually according to `MODEL_CHECKLIST.md` or re-create symlinks to your shared storage.

## Re-install after code update

If `InfiniteTalk` or `IndexTTS` release a required update:

```bash
cd /root/aigc_apps/InfiniteTalk/custom_nodes/InfiniteTalk
git pull
# or re-run the full installer
bash /tmp/kimi-talking-head/server/install.sh
```

## IndexTTS worker quick test

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
  "reference_wav": "assets/voice/me.m4a",
  "jobs": [{"text": "你好，测试一下声音克隆。", "out": "/tmp/test_tts.wav"}]
}
EOF
```

## Common issues

| Symptom | Fix |
|---|---|
| `numpy` / `opencv` import error | In ComfyUI venv: `pip install "numpy<2.2" "opencv-python>=4.10"` |
| OOM during lip-sync | Lower `sample_steps`, enable `low_vram`, or increase `blocks_to_swap` in `config/host_profile.json` |
| `detected dubious ownership` in git | Do not run `git` inside `/root/aigc_apps/InfiniteTalk` as a different user. Keep custom scripts in this repo (`server/`) instead. |
| SSH key denied from local Mac | Ensure `~/.ssh/config` uses the right user/port and `ssh -p <port> root@<server>` works. |
