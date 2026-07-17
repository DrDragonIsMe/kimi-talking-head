# 薪灵AI 口播视频生成器 — API 服务镜像
# 注意：TTS / InfiniteTalk 依赖远端 GPU 服务器，需通过 SSH 免密登录调用。

FROM node:22-bookworm

# 安装系统依赖：Python、FFmpeg、ImageMagick、jq、ripgrep、bc、中文字体
# fonts-noto-cjk 是硬依赖：组件字体栈为 "Noto Sans SC"/"PingFang SC"，
# 容器内缺中文字体时，无头 Chrome 渲染的字幕会变成豆腐块。
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    imagemagick \
    jq \
    ripgrep \
    bc \
    openssh-client \
    fonts-noto-cjk \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app

# 先复制依赖文件，利用 Docker 缓存层
COPY package*.json ./
RUN npm ci

# 复制项目源码
COPY . .

# 暴露 API 端口
EXPOSE 3456

ENV NODE_ENV=production
ENV PORT=3456
ENV MAX_CONCURRENT=1

CMD ["npm", "run", "api"]
