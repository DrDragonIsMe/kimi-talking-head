# Server Model Checklist

All paths are relative to `/root/aigc_apps/InfiniteTalk/models` unless noted.
Total disk requirement: ~55 GB.

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
