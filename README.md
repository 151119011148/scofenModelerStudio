# Scofen Modeler Studio

> One model. Nine views.

轻量化 SysML 1.6 / UML 2.5.1 建模工具，对标 M-Design 与 MagicDraw / Cameo。
模型优先、服务端权威：元素与关系是唯一事实源，图只是视图。

**当前状态：M0 骨架已实现并通过 27 项自动化测试，尚未进入 M1～M4 的完整产品实现。**
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
```

浏览器打开 <http://localhost:8080>。前端开发模式可用 `cd frontend && npm run dev`（Vite 5173，已配置 `/api` 与 `/ws` 代理到 8080）。

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

## 容器上线

```bash
./build.sh
docker compose up -d --build          # http://<host>:8080
docker compose --profile persistence up -d   # 附带 MySQL 8.4

# 或部署到已有服务器（远端需安装 Docker / Docker Compose 与 SSH 访问）
./deploy-remote.sh user@your-host /opt/scofen
```

镜像基于 `eclipse-temurin:17-jre`，端口 8080。反向代理需同时转发 HTTP 与 WebSocket 升级请求。

## 目录

```
scofen-metamodel/   四对象与九图注册表
scofen-core/        Repository / Command / revision CAS / 校验 / 撤销
scofen-xmi/         交换格式契约（EMF 适配器在 M3 接入）
scofen-web/         Spring Boot 4.1 REST + WebSocket + Flyway 脚本 + 静态前端
frontend/           Vite + React + TypeScript strict
```
