/**
 * 画布平移 / 缩放的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 双指滚动、鼠标滚轮 = 平移视口，缩放百分比一律不动（原来这些手势全被拿去做缩放）；
 *   2) 捏合（Chrome 报成带 ctrlKey 的滚轮）= 以光标为锚点缩放，光标下的模型点不跑位；
 *   3) 空白处左键拖动 = 平移，且一个字节都不写（revision 不动、记法坐标不动）；
 *   4) 空白处轻点（没拖动）仍然是「点击」：取消已选关系；
 *   5) 图形上的左键拖动照旧只挪图形，视口不许跟着动；
 *   6) 一路狂滚不会把图推丢：视口与内容包围盒始终保留可见交集（夹紧见 clampPanTo）；
 *   7) Shift+左键、中键拖动这两条老路子照旧平移。
 *
 * 数据由本脚本自己在本地沙箱里造：一个 30 节点的用例图铺到 2500×1400，
 * 空图时代找不到「需要平移」的感觉。只连本地端口，不碰线上。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18095/'
const PORT = Number(process.env.CDP_PORT ?? 9457)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const PROJECT_NAME = process.env.SCOFEN_PROJECT_NAME ?? '画布平移实测'
const DIAGRAM_NAME = '平移实测图'
const SHOTS = '/tmp/scofen-pan-shots'
const NODE = { width: 168, height: 84 }
const PAN_KEEP = 60

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

/** 30 个节点：6 个参与者贴左列，24 个用例排 4 列，整体铺到 2500×1400。 */
const actors = Array.from({ length: 6 }, (_, i) => ({
  id: `cp-a${i + 1}`, type: 'Actor', name: `参与者 ${i + 1}`,
  x: 40, y: 60 + i * 240,
}))
const cases = Array.from({ length: 24 }, (_, i) => ({
  id: `cp-u${i + 1}`, type: 'UseCase', name: `用例 ${i + 1}`,
  x: 520 + Math.floor(i / 6) * 620, y: 60 + (i % 6) * 240,
}))

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
      description: '本地沙箱：验证滚轮平移与捏合缩放',
    }),
  })
  projectId = project.id
  const model = await api('api/model')
  revision = model.revision
  const rootId = (model.elements.find((element) => !element.ownerId) ?? { id: 'model-root' }).id
  const already = new Set(model.elements.map((element) => element.id))
  console.log(`    项目 ${projectId} · 根 ${rootId} · rev ${revision}`)
  for (const item of [...actors, ...cases]) {
    if (already.has(item.id)) continue
    await cmd('CREATE_ELEMENT', {
      id: item.id, type: item.type, name: item.name, ownerId: rootId, documentation: '',
    })
  }
  const diagramId = 'cp-uc'
  const existingDiagram = (await api('api/model')).diagrams.find((d) => d.id === diagramId)
  if (!existingDiagram) {
    await cmd('CREATE_DIAGRAM', {
      id: diagramId, kind: 'uc', name: DIAGRAM_NAME, ownerId: rootId,
      elementIds: [...actors, ...cases].map((item) => item.id),
    })
  }
  const relations = cases.map((item, index) => ({
    id: `cp-r${index + 1}`, type: 'association',
    sourceId: actors[index % actors.length].id, targetId: item.id,
  }))
  const knownRelations = new Set((await api('api/model')).relationships.map((r) => r.id))
  for (const relation of relations) {
    if (knownRelations.has(relation.id)) continue
    await cmd('CREATE_RELATIONSHIP', {
      id: relation.id, type: relation.type, sourceId: relation.sourceId,
      targetId: relation.targetId, name: '', documentation: '',
    })
  }
  await cmd('SET_NOTATIONS', {
    items: [...actors, ...cases].map((item) => ({
      diagramId, elementId: item.id, x: item.x, y: item.y,
    })),
  })
  const written = (await snapshot()).notations.filter((n) => n.diagramId === diagramId)
  check('灌数坐标真的落库了（不是服务端自动格点）',
    written.length === actors.length + cases.length
    && Math.max(...written.map((n) => n.x + (n.width ?? NODE.width))) > 2000,
    `落库 ${written.length} 条 · 最大 x ${Math.max(...written.map((n) => n.x))}`)
  const box = {
    left: Math.min(...written.map((n) => n.x)),
    top: Math.min(...written.map((n) => n.y)),
    right: Math.max(...written.map((n) => n.x + (n.width ?? NODE.width))),
    bottom: Math.max(...written.map((n) => n.y + (n.height ?? NODE.height))),
  }
  console.log(`    内容包围盒 ${Math.round(box.right - box.left)}×${Math.round(box.bottom - box.top)}`
    + `（x ${box.left}..${box.right} · y ${box.top}..${box.bottom}）`)
  return box
}

const snapshot = () => api('api/model')
const health = () => api('api/health')
const notationsOf = (model) => model.notations.filter((n) => n.diagramId === 'cp-uc')
  .map((n) => ({ id: n.elementId, x: n.x, y: n.y }))

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

/** 视口：viewBox 四值 + 「一个模型单位占多少像素」，平移量要按它换算。 */
const viewExpr = `(()=>{const s=document.querySelector('.canvas > svg')
  const v=(s.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number)
  const m=s.getScreenCTM()
  return {x:v[0],y:v[1],w:v[2],h:v[3],pxPerUnit:m?m.a:1}})()`
const zoomExpr = `parseInt(document.querySelector('.sb-zoom')?.textContent||'',10)`
const selectedExpr = `document.querySelectorAll('.node [stroke="#2b5cb8"]').length`
const relationSelectedExpr
  = `(()=>{const k=document.querySelector('.props-object-kind')?.textContent||'';return k.includes('关系')})()`

/** 空白点：elementFromPoint 落回 svg 本身，才算「画布空白处」，与平移起手条件一致。 */
const emptyPointExpr = `(()=>{const s=document.querySelector('.canvas > svg')
  const r=s.getBoundingClientRect()
  for(let gy=0.12;gy<0.95;gy+=0.05)for(let gx=0.06;gx<0.95;gx+=0.05){
    const x=Math.round(r.left+r.width*gx),y=Math.round(r.top+r.height*gy)
    if(document.elementFromPoint(x,y)===s)return{x,y}}
  return null})()`

/** 图形上的可点位置：命中点必须落在该节点内部（参与者是线条画，中心可能空白）。 */
const nodePointExpr = `(()=>{for(const g of document.querySelectorAll('.canvas > svg .node')){
  const b=g.getBoundingClientRect()
  const x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2)
  const hit=document.elementFromPoint(x,y)
  if(hit&&g.contains(hit))return{x,y}}
  return null})()`

async function wheel(page, point, deltaX, deltaY, ctrl = false) {
  await page.call('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: point.x, y: point.y,
    deltaX, deltaY, modifiers: ctrl ? 2 : 0,
  })
  await sleep(120)
}

async function drag(page, from, to, { button = 'left', modifiers = 0, steps = 6 } = {}) {
  await page.call('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: from.x, y: from.y, button, clickCount: 1, modifiers })
  for (let i = 1; i <= steps; i++) {
    await page.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      button, modifiers,
    })
    await sleep(40)
  }
  await page.call('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: to.x, y: to.y, button, clickCount: 1, modifiers })
  await sleep(200)
}

async function clickAt(page, point, { button = 'left', modifiers = 0 } = {}) {
  await page.call('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: point.x, y: point.y, button, clickCount: 1, modifiers })
  await page.call('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: point.x, y: point.y, button, clickCount: 1, modifiers })
  await sleep(200)
}

const view = (page) => page.evaluate(viewExpr)
const near = (a, b, tol) => Math.abs(a - b) <= tol
// 命中点必须每次现取：视口一挪，上一次记下的屏幕坐标就可能落在空白或别的图形上。
const pickEmpty = async (page) => page.evaluate(emptyPointExpr)
const pickNode = async (page) => page.evaluate(nodePointExpr)

const page = await connect()

/**
 * 点撤销：写命令落库后界面要先刷一次 health 才解禁按钮，
 * 抢在刷新前点等于点了个 disabled，测试里必须等它真的可点。
 */
const undoButtonReadyExpr = `(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('撤销'))
  return !!b && !b.disabled})()`
const clickUndo = async () => {
  if (!(await waitFor(page, undoButtonReadyExpr, 40, 150))) return false
  return page.evaluate(`(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('撤销'));b.click();return true})()`)
}

const loginSnippet = `(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`

/**
 * 进工作台，并且确认项目目录真的拉回来了。
 * 本地 jar 每次重启都换签名密钥，localStorage 里那份旧 token 会 401：
 * 界面照样渲染工作台，只是项目名停在「未命名项目」——所以先登出再重登，
 * 最后以「开关上没有未命名项目」为准，不能只看 .props-dock 在不在。
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

console.log('[1] 本地沙箱灌数 + 登录打开图')
check('登录成功进入工作台', await ensureWorkbench())

const box = await seed()
// 灌数是绕开界面写的，项目目录要重新拉一次才看得见新项目。
check('灌数后回到工作台', await ensureWorkbench())
await page.evaluate(`document.querySelector('.project-switch')?.click()`)
check(`项目列表里有「${PROJECT_NAME}」`,
  await waitFor(page, clickByText('.pp-project', PROJECT_NAME), 40, 200))
await sleep(1500)
await page.evaluate(clickByText('.tree-head-tab', '图表'))
await sleep(400)
check(`打开图「${DIAGRAM_NAME}」`,
  await waitFor(page, clickByText('.chart-row', DIAGRAM_NAME), 40, 200))
await sleep(700)

if (!(await pickEmpty(page)) || !(await pickNode(page))) {
  throw new Error('画布上取不到空白点或图形命中点：多半是项目/图没真的打开，先查 [1] 那几项')
}

const start = await view(page)
const baselineNotations = notationsOf(await snapshot())
const startRevision = (await snapshot()).revision
console.log(`    初始视口 x=${start.x.toFixed(1)} y=${start.y.toFixed(1)} `
  + `${start.w.toFixed(0)}×${start.h.toFixed(0)} · 1px=${(1 / start.pxPerUnit).toFixed(3)} 模型单位 · rev ${startRevision}`)
check('找到画布空白点', !!(await pickEmpty(page)))
check('找到图形命中点', !!(await pickNode(page)))

console.log('\n[2] 双指滚动 / 鼠标滚轮 → 平移，不再缩放')
let empty = await pickEmpty(page)
const v0 = await view(page)
await wheel(page, empty, 0, 120)
let v = await view(page)
const wheelUnits = 120 / v0.pxPerUnit
console.log(`    纵向滚 120px：视口 y ${v0.y.toFixed(1)} → ${v.y.toFixed(1)}（期望 +${wheelUnits.toFixed(1)}）`)
check('往下滚就是往下滚：视口往下推', v.y > v0.y, `${v.y - v0.y}`)
check('平移量与像素换算一致（±8%）', near(v.y, v0.y + wheelUnits, wheelUnits * 0.08 + 1),
  `Δ=${(v.y - v0.y).toFixed(2)} 期望≈${wheelUnits.toFixed(2)}`)
check('纵向滚动不横移', near(v.x, v0.x, 0.5), `Δx=${(v.x - v0.x).toFixed(2)}`)
check('缩放百分比没变（这才是「双指=平移」）', (await page.evaluate(zoomExpr)) === 100,
  `${await page.evaluate(zoomExpr)}%`)

empty = await pickEmpty(page)
const v1 = await view(page)
await wheel(page, empty, 240, 0)
v = await view(page)
check('横向滚动把视口往右推', v.x > v1.x, `Δx=${(v.x - v1.x).toFixed(2)}`)

const v2 = await view(page)
await page.evaluate(`(()=>{const s=document.querySelector('.canvas > svg')
  s.dispatchEvent(new WheelEvent('wheel',{deltaY:3,deltaMode:1,bubbles:true,cancelable:true}))
  return 1})()`)
v = await view(page)
const lineUnits = 48 / v2.pxPerUnit
check('按行计的滚轮（deltaMode=1，16px/行）同样平移',
  near(v.y, v2.y + lineUnits, lineUnits * 0.1 + 1), `Δ=${(v.y - v2.y).toFixed(2)} 期望≈${lineUnits.toFixed(2)}`)
check('平移一个字节都不写', (await snapshot()).revision === startRevision,
  `rev ${(await snapshot()).revision}`)
check('记法坐标没被顺手动过',
  JSON.stringify(notationsOf(await snapshot())) === JSON.stringify(baselineNotations))
await page.screenshot('pan-by-wheel')

console.log('\n[3] 捏合（ctrl+滚轮）→ 以光标为锚点缩放')
empty = await pickEmpty(page)
const zoomBefore = await page.evaluate(zoomExpr)
const anchorBefore = await page.evaluate(
  `(()=>{const s=document.querySelector('.canvas > svg');const p=s.createSVGPoint();`
  + `p.x=${empty.x};p.y=${empty.y};const t=p.matrixTransform(s.getScreenCTM().inverse());`
  + `return {x:t.x,y:t.y}})()`)
await wheel(page, empty, 0, -100, true)
const anchorAfter = await page.evaluate(
  `(()=>{const s=document.querySelector('.canvas > svg');const p=s.createSVGPoint();`
  + `p.x=${empty.x};p.y=${empty.y};const t=p.matrixTransform(s.getScreenCTM().inverse());`
  + `return {x:t.x,y:t.y}})()`)
const zoomAfter = await page.evaluate(zoomExpr)
check('捏合改的是缩放', zoomAfter > zoomBefore, `${zoomBefore}% → ${zoomAfter}%`)
check('光标下的模型点不跑位',
  near(anchorBefore.x, anchorAfter.x, 3) && near(anchorBefore.y, anchorAfter.y, 3),
  `${anchorBefore.x.toFixed(1)},${anchorBefore.y.toFixed(1)} → ${anchorAfter.x.toFixed(1)},${anchorAfter.y.toFixed(1)}`)
check('捏合同样不写数据', (await snapshot()).revision === startRevision)

console.log('\n[4] 空白处左键拖动 → 平移，内容跟着手走')
empty = await pickEmpty(page)
const vBefore = await view(page)
const notesBeforeDrag = notationsOf(await snapshot())
const target = { x: empty.x + 180, y: empty.y + 120 }
await page.call('Input.dispatchMouseEvent',
  { type: 'mousePressed', x: empty.x, y: empty.y, button: 'left', clickCount: 1 })
check('平移过程中画布进入 grabbing 光标态',
  await page.evaluate(`document.querySelector('.canvas > svg').classList.contains('panning')`))
for (let i = 1; i <= 6; i++) {
  await page.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(empty.x + ((target.x - empty.x) * i) / 6),
    y: Math.round(empty.y + ((target.y - empty.y) * i) / 6),
    button: 'left',
  })
  await sleep(50)
}
await page.call('Input.dispatchMouseEvent',
  { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
await sleep(250)
const vAfter = await view(page)
console.log(`    右下拖 180×120px：视口 ${vBefore.x.toFixed(1)},${vBefore.y.toFixed(1)} `
  + `→ ${vAfter.x.toFixed(1)},${vAfter.y.toFixed(1)}`)
check('往右下拖，视口往左上移（内容跟着手）',
  vAfter.x < vBefore.x && vAfter.y < vBefore.y)
check('拖动量与像素换算一致（±8%）',
  near(vBefore.y - vAfter.y, 120 / vBefore.pxPerUnit, 120 / vBefore.pxPerUnit * 0.08 + 1),
  `Δ=${(vBefore.y - vAfter.y).toFixed(2)} 期望≈${(120 / vBefore.pxPerUnit).toFixed(2)}`)
check('拖动空白不改任何坐标',
  JSON.stringify(notationsOf(await snapshot())) === JSON.stringify(notesBeforeDrag))
check('拖动空白不推进 revision', (await snapshot()).revision === startRevision)
await page.screenshot('pan-by-drag')

console.log('\n[5] 空白处轻点仍然是「点击」：取消已选关系')
const nodeHit = await pickNode(page)
await clickAt(page, nodeHit)
check('点图形能选中对象', (await page.evaluate(selectedExpr)) >= 1,
  `选中 ${(await page.evaluate(selectedExpr))} 个`)
check('属性面板列出该对象的关系',
  await waitFor(page, clickByText('.props-tab', '关系'), 20, 150)
    && await waitFor(page, `!!document.querySelector('.rel-link-row')`, 20, 150))
await page.evaluate(`(()=>{const b=document.querySelector('.rel-link-row');if(b)b.click();return !!b})()`)
await sleep(250)
check('关系进入选中态', await page.evaluate(relationSelectedExpr))
empty = await pickEmpty(page)
const vBeforeClick = await view(page)
await clickAt(page, empty)
check('空白处轻点取消关系选中', !(await page.evaluate(relationSelectedExpr)))
const vAfterClick = await view(page)
check('轻点没被当成平移（视口不动）',
  near(vBeforeClick.x, vAfterClick.x, 0.01) && near(vBeforeClick.y, vAfterClick.y, 0.01))
check('轻点不写数据', (await snapshot()).revision === startRevision)

console.log('\n[6] 图形上的左键拖动：只挪图形，视口不动')
const revBeforeNode = (await snapshot()).revision
const notesBeforeNode = notationsOf(await snapshot())
const vBeforeNode = await view(page)
const nodeGrab = await pickNode(page)
await drag(page, nodeGrab, { x: nodeGrab.x + 70, y: nodeGrab.y + 50 })
const notesAfterNode = notationsOf(await snapshot())
const movedIds = notesAfterNode.filter((n, index) =>
  notesBeforeNode[index] && (n.x !== notesBeforeNode[index].x || n.y !== notesBeforeNode[index].y))
check('确实拖动了一个图形', movedIds.length === 1, `变了 ${movedIds.length} 条`)
check('一次拖动推进 1 个 revision', (await snapshot()).revision === revBeforeNode + 1,
  `${revBeforeNode} → ${(await snapshot()).revision}`)
const vAfterNode = await view(page)
check('图形上的拖拽不带近视口',
  near(vBeforeNode.x, vAfterNode.x, 0.01) && near(vBeforeNode.y, vAfterNode.y, 0.01),
  JSON.stringify({ before: [vBeforeNode.x, vBeforeNode.y], after: [vAfterNode.x, vAfterNode.y] }))
check('撤销按钮在写命令后解禁', await clickUndo())
await sleep(500)
check('撤销一步图形坐标复原',
  JSON.stringify(notationsOf(await snapshot())) === JSON.stringify(notesBeforeNode),
  `rev ${(await snapshot()).revision}`)

console.log('\n[7] Shift+左键 / 中键拖动照旧平移')
const revBeforeShift = (await snapshot()).revision
const vBeforeShift = await view(page)
const nodeOnShift = await pickNode(page)
await drag(page, nodeOnShift, { x: nodeOnShift.x + 90, y: nodeOnShift.y + 60 }, { modifiers: 8 })
const vAfterShift = await view(page)
check('Shift+左键（起手压在图形上）平移视口',
  vAfterShift.x < vBeforeShift.x && vAfterShift.y < vBeforeShift.y,
  JSON.stringify({ before: [vBeforeShift.x.toFixed(1), vBeforeShift.y.toFixed(1)],
    after: [vAfterShift.x.toFixed(1), vAfterShift.y.toFixed(1)] }))
check('Shift+拖动只动视口，不写数据',
  (await snapshot()).revision === revBeforeShift &&
  JSON.stringify(notationsOf(await snapshot())) === JSON.stringify(notesBeforeNode))
empty = await pickEmpty(page)
const revBeforeMiddle = (await snapshot()).revision
const vBeforeMiddle = await view(page)
await drag(page, empty, { x: empty.x + 60, y: empty.y + 40 }, { button: 'middle' })
const vAfterMiddle = await view(page)
check('中键拖动平移视口',
  vAfterMiddle.x < vBeforeMiddle.x && vAfterMiddle.y < vBeforeMiddle.y,
  JSON.stringify({ before: [vBeforeMiddle.x.toFixed(1), vBeforeMiddle.y.toFixed(1)],
    after: [vAfterMiddle.x.toFixed(1), vAfterMiddle.y.toFixed(1)] }))
check('中键拖动同样不写数据', (await snapshot()).revision === revBeforeMiddle)

console.log('\n[8] 一路狂滚也不会把图推丢')
for (let i = 0; i < 18; i++) {
  await wheel(page, empty, 500, 500)
}
const storm = await view(page)
const overlapX = Math.min(storm.x + storm.w, box.right) - Math.max(storm.x, box.left)
const overlapY = Math.min(storm.y + storm.h, box.bottom) - Math.max(storm.y, box.top)
console.log(`    狂滚后视口 x=${storm.x.toFixed(0)} y=${storm.y.toFixed(0)} `
  + `(${storm.w.toFixed(0)}×${storm.h.toFixed(0)}) · 与内容交集 ${overlapX.toFixed(0)}×${overlapY.toFixed(0)}`)
check('横向仍与内容相交 ≥ 60 模型单位', overlapX >= PAN_KEEP - 1, `${overlapX.toFixed(0)}`)
check('纵向仍与内容相交 ≥ 60 模型单位', overlapY >= PAN_KEEP - 1, `${overlapY.toFixed(0)}`)
check('夹紧后画面上仍有图形',
  await page.evaluate(`(()=>{const s=document.querySelector('.canvas > svg')
    const r=s.getBoundingClientRect();let n=0
    for(const g of s.querySelectorAll('.node')){const b=g.getBoundingClientRect()
      if(b.right>r.left&&b.left<r.right&&b.bottom>r.top&&b.top<r.bottom)n++}
    return n>0})()`))
await page.screenshot('pan-clamped')

console.log('\n[9] 适应窗口回到全貌，缩放按钮以视口中心为锚')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.sb-btn')].find(x=>x.title==='适应窗口');if(b)b.click();return !!b})()`)
await sleep(600)
const fitted = await view(page)
const fittedNotes = notationsOf(await snapshot())
const outside = fittedNotes.filter((n) => n.x < fitted.x || n.y < fitted.y
  || n.x + NODE.width > fitted.x + fitted.w || n.y + NODE.height > fitted.y + fitted.h).length
check('适应窗口后所有图形都在视口内', outside === 0, `${outside} 个在视口外`)
check('适应窗口把缩放降到 100% 以下', (await page.evaluate(zoomExpr)) < 100,
  `${await page.evaluate(zoomExpr)}%`)
const centerBefore = { x: fitted.x + fitted.w / 2, y: fitted.y + fitted.h / 2 }
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.sb-btn')].find(x=>x.textContent.trim()==='＋');if(b)b.click();return !!b})()`)
await sleep(400)
const zoomed = await view(page)
check('放大保持视口中心（±2 模型单位）',
  near(centerBefore.x, zoomed.x + zoomed.w / 2, 2)
  && near(centerBefore.y, zoomed.y + zoomed.h / 2, 2),
  `${centerBefore.x.toFixed(0)},${centerBefore.y.toFixed(0)} `
  + `→ ${(zoomed.x + zoomed.w / 2).toFixed(0)},${(zoomed.y + zoomed.h / 2).toFixed(0)}`)
await page.screenshot('pan-fit')

const finalModel = await snapshot()
check('坐标复原：与灌数后的初始图面逐条一致',
  JSON.stringify(notationsOf(finalModel)) === JSON.stringify(baselineNotations))
check('全程只有那一次图形拖动 + 它的撤销写过数据',
  finalModel.revision === startRevision + 2, `${startRevision} → ${finalModel.revision}`)

console.log(`\n合计 ${passed} 项通过，${failed} 项失败 · 截图目录 ${SHOTS}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
