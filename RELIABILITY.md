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
- Caption DNA id (`scripts/lib/validate_config.sh`): `content_overlay.subtitles.dna` must be one of `classic|loud|keynote|cream|editorial|documentary`; an invalid value aborts the run with a clear error instead of silently falling back to classic.
- Article quality (`scripts/validate_article.js`, runs before the `script` phase): effective length 100–10000 chars, code-block share < 30%, table rows < 10, Chinese share ≥ 50%. Warn-only by default; `STRICT_ARTICLE_CHECK=1` makes it fatal. The web admin runs the same check on `POST /api/v1/jobs` — 400 by default, `ARTICLE_VALIDATE_MODE=warn` downgrades to a warning, `ARTICLE_VALIDATE_SCRIPT` overrides the script path.

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

### Worker pool (optional, P2-12)

`config/servers.json` may add a `workers: [{name, host, port, user, ...}]` array alongside the existing `primary`/`backup` fields (see the commented example in `config/servers.example.json`). Semantics of `remote_job_select_worker` (`scripts/lib/remote_job.sh`):

- **Absent or empty `workers`** → single-server behavior, byte-identical to before (returns the `primary` connection fields).
- **Present** → round-robin starting from a cursor persisted in `REMOTE_JOB_RR_STATE` (default `${TMPDIR:-/tmp}/kimi_talking_head_workers.rr`), so consecutive pipeline runs rotate across machines. Each candidate gets a cheap precheck (`ssh -o BatchMode=yes -o ConnectTimeout=5 <worker> true`); unreachable workers are skipped with a warning. The first reachable worker wins and the cursor advances to the next index.
- **All unreachable** → clear log line and fallback to the `primary` fields (same as the no-workers path).
- Per-service paths (`tts_path`, `infinitetalk_path`, …) are read from the selected worker entry; a worker missing a service's path is treated as unavailable for that service (currently wired into `tts_index.sh`; other scripts keep the legacy primary/backup logic).

## 5. Customer Series (`config/hosts/customer_female.json`)

The 「客户说」 series uses a randomized AI host pool instead of a single real person:

- **Identity**: `scripts/generate_customer_persona.js` randomly picks a surname, given name, title, industry, and company name, then masks the middle characters with `*` (e.g. `李*涵`, `星*科技`). The resulting label is written to `video_layout.hybrid.brandBadge.text`.
- **Visuals**: `scripts/generate_customer_avatars.sh` generates 12 short 640×640 young-female talking-head template videos via `bl video generate`, scales them to 640×640, removes audio, and extracts the first frame as a photo fallback. The pipeline randomly picks one video and one photo per run.
- **Voice**: `scripts/generate_customer_voices.sh` produces 6 pitch-shifted variants of `assets/voice/female_ref_jennifer.wav` using ffmpeg (`asetrate+atempo+aresample`). The pipeline randomly picks one reference per run for IndexTTS cloning.
- **One-shot setup**: `npm run setup:customer` (or `bash scripts/setup_customer_assets.sh`) generates both pools. Output directories (`assets/host/customers/`, `assets/voice/customers/`) are gitignored, so a fresh clone must run this once before rendering a customer video.
- **Runtime**: `scripts/pipeline.sh` creates `temp/<run>/profile_effective.json` from the original profile plus the random persona, then uses that effective profile for TTS, lip-sync, and render. The original profile is never mutated.

## 6. Reuse Without Regeneration

For style or title changes only:

```bash
bash scripts/render_with_reused_media.sh \
  temp/<run>/article_raw.md <new_run_name> \
  temp/<run>/audio.wav \
  temp/<run>/lip_synced_raw.mp4
```

This reuses the original `script.txt` and `subtitles_raw.json` so audio and subtitles stay consistent.
The web admin (`npm run web`) goes further: its **Rebuild** button is slimmer — it creates a new version with the invalidation phase forced to `render` (see `api/versioning.js`), clones the previous version's workdir, and lets the pipeline state machine re-run only the render phase (zero GPU, zero LLM). Both paths share the pipeline state machine and the `MAX_CONCURRENT` semaphore with the CLI, so jobs started from the browser and from the shell do not run concurrently.

Workdir cloning (`prepareReuseWorkdir`) uses Node's `fs.cpSync` (Node ≥ 16.7) instead of the old `cp -cR` / `cp -R` fallback chain, so reuse behaves identically on macOS and Linux.

## 7. Monitoring

- Check remote job logs in `temp/<run>/remote_job_*`.
- Check GPU status with `nvidia-smi` on the server.
- `scripts/check_server.sh` verifies SSH + service paths.

## 8. Failure Runbooks

| Symptom | Action |
|---|---|
| `detected dubious ownership` in server git | Do not commit from the server; keep server-side scripts in `server/` in this repo. |
| InfiniteTalk install fails | Re-run `server/install.sh`; check CUDA/PyTorch match. |
| MuseTalk install fails | Check system/data disk space (≥25 GB); verify `mmcv==2.0.1`, `mmdet==3.1.0`, `mmpose==1.1.0` install against the chosen PyTorch/CUDA version. |
| MuseTalk face detection fails | Use a clear frontal-face template video for `host.video_source`; verify detection/landmark weights in `models/mmdet/` and `models/mmpose/`. |
| Subtitle match < 65% | Verify script matches audio; re-run Whisper or regenerate script. |
| `heroMoments[i] ... 超出正文时长范围` | Whisper word timestamps can run slightly past the audio end. `scripts/locate_hero_moments.js` now clamps moments to `maxDurationSeconds` (passed from `AUDIO_DURATION`); re-run with `FORCE_RENDER=1` to pick up the fix. |
| Render OOM / fails | Reduce `REMOTION_PARALLEL` and ensure output directory has space. |

## 9. Testing

`npm test` runs 20 offline suites plus `tsc --noEmit`, covering all critical paths. `npm run test:fast` runs the same suites except the API integration test and the TypeScript check (19 suites) for a quicker loop.

| Suite | What it guards |
|-------|---------------|
| `test_subtitle_parsing.js` | SRT parsing, cue segmentation, word-level validation |
| `test_sync_timing.js` | Time parsing, offsets, sync validation, frame/time conversion |
| `test_keyword_matcher.js` | Scene style matching, keyword extraction, subtitle formatting |
| `test_extract_title.js` | Title extraction at clause boundaries |
| `test_karaoke_words.js` | Word-level alignment, hero moment location, phrase sanitization |
| `test_audio_pipeline.js` | SFX synthesis, BGM config, asset validation |
| `test_scene_motion.js` | Scene window, Ken Burns transforms, transition rotation |
| `test_overlay_layout.js` | Layout presets, sequence rotation, holdCues |
| `test_hero_state.js` | Hero entrance/dwell/exit timeline |
| `test_versioning.js` | Config hashing, invalidation phase, workdir reuse, duration aggregation |
| `test_caption_dna.js` | Six DNA file integrity, field validation, `sanitizeOutputName` |
| `test_validate_subtitles.js` | `validate_subtitles.js` CLI directly (exit codes, stderr, word-level checks) |
| `test_validate_article.js` | Article quality pre-check (length, code/table share, Chinese ratio; stub-script injection) |
| `test_scene_visuals_cache.js` | Scene asset cache (hash hit, symlink, LRU eviction) |
| `test_scene_visuals_windows.js` | Shot-driven visual windows (6–15s merge, 42s fallback), stock candidate rerank, cache key |
| `test_api_server.js` | Full API integration (CRUD, run/rebuild/retry, versioning, auth, webhook, SSE keepalive, multi-host, article pre-check, schedule/trigger, script versions, preview) |
| `test_pipeline_state.sh` | Pipeline state machine (init/get/set/mark, concurrency, corruption recovery) |
| `test_validate_config.sh` | Caption DNA id pre-flight validation (accept valid, reject invalid) |
| `test_remote_job.sh` | Remote job helpers (SSH/SCP, submit, poll, circuit breaker, worker pool, PID extraction under noisy numeric banners) |
| `test_compositions.js` | Remotion composition registration guard (portrait/landscape/square dimensions) |
| `tsc --noEmit` | TypeScript type checking |

Visual regression (`npm run test:visual`) uses SSIM pixel comparison for three representative frames.

## 10. Web Admin Resilience

- **Webhook delivery persistence**: each version record carries `webhookDelivery {status, attempts, lastAttemptAt, lastError}`. Every attempt is persisted, so a process restart no longer loses pending deliveries — at startup the server scans version records for `status === 'pending'` on terminal versions and resumes them; `delivered` records are skipped, preventing duplicates after restart.
- **Job list caching**: `api/job-store.js` caches `listJobs`/`getJob` results in memory, invalidated by `state.json` mtime, so the list endpoint no longer re-reads every job file per request.
- **Pipeline state fingerprint cache**: `api/server.js` caches the parsed `.pipeline_state.json` keyed by an `(mtimeMs, size)` fingerprint; the SSE progress watcher and the job detail endpoint re-parse only when the file actually changes.
- **SSE keepalive**: comment frames every 25 s by default, overridable via `SSE_KEEPALIVE_MS` (tests use a short interval to assert keepalive frames).
- **Scheduled jobs**: cron schedules (`node-cron`) are restored from persisted job state at startup; a tick is skipped while the job is active. External triggers (`POST /api/v1/trigger/<token>`) are registered before the auth middleware — the token itself is the credential.

## 11. Deployment Checklist

For a brand-new GPU server:

1. Copy SSH key and set `config/servers.json` host/user/port.
2. Run `bash server/install.sh` on the server.
3. Follow `server/MODEL_CHECKLIST.md` to place weights and create symlinks.
4. Run `bash scripts/detect_paths.sh` on the local Mac.
5. Run `bash scripts/check_server.sh`.
6. For customer-series videos, run `npm run setup:customer` once to generate the AI host/voice pools.
7. Run a short end-to-end test video.
