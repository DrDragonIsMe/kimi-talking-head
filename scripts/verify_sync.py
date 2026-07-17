#!/usr/bin/env python3
"""Verify A/V sync by comparing rendered host window with raw lip-synced video.

Usage:
    python scripts/verify_sync.py <rendered.mp4> <raw_lip_synced.mp4> <title_card_frames> <audio_time>
"""
import subprocess
import sys
import tempfile
from pathlib import Path


def extract_frame(video: Path, frame: int, out: Path):
    """Extract a single frame using ffmpeg."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video),
            "-vf", f"select=eq(n\\,{frame})", "-vframes", "1",
            "-q:v", "2", str(out),
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def crop_host_window(src: Path, dst: Path, x: int, y: int, w: int, h: int):
    """Crop host window from rendered frame."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-vf", f"crop={w}:{h}:{x}:{y}",
            "-q:v", "2", str(dst),
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def prepare_raw_crop(src: Path, dst: Path, target_w: int, target_h: int):
    """Crop and scale raw 720x960 to match rendered host window object-fit: cover."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-vf",
            (
                f"scale={target_w}:-1,"
                f"crop={target_w}:{target_h}:0:(in_h-{target_h})/2"
            ),
            "-q:v", "2", str(dst),
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def compute_mse(a: Path, b: Path) -> float:
    """Compute MSE between two images using ffmpeg."""
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(a), "-i", str(b),
            "-lavfi", "[0:v][1:v]blend=all_mode=difference,histeq,signalstats",
            "-f", "null", "-",
        ],
        capture_output=True, text=True,
    )
    # Parse Mean average from signalstats output in stderr
    for line in result.stderr.splitlines():
        if "YAVG" in line or "lavfi.signalstats.YAVG" in line:
            print(line)
    return 0.0


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)
    rendered = Path(sys.argv[1])
    raw = Path(sys.argv[2])
    title_card_frames = int(sys.argv[3])
    audio_time = float(sys.argv[4])

    rendered_frame = title_card_frames + int(audio_time * 30)
    raw_frame = int(audio_time * 30)

    # Host window geometry for portrait-hybrid balanced preset with overrides
    host_x, host_y, host_w, host_h = 260, 1197, 560, 640

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        rendered_frame_path = tmp / "rendered_frame.png"
        raw_frame_path = tmp / "raw_frame.png"
        rendered_host = tmp / "rendered_host.png"
        raw_host = tmp / "raw_host.png"

        extract_frame(rendered, rendered_frame, rendered_frame_path)
        extract_frame(raw, raw_frame, raw_frame_path)
        crop_host_window(rendered_frame_path, rendered_host, host_x, host_y, host_w, host_h)
        prepare_raw_crop(raw_frame_path, raw_host, host_w, host_h)

        out_dir = Path("output/sync_verify") / rendered.stem
        out_dir.mkdir(parents=True, exist_ok=True)
        suffix = f"t{audio_time:.2f}_rf{rendered_frame}_raw{raw_frame}"
        final_rendered = out_dir / f"rendered_host_{suffix}.png"
        final_raw = out_dir / f"raw_host_{suffix}.png"
        rendered_host.rename(final_rendered)
        raw_host.rename(final_raw)

        print(f"Audio time: {audio_time}s")
        print(f"Rendered frame: {rendered_frame}, raw frame: {raw_frame}")
        print(f"Rendered host crop: {final_rendered}")
        print(f"Raw host crop:      {final_raw}")


if __name__ == "__main__":
    main()
