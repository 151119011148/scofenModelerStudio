#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -z "${JAVA_HOME:-}" ]; then
  echo "提示：请设置 JAVA_HOME 指向 JDK 17 及以上（编译目标固定为 Java 17）。"
fi

echo "==> 构建前端（Vite + React + TypeScript strict）"
(cd frontend && npm install --no-audit --no-fund && npm run build)

echo "==> 构建后端（Maven 四模块 + 测试 + fat jar）"
./mvnw -B -ntp clean package

echo "==> 产物"
echo "scofen-web/target/scofen-server.jar"
echo "启动：java -jar scofen-web/target/scofen-server.jar"
