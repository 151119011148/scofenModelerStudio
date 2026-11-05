#!/usr/bin/env bash
set -euo pipefail
# 用法：./deploy-remote.sh user@host [remote_dir]
# 前置：
#   1) 本机已用 `SCOFEN_BASE=/scofen/modelerStudio/ ./build.sh` 构建
#   2) 远端为 Alibaba Cloud Linux / RHEL 系，装好 JDK 17 + Nginx + systemd
#   3) 已配置 SSH 免密（ssh-copy-id 或 ssh-agent），无需 Docker
# 效果：应用跑在 127.0.0.1:18080，Nginx 80 端口挂 /scofen/modelerStudio/，不影响现有站点。

HOST="${1:-}"
REMOTE_DIR="${2:-/opt/scofen}"

if [ -z "$HOST" ]; then
  echo "用法: ./deploy-remote.sh user@host [remote_dir]"
  exit 1
fi

cd "$(dirname "$0")"
JAR="scofen-web/target/scofen-server.jar"
if [ ! -f "$JAR" ]; then
  echo "未找到 $JAR，请先执行 SCOFEN_BASE=/scofen/modelerStudio/ ./build.sh"
  exit 1
fi
if ! grep -q '"/scofen/modelerStudio/' scofen-web/src/main/resources/static/index.html 2>/dev/null; then
  echo "警告：静态入口里没有 /scofen/modelerStudio/ 前缀，前端可能未按子路径构建。"
fi

echo "==> 准备远端目录 $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR' '$REMOTE_DIR/deploy-assets' '$REMOTE_DIR/logs'"

echo "==> 上传 fat jar 与部署资产"
scp "$JAR" "$HOST:$REMOTE_DIR/scofen-server.jar"
scp deploy/scofen.service deploy/scofen.locations "$HOST:$REMOTE_DIR/deploy-assets/"
scp deploy/install-remote.sh "$HOST:$REMOTE_DIR/install-remote.sh"

echo "==> 远端安装并启动"
ssh "$HOST" "bash '$REMOTE_DIR/install-remote.sh'"

echo "==> 完成：http://${HOST#*@}/scofen/modelerStudio/"
echo "若前面有 CDN / 额外反代，记得同时转发 WebSocket 升级请求到 /scofen/modelerStudio/ws/patches。"
