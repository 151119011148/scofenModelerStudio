#!/usr/bin/env bash
set -euo pipefail
# 在目标服务器上执行（由 deploy-remote.sh 通过 ssh 传入 stdin）。
# 前置：/opt/scofen/scofen-server.jar 已上传；JDK 17、nginx、systemd 可用。

REMOTE_DIR=/opt/scofen
UNIT=/etc/systemd/system/scofen.service
LOCATIONS=/etc/nginx/conf.d/scofen.locations
SITE=/etc/nginx/conf.d/emotion-web.conf

echo "==> 校验运行环境"
[ -f "$REMOTE_DIR/scofen-server.jar" ] || { echo "缺少 fat jar"; exit 1; }
/usr/lib/jvm/java-17-openjdk/bin/java -version 2>&1 | head -1
command -v nginx >/dev/null || { echo "缺少 nginx"; exit 1; }
command -v python3 >/dev/null || { echo "缺少 python3"; exit 1; }
mkdir -p "$REMOTE_DIR/logs"

echo "==> 安装 systemd unit"
cp "$REMOTE_DIR/deploy-assets/scofen.service" "$UNIT"
systemctl daemon-reload

echo "==> 安装 Nginx 片段"
cp "$REMOTE_DIR/deploy-assets/scofen.locations" "$LOCATIONS"

# 幂等地把 include 挂进已有 80 端口 server（与 scofendoc 同一模式）
python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/conf.d/emotion-web.conf")
s = p.read_text(encoding="utf-8")
if "scofen.locations" in s:
    print("include 已存在，跳过")
else:
    marker = "    include /etc/nginx/conf.d/scofendoc.locations;"
    if marker not in s:
        raise SystemExit("未找到 scofendoc include 锚点，请人工确认站点配置")
    backup = p.with_suffix(p.suffix + ".bak-scofen")
    if not backup.exists():
        backup.write_text(s, encoding="utf-8")
        print("已备份原配置:", backup)
    line = "    include /etc/nginx/conf.d/scofen.locations;   # Scofen Modeler Studio /scofen/\n"
    p.write_text(s.replace(marker, marker + "\n" + line, 1), encoding="utf-8")
    print("已插入 include")
PY

nginx -t
nginx -s reload

echo "==> 启动服务"
systemctl enable scofen.service >/dev/null 2>&1 || true
systemctl restart scofen.service
systemctl --no-pager --full status scofen.service | head -8 || true

echo "==> 等待应用就绪"
for i in $(seq 1 40); do
  if curl -fsS --max-time 2 http://127.0.0.1:18080/api/health >/dev/null 2>&1; then
    echo "应用已就绪（第 ${i} 次探测）"
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "启动超时，最近日志："
    journalctl -u scofen.service -n 40 --no-pager || true
    exit 1
  fi
  sleep 1
done

echo "==> 本机链路检查"
curl -fsS --max-time 5 http://127.0.0.1:18080/api/health; echo
curl -sS -o /dev/null -w "index via nginx: %{http_code}\n" --max-time 5 http://127.0.0.1/scofen/
curl -sS -o /dev/null -w "api via nginx:   %{http_code}\n" --max-time 5 http://127.0.0.1/scofen/api/health
echo "==> 部署完成：http://<公网IP>/scofen/"
