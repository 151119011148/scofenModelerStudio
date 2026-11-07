/**
 * 项目根 Package + 可创建 Model 节点的浏览器级实测。
 *
 * 走真实 UI：登录 → 检查模型树根 → 「模型」菜单「在项目根下新建元素…」
 * → 类型下拉里选「模型」→ 填写名称 → 创建 → 树上出现新节点 → 撤销恢复。
 *
 * 运行方式见 tools/verify/README.md。Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9445)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-root-shots'
const MODEL_NAME = 'UI验证模型'

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
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }
      }, 30000)
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('DOM.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    }
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
    try { if (await page.evaluate(expr)) return true } catch { /* 页面尚未就绪 */ }
    await sleep(gap)
  }
  return false
}

/** 页面内取当前项目快照。用相对路径，兼容子路径部署。 */
const snapshotExpr = `(async()=>{const r=await fetch('api/model',{headers:{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token')}});return await r.json()})()`

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(2200)

console.log('[2] 项目根是 Package')
const snap0 = await page.evaluate(snapshotExpr, true)
const roots = snap0.elements.filter((e) => !e.ownerId)
check('只有一个顶层元素', roots.length === 1, JSON.stringify(roots.map((e) => e.id)))
check('项目根 id 为 model-root', roots[0]?.id === 'model-root')
check('项目根类型是 Package', roots[0]?.type === 'Package', roots[0]?.type)
check('模型树渲染出根节点样式', await page.evaluate(`!!document.querySelector('.tree-row.root-node')`))
check('根节点带「项目根」标签', await page.evaluate(
  `[...document.querySelectorAll('.root-tag')].some(e=>e.textContent.includes('项目根'))`))
await page.screenshot('01-root-package')

console.log('[3] 新建对话框里能选到「模型」')
// 「模型」菜单 →「在项目根下新建元素…」
await page.evaluate(`(()=>{const open=document.querySelector('.mb-drop');if(open){document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))}return 1})()`)
await sleep(300)
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.mb-btn')].find(x=>x.textContent.trim()==='模型');if(!b)throw new Error('未找到「模型」菜单');b.click();return 1})()`)
await sleep(450)
const menuEntries = await page.evaluate(`[...document.querySelectorAll('.mb-entry-label')].map(e=>e.textContent.trim())`)
check('「模型」菜单有「在项目根下新建元素…」', menuEntries.includes('在项目根下新建元素…'), menuEntries.join('|'))
await page.evaluate(`(()=>{const e=[...document.querySelectorAll('.mb-entry-label')].find(x=>x.textContent.trim()==='在项目根下新建元素…');if(!e)return false;e.closest('button').click();return true})()`)
await sleep(500)
const options = await page.evaluate(`[...document.querySelectorAll('.modal select option')].map(o=>({value:o.value,text:o.textContent.trim()}))`)
check('新建对话框列出元素类型', options.length > 0, String(options.length))
check('候选类型含 MODEL（模型节点）', options.some((o) => o.value === 'MODEL'), options.map((o) => o.value).join('|'))
console.log('    可选类型：', options.map((o) => o.value).join(' '))
await page.screenshot('02-create-dialog')

console.log('[4] 真正创建一个 Model 节点')
const picked = await page.evaluate(`(()=>{const sel=document.querySelector('.modal select');if(!sel)return false;
 const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
 setter.call(sel,'MODEL');sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
check('已选中 MODEL 类型', picked)
await sleep(350)
await page.evaluate(`(()=>{const inp=[...document.querySelectorAll('.modal input:not([type=checkbox])')][0];
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 setter.call(inp,${JSON.stringify(MODEL_NAME)});inp.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`)
await sleep(250)
const createBtn = await page.evaluate(`(()=>{const b=document.querySelector('.modal-actions button.primary');if(!b||b.disabled)return false;b.click();return true})()`)
check('「创建」按钮可点击', createBtn)
const created = await waitFor(page,
  `(async()=>{const m=await (${snapshotExpr});return m.elements.some(e=>e.name===${JSON.stringify(MODEL_NAME)}&&e.type==='Model')})()`,
  60, 300)
check('新 Model 节点已写入服务端', created)
const snap1 = created ? await page.evaluate(snapshotExpr, true) : snap0
const newNode = snap1.elements.find((e) => e.name === MODEL_NAME)
check('新节点挂在项目根下', newNode?.ownerId === 'model-root', String(newNode?.ownerId))
check('项目根类型仍是 Package', snap1.elements.find((e) => e.id === 'model-root')?.type === 'Package')
// runCommand 还要处理 Patch 与 refresh，比服务端落库稍慢，用等待式断言。
check('对话框创建后自动关闭',
  await waitFor(page, `!document.querySelector('.modal select')`, 40, 200))
await page.screenshot('03-model-created')

console.log('[5] 撤销恢复 + XMI 根标签')
const undoRes = await page.evaluate(`(async()=>{const r=await fetch('api/commands/undo',{method:'POST',headers:{'X-Scofen-Session':'web-ui','Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token')}});return {status:r.status,body:await r.text()}})()`, true)
check('撤销请求 200', undoRes.status === 200, `${undoRes.status} ${undoRes.body.slice(0, 160)}`)
await sleep(700)
const snap2 = await page.evaluate(snapshotExpr, true)
check('撤销后 Model 节点消失', !snap2.elements.some((e) => e.name === MODEL_NAME))
const xmi = await page.evaluate(`(async()=>{const r=await fetch('api/exchange/xmi',{headers:{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token')}});return await r.text()})()`, true)
check('XMI 导出根标签为 uml:Package', /<uml:Package\b/.test(xmi), xmi.slice(0, 220))
check('XMI 根带 scofen:type="Package"', xmi.includes('scofen:type="Package"'))

console.log(`\n[结果] PASS ${passed} / FAIL ${failed}`)
await page.close()
process.exit(failed === 0 ? 0 : 1)
