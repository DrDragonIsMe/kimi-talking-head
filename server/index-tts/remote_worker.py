"""Remote IndexTTS2 worker. Reads JSON from stdin, writes JSON to stdout.

Expected input JSON:
{
  "model_dir": "/opt/index-tts/checkpoints",
  "device": "cuda:0",
  "use_fp16": false,
  "use_cuda_kernel": false,
  "use_torch_compile": false,
  "reference_wav": "/opt/index-tts/ref/me_clean.wav",
  "jobs": [{"text": "...", "out": "..."}]
}

Output JSON:
{"results": [{"out": "...", "ok": true|false, "error": "..."}]}
"""
from __future__ import annotations

import json
import sys


class _StdoutToStderr:
    def __init__(self):
        self._real_stdout = sys.stdout

    def __enter__(self):
        sys.stdout = sys.stderr
        return self

    def __exit__(self, *args):
        sys.stdout = self._real_stdout
        return False


def main() -> None:
    job = json.load(sys.stdin)
    from indextts.infer_v2 import IndexTTS2

    model_dir = job.get("model_dir", "checkpoints")
    device = job.get("device", "cuda:0")
    use_fp16 = bool(job.get("use_fp16", False))
    use_cuda_kernel = bool(job.get("use_cuda_kernel", False))
    use_torch_compile = bool(job.get("use_torch_compile", False))

    with _StdoutToStderr():
        tts = IndexTTS2(
            cfg_path=f"{model_dir}/config.yaml",
            model_dir=model_dir,
            use_fp16=use_fp16,
            device=device,
            use_cuda_kernel=use_cuda_kernel,
            use_torch_compile=use_torch_compile,
        )

        ref_wav = job["reference_wav"]
        results = []
        for item in job["jobs"]:
            try:
                tts.infer(
                    spk_audio_prompt=ref_wav,
                    text=item["text"],
                    output_path=item["out"],
                )
                results.append({"out": item["out"], "ok": True, "error": None})
            except Exception as exc:
                results.append({"out": item["out"], "ok": False, "error": str(exc)})

    json.dump({"results": results}, sys.stdout)


if __name__ == "__main__":
    main()
