# Reliability & Automation Guide

This document describes the guards, automation, and operational runbooks for the talking-head pipeline.

## 1. Resumable Pipeline

`scripts/pipeline.sh` keeps state in `temp/<run>/.pipeline_state.json`.

- If a run fails, re-run the same command to resume at the failed phase.
- To force a phase: `FORCE_<PHASE>=1 bash scripts/pipeline.sh <article> <run>`.
  Supported phases: `script`, `tts`, `whisper`, `subtitles`, `storyboard`, `visuals`, `lipsync`, `postprocess`, `render`.

## 2. Pre-Flight Checks

Before any run, the pipeline validates:

- Required env vars (`OPENAI_API_KEY`, `ARK_API_KEY`, `ARK_ENDPOINT_ID`, etc.).
- Host profile, servers config, and template files exist.
- GPU server SSH connectivity and InfiniteTalk / IndexTTS paths.
- Local and remote dependencies (ComfyUI, Python venv, model files).

## 3. Subtitle Alignment

`scripts/align_subtitles.py` uses Whisper word-level timestamps and a character-level LCS mapping to produce SRT cues that match the original script.

- Match ratio must be ≥ 65% or the pipeline stops.
- If the script is edited later, use `scripts/render_with_reused_media.sh` with matching `script.txt` and `subtitles_raw.json`, or regenerate from scratch.

## 4. GPU Server Operations

- `server/install.sh` installs ComfyUI + InfiniteTalk, IndexTTS, and MuseTalk on a fresh GPU server.
- `server/versions.env` pins dependency versions (`*_REF` + `TORCH_SPEC`); empty values track upstream HEAD. Backfill tested commits after a verified install to make reinstalls reproducible.
- Remote job wrappers (`scripts/tts_index.sh`, `infinitetalk.sh`, `musetalk.sh`) share `scripts/lib/remote_job.sh`: unified SSH options (`BatchMode`, `ConnectTimeout`) and a circuit breaker — 5 consecutive SSH failures abort the phase instead of waiting out the full timeout.
- `server/server_maintenance.md` contains day-to-day runbooks.
- Model weights are documented in [`server/MODEL_CHECKLIST.md`](server/MODEL_CHECKLIST.md); they are loaded via symlinks and are never committed.
- The local engine is selected in `config/host_profile.json` via `lipsync.engine` (`infinitetalk` or `musetalk`).

## 5. Reuse Without Regeneration

For style or title changes only:

```bash
bash scripts/render_with_reused_media.sh \
  temp/<run>/article_raw.md <new_run_name> \
  temp/<run>/audio.wav \
  temp/<run>/lip_synced_raw.mp4
```

This reuses the original `script.txt` and `subtitles_raw.json` so audio and subtitles stay consistent.
The web admin (`npm run web`) exposes the same fast path as the **Rebuild** button; it shares the pipeline state machine and the `MAX_CONCURRENT` semaphore with the CLI, so jobs started from the browser and from the shell do not run concurrently.

## 6. Monitoring

- Check remote job logs in `temp/<run>/remote_job_*`.
- Check GPU status with `nvidia-smi` on the server.
- `scripts/check_server.sh` verifies SSH + service paths.

## 7. Failure Runbooks

| Symptom | Action |
|---|---|
| `detected dubious ownership` in server git | Do not commit from the server; keep server-side scripts in `server/` in this repo. |
| InfiniteTalk install fails | Re-run `server/install.sh`; check CUDA/PyTorch match. |
| MuseTalk install fails | Check system/data disk space (≥25 GB); verify `mmcv==2.0.1`, `mmdet==3.1.0`, `mmpose==1.1.0` install against the chosen PyTorch/CUDA version. |
| MuseTalk face detection fails | Use a clear frontal-face template video for `host.video_source`; verify detection/landmark weights in `models/mmdet/` and `models/mmpose/`. |
| Subtitle match < 65% | Verify script matches audio; re-run Whisper or regenerate script. |
| Render OOM / fails | Reduce `REMOTION_PARALLEL` and ensure output directory has space. |

## 8. Deployment Checklist

For a brand-new GPU server:

1. Copy SSH key and set `config/servers.json` host/user/port.
2. Run `bash server/install.sh` on the server.
3. Follow `server/MODEL_CHECKLIST.md` to place weights and create symlinks.
4. Run `bash scripts/detect_paths.sh` on the local Mac.
5. Run `bash scripts/check_server.sh`.
6. Run a short end-to-end test video.
