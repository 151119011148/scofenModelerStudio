# 浏览器级实测脚本

用 headless Chrome + CDP 直驱真实 UI 做端到端验证，不依赖 puppeteer/playwright。

## 脚本

| 脚本 | 覆盖 |
| --- | --- |
| `xmi-e2e.mjs` | XMI 导入导出：登录 → 「文件」菜单四个入口 → 导出三种格式 → 导入对话框 → 选文件 → 导入 → 撤销 → 无侧车导入（服务端重排九图）。末尾会自动撤销，把线上项目恢复干净 |
| `root-package-e2e.mjs` | 项目根 Package + 可创建 Model 节点：登录 → 检查模型树根 → 「模型」菜单新建对话框 → 类型下拉选 MODEL → 创建 → 树上出现新节点 → 撤销恢复 → XMI 根标签为 `uml:Package` |
| `reconnect-e2e.mjs` | 初始化失败自愈：用 CDP `Network.setBlockedURLs` 阻断所有 `/api` 请求后刷新，验证出现连接失败横幅、不再用「该父类型不允许再包含子元素」伪装成元模型规则；解除阻断后分别验证自动退避重试与「立即重试」按钮都能让页面恢复 |
| `property-panel-e2e.mjs` | 属性栏三件套：右上角三档下拉与计数、按属性 key 搜索（含空态）、key 升序 / 降序 / 规范顺序三态排序、可编辑行「⋯」弹框的字符 / 数组 / 模型引用 / 枚举四类编辑器、清除值与 Esc 关闭、服务端快照写入与撤销恢复，末尾校验数据无残留 |

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
```

## 参数

| 变量 | 说明 |
| --- | --- |
| `SCOFEN_PASSWORD` | 超管口令（脚本与仓库里都不留明文，必填） |
| `APP_URL` | 应用入口。本地根部署 `http://127.0.0.1:18080/`；线上子路径 `http://<IP>/scofen/modelerStudio/` |
| `CDP_PORT` | Chrome 调试端口，须与启动参数一致 |

## 两个易踩点

1. **页面内 fetch 一律用相对路径**（`api/exchange/xmi`，不是 `/api/exchange/xmi`）。
   绝对路径在子路径部署下会打到同机其它站点：服务器上 `/api/` 归 emotion 应用，
   会被它以自己的 401 格式挡掉，症状是「导出接口 401」而实际路径根本不对。
   相对路径相对当前页 `/scofen/modelerStudio/` 解析，两种部署都成立。

2. **异步 `Runtime.evaluate` 必须传 `awaitPromise: true`**，否则 Promise 未被等待，
   读到的返回值是 undefined，断言会莫名其妙全红。

## 产物

截图落在 `/tmp/scofen-xmi-shots/`、`/tmp/scofen-root-shots/`、`/tmp/scofen-prop-shots/`
与 `/tmp/scofen-reconnect-*.png`，导入用的样本文件落在 `/tmp/scofen-xmi-files/`。
