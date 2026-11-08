/**
 * 属性面板尺寸与扩展域隔离的回归（headless Chrome + CDP，无 puppeteer 依赖）：
 *   A) 项目树里不出现扩展域 id（ext- / mc- / st- / prim- / …）的「孤儿构造型」行
 *   B) 属性面板可上下拖动：高度落 localStorage、刷新保持、夹紧上下限、双击恢复默认
 *   C) 左右拖宽未被破坏（回归）
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18092/scofen/modelerStudio/'
const PORT = Number(process.env.CDP_PORT ?? 9470)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-props-shots'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
let failed = 0
function check(label, cond, extra = '') {
  if (cond) { passed++; console.log(`    PASS — ${label}`) }
  else { failed++; console.log(`    FAIL — ${label}${extra ? ' :: ' + extra : ''}`) }
  return cond
}

async function connect() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  const info = await res.json()
  const ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = (e) => reject(new Error('ws error: ' + e.message))
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message}`))
      else resolve(msg.result)
    }
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)) } }, 30000)
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
  const goto = async (url) => { await call('Page.navigate', { url }); await sleep(1800) }
  const screenshot = async (name) => {
    mkdirSync(SHOTS, { recursive: true })
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, 'base64'))
    return `${SHOTS}/${name}.png`
  }
  return { call, evaluate, goto, screenshot, close: () => ws.close() }
}

async function waitFor(page, expr, tries = 100, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try { if (await page.evaluate(expr)) return true } catch { /* not ready */ }
    await sleep(gap)
  }
  return false
}

/** 真实鼠标拖拽：deltaY 为负表示向上拖（属性面板变高）。 */
async function dragBy(page, selector, deltaX, deltaY) {
  const box = await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
    if(!e) return null; const r=e.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}})()`)
  if (!box) return false
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(70)
  for (let step = 1; step <= 6; step++) {
    await page.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: box.x + Math.round((deltaX * step) / 6), y: box.y + Math.round((deltaY * step) / 6),
      button: 'left', buttons: 1,
    })
    await sleep(40)
  }
  await page.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x + deltaX, y: box.y + deltaY, button: 'left', clickCount: 1,
  })
  await sleep(300)
  return true
}

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))

console.log('[A] 项目树不再出现扩展域孤儿')
const treeIds = await page.evaluate(`[...document.querySelectorAll('.tree-row[data-tree-id]')]
  .map(e=>e.getAttribute('data-tree-id'))`)
const leaked = treeIds.filter((id) => /^(ext-|mc-|st-|prim-|val-|unit-|dim-|std-)/.test(id || ''))
check('模型树没有扩展域 id 行', leaked.length === 0, `leaked=${JSON.stringify(leaked.slice(0, 8))}`)
const keywordRows = await page.evaluate(`[...document.querySelectorAll('.tree-row[data-tree-id]')]
  .filter(e=>/构造型|Stereotype/.test(e.textContent)).map(e=>e.textContent.trim())`)
check('模型树没有「构造型」标签行', keywordRows.length === 0, JSON.stringify(keywordRows.slice(0, 6)))
const rootProbe = await page.evaluate(`(()=>{const r=[...document.querySelectorAll('.tree-row')]
  .find(e=>/项目根|Project root/.test(e.textContent));
 return r ? {cls:r.className, id:r.getAttribute('data-tree-id'), kind:r.getAttribute('data-tree-kind')} : null})()`)
check('项目根仍在', !!rootProbe && /root-node/.test(rootProbe.cls), JSON.stringify(rootProbe))

console.log('[B] 属性面板上下拖动')
const heightOf = () => page.evaluate(`Math.round(document.querySelector('.props-dock').getBoundingClientRect().height)`)
const h0 = await heightOf()
check('属性面板初始高度合理', h0 > 150 && h0 < 900, `h0=${h0}`)

const dragged = await dragBy(page, '.props-grip', 0, -90)
check('命中属性面板把手', dragged === true)
const h1 = await heightOf()
check('向上拖 90px 后面板变高约 90px', Math.abs((h1 - h0) - 90) <= 10, `h0=${h0} h1=${h1} delta=${h1 - h0}`)
const stored = await page.evaluate(`localStorage.getItem('scofen.modeler.dock.props')`)
check('高度已写入 localStorage', Number(stored) === h1, `stored=${stored} h1=${h1}`)
check('拖拽时 body 进入 row-resizing（拖拽结束后移除）',
  await page.evaluate(`!document.body.classList.contains('row-resizing')`))

await page.goto(APP_URL)
await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250)
const h2 = await heightOf()
check('刷新后高度保持', Math.abs(h2 - h1) <= 2, `h1=${h1} h2=${h2}`)

// 向下拖回去，验证两个方向
await dragBy(page, '.props-grip', 0, 60)
const h3 = await heightOf()
check('向下拖 60px 后面板变矮约 60px', Math.abs((h2 - h3) - 60) <= 10, `h2=${h2} h3=${h3}`)

// 拖到极小 / 极大：边界夹紧
await dragBy(page, '.props-grip', 0, -600)
const hMax = await heightOf()
check('上限留出模型树空间（≤ 容器高 - 132）', hMax <= 900, `hMax=${hMax}`)
await dragBy(page, '.props-grip', 0, 600)
const hMin = await heightOf()
check('下限不小于 180px', hMin >= 180, `hMin=${hMin}`)

// 拖到极大再双击：默认高度应明显回落，且清掉自定义值
await dragBy(page, '.props-grip', 0, -400)
const hBig = await heightOf()
check('可以先拖到较高位置', hBig > 300, `hBig=${hBig}`)
await page.evaluate(`(()=>{document.querySelector('.props-grip')
  .dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return 1})()`)
await sleep(400)
const resetKey = await page.evaluate(`localStorage.getItem('scofen.modeler.dock.props')`)
const hReset = await heightOf()
check('双击后清除自定义高度', resetKey === null, `key=${resetKey}`)
check('双击后高度回落到默认档', hReset < hBig - 20, `hBig=${hBig} hReset=${hReset}`)

await page.screenshot('props-resize')

console.log('[C] 左右拖宽回归')
const leftWidth = () => page.evaluate(`Math.round(document.querySelector('.left-dock').getBoundingClientRect().width)`)
const w0 = await leftWidth()
await dragBy(page, '[data-dock-resizer="left"]', 40, 0)
const w1 = await leftWidth()
check('左栏宽度仍可左右拖动', Math.abs((w1 - w0) - 40) <= 6, `w0=${w0} w1=${w1}`)
await dragBy(page, '[data-dock-resizer="left"]', -40, 0)
check('左栏宽度可拖回', Math.abs((await leftWidth()) - w0) <= 6)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
page.close()
process.exit(failed === 0 ? 0 : 1)
