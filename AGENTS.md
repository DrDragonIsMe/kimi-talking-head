# Agent Guidelines

## Project

`kimi-talking-head` generates 1080×1920 portrait talking-head videos from articles. Pipeline: article → script → TTS → Whisper → subtitles → storyboard → scene visuals → InfiniteTalk lip-sync → Remotion render.

## Key Files

- `scripts/pipeline.sh` — main orchestration, resumable via `temp/<run>/.pipeline_state.json`.
- `scripts/render_with_reused_media.sh` — reuse existing audio/lip video for style/title-only changes.
- `scripts/align_subtitles.py` — word-level Whisper JSON + script character-level alignment.
- `config/host_profile.json` — host photo, voice reference, template, layout preset, brand copy.
- `config/servers.json` — SSH + GPU server paths, updated by `scripts/detect_paths.sh`.
- `server/` — GPU server deployment scripts and model checklist.

## Conventions

- Use `bash scripts/pipeline.sh <article> <run>` for full runs.
- Use `FORCE_<PHASE>=1` to re-run a specific phase.
- Keep generated media (`temp/`, `output/`, `public/audio.wav`, `public/host_video.mp4`, etc.) out of git.
- Update `README.md`, `RELIABILITY.md`, `.kimi/kimi_pipeline.md`, and `server/*.md` when changing architecture or deployment.
- Never commit `config/host_profile.json`, `config/servers.json`, or `.env`.
