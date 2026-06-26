FROM node:20-slim

# yt-dlp's release zipapp runs on python3; ffmpeg is recommended for format merging.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ffmpeg curl ca-certificates && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend
COPY schema.sql ./schema.sql

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
EXPOSE 3001

CMD ["node", "backend/server.js"]
