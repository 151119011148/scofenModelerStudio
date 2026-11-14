/**
 * 序列图的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 生命线 = 表头框 + 竖直虚线，全部表头对齐到同一行、全部虚线收到同一个底边；
 *   2) 消息 = 水平箭头，一条一个时间槽，槽序 = 模型里的 messageOrder，不再是对角连线；
 *   3) 线型按 messageSort：同步实心三角、异步开放箭头、回复虚线 + «reply» 构造型；
 *   4) 自消息向右折出，回到同一条生命线；
 *   5) 接收端画推导出的激活条（纯图面，不落库）；
 *   6) 端点不是生命线的消息退回通用连线渲染，不凭空消失；
 *   7) 点消息 = 选中那条 message 关系，属性面板能直接改 messageSort；
 *   8) 拖动生命线时消息实时跟着换列，一次拖动只推进 1 个 revision 且可撤销；
 *   9) 内容包围盒 / 适应窗口含推导出来的消息行与生命线末端，且渲染本身零写入；
 *  10) 时间槽顺序是模型数据：Alt+↑/↓ 改序、落库、一步撤销；
 *  11) 组合片段画成 alt/opt 框（operator 五边形标签、操作数分隔虚线、[guard]），区间是模型属性；
 *  12) 拖动消息线改序：插入指示线、落到目标槽、一个 revision、一步撤销；
 *  13) 走界面新建序列图：宿主自动补成 Interaction，工具箱拖入生命线不再被容器规则拒；
 *  14) 走界面逐个点七种消息组件：返回 / 创建 / 销毁 / 给自己的消息 / 异步信号，
 *      messageSort 随关系一次落库，图面分别是长虚线 «reply»、斜指下移表头的 «create»、
 *      红色 X 终止符、四段自反回环、短点虚线，且序列图不再重复列通用「消息」按钮。
 *
 * 读图一律取 SVG 属性值：属性是模型单位，与当前缩放无关，断言不会被视口比例糊弄。
 * 数据由本脚本在本地沙箱里自己造（绕开界面直接发命令），只连本地端口，不碰线上；
 * 开头会清掉上一轮走界面留下的图与元素，所以可以反复重跑。
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5199/'
const PORT = Number(process.env.CDP_PORT ?? 9457)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const PROJECT_NAME = process.env.SCOFEN_PROJECT_NAME ?? '序列图实测'
const DIAGRAM_NAME = '序列图实测图'
const DIAGRAM_ID = 'sq-diagram'
const SHOTS = '/tmp/scofen-seq-shots'

// 与 sequenceLayout.ts 保持一致的图面常量（脚本独立复算，不用产品代码兜底断言）。
const HEADER_HEIGHT = 44
const HEADER_MIN_WIDTH = 110
const FIRST_GAP = 52
const ROW_PITCH = 54
const ACTIVATION_WIDTH = 12

const LIFELINES = [
  { id: 'sq-l1', name: '用户', x: 120 },
  { id: 'sq-l2', name: '前端界面', x: 360 },
  { id: 'sq-l3', name: '订单服务', x: 600 },
]
/** 元模型的容器规则：生命线只能挂 Interaction（或片段）之下，所以图宿主先建一个交互。 */
const HOST_ID = 'sq-int'
const HOST_NAME = '下单交互'
/** 端点不是生命线的一条消息：应该走通用连线，不能被序列图渲染吞掉。 */
const NON_LIFELINE_TARGET = 'sq-note'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
let failed = 0
function check(label, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`    PASS — ${label}`)
  } else {
    failed++
    console.log(`    FAIL — ${label}${extra ? ' :: ' + extra : ''}`)
  }
  return cond
}

// ── 服务端：造数据 + 取权威快照 ─────────────────────────────────────────────
const APP = APP_URL.replace(/\/$/, '') + '/'
let token = ''
let projectId = ''
let revision = 0

async function api(path, init = {}) {
  const response = await fetch(new URL(path, APP), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Scofen-Session': 'web-ui',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(projectId ? { 'X-Scofen-Project': projectId } : {}),
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${path} → HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`)
  }
  return body
}

async function cmd(type, payload) {
  const patch = await api('api/commands', {
    method: 'POST',
    body: JSON.stringify({
      type, payload, baseRevision: revision, clientCmdId: `${type}-${revision}`,
    }),
  })
  revision = patch.revision
  return patch
}

const snapshot = () => api('api/model')
const notationsOf = (model) => model.notations.filter((n) => n.diagramId === DIAGRAM_ID)
  .map((n) => `${n.elementId}:${Math.round(n.x)},${Math.round(n.y)}`).sort().join('|')

/**
 * 三条生命线 + 四条消息（异步 / 回复 / 自消息）+ 一条打不到生命线的消息。
 * messageSort 用 UPDATE_PROPERTY 写进关系元属性——渲染层据它选线型，这里先确认服务端认这条键。
 */
/**
 * 上一轮 [9] 在界面上建的东西（图 + 顺带补的 Interaction 宿主 + 拖进去的生命线）会留在沙箱里，
 * 让这一轮的「提交创建」「推进 2 个 revision」「新图只有一条生命线」全部失真：先按名字清干净。
 * 只碰本脚本自己造的图名，灌数的三条生命线/宿主/便签在保护名单里。
 */
const UI_DIAGRAM_NAME = 'UI 建的序列图'
const SEEDED_IDS = new Set([HOST_ID, NON_LIFELINE_TARGET, ...LIFELINES.map((item) => item.id)])

async function cleanUiLeftovers(model) {
  const strayDiagrams = model.diagrams.filter((d) => d.name.startsWith(UI_DIAGRAM_NAME))
  for (const diagram of strayDiagrams) await cmd('DELETE_DIAGRAM', { id: diagram.id })
  const fresh = await snapshot()
  const strays = fresh.elements.filter((element) => !SEEDED_IDS.has(element.id)
    && ['lifeline', 'interaction', 'comment'].some((kind) => element.type.toLowerCase().includes(kind)))
  if (strays.length > 0) await cmd('DELETE_ELEMENTS', { ids: strays.map((element) => element.id) })
  if (strayDiagrams.length > 0 || strays.length > 0) {
    console.log(`    清掉上一轮界面残留：图 ${strayDiagrams.length} · 元素 ${strays.length}`)
  }
}

async function seed() {
  const session = await api('api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'scofen', password: PASSWORD }),
  })
  token = session.token
  const directory = await api('api/workspaces')
  const space = (directory.spaces ?? []).find((item) => item.kind === 'personal')
    ?? (directory.spaces ?? [])[0]
  const existing = (space.projects ?? []).find((project) => project.name === PROJECT_NAME)
  const project = existing ?? await api('api/workspaces/projects', {
    method: 'POST',
    headers: { 'X-Scofen-Project': space.code },
    body: JSON.stringify({
      spaceCode: space.code, name: PROJECT_NAME,
      description: '本地沙箱：验证序列图生命线与消息的图面实现',
    }),
  })
  projectId = project.id
  const model = await api('api/model')
  revision = model.revision
  const rootId = (model.elements.find((element) => !element.ownerId) ?? { id: 'model-root' }).id
  const known = new Set(model.elements.map((element) => element.id))
  console.log(`    项目 ${projectId} · 根 ${rootId} · rev ${revision}`)
  await cleanUiLeftovers(model)

  if (!known.has(HOST_ID)) {
    await cmd('CREATE_ELEMENT', {
      id: HOST_ID, type: 'Interaction', name: HOST_NAME, ownerId: rootId, documentation: '',
    })
  }
  const knownAfterHost = new Set((await snapshot()).elements.map((element) => element.id))
  for (const item of LIFELINES) {
    if (!knownAfterHost.has(item.id)) {
      await cmd('CREATE_ELEMENT', {
        id: item.id, type: 'Lifeline', name: item.name, ownerId: HOST_ID, documentation: '',
      })
    }
  }
  if (!known.has(NON_LIFELINE_TARGET)) {
    await cmd('CREATE_ELEMENT', {
      id: NON_LIFELINE_TARGET, type: 'Comment', name: '审批记录', ownerId: HOST_ID, documentation: '',
    })
  }
  const existingDiagram = (await snapshot()).diagrams.find((d) => d.id === DIAGRAM_ID)
  if (!existingDiagram) {
    await cmd('CREATE_DIAGRAM', {
      id: DIAGRAM_ID, kind: 'seq', name: DIAGRAM_NAME, ownerId: HOST_ID,
      elementIds: [...LIFELINES.map((item) => item.id), NON_LIFELINE_TARGET],
    })
  }
  await cmd('SET_NOTATIONS', {
    items: [
      ...LIFELINES.map((item) => ({ diagramId: DIAGRAM_ID, elementId: item.id, x: item.x, y: 80 })),
      { diagramId: DIAGRAM_ID, elementId: NON_LIFELINE_TARGET, x: 820, y: 40 },
    ],
  })

  const messages = [
    { id: 'sq-m1', name: '提交订单', sourceId: 'sq-l1', targetId: 'sq-l2' },
    { id: 'sq-m2', name: '扣减库存', sourceId: 'sq-l2', targetId: 'sq-l3', sort: 'asynchCall' },
    { id: 'sq-m3', name: '库存结果', sourceId: 'sq-l3', targetId: 'sq-l2', sort: 'reply' },
    { id: 'sq-m4', name: '刷新角标', sourceId: 'sq-l2', targetId: 'sq-l2', sort: 'synchCall' },
    { id: 'sq-m5', name: '留痕', sourceId: 'sq-l1', targetId: NON_LIFELINE_TARGET },
  ]
  const knownRelations = new Set((await snapshot()).relationships.map((r) => r.id))
  for (const message of messages) {
    if (!knownRelations.has(message.id)) {
      await cmd('CREATE_RELATIONSHIP', {
        id: message.id, type: 'message', sourceId: message.sourceId,
        targetId: message.targetId, name: message.name, documentation: '',
      })
    }
    if (message.sort) {
      await cmd('UPDATE_PROPERTY', { id: message.id, key: 'messageSort', value: message.sort })
    }
  }
  const written = await snapshot()
  const withSort = written.relationships.filter((r) => r.properties?.messageSort)
  check('messageSort 能落到关系元属性（渲染线型的依据）', withSort.length === 3,
    `已落 ${withSort.length} 条：${withSort.map((r) => r.properties.messageSort).join('/')}`)
  check('生命线坐标真的落库', notationsOf(written).includes('sq-l1:120,80'), notationsOf(written))
  return written
}

// ── CDP ────────────────────────────────────────────────────────────────────
async function connect() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
  const ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('ws error'))
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error('CDP timeout: ' + method))
        }
      }, 30000)
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    })
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + JSON.stringify(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    }
    return r.result.value
  }
  const goto = async (url) => {
    await call('Page.navigate', { url })
    await sleep(2000)
  }
  const screenshot = async (name) => {
    mkdirSync(SHOTS, { recursive: true })
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    const file = `${SHOTS}/${name}.png`
    writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }
  return { call, evaluate, goto, screenshot, close: () => ws.close() }
}

async function waitFor(page, expr, tries = 120, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await page.evaluate(expr)) return true
    } catch {
      /* 页面尚未就绪 */
    }
    await sleep(gap)
  }
  return false
}

const clickByText = (selector, text) =>
  `(()=>{const el=[...document.querySelectorAll('${selector}')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(el)el.click();return !!el})()`

/**
 * 图面读数（模型单位）：
 *   headers/axes —— 生命线表头与竖直虚线（.lifeline-axis）
 *   messages   —— 时间槽上的消息（.seq-message），按 y 升序即图面槽序
 *   loose      —— 没进时间槽、仍走通用连线的关系条数
 */
const sceneExpr = `(()=>{const svg=document.querySelector('.canvas > svg')
 const num=(el,a)=>Number(el.getAttribute(a))
 const axes=[...svg.querySelectorAll('.lifeline-axis')].map(l=>({x:num(l,'x1'),top:num(l,'y1'),bottom:num(l,'y2')}))
 const headers=[...svg.querySelectorAll('.node')].filter(g=>g.querySelector('.lifeline-axis'))
   .map(g=>{const r=g.querySelector('rect')
     return {x:num(r,'x'),y:num(r,'y'),w:num(r,'width'),h:num(r,'height'),
       type:(g.querySelector('text')?.textContent||'').trim(),
       name:[...g.querySelectorAll('text')].map(t=>t.textContent.trim()).filter(s=>!s.startsWith('«')).join('')}})
 // 激活条画在图面层（一条可能横跨好几行），不再挂在某条消息里：先收全表，再按行归属。
 const bars=[...svg.querySelectorAll('.seq-bar')].map(b=>({x:num(b,'x'),y:num(b,'y'),w:num(b,'width'),h:num(b,'height')}))
 const messages=[...svg.querySelectorAll('.seq-message')].map(g=>{
   const l=g.querySelector('.seq-line')
   const pts=(l.getAttribute('points')||'').trim().split(/\\s+/).filter(Boolean).map(s=>s.split(',').map(Number))
   const self=l.tagName.toLowerCase()==='polyline'
   const y=self?pts[0][1]:num(l,'y1')
   const texts=[...g.querySelectorAll('text')].map(t=>t.textContent.trim())
   const seqText=texts.find(t=>/^\\d+:/.test(t))||''
   return {self,y,x1:self?pts[0][0]:num(l,'x1'),
     x2:self?pts[1][0]:num(l,'x2'),backX:self?pts[pts.length-1][0]:null,
     dash:l.getAttribute('stroke-dasharray')||'',color:l.getAttribute('stroke'),
     arrow:g.querySelector('polygon')?'filled':'open',
     texts,seqNo:Number((seqText.split(':')[0]||'0')),
     labelBg:!!g.querySelector('.seq-label'),
     bar:null}})
   .sort((a,b)=>a.y-b.y)
 // 目标端的激活条按「箭头落点」认领：端点就停在条的左/右边缘，嵌套条向右偏，取最靠右那条。
 for(const m of messages){if(m.self)continue
   const hit=bars.filter(b=>b.y<=m.y+0.5&&b.y+b.h>=m.y-0.5)
     .filter(b=>Math.abs(b.x-m.x2)<1||Math.abs(b.x+b.w-m.x2)<1)
     .sort((a,b)=>a.x-b.x)
   m.bar=hit.length?hit[hit.length-1]:null}
 // 通用连线渲染的容器：整组 pointer-events=none、没有类名（序列消息组是 .seq-message，节点是 .node）。
 const loose=[...svg.children].filter(el=>el.tagName==='g'
   && !el.classList.contains('seq-message') && !el.classList.contains('node')
   && !el.classList.contains('seq-frame')
   && el.getAttribute('pointer-events')==='none').length
 const frame=svg.querySelector('.seq-frame')
 return {axes,headers,bars,messages,loose,
   frame:frame?{label:frame.querySelector('text')?.textContent.trim()||'',
     rect:(()=>{const r=frame.querySelector('rect');return {x:num(r,'x'),y:num(r,'y'),w:num(r,'width'),h:num(r,'height')}})()}:null,
   zoom:parseInt(document.querySelector('.sb-zoom')?.textContent||'',10),
   viewBox:(svg.getAttribute('viewBox')||'').split(/\\s+/).map(Number)}})()`

const page = await connect()

const loginSnippet = `(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`

/**
 * 进工作台并确认项目目录真的拉回来：本地 jar 每次重启换签名密钥，
 * localStorage 里的旧 token / 旧项目指针会让 api/model 404（见 README 易踩点 4）。
 */
async function ensureWorkbench() {
  await page.goto(APP_URL)
  await waitFor(page,
    `!!document.querySelector('.props-dock') || !!document.querySelector('input[name="scofen-admin-username"]')`, 40, 250)
  if (await page.evaluate(`!!document.querySelector('.props-dock')`)) {
    await page.evaluate(`(()=>{document.querySelector('.project-switch')?.click();return 1})()`)
    await sleep(400)
    await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='登出');if(b)b.click();return !!b})()`)
    await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`, 40, 250)
  }
  await page.evaluate(loginSnippet)
  const workbench = await waitFor(page, `!!document.querySelector('.props-dock')`, 40, 250)
  const directory = await waitFor(page,
    `(()=>{const t=document.querySelector('.project-switch')?.textContent??''
       return t.length > 0 && !t.includes('未命名项目')})()`, 40, 250)
  return workbench && directory
}

const axisOfName = (scene, name) => {
  const index = scene.headers.findIndex((h) => h.name === name)
  return index >= 0 ? scene.axes[index] : undefined
}

/** 消息显示名：标签前缀带时间轴序号（「1: 提交订单」），断言只比较名字。 */
const messageName = (message) => {
  const label = message.texts.find((text) => !text.startsWith('«')) ?? ''
  return label.replace(/^\d+:\s*/, '')
}

/**
 * 消息在目标端的落点：有激活条时箭头停在条的边缘（不扎进条里），
 * 从左来停左边缘、从右来停右边缘；没有激活条才贴到生命线中心。
 */
const expectedEnd = (message, targetAxisX) => (message.bar
  ? (targetAxisX >= message.x1 ? message.bar.x : message.bar.x + message.bar.w)
  : targetAxisX)

/** 自消息画成四段折线，回到生命线的那一段才是端点（x2 只是折返竖腿的横坐标）。 */
const messageEnd = (message) => (message.self ? message.backX : message.x2)

/**
 * 服务端 revision 前进了不等于界面画出来了：写完之后前端还要 refresh 一次模型。
 * 读图面前先等状态栏那个 rev 跟上，否则量到的是刷新前的旧图面。
 */
const waitForUiRevision = (expected, tries = 60, gap = 120) => waitFor(page,
  `(()=>{const t=[...document.querySelectorAll('.sb-item')].map(e=>e.textContent.trim())
     .find(x=>/^rev \\d+$/.test(x));return !!t && Number(t.split(/\\s+/)[1])===${expected}})()`,
  tries, gap)

/**
 * 端点是否落在该列：允许停在列中心，或停在激活条的左/右边缘
 * （自消息从右侧折返，落在条的右边缘；反向消息落在左边缘）。
 */
const endsOnColumn = (message, axis) => {
  const end = messageEnd(message)
  const candidates = [axis.x]
  if (message.bar) candidates.push(message.bar.x, message.bar.x + message.bar.w)
  return candidates.some((value) => Math.abs(value - end) < 1)
}

/** 轮询等 revision 走到期望值：写命令要等服务端返回 + 前端刷模型，固定 sleep 会读到中间态。 */
async function waitForRevision(expected, tries = 40, gap = 200) {
  for (let i = 0; i < tries; i++) {
    const current = (await snapshot()).revision
    if (current === expected) return true
    await sleep(gap)
  }
  return false
}

console.log('[1] 本地沙箱灌数 + 登录打开序列图')
check('登录成功进入工作台', await ensureWorkbench())
await seed()
check('灌数后回到工作台', await ensureWorkbench())
await page.evaluate(`document.querySelector('.project-switch')?.click()`)
check(`项目列表里有「${PROJECT_NAME}」`,
  await waitFor(page, clickByText('.pp-project', PROJECT_NAME), 40, 200))
await sleep(1500)
await page.evaluate(clickByText('.tree-head-tab', '图表'))
await sleep(400)
check(`打开图「${DIAGRAM_NAME}」`,
  await waitFor(page, clickByText('.chart-row', DIAGRAM_NAME), 40, 200))
await sleep(900)

const scene = await page.evaluate(sceneExpr)
if (scene.axes.length !== 3) {
  throw new Error(`画布上只找到 ${scene.axes.length} 条生命线虚线：多半是图没真的打开，先查 [1]`)
}
console.log(`    生命线 ${scene.headers.length} 条 · 时间槽消息 ${scene.messages.length} 条 · 通用连线元素 ${scene.loose}`)

console.log('\n[2] 生命线：表头同行、虚线同底')
check('三条生命线都画成表头 + 竖直虚线', scene.axes.length === 3 && scene.headers.length === 3,
  `表头 ${scene.headers.length} · 虚线 ${scene.axes.length}`)
check('表头全部对齐到同一行（y 相同）', new Set(scene.headers.map((h) => h.y)).size === 1,
  scene.headers.map((h) => h.y).join('/'))
check('表头用生命线专用高度', scene.headers.every((h) => h.h === HEADER_HEIGHT),
  scene.headers.map((h) => h.h).join('/'))
check('表头宽度不跟着窄记法走（至少放得下名字）',
  scene.headers.every((h) => h.w >= HEADER_MIN_WIDTH), scene.headers.map((h) => Math.round(h.w)).join('/'))
check('虚线起于表头底边', scene.axes.every((a, i) =>
  Math.abs(a.top - (scene.headers[i].y + HEADER_HEIGHT)) < 1), scene.axes.map((a) => a.top).join('/'))
check('虚线全部收到同一个底边（时间轴等长）',
  new Set(scene.axes.map((a) => Math.round(a.bottom))).size === 1,
  scene.axes.map((a) => Math.round(a.bottom)).join('/'))
check('虚线竖直且是虚线', await page.evaluate(`[...document.querySelectorAll('.lifeline-axis')]
  .every(l=>l.getAttribute('stroke-dasharray')&&l.getAttribute('x1')===l.getAttribute('x2'))`))
check('虚线中线 = 表头水平中心', scene.axes.every((a, i) =>
  Math.abs(a.x - (scene.headers[i].x + scene.headers[i].w / 2)) < 1),
  scene.axes.map((a, i) => `${a.x.toFixed(0)}/${(scene.headers[i].x + scene.headers[i].w / 2).toFixed(0)}`).join(' '))
check('表头里带 Lifeline 构造型与名字',
  scene.headers.every((h) => h.type.includes('«') && h.name.length > 0),
  scene.headers.map((h) => `${h.type}|${h.name}`).join(' '))
await page.screenshot('seq-lifelines')

console.log('\n[3] 消息：水平箭头 + 时间槽按创建顺序堆叠')
check('四条消息进时间槽，第五条（端点非生命线）退回通用连线',
  scene.messages.length === 4 && scene.loose >= 1,
  `时间槽 ${scene.messages.length} · 通用连线元素 ${scene.loose}`)
check('时间槽上的消息首段都是水平的', await page.evaluate(`[...document.querySelectorAll('.seq-message')]
  .every(g=>{const l=g.querySelector('.seq-line')
    if(l.tagName.toLowerCase()==='line')return l.getAttribute('y1')===l.getAttribute('y2')
    const p=l.getAttribute('points').trim().split(/\\s+/).map(s=>s.split(',').map(Number))
    return p[0][1]===p[1][1]})`))
console.log(`    槽序（按 y）：${scene.messages.map((m) => m.texts.find((x) => !x.startsWith('«'))).join(' → ')}`)
check('相邻槽行距恒等于时间槽间距', scene.messages.every((m, i) =>
  i === 0 || Math.abs(m.y - scene.messages[i - 1].y - ROW_PITCH) < 1),
  scene.messages.map((m) => Math.round(m.y)).join('/'))
check('第一条消息在表头之下留出一段间隔',
  Math.abs(scene.messages[0].y - (scene.headers[0].y + HEADER_HEIGHT + FIRST_GAP)) < 1,
  `${scene.messages[0].y} vs ${scene.headers[0].y + HEADER_HEIGHT + FIRST_GAP}`)
check('槽序就是创建顺序：提交订单 → 扣减库存 → 库存结果 → 刷新角标',
  scene.messages.every((m, i) => m.texts.join('|').includes(
    ['提交订单', '扣减库存', '库存结果', '刷新角标'][i])))
const m1 = scene.messages[0]
check('消息源端贴生命线列、目标端贴该列的激活条边缘',
  Math.abs(m1.x1 - axisOfName(scene, '用户').x) < 1
  && Math.abs(m1.x2 - expectedEnd(m1, axisOfName(scene, '前端界面').x)) < 1,
  `${m1.x1} → ${m1.x2}，列 ${axisOfName(scene, '用户').x} / ${axisOfName(scene, '前端界面').x}`)
check('反向消息从右往左画（库存结果 服务→界面）', await page.evaluate(`(()=>{const g=[...document.querySelectorAll('.seq-message')]
  .find(x=>x.textContent.includes('库存结果'));const l=g.querySelector('.seq-line')
  return Number(l.getAttribute('x1'))>Number(l.getAttribute('x2'))})()`))
check('每条消息的两端都落在生命线列上（目标端算上激活条边缘）',
  scene.messages.every((m) => scene.axes.some((a) => Math.abs(a.x - m.x1) < 1)
    && scene.axes.some((a) => endsOnColumn(m, a))),
  scene.messages.map((m) => `${Math.round(m.x1)}→${Math.round(messageEnd(m))}`).join(' '))
check('每条消息都有箭头', scene.messages.every((m) => m.arrow === 'filled' || m.arrow === 'open'))

console.log('\n[4] messageSort 决定线型（UML 规范）')
const [mSync, mAsync, mReply, mSelf] = scene.messages
check('同步调用：实线 + 实心箭头', !mSync.dash && mSync.arrow === 'filled',
  `dash=${mSync.dash || '无'} arrow=${mSync.arrow}`)
check('异步调用：实线 + 开放箭头', !mAsync.dash && mAsync.arrow === 'open',
  `dash=${mAsync.dash || '无'} arrow=${mAsync.arrow}`)
check('回复：虚线 + 开放箭头 + «reply» 构造型', !!mReply.dash && mReply.arrow === 'open'
  && mReply.texts.includes('«reply»'), `dash=${mReply.dash || '无'} arrow=${mReply.arrow} texts=${mReply.texts.join('/')}`)
check('自消息折成四段折线并回到同一条生命线', mSelf.self
  && Math.abs(mSelf.x1 - axisOfName(scene, '前端界面').x) < 1
  && (await page.evaluate(`(()=>{const g=[...document.querySelectorAll('.seq-message')]
      .find(x=>x.textContent.includes('刷新角标'));const p=g.querySelector('.seq-line')
      const pts=p.getAttribute('points').trim().split(/\\s+/).map(s=>s.split(',').map(Number))
      return pts.length===4&&pts[0][0]===pts[3][0]&&pts[0][1]!==pts[3][1]&&pts[1][0]>pts[0][0]})()`)))
check('消息标签压在行上方且带白色底块（不被虚线糊住）',
  scene.messages.every((m) => m.labelBg && m.texts.length > 0))

console.log('\n[5] 激活条：按调用栈推导，不落库')
const bars = scene.messages.filter((m) => m.bar)
check('非自消息的接收端都压在激活条上', bars.length === 3, `${bars.length} 条`)
check('激活条居中压在目标生命线上', bars.every((m) =>
  !!scene.axes.find((a) => Math.abs(a.x - (m.bar.x + m.bar.w / 2)) < 1)))
check('激活条覆盖消息所在行、且不越过生命线底边', bars.every((m) =>
  m.bar.y <= m.y + 0.5 && m.y <= m.bar.y + m.bar.h + 0.5 && m.bar.y + m.bar.h <= scene.axes[0].bottom + 1),
  bars.map((m) => `${Math.round(m.bar.y)}+${Math.round(m.bar.h)}`).join(' '))
/*
 * 调用栈规则（这次修掉的老毛病）：收到调用才压一层、本线发出 reply 才收口，
 * 中间「往下游发请求」不算结束。老实现是「收到后发下一条消息即收口」，
 * 于是 前端界面 收下 提交订单 之后转手发 扣减库存，自己的激活条就被截断了。
 */
check('激活条按调用栈收口：本线发出 reply 才结束，否则一直执行到生命线底边',
  bars.every((m) => {
    const center = m.bar.x + m.bar.w / 2
    const end = m.bar.y + m.bar.h
    const reply = scene.messages.find((other) => other.y > m.bar.y + 0.5
      && Math.abs(other.x1 - center) < 1 && other.texts.includes('«reply»'))
    const bottom = scene.axes.find((a) => Math.abs(a.x - center) < 1)?.bottom ?? 0
    return reply ? Math.abs(end - reply.y) < 1 : Math.abs(end - bottom) < 1
  }),
  bars.map((m) => `${Math.round(m.bar.y)}..${Math.round(m.bar.y + m.bar.h)}`).join(' '))
check('中转调用不截断自己的激活条（前端界面：收下提交订单后继续执行到最后一行）',
  (() => {
    const front = axisOfName(scene, '前端界面')
    const own = scene.bars.filter((b) => Math.abs((b.x + b.w / 2) - front.x) < 1)
    return own.length === 1 && Math.abs(own[0].y + own[0].h - front.bottom) < 1
  })(),
  scene.bars.map((b) => `${Math.round(b.y)}..${Math.round(b.y + b.h)}`).join(' '))
check('自消息在自己的生命线上叠一条短激活条（UML 的套层）',
  (() => {
    const self = scene.messages.find((m) => m.self)
    const nested = scene.bars.filter((b) => b.y >= self.y - 0.5 && b.y <= self.y + 0.5
      && b.w < ACTIVATION_WIDTH)
    return nested.length === 1 && nested[0].h <= 18
  })(),
  scene.bars.map((b) => `${Math.round(b.x)},${Math.round(b.y)}+${Math.round(b.h)}`).join(' '))
const modelBefore = await snapshot()
const revBeforeRender = modelBefore.revision
const notesBefore = notationsOf(modelBefore)

console.log('\n[6] 点选消息 = 选中关系（可编辑属性）')
const hitPoint = await page.evaluate(`(()=>{const g=[...document.querySelectorAll('.seq-message')]
  .find(x=>x.textContent.includes('扣减库存'));const l=g.querySelector('.seq-hit')
  const b=l.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`)
await page.call('Input.dispatchMouseEvent',
  { type: 'mousePressed', x: hitPoint.x, y: hitPoint.y, button: 'left', clickCount: 1 })
await page.call('Input.dispatchMouseEvent',
  { type: 'mouseReleased', x: hitPoint.x, y: hitPoint.y, button: 'left', clickCount: 1 })
await sleep(500)
check('消息可点选，属性面板进入关系态',
  await waitFor(page, `(()=>{const k=document.querySelector('.props-object-kind')?.textContent||''
    return k.includes('关系')})()`, 20, 150))
check('属性面板列出该消息的 messageSort 行',
  await waitFor(page, `!!document.querySelector('[data-prop-key="messageSort"]')`, 20, 150))
check('点选消息不写数据', (await snapshot()).revision === revBeforeRender,
  `${revBeforeRender} → ${(await snapshot()).revision}`)
await page.screenshot('seq-message-selected')

console.log('\n[7] 拖动生命线：消息实时跟着换列')
// 默认视口只到 640×420 模型单位，第三条生命线列（记法 x=600，表头宽 168）落在画布右边之外。
// 先按「适应窗口」把整张图收进视口，否则按下点根本不在画布上，测到的是「看不见」而不是「拖不动」。
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.sb-btn')].find(x=>x.title==='适应窗口');if(b)b.click();return !!b})()`)
await sleep(800)
const revBeforeDrag = (await snapshot()).revision
const grab = await page.evaluate(`(()=>{const g=[...document.querySelectorAll('.node')]
  .find(x=>x.textContent.includes('订单服务'));const r=g.querySelector('rect')
  const b=r.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`)
const grabHit = await page.evaluate(`(()=>{const el=document.elementFromPoint(${grab.x},${grab.y})
  if(!el)return '画布外'
  return el.closest('.node')?'节点内':el.closest('.seq-message')?'消息内':'其它:'+el.tagName})()`)
const viewExpr = `(()=>{const s=document.querySelector('.canvas > svg')
  return (s.getAttribute('viewBox')||'').split(/\\s+/).map(Number)})()`
const vBefore = await page.evaluate(viewExpr)
const columnBeforeDrag = axisOfName(scene, '订单服务').x
check('适应窗口后表头落在可见画布内（按下点命中节点）', grabHit === '节点内',
  `按下点 ${grab.x},${grab.y} → ${grabHit}`)
await page.call('Input.dispatchMouseEvent',
  { type: 'mousePressed', x: grab.x, y: grab.y, button: 'left', clickCount: 1 })
check('按下表头即选中该生命线（命中落在表头，没被上层图形挡掉）',
  await waitFor(page, `(()=>{const t=document.querySelector('.sb-selected')?.textContent||''
    return t.includes('订单服务')})()`, 20, 100),
  `按下点 ${grab.x},${grab.y} 命中 ${grabHit} · 状态栏「`
  + await page.evaluate(`document.querySelector('.sb-selected')?.textContent ?? ''`))
for (let i = 1; i <= 6; i++) {
  await page.call('Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: grab.x + i * 8, y: grab.y, button: 'left' })
  await sleep(40)
}
check('表头按下并拖出阈值后进入 dragging 态（真的被当成图形拖动，不是平移）',
  await page.evaluate(`document.querySelectorAll('.node.dragging').length > 0`))
const sceneMidDrag = await page.evaluate(sceneExpr)
const dragging = sceneMidDrag
const dragAxis = axisOfName(dragging, '订单服务')
const dragMessage = dragging.messages.find((m) => m.texts.some((text) => text.includes('扣减库存')))
check('消息端点实时贴到拖动中的生命线列（含激活条边缘）',
  dragMessage && Math.abs(dragMessage.x2 - expectedEnd(dragMessage, dragAxis.x)) < 2,
  `列 ${dragAxis?.x.toFixed(0)} 期望端点 ${dragMessage && expectedEnd(dragMessage, dragAxis.x).toFixed(0)}`
  + ` · 实得 ${dragMessage?.x2.toFixed(0)}`)
check('拖动过程中时间槽不重排（顺序仍按 messageOrder）',
  dragging.messages.map((m) => messageName(m)).join('→')
  === '提交订单→扣减库存→库存结果→刷新角标', dragging.messages.map((m) => m.texts.join('|')).join(' / '))
check('生命线仍与其余生命线同底', new Set(dragging.axes.map((a) => Math.round(a.bottom))).size === 1)
await page.call('Input.dispatchMouseEvent',
  { type: 'mouseReleased', x: grab.x + 48, y: grab.y, button: 'left', clickCount: 1 })
const dragCommitted = await waitForRevision(revBeforeDrag + 1)
const toast = await page.evaluate(`document.querySelector('.sb-message')?.textContent?.trim() ?? ''`)
const revAfterDrag = (await snapshot()).revision
check('一次拖动推进 1 个 revision', dragCommitted && revAfterDrag === revBeforeDrag + 1,
  `${revBeforeDrag} → ${revAfterDrag}${toast ? ' · 提示：' + toast : ''}`)
const undoReady = `(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('撤销'))
  return !!b && !b.disabled})()`
check('撤销按钮在写命令后解禁', await waitFor(page, undoReady, 40, 150)
  && await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('撤销'));b.click();return true})()`))
const undoCommitted = await waitForRevision(revAfterDrag + 1)
const uiBack = await waitForUiRevision(revAfterDrag + 1)
const afterUndo = await page.evaluate(sceneExpr)
check('撤销本身也推进 1 个 revision（撤销也是命令）', undoCommitted, `${(await snapshot()).revision}`)
check('撤销后界面刷新到撤销后的 revision', uiBack,
  await page.evaluate(`[...document.querySelectorAll('.sb-item')].map(e=>e.textContent.trim()).find(x=>/^rev \\d+$/.test(x)) ?? ''`))
check('撤销后生命线回到拖动前的列',
  Math.abs(axisOfName(afterUndo, '订单服务').x - columnBeforeDrag) < 2,
  `${columnBeforeDrag} → ${axisOfName(afterUndo, '订单服务').x}`)
const vAfterDrag = await page.evaluate(viewExpr)
check('拖动生命线不带近视口', JSON.stringify(vBefore) === JSON.stringify(vAfterDrag),
  `${vBefore} → ${vAfterDrag}`)

console.log('\n[8] 适应窗口覆盖推导出来的图面，渲染本身零写入')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.sb-btn')].find(x=>x.title==='适应窗口');if(b)b.click();return !!b})()`)
await sleep(800)
const fitted = await page.evaluate(sceneExpr)
const vb = fitted.viewBox
const lastRow = Math.max(...fitted.messages.map((m) => m.y))
const axisBottom = fitted.axes[0].bottom
check('适应窗口后表头、消息行、生命线末端都在视口内',
  vb[1] <= fitted.headers[0].y && vb[1] + vb[3] >= axisBottom + 15 && lastRow < vb[1] + vb[3],
  `视口 y ${vb[1].toFixed(0)}..${(vb[1] + vb[3]).toFixed(0)} · 末行 ${lastRow} · 生命线底 ${axisBottom}`)
check('适应窗口把缩放降到 100% 以下', fitted.zoom < 100, `${fitted.zoom}%`)
const afterFit = await snapshot()
check('渲染、点选、适应窗口一个字节都不写（只有那一次拖动和它的撤销写过）',
  afterFit.revision === revBeforeRender + 2 && notationsOf(afterFit) === notesBefore,
  `rev ${revBeforeRender} → ${afterFit.revision}`)
await page.screenshot('seq-fit')

console.log('\n[10] 时间槽顺序是模型数据：Alt+↑/↓ 改顺序、落库、一步撤销')
const revBeforeOrder = (await snapshot()).revision
const orderHit = await page.evaluate(`(()=>{const g=[...document.querySelectorAll('.seq-message')]
  .find(x=>x.textContent.includes('扣减库存'));const l=g.querySelector('.seq-hit')
  const b=l.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`)
await page.call('Input.dispatchMouseEvent',
  { type: 'mousePressed', x: orderHit.x, y: orderHit.y, button: 'left', clickCount: 1 })
await page.call('Input.dispatchMouseEvent',
  { type: 'mouseReleased', x: orderHit.x, y: orderHit.y, button: 'left', clickCount: 1 })
await sleep(400)
for (const type of ['rawKeyDown', 'keyUp']) {
  await page.call('Input.dispatchKeyEvent', {
    type, key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38, modifiers: 1,
  })
}
const orderCommitted = await waitForRevision(revBeforeOrder + 1)
await waitForUiRevision(revBeforeOrder + 1)
const orderedScene = await page.evaluate(sceneExpr)
check('Alt+↑ 把「扣减库存」从第 2 槽移到第 1 槽',
  messageName(orderedScene.messages[0]) === '扣减库存',
  orderedScene.messages.map(messageName).join(' → '))
check('序号跟着重排（1..n 连续）', orderedScene.messages.map((m) => m.seqNo).join(',') === '1,2,3,4',
  orderedScene.messages.map((m) => m.seqNo).join(','))
const orderModel = await snapshot()
// 「留痕」的端点是注释、不在时间轴上，不该被编号——只断言时间槽里的这四条。
const timelineNames = ['提交订单', '扣减库存', '库存结果', '刷新角标']
const timelineRelations = orderModel.relationships
  .filter((r) => r.type === 'message' && timelineNames.includes(r.name))
check('顺序落库成 messageOrder（不是靠关系数组下标）',
  timelineRelations.length === 4
    && timelineRelations.every((r) => Number.isFinite(Number(r.properties?.messageOrder))),
  timelineRelations.map((r) => `${r.name}:${r.properties?.messageOrder}`).join(' '))
check('一次改序只推进 1 个 revision', orderCommitted, `${revBeforeOrder} → ${orderModel.revision}`)
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button.tbi')]
  .find(x=>x.title.includes('撤销'));if(b)b.click();return !!b})()`)
await waitForRevision(orderModel.revision + 1)
await waitForUiRevision(orderModel.revision + 1)
const restoredScene = await page.evaluate(sceneExpr)
check('撤销一步回到原顺序', messageName(restoredScene.messages[0]) === '提交订单',
  restoredScene.messages.map(messageName).join(' → '))

console.log('\n[11] 组合片段：alt 框、操作数分隔虚线，区间是模型属性')
// [10] 里的撤销是走界面点按钮发的命令，脚本侧的 baseRevision 没跟着走，先对齐服务端。
const fragModel = await snapshot()
revision = fragModel.revision
if (fragModel.elements.some((e) => e.id === 'sq-frag')) {
  await cmd('DELETE_ELEMENT', { id: 'sq-frag' })
}
await cmd('CREATE_ELEMENT', {
  id: 'sq-frag', type: 'CombinedFragment', name: '库存结果分支',
  ownerId: HOST_ID, documentation: '', stereotypes: [],
  diagramId: DIAGRAM_ID, x: 820, y: 300,
})
for (const [key, value] of [
  ['interactionOperator', 'alt'], ['coveredFrom', 2], ['coveredTo', 3], ['guards', ['充足', '不足']],
]) {
  await cmd('UPDATE_PROPERTY', { id: 'sq-frag', key, value })
}
await waitForUiRevision((await snapshot()).revision)
const fragmentExpr = `(()=>{const svg=document.querySelector('.canvas > svg')
 return [...svg.querySelectorAll('.seq-fragment')].map(g=>{
   const r=g.querySelector('rect')
   return {label:g.querySelector('.seq-fragment-label')?.textContent.trim(),
     guard:[...g.querySelectorAll('.seq-fragment-guard')].map(x=>x.textContent.trim()),
     lines:g.querySelectorAll('line[stroke-dasharray]').length,
     rect:r?{x:Number(r.getAttribute('x')),y:Number(r.getAttribute('y')),
       w:Number(r.getAttribute('width')),h:Number(r.getAttribute('height'))}:null,
     nodes:svg.querySelectorAll('g.node').length}})})()`
const fragScene = await page.evaluate(sceneExpr)
const frags = await page.evaluate(fragmentExpr)
check('组合片段画成 alt [充足] 框，而不是普通方块',
  frags.length === 1 && frags[0].label === 'alt [充足]' && frags[0].nodes === 4,
  JSON.stringify(frags))
check('alt 两个操作数之间有分隔虚线并标 [不足]',
  frags[0]?.lines === 1 && frags[0]?.guard.includes('[不足]'), JSON.stringify(frags[0]))
check('片段框住第 2–3 条消息所在的时间槽',
  !!frags[0]?.rect && Math.abs(frags[0].rect.y - (fragScene.messages[1].y - 22)) < 2
    && frags[0].rect.y + frags[0].rect.h > fragScene.messages[2].y,
  `框 ${JSON.stringify(frags[0]?.rect)} · 行 ${fragScene.messages.map((m) => m.y).join(',')}`)
const revBeforeFragEdit = (await snapshot()).revision
await cmd('UPDATE_PROPERTY', { id: 'sq-frag', key: 'coveredTo', value: 4 })
await waitForUiRevision(revBeforeFragEdit + 1)
const wider = (await page.evaluate(fragmentExpr))[0]
check('改 coveredTo 后框向下扩一整行（区间落库、图面现算）',
  Math.abs((wider?.rect?.h ?? 0) - (frags[0]?.rect?.h ?? 0) - ROW_PITCH) < 2,
  `${frags[0]?.rect?.h} → ${wider?.rect?.h}`)
await page.screenshot('seq-fragment')

console.log('\n[12] 拖动消息线改序：落到目标时间槽，一个 revision、一步撤销')
const revBeforeMsgDrag = (await snapshot()).revision
const beforeMsgDrag = await page.evaluate(sceneExpr)
const dragCoords = await page.evaluate(`(()=>{const svg=document.querySelector('.canvas > svg')
 const g=[...svg.querySelectorAll('.seq-message')].find(x=>x.textContent.includes('提交订单'))
 const hit=g.querySelector('.seq-hit');const b=hit.getBoundingClientRect()
 const from={x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}
 const p=svg.createSVGPoint();p.x=Number(hit.getAttribute('x1'));p.y=${beforeMsgDrag.messages[2].y}
 const s=p.matrixTransform(svg.getScreenCTM())
 return {from,to:{x:from.x,y:Math.round(s.y)}}})()`)
await page.call('Input.dispatchMouseEvent',
  { type: 'mousePressed', x: dragCoords.from.x, y: dragCoords.from.y, button: 'left', clickCount: 1 })
for (let i = 1; i <= 8; i++) {
  await page.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: dragCoords.from.x,
    y: Math.round(dragCoords.from.y + ((dragCoords.to.y - dragCoords.from.y) * i) / 8),
    button: 'left',
  })
  await sleep(60)
}
check('拖动过程中出现目标时间槽的插入指示',
  await page.evaluate(`!!document.querySelector('.seq-drop-marker')`))
await page.call('Input.dispatchMouseEvent',
  { type: 'mouseReleased', x: dragCoords.to.x, y: dragCoords.to.y, button: 'left', clickCount: 1 })
const dragOrderCommitted = await waitForRevision(revBeforeMsgDrag + 1)
await waitForUiRevision(revBeforeMsgDrag + 1)
const afterMsgDrag = await page.evaluate(sceneExpr)
check('把第 1 条消息拖到第 3 槽',
  messageName(afterMsgDrag.messages[2]) === '提交订单',
  afterMsgDrag.messages.map(messageName).join(' → '))
check('拖动改序只推进 1 个 revision',
  dragOrderCommitted && (await snapshot()).revision === revBeforeMsgDrag + 1)
const dragOrderModel = await snapshot()
check('拖动改序把新排位写进 messageOrder',
  dragOrderModel.relationships.find((r) => r.name === '提交订单')?.properties?.messageOrder === 3,
  dragOrderModel.relationships.filter((r) => r.type === 'message')
    .map((r) => `${r.name}:${r.properties?.messageOrder}`).join(' '))
await page.screenshot('seq-drag-order')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button.tbi')]
  .find(x=>x.title.includes('撤销'));if(b)b.click();return !!b})()`)
await waitForRevision(revBeforeMsgDrag + 2)
await waitForUiRevision(revBeforeMsgDrag + 2)
const restoredByUndo = await page.evaluate(sceneExpr)
check('撤销一步回到拖动前的顺序', messageName(restoredByUndo.messages[0]) === '提交订单',
  restoredByUndo.messages.map(messageName).join(' → '))
revision = (await snapshot()).revision
await cmd('DELETE_ELEMENT', { id: 'sq-frag' })

console.log('\n[9] 界面建序列图：自动补 Interaction 宿主，工具箱建生命线不再被容器规则拒')
const revBeforeUi = (await snapshot()).revision
check('打开「新建图…」对话框', await waitFor(page,
  `(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('新建图'));if(!b)return false;b.click();return true})()`, 20, 150)
  && await waitFor(page, `!!document.querySelector('.modal select')`, 20, 150))
const uiDiagramName = 'UI 建的序列图'
check('类型选序列图、填名', await page.evaluate(`(()=>{
  const sel=document.querySelector('.modal select'), inp=document.querySelector('.modal input')
  const setV=(el,v,proto)=>{const s=Object.getOwnPropertyDescriptor(proto,'value').set;s.call(el,v);el.dispatchEvent(new Event('change',{bubbles:true}))}
  setV(sel,'seq',HTMLSelectElement.prototype)
  setV(inp,${JSON.stringify(uiDiagramName)},HTMLInputElement.prototype)
  return (sel.value==='seq'&&inp.value===${JSON.stringify(uiDiagramName)})})()`))
check('提交创建', await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.modal-actions button')].find(x=>x.className.includes('primary'));if(!b||b.disabled)return false;b.click();return true})()`)
  && await waitFor(page, `!document.querySelector('.modal select')`, 40, 200))
await sleep(900)
const afterUi = await snapshot()
const uiDiagram = afterUi.diagrams.find((d) => d.name === uiDiagramName)
const uiHost = uiDiagram && afterUi.elements.find((e) => e.id === uiDiagram.ownerId)
check('图的宿主被自动补成 Interaction（生命线才允许挂在它下面）',
  !!uiHost && uiHost.type.toLowerCase().includes('interaction'),
  uiHost ? `${uiHost.type} · ${uiHost.name}` : `图 ${JSON.stringify(uiDiagram)?.slice(0, 120)}`)
// 宿主复用还是新建取决于当时有没有现成 Interaction：灌数的「下单交互」就在同一个父节点下，
// 所以这里只会多建 1 条；全新项目才会是 2 条。断言按产品真正保证的那件事写。
check('建图推进 1–2 个 revision（有可用宿主就只建图）',
  afterUi.revision - revBeforeUi >= 1 && afterUi.revision - revBeforeUi <= 2,
  `${revBeforeUi} → ${afterUi.revision}`)
const lifelinesBefore = afterUi.elements.filter((e) => e.type.toLowerCase().includes('lifeline')).length
// 只在工具箱按钮里找：模型树行也带「生命线」类型标签且可拖拽，命中它会变成「把已有生命线加进图」。
check('工具箱里出现「生命线」', await waitFor(page,
  `!![...document.querySelectorAll('.tb-item[draggable="true"]')].find(el=>el.textContent.includes('生命线'))`, 30, 200))
await page.evaluate(`(()=>{[...document.querySelectorAll('.tb-item[draggable="true"]')]
  .find(el=>el.textContent.includes('生命线')).scrollIntoView({block:'center'});return 1})()`)
await sleep(200)
const dragFrom = await page.evaluate(`(()=>{const el=[...document.querySelectorAll('.tb-item[draggable="true"]')]
  .find(x=>x.textContent.includes('生命线'));const b=el.getBoundingClientRect()
  return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`)
const dropTo = await page.evaluate(`(()=>{const b=document.querySelector('.canvas > svg').getBoundingClientRect()
  return {x:Math.round(b.left+b.width*0.4),y:Math.round(b.top+b.height*0.4)}})()`)
await page.call('Input.dispatchMouseEvent',
  { type: 'mousePressed', x: dragFrom.x, y: dragFrom.y, button: 'left', clickCount: 1 })
for (let i = 1; i <= 8; i++) {
  await page.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(dragFrom.x + ((dropTo.x - dragFrom.x) * i) / 8),
    y: Math.round(dragFrom.y + ((dropTo.y - dragFrom.y) * i) / 8),
    button: 'left',
  })
  await sleep(60)
}
await page.call('Input.dispatchMouseEvent',
  { type: 'mouseReleased', x: dropTo.x, y: dropTo.y, button: 'left', clickCount: 1 })
await sleep(1200)
const afterDrop = await snapshot()
const newLifelines = afterDrop.elements.filter((e) => e.type.toLowerCase().includes('lifeline'))
check('拖入生命线成功（比拖前多一条）', newLifelines.length === lifelinesBefore + 1,
  `${lifelinesBefore} → ${newLifelines.length}`)
const fresh = newLifelines.find((e) => !LIFELINES.some((item) => item.id === e.id))
check('新生命线落在宿主 Interaction 里（不是包，也不是图）',
  !!fresh && fresh.ownerId === uiDiagram.ownerId, `${fresh?.ownerId} vs ${uiDiagram?.ownerId}`)
const uiScene = await page.evaluate(sceneExpr)
check('新建的空序列图立刻能画出生命线（表头 + 虚线）',
  uiScene.axes.length === 1 && uiScene.headers.length === 1,
  `虚线 ${uiScene.axes.length} · 表头 ${uiScene.headers.length}`)
check('只有一条生命线时也能定出底边（虚线有长度）',
  uiScene.axes.length === 1 && uiScene.axes[0].bottom - uiScene.axes[0].top >= 100,
  uiScene.axes.length === 1 ? `${Math.round(uiScene.axes[0].bottom - uiScene.axes[0].top)}` : 'n/a')
await page.screenshot('seq-ui-created')

console.log('\n[13] 消息种类工具箱：七种组件在界面上直接建出对应线型')
// [9] 走界面建图 + 拖生命线推进过 revision，脚本侧的 baseRevision 先对齐服务端。
revision = (await snapshot()).revision
const toolModel = await snapshot()
const uiDiaForTools = toolModel.diagrams.find((d) => d.name === 'UI 建的序列图')
check('[9] 建的界面序列图仍在（[13] 的操作台）', !!uiDiaForTools)
const toolHost = uiDiaForTools?.ownerId ?? ''
// 按「这张图里已经画着几条生命线」补到三条：建图时可能把当前选中元素带进图，
// 只按 ownerId 数会漏算，最后多出第 4 条，表头数量断言就会假失败。
const uiRefs = new Set(uiDiaForTools?.elementIds ?? [])
const toolLines = toolModel.elements.filter((e) =>
  uiRefs.has(e.id) && e.type.toLowerCase().includes('lifeline'))
const knownToolIds = new Set(toolModel.elements.map((e) => e.id))
// 补成三条生命线：起点 / 终点 / 自反都要有对象可点，坐标统一排开避免表头叠列。
for (let i = toolLines.length; i < 3; i++) {
  const id = `sq-tool-l${i + 1}`
  if (!knownToolIds.has(id)) {
    await cmd('CREATE_ELEMENT', {
      id, type: 'Lifeline', name: `工具箱生命线${i + 1}`, ownerId: toolHost,
      documentation: '', diagramId: uiDiaForTools.id, x: 40 + i * 190, y: 80,
    })
  }
}
const afterToolSeed = await snapshot()
const freshRefs = new Set((afterToolSeed.diagrams.find((d) => d.id === uiDiaForTools.id)?.elementIds) ?? [])
const allToolLines = afterToolSeed.elements.filter((e) =>
  freshRefs.has(e.id) && e.type.toLowerCase().includes('lifeline'))
await cmd('SET_NOTATIONS', { items: allToolLines.map((e, i) => ({
  diagramId: uiDiaForTools.id, elementId: e.id, x: 40 + i * 190, y: 80, width: 132, height: 44,
})) })
check('工具箱实测图有 3 条生命线（表头 + 虚线）', await waitFor(page,
  `document.querySelectorAll('.lifeline-axis').length >= 3`, 80, 200))

// [9] 为拖放把工具箱滚到了元素组，这里滚回顶部，让截图能核对置顶的七种消息组件。
await page.evaluate(`(()=>{const s=document.querySelector('.tb-scroll');if(s)s.scrollTop=0;return 1})()`)
const toolCount = await page.evaluate(`document.querySelectorAll('.seq-msg-tool').length`)
check('工具箱列出 7 种消息组件', toolCount === 7, `实际 ${toolCount}`)
check('通用「消息」关系按钮在序列图里被七种组件取代', await page.evaluate(
  `(()=>[...document.querySelectorAll('.tb-item.relation')]
     .filter(x=>!x.classList.contains('seq-msg-tool'))
     .every(x=>!/消息/.test(x.textContent)))()`))

// 表头在缩放后可能相邻重叠，按屏幕坐标点击会误命中旁边那条生命线，进而被
// 「点回起点 = 自消息」接住，建出没有语义的自反 create/delete。这里按 data-element-id
// 把 pointerdown 派发到指定节点容器，仍然完整走 React 的 handlePointerDown →
// handleRelationPick → runCommand，只是绕开浏览器的命中测试。
const lifelineIds = await page.evaluate(`(()=>[...document.querySelectorAll('.canvas > svg .node')]
  .filter(n=>n.querySelector('.lifeline-axis'))
  .map(g=>({id:g.getAttribute('data-element-id'),x:Number(g.querySelector('rect').getAttribute('x'))}))
  .sort((a,b)=>a.x-b.x).map(o=>o.id))()`)
const pickLifeline = async (id) => {
  const ok = await page.evaluate(`(()=>{
    const g=[...document.querySelectorAll('.canvas > svg .node')]
      .find(n=>n.getAttribute('data-element-id')===${JSON.stringify(id)})
    if(!g)return false
    const r=g.querySelector('rect').getBoundingClientRect()
    g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,
      pointerId:1,pointerType:'mouse',clientX:r.left+r.width/2,clientY:r.top+r.height/2}))
    return true})()`)
  await sleep(280)
  return ok
}
const chooseTool = async (key) => {
  await page.evaluate(`(()=>{const b=document.querySelector('.seq-msg-tool[data-seq-tool="${key}"]');if(b)b.click();return !!b})()`)
  return waitFor(page, `!!document.querySelector('.seq-msg-tool[data-seq-tool="${key}"].tool-active')`, 20, 150)
}
const beforeIds = async () => new Set((await snapshot()).relationships.map((r) => r.id))
const newSortRelations = async (before, sort) => ((await snapshot()).relationships)
  .filter((r) => !before.has(r.id) && r.type.toLowerCase() === 'message'
    && r.properties?.messageSort === sort)
const l0 = lifelineIds[0]
const l1 = lifelineIds[Math.floor(lifelineIds.length / 2)]
const l2 = lifelineIds[lifelineIds.length - 1]
console.log(`    生命线（按模型 x）${JSON.stringify(lifelineIds)} · 起=${l0} 中=${l1} 终=${l2}`)
const describe = (rows) => rows.map((r) =>
  `${r.id}:${r.sourceId}→${r.targetId}(${r.properties?.messageSort})`).join('/')
check('三条生命线都能按 id 精确选中且互不相同',
  lifelineIds.length >= 3 && new Set([l0, l1, l2]).size === 3,
  `${l0} / ${l1} / ${l2}`)

// 返回消息：点起点 → 点终点，种类随关系一次落库，图面是紫色长虚线 + «reply» + 开放箭头。
let before = await beforeIds()
check('点选「返回消息」工具', await chooseTool('reply'))
await pickLifeline(l0)
await pickLifeline(l1)
let made = await newSortRelations(before, 'reply')
check('返回消息：一次连线落库 messageSort=reply', made.length === 1,
  `新建 ${made.length} 条`)
check('返回消息：虚线 + «reply» + 开放箭头', await waitFor(page,
  `(()=>{const g=[...document.querySelectorAll('.seq-message.sort-reply')].pop();if(!g)return false
     return !!g.querySelector('.seq-line').getAttribute('stroke-dasharray')
       && g.textContent.includes('«reply»') && !!g.querySelector('polyline')})()`, 30, 150))

// 创建消息：箭头斜指下移的表头顶边，目标表头带绿色描边与落点三角。
before = await beforeIds()
check('点选「创建消息」工具', await chooseTool('createMessage'))
await pickLifeline(l0)
await pickLifeline(l2)
made = await newSortRelations(before, 'createMessage')
console.log(`    新建 create 关系 ${describe(made)}`)
check('创建消息：落库 messageSort=createMessage', made.length === 1, `新建 ${made.length} 条`)
check('创建消息：图面有 «create» 且箭头终点低于起点（斜指表头）', await waitFor(page,
  `(()=>{const g=[...document.querySelectorAll('.seq-message.sort-createMessage')].pop();if(!g)return false
     const l=g.querySelector('.seq-line')
     return g.textContent.includes('«create»') && Number(l.getAttribute('y2'))>Number(l.getAttribute('y1'))})()`, 30, 150))
check('创建消息：目标表头下移并带落点三角', await waitFor(page,
  `(()=>{const hs=[...document.querySelectorAll('.canvas > svg .node')]
     .filter(n=>n.querySelector('.lifeline-axis')).map(n=>Number(n.querySelector('rect').getAttribute('y')))
     return !!document.querySelector('.seq-created-mark') && hs.length>=3
       && Math.max(...hs)-Math.min(...hs)>20})()`, 30, 150))

// 表头下移后重新取坐标：销毁消息打的是同一个目标，末端画 X。
before = await beforeIds()
check('点选「销毁消息」工具', await chooseTool('deleteMessage'))
await pickLifeline(l0)
await pickLifeline(l2)
made = await newSortRelations(before, 'deleteMessage')
console.log(`    新建 delete 关系 ${describe(made)}`)
check('销毁消息：落库 messageSort=deleteMessage', made.length === 1, `新建 ${made.length} 条`)
check('销毁消息：生命线末端画红色 X 终止符', await waitFor(page,
  `!!document.querySelector('.canvas > svg .seq-destroy')`, 30, 150))

// 给自己的消息：只点一条生命线，一步建成 source = target 的自反关系。
before = await beforeIds()
check('点选「给自己的消息」工具', await chooseTool('self'))
await pickLifeline(l1)
made = await newSortRelations(before, 'synchCall')
check('给自己的消息：只点一次就建成自反关系', made.length === 1
  && made[0].sourceId === made[0].targetId, `新建 ${made.length} 条 · ${made[0]?.sourceId}→${made[0]?.targetId}`)
check('给自己的消息：图面折成四段回环回到本列', await waitFor(page,
  `(()=>{const g=[...document.querySelectorAll('.seq-message.self')].pop();if(!g)return false
     const l=g.querySelector('.seq-line');if(l.tagName.toLowerCase()!=='polyline')return false
     const p=l.getAttribute('points').trim().split(/\\s+/).map(s=>s.split(',').map(Number))
     return p.length===4 && p[0][0]===p[3][0] && p[0][1]!==p[3][1] && p[1][0]>p[0][0]})()`, 30, 150))

// 异步信号：短点虚线（3 3）+ 开放箭头，与回复的长虚线区分开。
before = await beforeIds()
check('点选「异步信号」工具', await chooseTool('asynchSignal'))
await pickLifeline(l1)
await pickLifeline(l0)
made = await newSortRelations(before, 'asynchSignal')
check('异步信号：落库 messageSort=asynchSignal', made.length === 1, `新建 ${made.length} 条`)
check('异步信号：短点虚线节奏 3 3', await waitFor(page,
  `(()=>{const g=[...document.querySelectorAll('.seq-message.sort-asynchSignal')].pop()
     return !!g && g.querySelector('.seq-line').getAttribute('stroke-dasharray')==='3 3'})()`, 30, 150))
await page.screenshot('seq-message-kinds')

console.log(`\n合计 ${passed} 项通过，${failed} 项失败 · 截图目录 ${SHOTS}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
