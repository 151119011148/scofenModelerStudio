# Scofen Modeler Studio

> One model. Nine views.

轻量化 SysML 1.6 / UML 2.5.1 建模工具，对标 M-Design 与 MagicDraw / Cameo。
模型优先、服务端权威：元素与关系是唯一事实源，图只是视图。

**当前状态：M0 骨架已实现、27 项自动化测试全绿，并已上线 <http://47.117.110.143/scofen/>；尚未进入 M1～M4 的完整产品实现。**
方案全文见仓库上级目录的《产品方案与技术选型 v0.6》；首发完整范围约 21～25 周。

## 已实现（M0）

| 能力 | 说明 |
|---|---|
| 四对象分离 | `ModelElement` / `Relationship` / `Diagram(View)` / `Notation`，图只持有 id 引用 |
| 九图注册表 | 表驱动的 9 种图规格、元素集合、校验分组；序列图指向专用 `Java SequenceLayout` |
| Command 协议 | `type / payload / baseRevision / clientCmdId` → 服务端校验 → 原子写 → `revision` / `seq` 递增 |
| 乐观锁与幂等 | 过期 `baseRevision` 返回 409；重复 `clientCmdId` 不重复执行 |
| Patch 广播 | `affectedIds` / `changes` / `inverse` / `validationDelta`，经 WebSocket 推给所有只读会话 |
| 撤销 | 服务端按 session 保存逆命令栈 |
| 规则引擎 | 命名唯一性（大小写不敏感，对应 MySQL `utf8mb4_0900_ai_ci`）、端点存在、循环继承、图元素类型约束、删除元素后清理图引用 |
| 交换契约 | 语义层 / 图层分离；标准 XMI 缺侧车即拒绝；`.scofen.json` 无损；`.di.json` 保持中性 |
| B/S 界面 | Vite + React + TS strict 三栏原型（模型树 / 画布 / 属性+校验），九图切换、改名、新建、撤销、WS 实时同步 |
| 建表脚本 | `V1__init.sql`，按 MySQL 8.4 六条约束编写（默认关闭 Flyway，待持久化适配器接入） |

## 尚未实现（后续里程碑）

九图完整记法渲染、ELK Java / SequenceLayout 自动布局、EMF UML2 + SysML 1.6 Profile 的 XMI 往返、20 条黄金用例、MySQL 持久化适配器、RBAC / 审计 / 项目级编辑锁、SVG / PNG / Excel 导出、模型对比与批量导入。

## 环境要求

- JDK 17 及以上（编译目标固定 `--release 17`；本机可用 IntelliJ IDEA 自带 JBR）
- Maven 3.9+（仓库已带 Maven Wrapper，可直接用 `./mvnw`）
- Node.js 20.19+ / npm 10+
- MySQL 8.4 LTS（生产持久化阶段；M0 运行时不需要）

## 构建与运行

```bash
./build.sh                                   # 前端构建 + Maven 全量测试 + fat jar
java -jar scofen-web/target/scofen-server.jar  # 默认 8080

# 子路径部署（线上用法）：前端资源与 API / WS 统一带 /scofen/ 前缀
SCOFEN_BASE=/scofen/ ./build.sh
```

浏览器打开 <http://localhost:8080>（根路径构建时）。前端开发模式可用 `cd frontend && npm run dev`（Vite 5173，已配置 `/api` 与 `/ws` 代理到 8080）。

前端所有请求都基于 Vite 的 `import.meta.env.BASE_URL`：默认 `/`，`vite build --base=/scofen/` 时自动变成 `/scofen/api/...` 与 `/scofen/ws/patches`，无需改代码即可切换部署路径。

只跑测试：

```bash
./mvnw -B -ntp test          # 27 个测试：metamodel 5 / core 9 / xmi 5 / web 8
```

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 产品名、revision、九图数量、在线会话数 |
| GET | `/api/model` | 当前 revision 下的四对象快照 |
| GET | `/api/metamodel/diagrams` | 九图规格 |
| POST | `/api/commands` | 唯一写入口；请求头 `X-Scofen-Session` 指定撤销栈 |
| POST | `/api/commands/undo` | 按 session 撤销上一步 |
| GET | `/api/export/scofen.json` | 自有无损格式导出 |
| WS | `/ws/patches` | 权威 Patch 广播（单写者 + 只读跟随） |
| GET | `/actuator/health` | 运维健康检查 |

示例：

```bash
curl -X POST http://localhost:8080/api/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"RENAME_ELEMENT","payload":{"id":"e-vcu","name":"域控制器"},"baseRevision":15,"clientCmdId":"c-1"}'
```

## 部署上线

**当前线上环境**：阿里云 ECS（Alibaba Cloud Linux 3，47.117.110.143）。服务器上 80 端口已有 emotion-web / scofendoc，8080 与 8081 也已被占用，且未安装 Docker，因此采用「JDK 17 + systemd + Nginx 子路径反代」，不新增监听端口、不改安全组、不影响现有站点。

| 项 | 值 |
|---|---|
| 访问入口 | <http://47.117.110.143/scofen/> |
| 应用进程 | `scofen.service` → `127.0.0.1:18080`（fat jar 自带前端静态资源） |
| JDK | `/usr/lib/jvm/java-17-openjdk/bin/java` |
| Nginx 片段 | `/etc/nginx/conf.d/scofen.locations`，由 `emotion-web.conf` 的 server 内 include |
| WebSocket | `/scofen/ws/patches`（独立 location，带 Upgrade 头与 3600s 超时） |
| 日志 | `journalctl -u scofen.service -f` |

一键发版（要求远端已配置 SSH 免密，本机已按子路径构建）：

```bash
SCOFEN_BASE=/scofen/ ./build.sh
./deploy-remote.sh scofen-server /opt/scofen     # scofen-server 是本机 ~/.ssh/config 中的别名
```

脚本会上传 jar、`deploy/scofen.service`、`deploy/scofen.locations`，然后执行 `deploy/install-remote.sh`：幂等地插入 Nginx include（原配置自动备份为 `emotion-web.conf.bak-scofen`）、`nginx -t`、reload、systemd 重启与健康探测。

可选的 Docker 路径（适合自备容器环境）：

```bash
./build.sh
docker compose up -d --build                    # http://<host>:8080
docker compose --profile persistence up -d      # 附带 MySQL 8.4
```

镜像基于 `eclipse-temurin:17-jre`。任何反向代理都需同时转发 HTTP 与 WebSocket 升级请求。

## 目录

```
scofen-metamodel/   四对象与九图注册表
scofen-core/        Repository / Command / revision CAS / 校验 / 撤销
scofen-xmi/         交换格式契约（EMF 适配器在 M3 接入）
scofen-web/         Spring Boot 4.1 REST + WebSocket + Flyway 脚本 + 静态前端
frontend/           Vite + React + TypeScript strict
deploy/             systemd unit / Nginx locations / 远端安装脚本
deploy-remote.sh    一键发版入口
```
