#!/usr/bin/env python3
"""ComfyUI API client for InfiniteTalk video generation.

This script automates the full ComfyUI workflow:
1. Establish SSH tunnel to remote ComfyUI port 8188.
2. Upload reference image and audio via ComfyUI /upload endpoints.
3. Patch workflow prompt with runtime parameters and uploaded filenames.
4. Submit prompt to /prompt.
5. Poll /history/{prompt_id} until completion.
6. Download output video to local output path.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

import requests


class PromptLostError(RuntimeError):
    """Raised when a submitted prompt disappears from ComfyUI history/queue (e.g. server restart)."""
    pass


SSH_OPTS = [
    "-o", "ConnectTimeout=10",
    "-o", "BatchMode=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=10",
    "-o", "TCPKeepAlive=yes",
    "-o", "ExitOnForwardFailure=yes",
]


def request_with_retry(method, url, max_retries=3, timeout=60, **kwargs):
    """Make a requests call with simple exponential backoff."""
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.request(method, url, timeout=timeout, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            last_err = e
            detail = ""
            if hasattr(e, "response") and e.response is not None:
                try:
                    body = e.response.text[:500]
                    detail = f" [status={e.response.status_code} body={body}]"
                except Exception:
                    pass
            print(f"Request {method.upper()} {url} failed (attempt {attempt}/{max_retries}): {e}{detail}")
            if attempt < max_retries:
                time.sleep(min(30, 2 ** attempt))
    raise last_err


def load_json(path):
    with open(path) as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def find_executable(name):
    """Find executable path, preferring absolute path if available."""
    path = shutil.which(name)
    if path:
        return path
    # common macOS / Linux locations
    for candidate in ["/usr/bin/ssh", "/usr/local/bin/ssh", "/opt/homebrew/bin/ssh"]:
        if os.path.isfile(candidate):
            return candidate
    raise FileNotFoundError(f"{name} not found in PATH")


def start_tunnel(host, port, user, local_port=18188, remote_host="localhost", remote_port=8188):
    """Start SSH tunnel and return subprocess handle."""
    ssh_cmd = [
        find_executable("ssh"),
        *SSH_OPTS,
        "-f", "-N",
        "-L", f"{local_port}:{remote_host}:{remote_port}",
        f"{user}@{host}",
        "-p", str(port),
    ]
    print(f"Starting SSH tunnel: {' '.join(ssh_cmd)}")
    proc = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # Wait briefly for tunnel to establish
    for _ in range(30):
        if is_port_open(local_port):
            print(f"Tunnel established on localhost:{local_port}")
            return proc, local_port
        ret = proc.poll()
        if ret is not None:
            out = proc.stdout.read().decode("utf-8", errors="ignore")
            err = proc.stderr.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"SSH tunnel exited early with code {ret}. stdout={out}, stderr={err}")
        time.sleep(0.5)
    proc.terminate()
    raise RuntimeError(f"SSH tunnel did not open localhost:{local_port} in time")


def is_port_open(port, host="localhost"):
    import socket
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def stop_tunnel(proc):
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    print("SSH tunnel closed")


def wait_for_comfyui(base_url, timeout=60):
    print(f"Waiting for ComfyUI at {base_url} ...")
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = requests.get(f"{base_url}/system_stats", timeout=5)
            if resp.status_code == 200:
                print("ComfyUI is ready")
                return True
        except requests.RequestException:
            pass
        time.sleep(1)
    raise RuntimeError(f"ComfyUI not reachable at {base_url} after {timeout}s")


def upload_file(base_url, endpoint, file_path):
    """Upload a file to ComfyUI upload endpoint.

    ComfyUI uses /upload/image as the generic upload endpoint for all
    input files (images, audio, video). The form field must be named 'image'.
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Upload file not found: {file_path}")
    url = f"{base_url}{endpoint}"
    with open(file_path, "rb") as f:
        # Always use 'image' field, even for audio files
        resp = requests.post(url, files={"image": f}, timeout=300)
    resp.raise_for_status()
    data = resp.json()
    print(f"Uploaded {file_path.name} -> {data}")
    return data


def resolve_uploaded_filename(upload_data, original_name):
    """Return the filename as stored by ComfyUI upload endpoint."""
    name = upload_data.get("name") or upload_data.get("filename")
    if name:
        return name
    # Fallback: ComfyUI sometimes returns subfolder/type info
    subfolder = upload_data.get("subfolder", "")
    if subfolder:
        return f"{subfolder}/{original_name}"
    return original_name


def get_audio_duration(audio_path):
    """Return audio duration in seconds using wave or ffprobe fallback."""
    audio_path = Path(audio_path)
    # Try WAV first (fast)
    try:
        import wave
        with wave.open(str(audio_path), "r") as f:
            frames = f.getnframes()
            rate = f.getframerate()
            if rate:
                return frames / float(rate)
    except Exception:
        pass

    # Fallback to ffprobe
    try:
        ffprobe = shutil.which("ffprobe") or "/usr/bin/ffprobe"
        out = subprocess.check_output(
            [
                ffprobe,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ],
            stderr=subprocess.DEVNULL,
        )
        return float(out.decode().strip())
    except Exception as e:
        print(f"Warning: could not determine audio duration: {e}")
        return 0.0


def _format_hms(seconds):
    """Format seconds as M:SS for AudioCrop widgets."""
    seconds = max(0, int(seconds))
    m = seconds // 60
    s = seconds % 60
    return f"{m}:{s:02d}"


def patch_prompt(prompt, image_filename, audio_filename, profile, audio_path=None,
                 segment_start=0.0, segment_duration=None):
    """Patch prompt with runtime filenames, audio duration, and profile parameters."""
    it = profile.get("infinitetalk", {})

    # Resolve resolution from profile
    size_label = it.get("size", "infinitetalk-480")
    if size_label == "infinitetalk-720":
        width, height = 1280, 720
    elif size_label == "infinitetalk-480":
        width, height = 832, 480
    elif size_label == "infinitetalk-480-fast":
        # Lower width for faster inference while keeping 480 height
        width, height = 640, 480
    else:
        # Default to 480P to keep generation fast
        width, height = 832, 480

    # Ensure multiples of 16 (Wan wants this)
    width = (width // 16) * 16
    height = (height // 16) * 16

    fps = 25
    max_frames = 1000  # MultiTalkWav2VecEmbeds hard limit in current node
    audio_duration = get_audio_duration(audio_path) if audio_path else 0.0

    # Segment handling
    segment_start = max(0.0, float(segment_start))
    if segment_duration is None or segment_duration <= 0:
        segment_duration = audio_duration - segment_start
    segment_duration = max(0.0, float(segment_duration))
    segment_end = segment_start + segment_duration

    # Clamp to audio bounds
    if audio_duration > 0:
        segment_end = min(segment_end, audio_duration)
        segment_duration = segment_end - segment_start

    num_frames = min(int(segment_duration * fps), max_frames)

    # Positive / negative prompts tuned for a male business host / news anchor
    positive_prompt = (
        "A professional male business host in a dark suit, sitting and facing the camera, "
        "speaking with natural lip sync. Clean studio lighting, neutral background, "
        "sharp facial features, confident expression, photorealistic."
    )
    negative_prompt = (
        "woman, female, feminine, makeup, lipstick, long hair, bright tones, overexposed, "
        "static, blurred details, subtitles, style, paintings, images, overall gray, "
        "worst quality, low quality, JPEG compression residue, ugly, incomplete, "
        "extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, "
        "misshapen limbs, fused fingers, still picture, messy background, three legs, "
        "many people in the background, walking backwards"
    )

    # Inject TeaCache node once and wire it to the sampler
    teacache_node_id = None
    for node_id in list(prompt.keys()):
        if prompt[node_id].get("class_type") == "WanVideoTeaCache":
            teacache_node_id = node_id
            break
    if teacache_node_id is None:
        teacache_node_id = "999"
        # Find an unused id just in case
        while teacache_node_id in prompt:
            teacache_node_id = str(int(teacache_node_id) + 1)
        prompt[teacache_node_id] = {
            "inputs": {
                "rel_l1_thresh": float(it.get("teacache_thresh", 0.2)),
                "start_step": 1,
                "end_step": -1,
                "cache_device": "offload_device",
                "use_coefficients": True,
            },
            "class_type": "WanVideoTeaCache",
            "_meta": {"title": "WanVideo TeaCache"},
        }

    for node_id, node in prompt.items():
        cls = node.get("class_type", "")
        inputs = node.get("inputs", {})

        if cls == "MultiTalkModelLoader":
            inputs["model"] = "infinitetalk_single.safetensors"
            inputs["base_precision"] = "fp16"

        elif cls == "WanVideoModelLoader":
            inputs["model"] = "Wan2_1-I2V-14B-480P_fp8_e5m2.safetensors"
            inputs["base_precision"] = it.get("base_precision", "fp16")
            # Use a quantization that matches the fp8_e5m2 weights and the GPU
            # compute capability (>=8.9). _fast modes use FP8 matmul and are
            # measurably faster than plain e4m3fn conversion.
            inputs["quantization"] = it.get("quantization", "fp8_e5m2_fast")
            inputs["load_device"] = "offload_device"
            inputs["attention_mode"] = it.get("attention_mode", "sdpa")
            # Leave compile_args disconnected to disable torch.compile (the
            # WanVideoTorchCompileSettings node is kept for UI compatibility but
            # its output is not wired to the model loader).

        elif cls == "WanVideoTorchCompileSettings":
            # This node is intentionally left unwired from the model loader, so
            # torch.compile is disabled. Keep valid defaults for schema validation.
            inputs["backend"] = "inductor"

        elif cls == "LoadAudio":
            inputs["audio"] = audio_filename

        elif cls == "ImageOrVideoUpload":
            inputs["input file"] = image_filename

        elif cls == "ImageResizeKJv2":
            inputs["width"] = width
            inputs["height"] = height
            # Pad instead of crop so the host's whole face stays in frame
            inputs["keep_proportion"] = "pad"
            inputs["pad_color"] = "0, 0, 0"
            inputs["crop_position"] = "center"
            inputs["divisible_by"] = 2

        elif cls == "WanVideoImageToVideoMultiTalk":
            inputs["width"] = width
            inputs["height"] = height
            inputs["frame_window_size"] = 81
            inputs["motion_frame"] = int(it.get("motion_frame", 4))
            inputs["force_offload"] = bool(it.get("low_vram", True))

        elif cls == "WanVideoSampler":
            inputs["steps"] = int(it.get("sample_steps", 8))
            inputs["cfg"] = float(it.get("text_guide_scale", 1.0))
            inputs["shift"] = float(it.get("sample_shift", 2.0))
            inputs["seed"] = int(it.get("seed", 42))
            inputs["force_offload"] = True
            # "multitalk" is advertised in scheduler_list but not implemented in
            # ComfyUI-WanVideoWrapper's get_scheduler. Use a supported scheduler.
            inputs["scheduler"] = "unipc"
            inputs["riflex_freq_index"] = 0
            inputs["rope_function"] = "comfy"
            # Wire TeaCache
            inputs["cache_args"] = [teacache_node_id, 0]
            # Remove any UI-only / stale keys that may have been carried over
            inputs.pop("denoise_strength", None)
            inputs.pop("batched_cfg", None)

        elif cls == "WanVideoTextEncode":
            inputs["positive_prompt"] = positive_prompt
            inputs["negative_prompt"] = negative_prompt
            inputs["force_offload"] = True

        elif cls == "WanVideoLoraSelect":
            lora_dir = it.get("lora_dir", "")
            if lora_dir and lora_dir != "null":
                # ComfyUI expects filename in models/loras, so use basename if full path
                lora_name = os.path.basename(lora_dir)
                inputs["lora"] = lora_name
                inputs["strength"] = float(it.get("lora_scale", 1.0))
            inputs["low_mem_load"] = bool(it.get("low_vram", True))

        elif cls == "WanVideoBlockSwap":
            if it.get("low_vram", True):
                inputs["blocks_to_swap"] = int(it.get("blocks_to_swap", 36))
                inputs["offload_img_emb"] = True
                inputs["offload_txt_emb"] = True
                inputs["use_non_blocking"] = bool(it.get("use_non_blocking", True))

        elif cls == "MultiTalkWav2VecEmbeds":
            inputs["num_frames"] = num_frames
            inputs["fps"] = fps
            inputs["audio_scale"] = float(it.get("audio_guide_scale", 2.0))
            inputs["audio_cfg_scale"] = 1
            inputs["multi_audio_type"] = "para"
            inputs["normalize_loudness"] = True

        elif cls == "AudioCrop":
            inputs["start_time"] = _format_hms(segment_start)
            inputs["end_time"] = _format_hms(segment_end)

        elif cls == "VHS_VideoCombine":
            inputs["images"] = ["130", 0]
            inputs["audio"] = ["159", 0]
            inputs["filename_prefix"] = "infinitetalk_output"
            inputs["frame_rate"] = fps
            inputs["format"] = "video/h264-mp4"
            inputs["pix_fmt"] = "yuv420p"
            inputs["crf"] = 19
            inputs["save_metadata"] = True
            inputs["trim_to_audio"] = False
            inputs["pingpong"] = False
            inputs["save_output"] = True
            # Remove UI-only hidden fields carried over from workflow export
            inputs.pop("videopreview", None)

    return prompt


def submit_prompt(base_url, prompt, max_retries=3):
    """Submit prompt to ComfyUI and return prompt_id."""
    payload = {"prompt": prompt}
    resp = request_with_retry("post", f"{base_url}/prompt", max_retries=max_retries, timeout=60, json=payload)
    data = resp.json()
    print(f"Prompt submitted: {data}")
    return data["prompt_id"]


def queue_is_empty(base_url):
    """Return True if ComfyUI queue has no running/pending jobs."""
    try:
        resp = request_with_retry("get", f"{base_url}/queue", max_retries=2, timeout=10)
        data = resp.json()
        return len(data.get("queue_running", [])) == 0 and len(data.get("queue_pending", [])) == 0
    except Exception as e:
        print(f"Could not check queue status: {e}")
        return False


def poll_history(base_url, prompt_id, timeout=3600, interval=5, log_interval=60):
    """Poll ComfyUI history until prompt completes.

    Logs a heartbeat every ``log_interval`` seconds so long-running inference
    does not look frozen in the orchestrator output.
    """
    print(f"Polling prompt {prompt_id} ...")
    start = time.time()
    last_log = start
    missing_count = 0
    while time.time() - start < timeout:
        try:
            resp = request_with_retry("get", f"{base_url}/history/{prompt_id}", max_retries=3, timeout=30)
            data = resp.json()
        except requests.RequestException as e:
            print(f"Poll error: {e}, retrying...")
            time.sleep(interval)
            continue

        if data and prompt_id in data:
            missing_count = 0
            entry = data[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                messages = status.get("messages", [])
                raise RuntimeError(f"ComfyUI job failed: {messages}")
            outputs = entry.get("outputs", {})
            if outputs:
                elapsed = time.time() - start
                print(f"Prompt {prompt_id} completed in {elapsed:.1f}s")
                return entry
        else:
            missing_count += 1
            # If prompt is missing from history for ~60s while queue is empty,
            # the server likely restarted and lost the job.
            if missing_count >= 12 and queue_is_empty(base_url):
                raise PromptLostError(f"Prompt {prompt_id} lost: not in history and queue empty")
        now = time.time()
        if now - last_log >= log_interval:
            print(f"Still waiting for {prompt_id} ({now - start:.0f}s elapsed)...")
            last_log = now
        time.sleep(interval)
    raise RuntimeError(f"Timeout waiting for prompt {prompt_id} (>{timeout}s)")


def _find_output_items(node_outputs):
    """Recursively find dict items that contain a filename in a node output."""
    items = []
    if isinstance(node_outputs, dict):
        if "filename" in node_outputs:
            items.append(node_outputs)
        else:
            for value in node_outputs.values():
                items.extend(_find_output_items(value))
    elif isinstance(node_outputs, list):
        for item in node_outputs:
            items.extend(_find_output_items(item))
    return items


def probe_duration(path: str) -> float:
    """Return media duration in seconds using ffprobe."""
    ffprobe = shutil.which("ffprobe") or "/usr/bin/ffprobe"
    try:
        out = subprocess.check_output(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stderr=subprocess.DEVNULL,
        )
        return float(out.decode().strip())
    except Exception as e:
        raise RuntimeError(f"Could not determine duration for {path}: {e}")


def download_output(base_url, entry, output_dir):
    """Download the first video output from history entry.

    VHS_VideoCombine can emit two files: a silent video and a separate
    '-audio.mp4' that contains both video and audio tracks. Prefer the
    combined file so downstream concatenation has sound.
    """
    outputs = entry.get("outputs", {})
    candidates = []
    for node_id, node_outputs in outputs.items():
        for item in _find_output_items(node_outputs):
            filename = item.get("filename")
            if filename:
                candidates.append(item)

    if not candidates:
        raise RuntimeError("No downloadable output found in history entry")

    # Prefer the combined audio/video file (VHS naming convention).
    candidates.sort(key=lambda item: (not item["filename"].endswith("-audio.mp4"), item["filename"]))

    for item in candidates:
        filename = item.get("filename")
        subfolder = item.get("subfolder", "")
        file_type = item.get("type", "output")
        params = {"filename": filename, "subfolder": subfolder, "type": file_type}
        url = f"{base_url}/view?" + urllib.parse.urlencode(params)
        print(f"Downloading {filename} from {url} ...")
        resp = request_with_retry("get", url, max_retries=3, timeout=300)
        output_path = Path(output_dir) / filename
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(resp.content)
        print(f"Saved to {output_path}")
        return output_path


def main():
    parser = argparse.ArgumentParser(description="Run InfiniteTalk via ComfyUI API")
    parser.add_argument("--config", default="config/servers.json", help="servers config")
    parser.add_argument("--profile", default="config/host_profile.json", help="host profile")
    parser.add_argument("--workflow", default="scripts/comfyui/workflow_prompt.json", help="API workflow prompt JSON")
    parser.add_argument("--image", required=True, help="Reference image path")
    parser.add_argument("--audio", required=True, help="Audio path")
    parser.add_argument("--output-dir", default="output", help="Output directory")
    parser.add_argument("--output", help="Final output file path (optional, overrides output-dir naming)")
    parser.add_argument("--local-port", type=int, default=18188, help="Local tunnel port")
    parser.add_argument("--use-tunnel", action="store_true", help="Use SSH tunnel to remote ComfyUI (default: direct localhost connection)")
    parser.add_argument("--max-resubmits", type=int, default=2, help="Max times to resubmit a lost prompt")
    parser.add_argument("--prompt-suffix", default="", help="Suffix for patched prompt debug filename (for segmentation)")
    parser.add_argument("--start-time", type=float, default=0.0, help="Audio start time in seconds (for segmentation)")
    parser.add_argument("--duration", type=float, default=None, help="Max duration in seconds for this segment")
    args = parser.parse_args()

    project_dir = Path(__file__).resolve().parents[2]
    os.chdir(project_dir)

    servers = load_json(args.config)
    profile = load_json(args.profile)
    primary = servers["primary"]

    tunnel_proc = None
    use_tunnel = args.use_tunnel or os.environ.get("COMFYUI_USE_TUNNEL") in ("1", "true", "yes")
    try:
        if use_tunnel:
            tunnel_proc, local_port = start_tunnel(
                primary["host"], primary["port"], primary["user"], args.local_port
            )
            base_url = f"http://localhost:{local_port}"
            wait_for_comfyui(base_url)
        else:
            local_port = int(os.environ.get("COMFYUI_PORT", "8188"))
            base_url = f"http://localhost:{local_port}"
            print(f"Connecting directly to ComfyUI at {base_url} (no SSH tunnel)")
            wait_for_comfyui(base_url)

        image_data = upload_file(base_url, "/upload/image", args.image)
        audio_data = upload_file(base_url, "/upload/image", args.audio)
        image_name = resolve_uploaded_filename(image_data, Path(args.image).name)
        audio_name = resolve_uploaded_filename(audio_data, Path(args.audio).name)

        prompt = load_json(args.workflow)
        prompt = patch_prompt(
            prompt, image_name, audio_name, profile,
            audio_path=args.audio,
            segment_start=args.start_time,
            segment_duration=args.duration,
        )

        # Save patched prompt for debugging
        suffix = args.prompt_suffix or ""
        patched_name = f"comfyui_prompt_patched{suffix}.json"
        patched_path = Path(args.output_dir) / patched_name
        patched_path.parent.mkdir(parents=True, exist_ok=True)
        save_json(patched_path, prompt)
        print(f"Saved patched prompt to {patched_path}")

        poll_timeout = int(profile.get("infinitetalk", {}).get("poll_timeout", 7200))

        # Submit and poll, with automatic resubmission if the prompt is lost.
        entry = None
        resubmits = 0
        while True:
            prompt_id = submit_prompt(base_url, prompt)
            try:
                entry = poll_history(base_url, prompt_id, timeout=poll_timeout)
                break
            except PromptLostError as e:
                if resubmits >= args.max_resubmits:
                    raise RuntimeError(f"Prompt lost and max resubmits ({args.max_resubmits}) exceeded") from e
                resubmits += 1
                print(f"⚠️ {e}; resubmitting ({resubmits}/{args.max_resubmits}) ...")
                time.sleep(5)

        output_path = download_output(base_url, entry, args.output_dir)
        if args.output:
            final_path = Path(args.output)
            final_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(output_path), str(final_path))
            output_path = final_path

        # Validate output duration when expected duration is provided.
        if args.duration:
            actual = probe_duration(str(output_path))
            expected = float(args.duration)
            ratio = actual / expected if expected > 0 else 1.0
            print(f"Output duration validation: actual={actual:.2f}s, expected={expected:.2f}s, ratio={ratio:.2f}")
            if ratio < 0.9:
                raise RuntimeError(f"Output duration too short: {actual:.2f}s vs expected {expected:.2f}s")

        print(f"SUCCESS: {output_path}")
    finally:
        stop_tunnel(tunnel_proc)


if __name__ == "__main__":
    main()
