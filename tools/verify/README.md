# 浏览器级实测脚本

用 headless Chrome + CDP 直驱真实 UI 做端到端验证，不依赖 puppeteer/playwright。

## 脚本

| 脚本 | 覆盖 |
| --- | --- |
| `xmi-e2e.mjs` | XMI 导入导出：登录 → 「文件」菜单四个入口 → 导出三种格式 → 导入对话框 → 选文件 → 导入 → 撤销 → 无侧车导入（服务端重排九图）。末尾会自动撤销，把线上项目恢复干净 |
| `root-package-e2e.mjs` | 项目根 Package + 可创建 Model 节点：登录 → 检查模型树根 → 「模型」菜单新建对话框 → 类型下拉选 MODEL → 创建 → 树上出现新节点 → 撤销恢复 → XMI 根标签为 `uml:Package` |
| `reconnect-e2e.mjs` | 初始化失败自愈：用 CDP `Network.setBlockedURLs` 阻断所有 `/api` 请求后刷新，验证出现连接失败横幅、不再用「该父类型不允许再包含子元素」伪装成元模型规则；解除阻断后分别验证自动退避重试与「立即重试」按钮都能让页面恢复 |
| `property-panel-e2e.mjs` | 属性栏三件套：右上角三档下拉与计数、按属性 key 搜索（含空态）、key 升序 / 降序 / 规范顺序三态排序、可编辑行「⋯」弹框的字符 / 数组 / 模型引用 / 枚举四类编辑器、清除值与 Esc 关闭、服务端快照写入与撤销恢复，末尾校验数据无残留 |
| `tree-extensions-relations-e2e.mjs` | 模型树两项改造：扩展包开关默认隐藏 / 显示 / 刷新后持久化，静态目录独立下发、项目元素计数排除扩展包、虚拟分组可逐级展开且不与项目树混行；关系不再全局平铺，单向关系只挂源端、双向 `association` 在两端各挂一次（写入后 `DELETE_RELATIONSHIP` 清理并校验无残留）、虚拟节点可折叠、关系行可点选进属性窗口 |
| `shell-ux-e2e.mjs` | 外壳与树形态：扩展包分组与项目根同缩进且不在根子树内、项目根可折叠并校验蓝色三角（`rgb(51,112,255)`）与 90° 旋转、两条分隔线用 CDP 真实鼠标事件拖宽并校验 localStorage 跨刷新保持、空间项目列表删除（主项目无删除按钮、删除当前项目自动切走、服务端目录无残留） |
| `property-dock-resize-e2e.mjs` | 属性面板尺寸与扩展域隔离：项目树不出现扩展域 id（`ext-` / `mc-` / `st-` / `prim-` …）的孤儿行、属性面板上下拖动（拖 90px 高度同步 ±10、写入 localStorage、刷新保持、上下限夹紧、双击恢复默认），末尾回归左右拖宽 |
| `relationship-model-e2e.mjs` | 关系模型进扩展包：两个 Profile 下各出现「关系」子包（SysML 9 条构造型 / UML 28 条元类，合计 37）、`satisfy` 与 `association` 可点选且属性窗口显示「扩展的元类」（Dependency / Association）、关系条目只在扩展包虚拟分组里出现（不与项目树混行）。只读脚本，无数据残留 |
| `auto-layout-e2e.mjs` | 自动排布端到端：登录 → 打开沙箱项目 → 「排布」弹框（默认仅当前图 / 自动策略）→ 开始排布。断言全部从 `GET api/model` 现算：一次写入只推进 1 个 revision、排布后重叠为 0 且交叉显著下降、图面比例落在 0.5–3、元素/关系/图归属逐字段不变（只改坐标）、排布后自动适应窗口（缩放 < 100%）、撤销一步坐标逐条复原；再跑「全部图表」并校验序列图生命线未被改写，末尾按撤销栈深度退回排布前。需先用 `local-seed.mjs` 灌数 |
| `canvas-pan-e2e.mjs` | 画布平移/缩放端到端：自己灌一个 30 节点、铺到 2508×1284 的用例图，再断言双指滚动与鼠标滚轮只平移（缩放百分比不动）、`ctrlKey` 捏合以光标为锚点缩放、空白左拖平移且零写入、空白轻点仍算点击（取消已选关系）、图形上拖拽只挪图形不带近视口、Shift+左键与中键照旧平移、狂滚 18 次视口与内容包围盒仍相交 ≥60 模型单位、适应窗口后全部图形入框且放大以视口中心为锚。全程只有那一次图形拖动和它的撤销写过数据 |
| `local-seed.mjs` | 沙箱灌数（非浏览器）：把模型快照里挑几张图（含父链）在本地 jar 里重建成一个「自动排布实测」项目，并用快照原坐标铺出「排布前」的图面。图名走命令行参数，只连本地端口，不碰线上 |
| `sequence-e2e.mjs` | 序列图端到端：自己在本地沙箱灌一个 Interaction 宿主（`sq-int`）+ 三条生命线 + 五条消息（同步 / 异步 / 回复 / 自消息 / 端点是注释的那条），再断言图面：表头同行且用生命线专用高度、虚线从表头底边伸到共享底边、虚线中线=表头中心、消息按创建顺序等距堆时间槽且两端贴列（目标端算激活条边缘）、`messageSort` 四种线型、自消息四段折线回到本列、激活条由消息推导且不落库、点消息进关系选中态并能改 `messageSort`、拖动生命线时消息实时换列（一次拖动 1 个 revision、撤销回原列）、适应窗口覆盖推导出来的行与底边、渲染点选零写入；时间槽顺序落成 `messageOrder`（Alt+↑/↓ 与拖动消息线都走一条 `SET_MESSAGE_ORDER`、一个 revision、一步撤销）、组合片段按 `interactionOperator` / `coveredFrom` / `coveredTo` / `guards` 画成 alt 框（操作数分隔虚线 + `[guard]`，改区间框实时变高）、拖动消息线时显示插入指示线；最后两段走界面：新建序列图自动补 Interaction 宿主、工具箱拖入生命线不再被容器规则拒；再把三条生命线摆进图，逐个点七种消息组件，断言 `messageSort` 随关系一次落库，返回（长虚线 «reply»）/ 创建（«create» 斜指下移表头 + 落点三角）/ 销毁（红色 X 终止符）/ 给自己的消息（只点一条生命线建成自反关系、四段回环）/ 异步信号（短点虚线 3 3）各自成立，且序列图不再重复列通用「消息」按钮。脚本开头会清掉上一轮界面残留（按图名 + 非灌数的 Interaction/生命线/注释），可反复重跑 |

## 本地跑带子路径前缀的产物

前端按 `SCOFEN_BASE=/scofen/modelerStudio/` 构建时，`index.html` 引用的是绝对路径
`/scofen/modelerStudio/assets/*`，而本地 jar 开在根路径 → 直接访问会 404，E2E 连登录页都进不去。
`local-prefix-proxy.mjs` 复刻线上 Nginx 的剥前缀转发（含 WebSocket 升级）：

```bash
# 终端 A：本地 jar（路由在前端构建前缀下）
SCOFEN_AUTH_ADMIN_PASSWORD='<临时口令>' java -jar scofen-web/target/scofen-server.jar --server.port=18091

# 终端 B：反代 18092 -> 18091
node tools/verify/local-prefix-proxy.mjs

# 终端 C：E2E 指到反代地址
SCOFEN_PASSWORD='<临时口令>' \
APP_URL='http://127.0.0.1:18092/scofen/modelerStudio/' \
CDP_PORT=9444 node shell-ux-e2e.mjs
```

> 每个脚本要用**独立的 Chrome `--user-data-dir`**：上一次运行留下的登录态会让脚本找不到登录框。

## 运行

Chrome 必须与 node 脚本在**同一次 Bash 调用**里启动：shell 调用一结束，
后台进程会被回收，脚本连不上 CDP 端口。沙箱内 Chrome 必须带 `--no-sandbox`，
否则 GPU 进程不可用会直接自杀。

```bash
cd tools/verify
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --disable-gpu \
  --remote-debugging-port=9444 \
  --user-data-dir=/tmp/scofen-verify/profile \
  --window-size=1600,1000 about:blank > /tmp/chrome.log 2>&1 &
sleep 4
SCOFEN_PASSWORD='<超管口令>' \
APP_URL='http://127.0.0.1:18080/' \
CDP_PORT=9444 node xmi-e2e.mjs

# 项目根 / 新建 Model 节点
SCOFEN_PASSWORD='<超管口令>' \
APP_URL='http://<IP>/scofen/modelerStudio/' \
CDP_PORT=9444 node root-package-e2e.mjs

# 初始化失败自愈（会主动阻断页面 API，脚本内部自行恢复）
SCOFEN_PASSWORD='<超管口令>' \
APP_URL='http://<IP>/scofen/modelerStudio/' \
CDP_PORT=9444 node reconnect-e2e.mjs

# 属性栏：三档下拉 / 搜索排序 / 三点编辑弹框
SCOFEN_PASSWORD='<超管口令>' \
APP_URL='http://<IP>/scofen/modelerStudio/' \
CDP_PORT=9444 node property-panel-e2e.mjs

# 模型树：扩展包开关（隔离 + 内嵌）/ 关系虚拟节点（单向挂一方、双向挂两方）
SCOFEN_PASSWORD='<超管口令>' \
APP_URL='http://<IP>/scofen/modelerStudio/' \
CDP_PORT=9444 node tree-extensions-relations-e2e.mjs

# 外壳与树形态：扩展包层级 / 项目根折叠 / 蓝色三角 / 两栏拖宽 / 删除项目
SCOFEN_PASSWORD='<超管口令>' \
APP_URL='http://<IP>/scofen/modelerStudio/' \
CDP_PORT=9444 node shell-ux-e2e.mjs

# 属性面板上下拖动 + 扩展域孤儿行隔离 + 左右拖宽回归
SCOFEN_PASSWORD='<超管口令>' \
APP_URL='http://<IP>/scofen/modelerStudio/' \
CDP_PORT=9444 node property-dock-resize-e2e.mjs

# 自动排布：只打本地沙箱。先起一个带临时口令的本地 jar，灌数，再跑 e2e
SCOFEN_AUTH_ADMIN_PASSWORD='<临时口令>' java -jar scofen-web/target/scofen-server.jar --server.port=18095 --server.address=127.0.0.1
SCOFEN_PASSWORD='<临时口令>' APP_URL='http://127.0.0.1:18095/' \
  node local-seed.mjs '需求图-D1,用例图-D7,活动图-注册验证'
SCOFEN_PASSWORD='<临时口令>' APP_URL='http://127.0.0.1:18095/' CDP_PORT=9444 node auto-layout-e2e.mjs
# 换一批图验别的形状：SCOFEN_DIAGRAMS='用例图-D7,活动图-注册验证'（弹框默认策略想改看 [2] 的断言）

# 画布平移：脚本自己灌数，只要一个能登录的本地前端。两种接法：
#   a) 走 jar 产物（要先 npm run build 把 dist 同步进 static 再重打 jar）
SCOFEN_PASSWORD='<临时口令>' APP_URL='http://127.0.0.1:18095/' CDP_PORT=9457 node canvas-pan-e2e.mjs
#   b) 走 vite 源码（改 TSX 立刻生效，不必动 jar——本机 jar 正被别的改动占用时用这条）
SCOFEN_AUTH_ADMIN_PASSWORD='<临时口令>' java -jar scofen-web/target/scofen-server.jar --server.port=8080 --server.address=127.0.0.1
(cd frontend && npx vite --port 5199 --strictPort)   # vite 只监听 ::1，地址要写 localhost 不是 127.0.0.1
SCOFEN_PASSWORD='<临时口令>' APP_URL='http://localhost:5199/' CDP_PORT=9457 node canvas-pan-e2e.mjs

# 序列图：同样自己灌数，且可反复重跑（开头会清上一轮 [9] 在界面上建的图与元素）
#   走 vite 源码最快（改 sequenceLayout.ts / App.tsx 立刻生效）：
SCOFEN_PASSWORD='<临时口令>' APP_URL='http://localhost:5199/' CDP_PORT=9457 node sequence-e2e.mjs
#   走 jar 产物时把 APP_URL 换成 http://127.0.0.1:18095/，其余不变
```

## 参数

| 变量 | 说明 |
| --- | --- |
| `SCOFEN_PASSWORD` | 超管口令（脚本与仓库里都不留明文，必填） |
| `APP_URL` | 应用入口。本地根部署 `http://127.0.0.1:18080/`；线上子路径 `http://<IP>/scofen/modelerStudio/` |
| `CDP_PORT` | Chrome 调试端口，须与启动参数一致 |
| `SCOFEN_DIAGRAMS` | `auto-layout-e2e.mjs` 要打开并断言的图名，逗号分隔；默认 `需求图-D1,用例图-D7,活动图-注册验证` |
| `SCOFEN_PROJECT_NAME` | 沙箱项目名（灌数创建、e2e 按名打开）：自动排布两个脚本默认 `自动排布实测`，`canvas-pan-e2e.mjs` 默认 `画布平移实测`，`sequence-e2e.mjs` 默认 `序列图实测` |
| `SCOFEN_SNAPSHOT` | `local-seed.mjs` 读取的模型快照 JSON，默认 `/tmp/mbse/mdesign_payload_final.json`；要复现线上数据得先有一份同结构的快照 |

## 十个易踩点

1. **页面内 fetch 一律用相对路径**（`api/exchange/xmi`，不是 `/api/exchange/xmi`）。
   绝对路径在子路径部署下会打到同机其它站点：服务器上 `/api/` 归 emotion 应用，
   会被它以自己的 401 格式挡掉，症状是「导出接口 401」而实际路径根本不对。
   相对路径相对当前页 `/scofen/modelerStudio/` 解析，两种部署都成立。

2. **异步 `Runtime.evaluate` 必须传 `awaitPromise: true`**，否则 Promise 未被等待，
   读到的返回值是 undefined，断言会莫名其妙全红。

3. **撤销 / 重做本身也是一条命令**，`revision` 照样往前走。判断「是否回到排布前」只能比坐标
   和 `api/health` 的 `undoDepth`，不能比 revision；跑「全部图表」这种大动作前先记下
   `undoDepth`，撤销时只回退到那个数，多按会把灌数命令的历史也撤掉。

4. **本地 jar 一重启，浏览器里那个项目指针就废了**。未配 `scofen.auth.jwt-secret` 时每次启动换签名
   密钥，项目 id 也随内存态重新生成，而 `localStorage.scofen.modeler.project` 还留着上一次的 id：
   带着它请求，`api/model` / `api/health` 全 404。症状是工作台照样渲染、项目名停在「未命名项目」、
   底部挂一条「连接失败：HTTP 404」——所以**不能只看 `.props-dock` 在不在**就认定进了工作台。
   要么换一个干净 origin（vite 的 5199 与 jar 的 18095 不同源，localStorage 互不影响），
   要么先登出重登，并以 `.project-switch` 里拿得到真实项目名为准。

5. **属性面板默认停在「属性」页签**，关系列表（`.rel-link-row`）在「关系」页签里，直接查永远是 0；
   工具栏的撤销按钮要等命令写完后的一次 `health` 刷新才解禁，拖完 200ms 就点等于点了个
   `disabled`——症状是「撤销没生效、revision 没往前走」，而不是任何报错。脚本里先等
   `!b.disabled` 再点。

6. **生命线只能挂在 Interaction 之下**。直接 `CREATE_ELEMENT {type:'Lifeline', ownerId: 项目根}`
   会被容器规则拒（`包 (PACKAGE) cannot own 生命线 (LIFELINE)`）——这条规则同时解释了产品上原先
   「界面上根本建不出序列图元素」：工具箱建元素用的是图的宿主，而图的宿主通常是包。
   `sequence-e2e.mjs` 先建 `sq-int`（Interaction）再把三条生命线挂它下面，图也以它为宿主。

7. **默认视口只有 640×420 模型单位**，第三列生命线（记法 x=600、表头宽 168）落在画布右边之外。
   用 `getBoundingClientRect()` 取到的按下点会跑到窗口外（实测 x=1678 而视口宽 1600），
   `elementFromPoint` 返回 null，鼠标事件谁也没命中——症状是「生命线拖不动、revision 一动不动」，
   而不是任何报错。拖动前先点一次「适应窗口」，并断言按下点 `elementFromPoint` 命中 `.node`。

8. **服务端 revision 前进了 ≠ 界面画出来了**。写完或撤销后用 `api/model` 轮询到期望 rev 就立刻读图面，
   量到的还是刷新前的旧坐标（症状：撤销后生命线仍停在拖过的位置）。要等状态栏那个 `rev N`
   的 `.sb-item` 跟上服务端再读，脚本里就是 `waitForUiRevision()`。

9. **走界面的脚本重跑前要清残留**。`sequence-e2e.mjs` 的 [9] 会在项目里留下「UI 建的序列图」+
   自动补的 Interaction 宿主 + 拖入的生命线；第二轮同名图创建被拒、`axes.length` 莫名多一条，
   断言全失真。脚本开头按图名 `DELETE_DIAGRAM`、再 `DELETE_ELEMENTS` 掉非灌数的那批
   Interaction / 生命线 / 注释，灌数的 id 在保护名单里。

10. **别在跑着的 JVM 上重打它正在用的 jar**。Spring Boot 按需从 jar 里懒加载嵌套类，
    另一个会话（或你自己）重打 `scofen-web/target/scofen-server.jar` 会让正在运行的实例
    在下一次加载类时 `NoClassDefFoundError`（实测报 `TokenList`），症状是登录接口 500。
    本机 jar 正被别的改动占用时：`cp` 一份到 `/tmp/xxx.jar` 再从副本起一个自己的端口。

## 产物

截图落在 `/tmp/scofen-xmi-shots/`、`/tmp/scofen-root-shots/`、`/tmp/scofen-prop-shots/`、
`/tmp/scofen-tree-shots/`、`/tmp/scofen-shell-shots/`、`/tmp/scofen-props-shots/`、
`/tmp/scofen-layout-shots/`、`/tmp/scofen-pan-shots/` 与 `/tmp/scofen-seq-shots/`
以及 `/tmp/scofen-reconnect-*.png`，导入用的样本文件落在 `/tmp/scofen-xmi-files/`。
