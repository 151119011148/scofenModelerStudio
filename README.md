# Scofen Modeler Studio

> One model. Nine views.

轻量化 SysML 1.6 / UML 2.5.1 建模工具，对标 M-Design 与 MagicDraw / Cameo。
模型优先、服务端权威：元素与关系是唯一事实源，图只是视图。

**当前状态：M0 骨架 + 三件套已落地——MySQL 持久化、XMI 语义往返、RBAC 权限闭环，项目根固定为 Package，共 124 项用例（116 项运行通过，8 项 Testcontainers 因无 Docker 跳过），已上线 <http://47.117.110.143/scofen/modelerStudio/>；尚未进入 M1～M4 的完整产品实现。**
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
| 交换契约 | 语义层 / 图层分离；`.xmi` 标准 UML 2.5.1 + `.di.json` 布局侧车 + `.scofen.json` 无损自有格式，导出导入双向可用 |
| B/S 界面 | Vite + React + TS strict 三列工作区（模型树+属性 / 组件工具箱 / 画布），顶栏项目选择器、登录页、改名、新建、撤销、WS 实时同步 |
| 层级模型树 | 按 `ownerId` 递归的三层父子结构，展开/折叠、选中同步到属性面板与画布；九图示例数据覆盖各图合法类型 |
| 规范约束的增删改 | 服务端 `ContainmentRules` 表驱动所有权规则（如 Port 只能属于 Block / PartProperty）、根类型限制、命名格式与同命名空间唯一性、图类型约束；前端右键菜单只列出规范允许的子类型 |
| 右键菜单 | 新建子元素 / 重命名 / 加入当前图 / 在图中定位 / 删除；删除父节点级联整棵子树、关系与记法，单条原子命令且可撤销恢复 |
| 图形拖拽 | 画布 shape 支持指针拖拽，坐标经 `MOVE_NOTATION` 写入服务端 `Notation` 对象并广播，越界或不在图内的元素被服务端拒绝 |
| 建表脚本 | `MysqlSchema.ensure()` 幂等建六张表（项目、快照、用户、角色、用户角色、角色权限），MySQL 8.4 / InnoDB / utf8mb4 |
| 登录与会话 | JWT(HS256) + PBKDF2 口令哈希，两个超管账号（`scofen` / `gaofeng`）共用口令；`/api/**` 与 WebSocket 握手都校验登录态，401 自动回登录页 |
| 打开项目 | 顶栏项目选择器点击即打开、新建后自动打开；每个项目分配独立内存态模型运行时（唯一项目根 Package + 九图），统计 / revision / 撤销栈互不串写 |
| 规范属性窗口 | 按 UML 2.5.1 元类继承链 + SysML 1.6 构造型展开每种元素类型的元属性；**标准 / 专家 / 全部**三档收进属性栏右上角下拉，工具栏支持按属性 key 搜索与升序 / 降序排序（排序时平铺为全局有序的一张表）。属性以两列表格只读展示，可编辑行右侧「⋯」打开编辑弹框：字符 / 长文本 / 数值 / JSON 用输入框，布尔与枚举用下拉，模型引用用元素选择器，数组与构造型用 chip 增删（即时写入、可撤销）。所有写入走通用 `UPDATE_PROPERTY` 命令（校验 + 乐观锁 + 撤销）；计算属性与派生属性（`id` / `qualifiedName` / 各类统计量）只读并由前端实时求值 |
| 拖放加入图 | 模型树中把元素拖到「图」节点即把该元素加入该图并生成记法（自动排布落点、单条 `ADD_TO_DIAGRAM`、可撤销）；图只是视图，不复制、不拥有模型元素 |
| MySQL 持久化 | 切 `scofen.persistence.mode=mysql` 后按项目隔离落库：项目目录、整包 JSON 快照（按 revision 留存最近 100 版）、用户与角色表；内存态仍是默认值，重启即复位 |
| RBAC 权限闭环 | 9 个权限码两端共用一套：服务端 `@RequiresPermission` + 拦截器门控，前端读令牌里的 `perms` 收敛按钮显隐；内置 admin / editor / viewer 三角色 + 用户管理界面，权限码与界面显隐不会「藏了但还能调」 |
| XMI 导入导出 | 「文件」菜单导出 `.xmi` / `.di.json` / `.scofen.json` 三种格式，导入 `.xmi`（可配 `.di.json`）；导入为**整包替换**当前项目，一次 Command、一次 revision、一个 Patch，天然幂等且可撤销；无侧车时由服务端按元素主图归属重排九图 |
| 连接失败自愈 | 页面初始化时若后端/网络瞬时不可用，模型快照与元模型目录按 1s→2s→4s…（上限 30s）自动退避重试，WebSocket 断线同样重连；顶部横幅显示故障原因与「立即重试」按钮。数据未就绪时禁止打开新建对话框，不再把连接故障显示成「该父类型不允许再包含子元素」 |

## 尚未实现（后续里程碑）

九图完整记法渲染、ELK Java / SequenceLayout 自动布局、EMF UML2 + SysML 1.6 Profile 的标准 XMI 互操作、20 条黄金用例、项目级编辑锁与审计日志、SVG / PNG / Excel 导出、模型对比与批量导入。

## 环境要求

- JDK 17 及以上（编译目标固定 `--release 17`；本机可用 IntelliJ IDEA 自带 JBR）
- Maven 3.9+（仓库已带 Maven Wrapper，可直接用 `./mvnw`）
- Node.js 20.19+ / npm 10+
- MySQL 8.4 LTS（生产持久化阶段；M0 运行时不需要）

## 登录与账号

默认有两个超管账号：`scofen` 与 `gaofeng`（均全小写），**共用同一口令**，登录后的身份与权限完全相同。
口令在源码中只保存 PBKDF2-HMAC-SHA256 哈希，明文不进仓库。
口令区分大小写，首尾带空格也会校验失败；登录页提供「显示」开关用于核对输入，并已禁用浏览器自动填充——
同一台服务器上若登录过其它站点，Chrome 可能按 origin 自动填入别的账号密码，遇到 401 请先清空两个输入框手动填写。
运维可用环境变量覆盖（Spring 宽松绑定）：

| 变量 | 说明 |
|---|---|
| `SCOFEN_AUTH_ADMIN_USERNAMES` | 逗号分隔的超管清单，默认 `scofen,gaofeng`；设置后覆盖默认值 |
| `SCOFEN_AUTH_ADMIN_USERNAME` | 旧版单数变量，仅在未设置复数变量时生效，值为单个登录名 |
| `SCOFEN_AUTH_ADMIN_PASSWORD` | 明文口令，仅运行时注入，优先级最高 |
| `SCOFEN_AUTH_ADMIN_PASSWORD_HASH` | 直接替换哈希（`pbkdf2$迭代$salt$hash`） |
| `SCOFEN_AUTH_JWT_SECRET` | 固定 JWT 密钥；未设置时每次启动随机生成，重启后需重新登录 |

线上由 `deploy/install-remote.sh` 首次部署时自动生成 `/etc/scofen/modeler.env`（chmod 600）并写入固定密钥，
因此服务重启不会让已登录会话失效；本地默认仍是随机密钥。

未登录访问任何 `/api/**`（`/api/health` 与 `/api/auth/login` 除外）返回 401 JSON；
WebSocket 握手通过 `?token=<JWT>` 校验。所有 `/api/**` 请求带 `X-Scofen-Project: <projectId>`
指定当前打开的项目，带 `X-Scofen-Session` 指定撤销栈。

## 项目根固定为 Package

每个项目初始化时自动创建一个项目根（id `model-root`，类型 `Package`），它是**项目容器**而不是模型本身。
UML/SysML 里 Model 是 Package 的一种，模型节点应建在项目根下，一个项目可以组织多个 Model。
若根本身就是 Model，旧版「一个项目只能有一个根 Model」的限制会占住名额，用户就无法再创建模型节点。

- 项目根不可删除、不可拖拽；顶层 Model 一律拒绝，避免冒出第二个「看起来像项目根」的节点。
- 存量项目（老版本的根是 Model）在快照回载时**幂等归一**为 Package：只改类型与「扩展的元类」引用，
  不推进 revision、不广播 Patch，名称 / 文档 / 标签值一律保留。
- 导入外部 XMI 同样归一：外部根常是 `uml:Model`，导入后统一成 Package 项目根。
  导出的根标签按实际类型输出（Package → `uml:Package`），导入同时识别 `uml:Model` 与 `uml:Package`。

## MySQL 落库

默认仍是**内存态**（`scofen.persistence.mode=memory`，重启即复位，零数据库依赖）。
切到落库模式只要改环境变量，代码零改动：

```bash
# /etc/scofen/modeler.env（systemd EnvironmentFile 注入，chmod 600）
SCOFEN_PERSISTENCE_MODE=mysql
SPRING_DATASOURCE_URL=jdbc:mysql://127.0.0.1:3306/scofen_modeler?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai&characterEncoding=utf8&useUnicode=true
SPRING_DATASOURCE_USERNAME=root
SPRING_DATASOURCE_PASSWORD=<口令>
```

建表由应用首次访问时幂等执行（`MysqlSchema.ensure()`），共六张表：

| 表 | 用途 |
|---|---|
| `scofen_project` | 项目目录：名称、空间、状态与最新 revision 指针 |
| `scofen_model_snapshot` | 模型整包 JSON 快照，主键 `(project_id, revision)`，按项目隔离 |
| `scofen_user` / `scofen_role` / `scofen_user_role` / `scofen_role_permission` | RBAC 用户与角色，口令只存 PBKDF2 哈希 |

快照默认保留最近 100 个 revision（`scofen.persistence.snapshot-retention`），留窗口是为了能回退到前一版，不是做历史归档。

## XMI 语义往返

导出三选一，界面在「文件」菜单：

| 格式 | 内容 | 用途 |
|---|---|---|
| `.xmi` | 标准 UML 2.5.1 `xmi:XMI`；SysML 非标准元类的原类型记在 `scofen:type` 扩展命名空间 | 与外部工具交换语义 |
| `.di.json` | 布局侧车：九图的类型与名称、全部记号坐标 | 与 `.xmi` 配对，标准 XMI 装不下这些 |
| `.scofen.json` | 自有无损格式，四对象原样 | 备份与跨机迁移 |

导入 `.xmi`（可配 `.di.json`）的语义是**整包替换当前项目**：

- 一次 Command、一次 revision、一个 Patch，天然幂等——导入自己导出的文件，结果与导出前完全一致；
- 通用扩展包（SysML/UML 元类清单）是每个项目自带的公共内容，导入时**保留不替换**；
- 无 `.di.json` 时服务端按元素的主图归属重排九图，不会让九图塌成一个点；
- 校验在「替换后的世界」里做（旧的即将被清空，不能拿它比唯一性），且分两遍扫描，消除父子元素在文件中的顺序依赖；
- `IMPORT_MODEL` ↔ `RESTORE_IMPORTED` 对称可撤销，撤销一次回到导入前，重做重新导入。

## RBAC 权限闭环

权限码两端共用一套（`Permission` 枚举，9 个）：服务端 `@RequiresPermission` + 拦截器门控，
前端读 JWT 里的 `perms` 收敛按钮显隐，不会出现「界面藏了但接口还能调」。

内置三个角色：`admin`（全部权限）、`editor`（建模 + 导入导出）、`viewer`（只读）。
超管清单（`scofen` / `gaofeng`）是兜底——即便误删了库里的超管，也还有一条进得去的路。
用户在「管理」面板维护，角色与权限映射存在库里。

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
./mvnw -B -ntp test          # 124 个用例：metamodel 13 / core 50 / xmi 12 / web 49（其中 8 项 Testcontainers 因无 Docker 跳过）
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
| GET | `/api/metamodel/properties` | UML 2.5.1 + SysML 1.6 元属性全集：元类继承链、每种元素类型的属性表、标准/专家/全部三档计数 |
| GET | `/api/metamodel/extension` | 通用扩展包目录（SysML/UML 元类清单，供构造型与引用型属性指向） |
| GET | `/api/workspaces` | 空间与项目目录 |
| POST | `/api/commands` | 唯一写入口；请求头 `X-Scofen-Session` 指定撤销栈 |
| POST | `/api/commands/undo` | 按 session 撤销上一步 |
| POST | `/api/commands/redo` | 按 session 重做 |
| GET | `/api/exchange/xmi` | 导出标准 UML 2.5.1 XMI（需 `model.export`） |
| GET | `/api/exchange/xmi.di.json` | 导出布局侧车（图类型、图名、记号坐标） |
| GET | `/api/exchange/scofen.json` | 导出自有无损格式 |
| GET | `/api/exchange/sidecar/preview` | 侧车概览：图数、记号数、九图规格 |
| POST | `/api/exchange/xmi` | 导入 XMI，整包替换当前项目（需 `model.import`） |
| GET | `/api/admin/users` `/api/admin/roles` `/api/admin/permissions` | 用户、角色与权限码目录（需 `user.manage` / `role.manage`） |
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
| 数据库 | MySQL 8.4 `scofen_modeler` 库（`scofen.persistence.mode=mysql`）；表由应用幂等建 |
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
scofen-metamodel/   四对象与九图注册表 + 元模型与属性目录
scofen-core/        Repository / Command / revision CAS / 校验 / 撤销
scofen-xmi/         XMI 语义往返（UmlXmiAdapter）+ 布局侧车 + 服务端重排
scofen-web/         Spring Boot 4.1 REST + WebSocket + MySQL 落库 + RBAC + 静态前端
frontend/           Vite + React + TypeScript strict
deploy/             systemd unit / Nginx locations / 远端安装脚本
tools/verify/       浏览器级实测脚本（headless Chrome + CDP，无 puppeteer 依赖）
deploy-remote.sh    一键发版入口
```
