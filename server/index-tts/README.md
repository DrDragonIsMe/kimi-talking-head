# IndexTTS Remote Worker

`remote_worker.py` is a thin JSON-stdio wrapper around IndexTTS2.

The local `scripts/tts_index.sh` uploads the reference audio and text, then runs this worker on the server via SSH. The worker reads a single JSON job from stdin and writes a JSON result to stdout.

## Input schema

```json
{
  "model_dir": "/root/aigc_apps/index-tts/checkpoints",
  "device": "cuda:0",
  "use_fp16": false,
  "use_cuda_kernel": false,
  "use_torch_compile": false,
  "reference_wav": "/path/to/ref.wav",
  "jobs": [
    {"text": "要合成的文本", "out": "/path/to/out.wav"}
  ]
}
```

## Output schema

```json
{
  "results": [
    {"out": "/path/to/out.wav", "ok": true, "error": ""}
  ]
}
```

## Why a wrapper?

IndexTTS2 model loading is slow. Keeping the model object alive across multiple sentences in one process avoids reloading. This worker loads the model once, synthesizes all jobs, and exits.
