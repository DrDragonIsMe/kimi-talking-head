#!/bin/bash
cd /root/aigc_apps/InfiniteTalk
source venv/bin/activate
python main.py --disable-cuda-malloc --listen 0.0.0.0
