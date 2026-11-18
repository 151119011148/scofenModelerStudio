/**
 * 「图类型」节点的打开链路（扩展图库 16 张模板 / 用户自建图种类）：
 *
 *   1) 树里的图类型是**定义**不是图，双击必须落成一张该类型的图并打开——
 *      这是「扩展图库的图点不开」的根因（此前双击只选中，什么都不发生）；
 *   2) 同类型已有图时再双击只打开第一张，不重复建；
 *   3) 右键菜单给「用此类型新建图」，作为双击之外的显式入口；
 *   4) 左栏「图表」视图按**自定义类型**分组，而不是混进基底「模块定义图」组；
 *   5) 脚本可重入：开头与结尾都清掉本轮建出来的图。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动，
 * 口令走 SCOFEN_PASSWORD，APP_URL 指向被测实例。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9498)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-diagram-type-shots'
/** 预置图库里的「系统上下文图」，基底 bdd，双击后应落成同名图。 */
const PRESET = 'e-dt-preset-system-context'
const PRESET_NAME = '系统上下文图'

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
    await sleep(2400)
  }
  const screenshot = async (name) => {
    mkdirSync(SHOTS, { recursive: true })
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, 'base64'))
    return `${SHOTS}/${name}.png`
  }
  return { call, evaluate, goto, screenshot, close: () => ws.close() }
}

async function waitFor(page, expr, tries = 60, gap = 250) {
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

const page = await connect()
const H = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token'),
  'Content-Type':'application/json','X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'}`
const api = async (expression) => page.evaluate(`(async()=>{const h=${H};${expression}})()`, true)

/** 点/双击某个树行：用 MouseEvent 触发，走 React 的合成事件。 */
const clickRow = (id, type = 'click') => page.evaluate(`(()=>{
  const r=[...document.querySelectorAll('.tree-row[data-tree-id]')]
    .find(x=>x.getAttribute('data-tree-id')===${JSON.stringify(id)});
  if(!r) return false;
  r.dispatchEvent(new MouseEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,view:window}));
  return true;
})()`)

/** 服务端里 customTypeId 指向该预置模板的图（自定义图）。 */
const customDiagrams = () => api(`
  const d=await (await fetch('api/model',{headers:h})).json();
  return (d.diagrams??[]).filter(x=>x.customTypeId===${JSON.stringify(PRESET)}).map(x=>x.id+'|'+x.name)`)

/** 删除本轮建出来的自定义图（可重入）。 */
const cleanCustomDiagrams = async () => {
  const list = await customDiagrams()
  for (const entry of list) {
    const id = entry.split('|')[0]
    await api(`
      const m=await (await fetch('api/model',{headers:h})).json();
      const r=await fetch('api/commands',{method:'POST',headers:h,body:JSON.stringify({
        type:'DELETE_DIAGRAM',payload:{id:${JSON.stringify(id)}},baseRevision:m.revision,
        clientCmdId:'clean-type-open-'+Math.random().toString(36).slice(2)})});
      return r.status`)
  }
  return list
}

const activeTabLabel = () => page.evaluate(
  `document.querySelector('.doc-tab.active .doc-tab-label')?.textContent?.trim() ?? ''`)

await page.goto(APP_URL)
console.log('[1] 登录与可重入清理')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
let loginInjected = false
for (let i = 0; i < 20 && !loginInjected; i++) {
  try {
    loginInjected = await page.evaluate(`(()=>{const q=(n)=>document.querySelector('input[name="scofen-admin-'+n+'"]');
      if(!q('username')||!q('password')) return false;
      const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set(q('username'),'scofen');
      set(q('password'),${JSON.stringify(PASSWORD)});
      [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent))?.click();return true})()`)
  } catch {
    /* 表单重挂竞态：判空重试 */
  }
  if (!loginInjected) await sleep(300)
}
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await cleanCustomDiagrams()
check('清理后没有该类型的自定义图', (await customDiagrams()).length === 0,
  JSON.stringify(await customDiagrams()))

console.log('[2] 双击图类型节点 → 新建并打开')
check('树里能定位到「系统上下文图」图类型', await waitFor(page, `(()=>{
  return [...document.querySelectorAll('.tree-row[data-tree-id]')]
    .some(x=>x.getAttribute('data-tree-id')===${JSON.stringify(PRESET)})})()`))
check('双击已下发', await clickRow(PRESET, 'dblclick'))
await sleep(2200)
const opened = await customDiagrams()
check('服务端落库 1 张该类型的图', opened.length === 1, JSON.stringify(opened))
check('图名取图类型名', opened[0]?.split('|')[1] === PRESET_NAME, opened[0] ?? '')
check('页签切到新图', await waitFor(page,
  `document.querySelector('.doc-tab.active .doc-tab-label')?.textContent?.trim()===${JSON.stringify(PRESET_NAME)}`, 40, 250),
  await activeTabLabel())
check('画布渲染出图框', await waitFor(page, `!!document.querySelector('.diagram-frame')`))
check('图框标题含类型名（自定义模板 {图种}）', await page.evaluate(
  `(document.querySelector('.diagram-frame')?.textContent ?? '').includes(${JSON.stringify(PRESET_NAME)})`),
  await page.evaluate(`document.querySelector('.diagram-frame')?.textContent?.slice(0,60) ?? ''`))
await page.screenshot('01-open-by-dblclick')

console.log('[3] 再双击不重复建图')
check('第二次双击已下发', await clickRow(PRESET, 'dblclick'))
await sleep(1800)
check('仍然只有 1 张（打开已有而不是再建）', (await customDiagrams()).length === 1,
  JSON.stringify(await customDiagrams()))
check('页签仍是该图', (await activeTabLabel()) === PRESET_NAME, await activeTabLabel())

console.log('[4] 右键菜单给出显式入口')
await page.evaluate(`(()=>{
  const r=[...document.querySelectorAll('.tree-row[data-tree-id]')]
    .find(x=>x.getAttribute('data-tree-id')===${JSON.stringify(PRESET)});
  if(!r) return false;
  const box=r.getBoundingClientRect();
  r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,view:window,
    clientX:box.left+30,clientY:box.top+8}));
  return true})()`)
const menuText = await page.evaluate(
  `document.querySelector('.context-menu')?.textContent ?? ''`)
check('菜单出现', menuText.length > 0)
check('菜单含「用此类型新建图」', menuText.includes('用此类型新建图'), menuText.slice(0, 80))
await page.screenshot('02-type-context-menu')
await page.evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)

console.log('[5] 图表视图按自定义类型分组')
await page.evaluate(`(()=>{
  const b=[...document.querySelectorAll('.bt-tab, .left-tab, button')]
    .find(x=>x.textContent.trim()==='图表' && x.className.includes('tab'));
  if(b) b.click(); return !!b})()`)
await sleep(800)
const groups = await page.evaluate(
  `[...document.querySelectorAll('.chart-group-head')].map(h=>h.textContent.trim())`)
check('出现「系统上下文图」分组', groups.some((g) => g.includes(PRESET_NAME)), JSON.stringify(groups))
check('不再混进「模块定义图」组', !groups.some((g) => g.includes('模块定义图') && g.includes('系统上下文图')),
  JSON.stringify(groups))
const groupRows = await page.evaluate(`(()=>{
  const head=[...document.querySelectorAll('.chart-group-head')]
    .find(h=>h.textContent.includes(${JSON.stringify(PRESET_NAME)}));
  if(!head) return -1;
  const section=head.closest('.chart-group');
  return section ? section.querySelectorAll('.chart-row[data-diagram-id]').length : -1})()`)
check('该分组下恰好 1 张图', groupRows === 1, String(groupRows))
await page.screenshot('03-charts-group')

console.log('[6] 清理')
const removed = await cleanCustomDiagrams()
check('已删除本轮建出的图', removed.length === 1, JSON.stringify(removed))
check('服务端无残留', (await customDiagrams()).length === 0)

console.log('────────────')
console.log(`通过 ${passed} / ${passed + failed}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
