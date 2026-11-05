# Scofen Modeler Studio

> One model. Nine views.

轻量化 SysML 1.6 / UML 2.5.1 建模工具，对标 M-Design 与 MagicDraw / Cameo。
模型优先、服务端权威：元素与关系是唯一事实源，图只是视图。

**当前状态：M0 骨架已实现、54 项自动化测试全绿（无 Docker 时跳过 2 个 Testcontainers 用例），并已上线 <http://47.117.110.143/scofen/modelerStudio/>；尚未进入 M1～M4 的完整产品实现。**
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
| B/S 界面 | Vite + React + TS strict 三列工作区（模型树+属性 / 组件工具箱 / 画布），顶栏项目选择器、登录页、改名、新建、撤销、WS 实时同步 |
| 层级模型树 | 按 `ownerId` 递归的三层父子结构，展开/折叠、选中同步到属性面板与画布；九图示例数据覆盖各图合法类型 |
| 规范约束的增删改 | 服务端 `ContainmentRules` 表驱动所有权规则（如 Port 只能属于 Block / PartProperty）、根类型限制、命名格式与同命名空间唯一性、图类型约束；前端右键菜单只列出规范允许的子类型 |
| 右键菜单 | 新建子元素 / 重命名 / 加入当前图 / 在图中定位 / 删除；删除父节点级联整棵子树、关系与记法，单条原子命令且可撤销恢复 |
| 图形拖拽 | 画布 shape 支持指针拖拽，坐标经 `MOVE_NOTATION` 写入服务端 `Notation` 对象并广播，越界或不在图内的元素被服务端拒绝 |
| 建表脚本 | `V1__init.sql`，按 MySQL 8.4 六条约束编写（默认关闭 Flyway，待持久化适配器接入） |
| 登录与会话 | JWT(HS256) + PBKDF2 口令哈希，单一超管账号；`/api/**` 与 WebSocket 握手都校验登录态，401 自动回登录页 |
| 打开项目 | 顶栏项目选择器点击即打开、新建后自动打开；每个项目分配独立内存态模型运行时（唯一根 Model + 九图），统计 / revision / 撤销栈互不串写 |

## 尚未实现（后续里程碑）

九图完整记法渲染、ELK Java / SequenceLayout 自动布局、EMF UML2 + SysML 1.6 Profile 的 XMI 往返、20 条黄金用例、MySQL 持久化适配器、RBAC / 审计 / 项目级编辑锁、SVG / PNG / Excel 导出、模型对比与批量导入。

## 环境要求

- JDK 17 及以上（编译目标固定 `--release 17`；本机可用 IntelliJ IDEA 自带 JBR）
- Maven 3.9+（仓库已带 Maven Wrapper，可直接用 `./mvnw`）
- Node.js 20.19+ / npm 10+
- MySQL 8.4 LTS（生产持久化阶段；M0 运行时不需要）

## 登录与账号

默认超管账号 `scofen`，口令在源码中只保存 PBKDF2-HMAC-SHA256 哈希，明文不进仓库。
运维可用环境变量覆盖（Spring 宽松绑定）：

| 变量 | 说明 |
|---|---|
| `SCOFEN_AUTH_ADMIN_USERNAME` | 登录名，默认 `scofen` |
| `SCOFEN_AUTH_ADMIN_PASSWORD` | 明文口令，仅运行时注入，优先级最高 |
| `SCOFEN_AUTH_ADMIN_PASSWORD_HASH` | 直接替换哈希（`pbkdf2$迭代$salt$hash`） |
| `SCOFEN_AUTH_JWT_SECRET` | 固定 JWT 密钥；未设置时每次启动随机生成，重启后需重新登录 |

线上由 `deploy/install-remote.sh` 首次部署时自动生成 `/etc/scofen/modeler.env`（chmod 600）并写入固定密钥，
因此服务重启不会让已登录会话失效；本地默认仍是随机密钥。

未登录访问任何 `/api/**`（`/api/health` 与 `/api/auth/login` 除外）返回 401 JSON；
WebSocket 握手通过 `?token=<JWT>` 校验。所有 `/api/**` 请求带 `X-Scofen-Project: <projectId>`
指定当前打开的项目，带 `X-Scofen-Session` 指定撤销栈。

## 构建与运行

```bash
./build.sh                                   # 前端构建 + Maven 全量测试 + fat jar
java -jar scofen-web/target/scofen-server.jar  # 默认 8080

# 子路径部署（线上用法）：前端资源与 API / WS 统一带 /scofen/modelerStudio/ 前缀
SCOFEN_BASE=/scofen/modelerStudio/ ./build.sh
```

浏览器打开 <http://localhost:8080>（根路径构建时）；首次进入会显示登录页，用超管账号登录后才加载模型。
顶栏中间的项目选择器可切换空间与项目，点击即打开；「完整面板」可展开空间抽屉查看详情与新建项目。
前端开发模式可用 `cd frontend && npm run dev`（Vite 5173，已配置 `/api` 与 `/ws` 代理到 8080）。

前端所有请求都基于 Vite 的 `import.meta.env.BASE_URL`：默认 `/`，`vite build --base=/scofen/modelerStudio/` 时自动变成 `/scofen/modelerStudio/api/...` 与 `/scofen/modelerStudio/ws/patches`，无需改代码即可切换部署路径。

只跑测试：

```bash
./mvnw -B -ntp test          # 54 个测试：metamodel 6 / core 20 / xmi 5 / web 23（含 2 个 Testcontainers 跳过）
```

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 公开：校验超管口令，返回 JWT 与用户资料 |
| GET | `/api/auth/me` | 校验本地 token 是否仍有效 |
| POST | `/api/auth/logout` | 确认会话有效（清 token 由前端完成） |
| GET | `/api/health` | 公开：产品名、revision、九图数量、在线会话数 |
| GET | `/api/model` | 当前项目 / 当前 revision 下的四对象快照 |
| GET | `/api/metamodel/diagrams` | 九图规格与该图允许的元素类型 (`allowedTypes`) |
| GET | `/api/metamodel/containment` | 元素类型中文标签/构造型、父子包含规则、根类型、画布边界 |
| POST | `/api/commands` | 唯一写入口；请求头 `X-Scofen-Session` 指定撤销栈 |
| POST | `/api/commands/undo` | 按 session 撤销上一步 |
| GET | `/api/export/scofen.json` | 自有无损格式导出 |
| WS | `/ws/patches?token=<JWT>` | 权威 Patch 广播（单写者 + 只读跟随），握手校验登录态 |
| GET | `/actuator/health` | 运维健康检查 |

示例：

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"scofen","password":"<超管口令>"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -X POST http://localhost:8080/api/commands \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"RENAME_ELEMENT","payload":{"id":"e-vcu","name":"域控制器"},"baseRevision":15,"clientCmdId":"c-1"}'
```

> 线上 `baseRevision` 请以 `GET /api/health` 的返回值为准，示例中的 15 是旧版种子数据的初始值。

界面操作对应的 Command（全部由服务端校验并广播 Patch）：

| Command | 关键 payload | 说明 |
|---|---|---|
| `CREATE_ELEMENT` | `id, type, name, ownerId, stereotypes, diagramId?` | 按包含规则校验；带 `diagramId` 时同时加入图并生成默认记法 |
| `DELETE_ELEMENT` | `id` | 级联删除子树、关系、记法、图引用；逆命令为 `RESTORE_SUBTREE` |
| `RESTORE_SUBTREE` | 删除前的完整对象列表 | 由服务端撤销栈内部执行，可精确恢复坐标与图引用 |
| `MOVE_NOTATION` | `diagramId, elementId, x, y` | 拖拽落点；越界或元素不在该图内返回 400 |
| `ADD_TO_DIAGRAM` / `REMOVE_FROM_DIAGRAM` | `diagramId, elementId` | 图与记法的引用维护 |
| `RENAME_ELEMENT` / `UPDATE_DOCUMENTATION` | `id, name / documentation` | 语义层改名，九图同步 |

## 部署上线

**当前线上环境**：阿里云 ECS（Alibaba Cloud Linux 3，47.117.110.143）。服务器上 80 端口已有 emotion-web / scofendoc，8080 与 8081 也已被占用，且未安装 Docker，因此采用「JDK 17 + systemd + Nginx 子路径反代」，不新增监听端口、不改安全组、不影响现有站点。

| 项 | 值 |
|---|---|
| 访问入口 | <http://47.117.110.143/scofen/modelerStudio/>（旧 `/scofen/` 301 跳转） |
| 应用进程 | `scofen.service` → `127.0.0.1:18080`（fat jar 自带前端静态资源） |
| JDK | `/usr/lib/jvm/java-17-openjdk/bin/java` |
| Nginx 片段 | `/etc/nginx/conf.d/scofen.locations`，由 `emotion-web.conf` 的 server 内 include |
| WebSocket | `/scofen/modelerStudio/ws/patches`（独立 location，带 Upgrade 头与 3600s 超时） |
| 登录密钥 | `/etc/scofen/modeler.env`（首次部署自动生成，`chmod 600`），由 systemd `EnvironmentFile` 注入 |
| 日志 | `journalctl -u scofen.service -f` |

一键发版（要求远端已配置 SSH 免密，本机已按子路径构建）：

```bash
SCOFEN_BASE=/scofen/modelerStudio/ ./build.sh
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
