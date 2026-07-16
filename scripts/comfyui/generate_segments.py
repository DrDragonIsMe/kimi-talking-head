#!/usr/bin/env python3
"""Generate long-form InfiniteTalk videos via ComfyUI by splitting audio into segments.

This orchestrator:
1. Reads the host profile and audio duration.
2. Splits the audio into <=40 s segments (configurable).
3. Optionally overlaps adjacent segments and crossfades them during stitch.
4. Calls scripts/comfyui/comfyui_client.py for each segment.
5. Retries failed segments.
6. Concatenates segments with ffmpeg.
7. Validates the final duration and cleans up intermediates.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass
class Segment:
    index: int
    start: float
    duration: float
    output: Path


def load_json(path: str):
    with open(path) as f:
        return json.load(f)


def probe_duration(path: str) -> float:
    """Return media duration in seconds using ffprobe."""
    ffprobe = shutil.which("ffprobe") or "/usr/bin/ffprobe"
    try:
        out = subprocess.check_output(
            [
                ffprobe,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            stderr=subprocess.DEVNULL,
        )
        return float(out.decode().strip())
    except Exception as e:
        raise RuntimeError(f"Could not determine duration for {path}: {e}")


def compute_segments(
    total_duration: float,
    segment_duration: float,
    overlap: float,
    output_dir: Path,
    prefix: str = "segment",
) -> List[Segment]:
    """Compute segment boundaries with optional overlap.

    Each segment renders at most ``segment_duration`` seconds of audio.
    Adjacent segments overlap by ``overlap`` seconds, which creates a shared
    region that can be crossfaded during stitching.
    """
    if segment_duration <= 0:
        raise ValueError("segment_duration must be > 0")
    if overlap < 0:
        raise ValueError("overlap must be >= 0")
    if overlap >= segment_duration:
        raise ValueError("overlap must be smaller than segment_duration")

    step = segment_duration - overlap
    segments: List[Segment] = []
    i = 0
    while True:
        start = i * step
        if start >= total_duration:
            break
        duration = min(segment_duration, total_duration - start)
        output = output_dir / f"{prefix}_seg{i:03d}.mp4"
        segments.append(Segment(index=i, start=start, duration=duration, output=output))
        if start + duration >= total_duration:
            break
        i += 1

    return segments


def segment_is_valid(segment: Segment) -> bool:
    """Return True if the segment output already exists and has positive duration."""
    if not segment.output.exists() or segment.output.stat().st_size == 0:
        return False
    try:
        duration = probe_duration(str(segment.output))
        return duration > 0
    except Exception:
        return False


def run_segment(
    client_script: Path,
    config: str,
    profile: str,
    workflow: str,
    image: str,
    audio: str,
    segment: Segment,
    local_port: int,
    max_retries: int,
    no_tunnel: bool = False,
    resume: bool = False,
) -> None:
    """Call comfyui_client.py for one segment, retrying on failure."""
    if resume and segment_is_valid(segment):
        print(f"[Segment {segment.index}] output already exists and looks valid, skipping: {segment.output}")
        return

    suffix = f"_seg{segment.index:03d}"
    cmd = [
        sys.executable,
        str(client_script),
        "--config", config,
        "--profile", profile,
        "--workflow", workflow,
        "--image", image,
        "--audio", audio,
        "--start-time", str(segment.start),
        "--duration", str(segment.duration),
        "--local-port", str(local_port),
        "--output-dir", str(segment.output.parent),
        "--output", str(segment.output),
        "--prompt-suffix", suffix,
    ]
    if not no_tunnel:
        cmd.append("--use-tunnel")

    last_error = None
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    for attempt in range(1, max_retries + 1):
        print(f"\n[Segment {segment.index}] Attempt {attempt}/{max_retries}: start={segment.start:.2f}s duration={segment.duration:.2f}s -> {segment.output}")
        seg_start = time.time()
        try:
            subprocess.run(cmd, check=True, env=env)
            if not segment.output.exists():
                raise RuntimeError("Client succeeded but output file is missing")
            elapsed = time.time() - seg_start
            print(f"[Segment {segment.index}] done in {elapsed:.1f}s")
            return
        except subprocess.CalledProcessError as e:
            last_error = e
            elapsed = time.time() - seg_start
            print(f"[Segment {segment.index}] Attempt {attempt} failed after {elapsed:.1f}s: {e}")
            if attempt < max_retries:
                wait = min(60, 10 * attempt)
                print(f"[Segment {segment.index}] Retrying in {wait}s...")
                time.sleep(wait)

    raise RuntimeError(f"Segment {segment.index} failed after {max_retries} attempts: {last_error}")


def concat_segments_copy(segments: List[Segment], output: Path) -> None:
    """Fast concat using ffmpeg concat demuxer with -c copy."""
    list_file = output.parent / "seg_files.txt"
    with open(list_file, "w") as f:
        for seg in segments:
            f.write(f"file '{seg.output.resolve()}'\n")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c", "copy",
        str(output),
    ]
    subprocess.run(cmd, check=True)
    list_file.unlink(missing_ok=True)


def concat_segments_crossfade(
    segments: List[Segment],
    output: Path,
    segment_duration: float,
    overlap: float,
    crossfade: float,
) -> None:
    """Concat segments with chained xfade/acrossfade transitions.

    Segments are expected to overlap by ``overlap`` seconds. The output timeline
    keeps the original audio length by fading across the overlapping regions.
    """
    if len(segments) == 1:
        shutil.copy(str(segments[0].output), str(output))
        return

    inputs: List[str] = []
    for seg in segments:
        inputs.extend(["-i", str(seg.output)])

    video_parts = []
    audio_parts = []
    prev_v = "[0:v]"
    prev_a = "[0:a]"
    for i in range(len(segments) - 1):
        # Original-audio boundary between segment i and i+1.
        boundary = (i + 1) * segment_duration - i * overlap
        offset = boundary - crossfade

        next_v = f"[{i + 1}:v]"
        next_a = f"[{i + 1}:a]"
        out_v = f"[v{i}]" if i < len(segments) - 2 else "[vout]"
        out_a = f"[a{i}]" if i < len(segments) - 2 else "[aout]"

        video_parts.append(
            f"{prev_v}{next_v}xfade=transition=fade:duration={crossfade:.3f}:offset={offset:.3f}{out_v}"
        )
        audio_parts.append(
            f"{prev_a}{next_a}acrossfade=d={crossfade:.3f}{out_a}"
        )
        prev_v = out_v
        prev_a = out_a

    filter_complex = ";".join(video_parts + audio_parts)
    cmd = [
        "ffmpeg", "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        str(output),
    ]
    subprocess.run(cmd, check=True)


def validate_output(output: Path, expected_duration: float, tolerance: float = 0.02) -> None:
    """Ensure stitched output duration is within tolerance of expected."""
    actual = probe_duration(str(output))
    ratio = actual / expected_duration if expected_duration > 0 else 1.0
    print(f"[Validate] stitched duration={actual:.2f}s, expected={expected_duration:.2f}s, ratio={ratio:.3f}")
    if ratio < 1.0 - tolerance:
        raise RuntimeError(f"Stitched video too short: {actual:.2f}s vs expected {expected_duration:.2f}s")


def main():
    parser = argparse.ArgumentParser(description="Generate long-form InfiniteTalk via ComfyUI segmentation")
    parser.add_argument("--config", default="config/servers.json", help="servers config")
    parser.add_argument("--profile", default="config/host_profile.json", help="host profile")
    parser.add_argument("--workflow", default="scripts/comfyui/workflow_prompt.json", help="API workflow prompt JSON")
    parser.add_argument("--image", required=True, help="Reference image path")
    parser.add_argument("--audio", required=True, help="Audio path")
    parser.add_argument("--output", required=True, help="Final stitched output path")
    parser.add_argument("--work-dir", help="Working directory for intermediate segments")
    parser.add_argument("--segment-duration", type=float, help="Max seconds per ComfyUI pass")
    parser.add_argument("--overlap", type=float, help="Overlap between adjacent segments")
    parser.add_argument("--crossfade", type=float, help="Crossfade duration (requires 0 < crossfade <= overlap)")
    parser.add_argument("--max-retries", type=int, help="Per-segment retries")
    parser.add_argument("--keep-segments", action="store_true", help="Keep intermediate segment files")
    parser.add_argument("--use-tunnel", action="store_true", help="Use SSH tunnel to remote ComfyUI (default: direct localhost connection)")
    parser.add_argument("--resume", action="store_true", help="Skip segments that already have a valid output file")
    args = parser.parse_args()

    project_dir = Path(__file__).resolve().parents[2]
    os.chdir(project_dir)

    profile = load_json(args.profile)
    it = profile.get("infinitetalk", {})

    segment_duration = args.segment_duration if args.segment_duration is not None else float(it.get("segment_duration", 40))
    overlap = args.overlap if args.overlap is not None else float(it.get("segment_overlap", 0))
    crossfade = args.crossfade if args.crossfade is not None else float(it.get("crossfade_duration", 0))
    max_retries = args.max_retries if args.max_retries is not None else int(it.get("max_retries", 1))
    keep_segments = args.keep_segments or bool(it.get("keep_segments", False))

    if overlap < 0 or overlap >= segment_duration:
        raise ValueError(f"overlap ({overlap}) must be in [0, segment_duration)")
    if crossfade < 0:
        raise ValueError(f"crossfade ({crossfade}) must be >= 0")
    if overlap == 0 and crossfade > 0:
        raise ValueError("crossfade requires overlap > 0")
    if crossfade > overlap:
        raise ValueError(f"crossfade ({crossfade}) cannot exceed overlap ({overlap})")

    audio_duration = probe_duration(args.audio)
    print(f"[Audio] duration={audio_duration:.2f}s, segment_duration={segment_duration}s, overlap={overlap}s, crossfade={crossfade}s")

    work_dir = Path(args.work_dir) if args.work_dir else Path(args.output).parent
    work_dir.mkdir(parents=True, exist_ok=True)

    segments = compute_segments(
        total_duration=audio_duration,
        segment_duration=segment_duration,
        overlap=overlap,
        output_dir=work_dir,
        prefix="lip_synced_raw",
    )
    print(f"[Plan] {len(segments)} segment(s)")
    for seg in segments:
        print(f"  seg{seg.index:03d}: {seg.start:.2f}s - {seg.start + seg.duration:.2f}s ({seg.duration:.2f}s) -> {seg.output.name}")

    use_tunnel = args.use_tunnel or os.environ.get("COMFYUI_USE_TUNNEL") in ("1", "true", "yes")
    no_tunnel = not use_tunnel
    local_port_base = 8188 if no_tunnel else 18188
    client_script = project_dir / "scripts" / "comfyui" / "comfyui_client.py"
    start_time = time.time()
    for seg in segments:
        run_segment(
            client_script=client_script,
            config=args.config,
            profile=args.profile,
            workflow=args.workflow,
            image=args.image,
            audio=args.audio,
            segment=seg,
            local_port=local_port_base + (0 if no_tunnel else seg.index),
            max_retries=max_retries,
            no_tunnel=no_tunnel,
            resume=args.resume,
        )
    print(f"\n[Segments] all {len(segments)} segment(s) finished in {time.time() - start_time:.1f}s")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    print(f"\n[Stitch] concatenating {len(segments)} segment(s) -> {output}")
    if crossfade > 0:
        concat_segments_crossfade(segments, output, segment_duration, overlap, crossfade)
    else:
        concat_segments_copy(segments, output)

    validate_output(output, audio_duration)

    if not keep_segments:
        for seg in segments:
            seg.output.unlink(missing_ok=True)
        (work_dir / "seg_files.txt").unlink(missing_ok=True)
        print("[Cleanup] intermediate segment files removed")
    else:
        print("[Cleanup] kept intermediate segment files (--keep-segments)")

    print(f"[Done] {output}")


if __name__ == "__main__":
    main()
