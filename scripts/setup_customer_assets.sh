#!/bin/bash
set -euo pipefail

# setup_customer_assets.sh
#
# 一键准备「客户说」系列所需的 AI 合成人物视频池与女声参考音频池。
# 新克隆仓库或需要焕新形象/音色时执行一次即可；产物写入
#   assets/host/customers/   (视频 + 首帧照片)
#   assets/voice/customers/  (变调参考音频)
# 这些目录已在 .gitignore 中排除，不会被提交。
#
# 依赖：bl (百炼 CLI)、ffmpeg、jq

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🎬 生成客户说人物形象视频池（12 段 640×640 女性口播模板）..."
bash "$PROJECT_DIR/scripts/generate_customer_avatars.sh"

echo ""
echo "🎙️  生成客户说女声参考音频池（6 段变调克隆参考）..."
bash "$PROJECT_DIR/scripts/generate_customer_voices.sh"

echo ""
echo "✅ 客户说素材准备完毕。每次运行 pipeline 时会自动随机挑选："
echo "   - 身份（脱敏姓名/公司/职位）"
echo "   - 形象视频 + 首帧照片"
echo "   - 声音参考"
echo ""
echo "   运行示例："
echo "   bash scripts/pipeline.sh articles/ai_customer_xinling.md my_run config/hosts/customer_female.json"
