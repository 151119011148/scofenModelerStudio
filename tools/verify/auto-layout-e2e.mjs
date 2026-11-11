/**
 * 自动排布的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 「排布」按钮 → 弹框默认「仅当前图」→ 开始排布：一次 SET_NOTATIONS 写入（revision +1）；
 *   2) 排布后重叠为 0、连线交叉显著下降（从服务端快照现算，不是前端自说自话）；
 *   3) 只改记法坐标：元素、关系、图归属与图名逐字段不变；
 *   4) 排布后自动适应窗口（缩放百分比真的降下来）；
 *   5) 撤销一步回到排布前，坐标逐条相等；
 *   6) 「全部图表」：项目里所有可排图一起重排，序列图等不可排图被跳过。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18095/'
const PORT = Number(process.env.CDP_PORT ?? 9457)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const PROJECT_NAME = process.env.SCOFEN_PROJECT_NAME ?? '自动排布实测'
const DIAGRAMS = (process.env.SCOFEN_DIAGRAMS ?? '需求图-D1,用例图-D7,活动图-注册验证')
  .split(',').map((s) => s.trim()).filter(Boolean)
const SHOTS = '/tmp/scofen-layout-shots'

const NODE = { width: 168, height: 84 }
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

// ── 服务端快照：断言一律以它为准 ────────────────────────────────────────────
let token = ''
let projectId = ''

async function api(path, init = {}) {
  const url = new URL(path, APP_URL)
  const response = await fetch(url, {
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
    throw new Error(`${path} → HTTP ${response.status} ${JSON.stringify(body)}`)
  }
  return body
}

async function loginRest() {
  const session = await api('api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'scofen', password: PASSWORD }),
  })
  token = session.token
  const spaces = await api('api/workspaces')
  for (const space of spaces.spaces ?? []) {
    const hit = (space.projects ?? []).find((project) => project.name === PROJECT_NAME)
    if (hit) {
      projectId = hit.id
      return
    }
  }
  throw new Error(`项目「${PROJECT_NAME}」不存在，请先跑 local_seed.mjs`)
}

async function snapshot() {
  return api('api/model')
}

/** 撤销/重做本身也是一条命令：revision 会往前走，判断「是否回到排布前」只能看坐标与 undoDepth。 */
async function health() {
  return api('api/health')
}

function diagramByName(model, name) {
  return model.diagrams.find((item) => item.name.includes(name))
}

/** 记法坐标：elementId → {x,y,w,h}，缺记法的用前端兜底格点，保证两边口径一致。 */
function boxesOf(model, diagram) {
  const byElement = new Map(
    model.notations.filter((n) => n.diagramId === diagram.id).map((n) => [n.elementId, n]),
  )
  return diagram.elementIds.map((id, index) => {
    const n = byElement.get(id)
    return {
      id,
      x: n?.x ?? 36 + (index % 3) * 196,
      y: n?.y ?? 36 + Math.floor(index / 3) * 128,
      w: n?.width ?? NODE.width,
      h: n?.height ?? NODE.height,
    }
  })
}

function overlaps(boxes) {
  let count = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) count++
    }
  }
  return count
}

function crossings(edges, boxes) {
  const center = new Map(boxes.map((b) => [b.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }]))
  const segs = edges.map(([a, b]) => [center.get(a), center.get(b)]).filter(([a, b]) => a && b)
  let count = 0
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (shareEndpoint(segs[i], segs[j])) continue
      if (intersect(segs[i], segs[j])) count++
    }
  }
  return count
}

function shareEndpoint(a, b) {
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`
  return [...a].some((p) => [...b].some((q) => key(p) === key(q)))
}

function orient(p, q, r) {
  return Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
}

function intersect([p1, p2], [p3, p4]) {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2)
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4)
  return d1 !== d2 && d3 !== d4
}

/** 单图指标：交叉、重叠、包围盒比例。 */
function metrics(model, diagram) {
  const ids = new Set(diagram.elementIds)
  const edges = model.relationships
    .filter((r) => ids.has(r.sourceId) && ids.has(r.targetId))
    .map((r) => [r.sourceId, r.targetId])
  const boxes = boxesOf(model, diagram)
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const width = Math.max(...boxes.map((b) => b.x + b.w)) - left
  const height = Math.max(...boxes.map((b) => b.y + b.h)) - top
  return {
    nodes: boxes.length,
    edges: edges.length,
    overlaps: overlaps(boxes),
    crossings: crossings(edges, boxes),
    aspect: width / Math.max(height, 1),
    width,
    height,
  }
}

/** 语义面：除记法坐标外的一切，用来证明排布没有越界改数据。 */
function semanticsFingerprint(model) {
  const sorted = (list, pick) => [...list].sort((a, b) => String(pick(a)).localeCompare(String(pick(b))))
    .map(pick)
  return JSON.stringify({
    elements: sorted(model.elements, (e) => `${e.id}|${e.name}|${e.ownerId ?? ''}|${e.ownedRelations ?? ''}`),
    relationships: sorted(model.relationships, (r) => `${r.id}|${r.type}|${r.sourceId}|${r.targetId}|${r.name ?? ''}`),
    diagrams: sorted(model.diagrams, (d) => `${d.id}|${d.name}|${d.kind}|${d.elementIds.join(',')}`),
  })
}

// ── CDP ────────────────────────────────────────────────────────────────────
async function connect() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  const info = await res.json()
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

const readSelect = () =>
  `(()=>{const m=document.querySelector('.modal');if(!m)return null;
     const opts=[...m.querySelectorAll('select')].map(s=>s.options[s.selectedIndex].textContent);
     return {title:m.querySelector('.modal-title')?.textContent??'',options:opts,
             buttons:[...m.querySelectorAll('button')].map(b=>b.textContent.trim())}})()`

const setSelectByValue = (index, value) =>
  `(()=>{const s=document.querySelectorAll('.modal select')[${index}]
     if(!s)return false
     const setter=Object.getOwnPropertyDescriptor(s.constructor.prototype,'value').set
     setter.call(s,${JSON.stringify(value)})
     s.dispatchEvent(new Event('change',{bubbles:true}))
     return s.value===${JSON.stringify(value)}})()`

const zoomPercent = () =>
  `(()=>{const m=document.querySelector('.sb-zoom');return m?parseInt(m.textContent,10):null})()`

// 提示条里会出现项目名「自动排布实测」，所以只认排布结果这句话。
const messageText = () => `document.querySelector('.sb-message')?.textContent ?? ''`
const layoutDone = () => `(()=>{const m=${messageText()};return /个记法已重排/.test(m)})()`
const layoutButton = `(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.textContent.trim()==='排布'&&x.className.includes('wide'));return !!b&&!b.disabled})()`
const undoButton = `(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('撤销'));return !!b&&!b.disabled})()`
const clickLayout = `(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.textContent.trim()==='排布'&&x.className.includes('wide'));if(b&&!b.disabled){b.click();return true}return false})()`
const clickUndo = `(()=>{const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('撤销'));if(b&&!b.disabled){b.click();return true}return false})()`

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录并打开沙箱项目')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`))

await page.evaluate(`document.querySelector('.project-switch').click()`)
check(`项目列表里有「${PROJECT_NAME}」`,
  await waitFor(page, clickByText('.pp-project', PROJECT_NAME), 40, 200))
await sleep(1500)
check('图表列表可切换', await waitFor(page, `!!document.querySelector('.tree-head-tab')`))

await loginRest()
const baseline = await snapshot()
console.log(`    项目 ${projectId} · rev ${baseline.revision} · 元素 ${baseline.elements.length} · 关系 ${baseline.relationships.length}`)

const targets = DIAGRAMS.map((name) => diagramByName(baseline, name)).filter(Boolean)
check(`快照里能找到 ${DIAGRAMS.length} 张目标图`, targets.length === DIAGRAMS.length,
  `只找到 ${targets.map((d) => d.name).join(' / ')}`)

console.log('\n[2] 单图排布：需求图')
const diagram = targets.find((d) => d.name.includes('需求图')) ?? targets[0]
const beforeMetrics = metrics(baseline, diagram)
const fingerprintBefore = semanticsFingerprint(baseline)
console.log(`    ${diagram.name} 排布前：节点 ${beforeMetrics.nodes} · 关系 ${beforeMetrics.edges} · `
  + `交叉 ${beforeMetrics.crossings} · 重叠 ${beforeMetrics.overlaps} · `
  + `${Math.round(beforeMetrics.width)}×${Math.round(beforeMetrics.height)}（比例 ${beforeMetrics.aspect.toFixed(2)}）`)

await page.evaluate(clickByText('.tree-head-tab', '图表'))
await sleep(400)
check(`打开图「${diagram.name}」`,
  await waitFor(page, clickByText('.chart-row', diagram.name), 40, 200))
await sleep(600)

check('工具栏「排布」可点', await waitFor(page, layoutButton))
await page.evaluate(clickLayout)
check('弹出自动排布对话框', await waitFor(page, `!!document.querySelector('.modal')`, 20, 150))
const dialog = await page.evaluate(readSelect())
check('默认范围 = 仅当前图', (dialog?.options[0] ?? '').includes('仅当前图'), JSON.stringify(dialog))
check('默认策略 = 自动', (dialog?.options[1] ?? '').includes('自动'), JSON.stringify(dialog))
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.modal button')].find(x=>x.textContent.trim()==='开始排布');if(b)b.click();return !!b})()`)
check('排布完成并给出提示', await waitFor(page, layoutDone(), 60, 250))
console.log('    提示：' + await page.evaluate(messageText()))

const after = await snapshot()
check('一次写入只推进 1 个 revision', after.revision === baseline.revision + 1,
  `${baseline.revision} → ${after.revision}`)
const afterMetrics = metrics(after, diagram)
console.log(`    ${diagram.name} 排布后：交叉 ${beforeMetrics.crossings} → ${afterMetrics.crossings} · `
  + `重叠 ${beforeMetrics.overlaps} → ${afterMetrics.overlaps} · `
  + `${Math.round(afterMetrics.width)}×${Math.round(afterMetrics.height)}（比例 ${afterMetrics.aspect.toFixed(2)}）`)
check('排布后无重叠', afterMetrics.overlaps === 0, `${afterMetrics.overlaps} 对`)
check('连线交叉明显减少', afterMetrics.crossings < beforeMetrics.crossings,
  `${beforeMetrics.crossings} → ${afterMetrics.crossings}`)
check('图面比例接近视口（0.5–3）', afterMetrics.aspect > 0.5 && afterMetrics.aspect < 3,
  afterMetrics.aspect.toFixed(2))
check('只改坐标：元素/关系/图归属逐字段不变',
  semanticsFingerprint(after) === fingerprintBefore)
const movedCount = after.notations.filter((n) => n.diagramId === diagram.id)
  .filter((n) => {
    const old = baseline.notations.find((x) => x.diagramId === n.diagramId && x.elementId === n.elementId)
    return !old || Math.abs(old.x - n.x) > 1 || Math.abs(old.y - n.y) > 1
  }).length
check('该图记法确实被重排', movedCount > 0, `${movedCount} 条`)
const shot1 = await page.screenshot('layout-requirement')
console.log('    截图：' + shot1)

const zoomAfterLayout = await page.evaluate(zoomPercent())
check('排布后自动适应窗口（缩放 < 100%）', zoomAfterLayout !== null && zoomAfterLayout < 100,
  `${zoomAfterLayout}%`)

console.log('\n[3] 撤销一步回到排布前')
check('撤销按钮可用', await waitFor(page, undoButton))
await page.evaluate(clickUndo)
const undone = await snapshot()
check('撤销记入重做栈', (await health()).redoDepth >= 1)
const restoredSame = undone.notations
  .filter((n) => n.diagramId === diagram.id)
  .every((n) => {
    const old = baseline.notations.find((x) => x.diagramId === n.diagramId && x.elementId === n.elementId)
    return old && Math.abs(old.x - n.x) < 0.01 && Math.abs(old.y - n.y) < 0.01
  })
check('坐标逐条回到排布前', restoredSame)
check('撤销后交叉数复原',
  metrics(undone, diagram).crossings === beforeMetrics.crossings)
check('撤销后语义面仍与初始一致', semanticsFingerprint(undone) === fingerprintBefore)

console.log('\n[4] 全部图表一起排布')
check('排布按钮重新可用', await waitFor(page, layoutButton))
await page.evaluate(clickLayout)
check('再次弹出对话框', await waitFor(page, `!!document.querySelector('.modal')`, 20, 150))
check('范围可切到全部图表', await page.evaluate(setSelectByValue(0, 'all')))
// 记住排布前的撤销栈深度：收尾只退到这里，多退一步就把灌数命令撤掉了。
const depthBeforeAll = (await health()).undoDepth
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.modal button')].find(x=>x.textContent.trim()==='开始排布');if(b)b.click();return !!b})()`)
check('全部图表排布完成', await waitFor(page, layoutDone(), 120, 250))
console.log('    提示：' + await page.evaluate(messageText()))
const all = await snapshot()
check('全部图表仍是 1 个 revision', all.revision === undone.revision + 1,
  `${undone.revision} → ${all.revision}`)
const perDiagram = all.diagrams
  .filter((d) => d.elementIds.length > 0)
  .map((d) => ({ name: d.name, ...metrics(all, d) }))
const totalOverlaps = perDiagram.reduce((s, d) => s + d.overlaps, 0)
const totalCrossings = perDiagram.reduce((s, d) => s + d.crossings, 0)
const beforeAll = perDiagram.map((d) => metrics(undone, undone.diagrams.find((x) => x.name === d.name)))
const totalBefore = beforeAll.reduce((s, d) => s + d.crossings, 0)
for (const d of perDiagram) {
  console.log(`    ${d.name.padEnd(28, ' ')} 节点${String(d.nodes).padStart(3)} 关系${String(d.edges).padStart(3)}`
    + ` 交叉${String(d.crossings).padStart(4)} 重叠${String(d.overlaps).padStart(3)}`
    + ` 比例${d.aspect.toFixed(2).padStart(6)}`)
}
check('全项目零重叠', totalOverlaps === 0, `${totalOverlaps} 对`)
check('全项目交叉数下降', totalCrossings < totalBefore, `${totalBefore} → ${totalCrossings}`)
check('序列图生命线未被改写', (() => {
  const seq = all.diagrams.find((d) => d.kind === 'seq')
  if (!seq || seq.elementIds.length === 0) return true
  return undone.notations.filter((n) => n.diagramId === seq.id).every((n) => {
    const after2 = all.notations.find((x) => x.diagramId === seq.id && x.elementId === n.elementId)
    return !after2 || (Math.abs(after2.x - n.x) < 0.01 && Math.abs(after2.y - n.y) < 0.01)
  })
})())
check('全部图表只改坐标', semanticsFingerprint(all) === fingerprintBefore)
const shot2 = await page.screenshot('layout-all')
console.log('    截图：' + shot2)

console.log('\n[5] 收尾：撤销干净，沙箱回到排布前的状态')
for (let i = 0; i < 6; i++) {
  const depth = (await health()).undoDepth
  if (depth <= depthBeforeAll) break
  if (!await waitFor(page, undoButton, 20, 200)) break
  await page.evaluate(clickUndo)
  await sleep(700)
}
const cleaned = await snapshot()
const sameAll = cleaned.notations.every((n) => {
  const old = undone.notations.find((x) => x.diagramId === n.diagramId && x.elementId === n.elementId)
  return old && Math.abs(old.x - n.x) < 0.01 && Math.abs(old.y - n.y) < 0.01
})
check('记法坐标全部复原', sameAll)
check('数据语义无残留', semanticsFingerprint(cleaned) === fingerprintBefore)

await page.close()
console.log(`\n结果 PASS ${passed} · FAIL ${failed}`)
if (failed > 0) process.exitCode = 1
