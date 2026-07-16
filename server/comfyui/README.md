# ComfyUI / InfiniteTalk Server Scripts

These scripts are copied to `/root/aigc_apps/` during deployment.

## `start.sh`

Starts ComfyUI on `0.0.0.0:8188` with `--disable-cuda-malloc`.

```bash
ssh root@<server>
bash /root/aigc_apps/start.sh
```

## `env.sh`

A small helper that activates the ComfyUI venv and prints the run directory. Used by `install.sh` and can be sourced manually:

```bash
source /root/aigc_apps/env.sh
```

## `monitor.sh`

Optional monitor used by `run_server_side.sh` when running long lip-sync jobs. It logs queue length, GPU utilization, and the last line of the job log every 60 seconds. It exits when `generate_segments.py` is no longer running.

You normally do not need to run this manually; the pipeline handles it.
