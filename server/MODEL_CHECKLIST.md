# Server Model Checklist

All paths are relative to `/root/aigc_apps/InfiniteTalk/models` unless noted.
Total disk requirement: ~55 GB for InfiniteTalk, plus ~12 GB for MuseTalk.

## ComfyUI / InfiniteTalk

| File | Destination | Size | Source / Notes |
|------|-------------|------|----------------|
| `infinitetalk_single.safetensors` | `models/diffusion_models/` | ~2.5 GB | InfiniteTalk model. Use `MeiGen-AI/InfiniteTalk` release or your own checkpoint. |
| `Wan2_1-I2V-14B-480P_fp8_e5m2.safetensors` | `models/diffusion_models/` | ~16 GB | Wan2.1 I2V 14B 480P fp8. HuggingFace: `Wan-AI/Wan2.1-I2V-14B-480P` or mirror. |
| `Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors` | `models/loras/` | ~0.3 GB | Workflow LoRA. HuggingFace / Civitai search for filename. |
| `Wan2.1_I2V_14B_FusionX_LoRA.safetensors` | `models/loras/` | ~0.35 GB | Optional workflow LoRA. |
| `umt5-xxl-enc-bf16.safetensors` | `models/text_encoders/` | ~10.5 GB | Wan text encoder. HuggingFace: `Kijai/umt5-xxl-enc-bf16` or mirror. |
| `Wan2_1_VAE_fp32.safetensors` | `models/vae/` | ~0.48 GB | Wan VAE. HuggingFace: `Kijai/WanVideoSuite` or mirror. |
| `clip_vision_h.safetensors` | `models/clip_vision/` | ~1.2 GB | CLIP-ViT-H. HuggingFace: `openai/clip-vit-large-patch14` or `Kijai/clip-vision-test`. |

## IndexTTS

Place in `/root/aigc_apps/index-tts/checkpoints/`:

```
checkpoints/
├── README.md
├── bpe.model
├── config.yaml
├── feat1.pt
├── feat2.pt
├── gpt.pth
├── pinyin.vocab
├── qwen0.6bemo4-merge/   (directory)
├── s2mel.pth
├── wav2vec2bert_stats.pt
└── w2v-bert-2.0/          (directory)
```

Download from the official IndexTTS2 model release (Bilibili/HuggingFace). The `remote_worker.py` wrapper expects `checkpoints/config.yaml` and `checkpoints/gpt.pth` to exist.

## Wav2Vec

The workflow uses `TencentGameMate/chinese-wav2vec2-base`. It is downloaded automatically on first use by the `DownloadAndLoadWav2VecModel` node (requires internet or a cached HuggingFace cache).

## MuseTalk

All paths are relative to the MuseTalk install directory (default `/root/aigc_apps/MuseTalk`, or `<data-disk>/aigc_apps/MuseTalk` when the system disk is full).
Total disk requirement: ~12 GB.

### MuseTalk 1.5 (recommended)

```
models/
├── musetalkV15/
│   ├── unet.pth              (~1.4 GB)
│   └── mususetalk.json
├── sd-vae-ft-mse/            (~0.5 GB)
│   ├── config.json
│   └── diffusion_pytorch_model.bin
├── whisper/                  (~0.15 GB)
│   └── tiny.pt  (or base.pt)
├── face-parse-bisent/        (~0.1 GB)
│   ├── 79999_iter.pth
│   └── resnet18-5c106cde.pth
├── mmdet/                    (~0.15 GB)
│   └── mmdet_models/
│       └── retinaface_r50.pth
└── mmpose/                   (~0.1 GB)
    └── mmpose_models/
        └── face-landmarks.pth
```

### MuseTalk 1.0

```
models/
├── musetalk/
│   ├── pytorch_model.bin     (~1.4 GB)
│   └── mususetalk.json
├── sd-vae-ft-mse/
├── whisper/
├── face-parse-bisent/
├── mmdet/
└── mmpose/
```

### Download helpers

The official MuseTalk repo provides a `scripts/download.py` helper. You can also download manually from HuggingFace:

```bash
cd /root/aigc_apps/MuseTalk
source venv/bin/activate

# Use the official download helper if available
python scripts/download.py --model musetalkV15

# Or download via huggingface-cli / wget from the model release page:
# https://huggingface.co/TMElyralab/MuseTalk
```

After downloading, verify the following files exist before running the pipeline:

```bash
ls models/musetalkV15/unet.pth
ls models/sd-vae-ft-mse/config.json
ls models/whisper/tiny.pt
```

For servers with limited system-disk space, `server/install.sh` will automatically install MuseTalk on a data disk (`/data`, `/mnt/data`, `/mnt`, or `/home/data`) when `/root/aigc_apps` has less than 25 GB free.
