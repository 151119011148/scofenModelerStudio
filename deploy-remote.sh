#!/usr/bin/env bash
set -euo pipefail

# 用法：./deploy-remote.sh user@host [remote_dir]
# 前置：本地已执行 ./build.sh；远端已安装 Docker 与 Docker Compose。
HOST="${1:-}"
REMOTE_DIR="${2:-/opt/scofen}"

if [ -z "$HOST" ]; then
  echo "用法: ./deploy-remote.sh user@host [remote_dir]"
  exit 1
fi

cd "$(dirname "$0")"
JAR="scofen-web/target/scofen-server.jar"
if [ ! -f "$JAR" ]; then
  echo "未找到 $JAR，请先执行 ./build.sh"
  exit 1
fi

echo "==> 准备远端目录 $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR/scofen-web/target'"

echo "==> 上传产物"
scp "$JAR" "$HOST:$REMOTE_DIR/scofen-web/target/scofen-server.jar"
scp Dockerfile docker-compose.yml "$HOST:$REMOTE_DIR/"

echo "==> 启动容器"
ssh "$HOST" "cd '$REMOTE_DIR' && docker compose up -d --build && docker compose ps"

echo "==> 完成：http://$HOST:8080 （HOST 请换成域名或 IP）"
echo "若前面有 Nginx 反代，记得同时转发 WebSocket 升级请求到 /ws/patches。"
