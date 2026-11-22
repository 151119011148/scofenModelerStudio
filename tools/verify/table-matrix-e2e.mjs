/**
 * 表格视图 + 华望式新建元素弹窗端到端验证（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 左栏新增「表格」视图，三项入口齐全
 *   2) 需求表：列定义 / 覆盖状态 / 工具栏（新建需求、导出 CSV）
 *   3) 通用表：类型筛选 / 范围切换 / 新建元素 / 导出
 *   4) 通用矩阵：行列类型、关系准则、行列互换、单元格
 *   5) 右键 / 菜单的新建元素弹窗：华望四段分组 + 搜索过滤
 *   6) 页面无 console error / 加载失败
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 * 本脚本只读，不写模型数据（新建元素弹窗打开后取消）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9467)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-table-shots'

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
  const events = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      events.push('console.error: ' + (msg.params.args?.[0]?.value ?? ''))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      events.push('exception: ' + (msg.params?.exceptionDetails?.text ?? ''))
    } else if (msg.method === 'Network.loadingFailed') {
      events.push('loadingFailed: ' + (msg.params?.errorText ?? ''))
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
  await call('Page.enable'); await call('Runtime.enable'); await call('DOM.enable'); await call('Network.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
  const goto = async (url) => { await call('Page.navigate', { url }); await sleep(1800) }
  const screenshot = async (name) => {
    mkdirSync(SHOTS, { recursive: true })
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    const path = `${SHOTS}/${name}.png`
    writeFileSync(path, Buffer.from(data, 'base64'))
    return path
  }
  return { call, evaluate, goto, screenshot, events, close: () => ws.close() }
}

async function waitFor(page, expr, tries = 100, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try { if (await page.evaluate(expr)) return true } catch { /* 尚未就绪 */ }
    await sleep(gap)
  }
  return false
}

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录进入工作台')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
const loginOnce = `(()=>{const u=document.querySelector('input[name="scofen-admin-username"]')
 const p=document.querySelector('input[name="scofen-admin-password"]')
 if(!u||!p)return false
 const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}
 set(u,'scofen'); set(p,${JSON.stringify(PASSWORD)})
 const b=[...document.querySelectorAll('button')].find(x=>/登录/.test(x.textContent))
 if(!b)return false
 b.click();return true})()`
let loggedIn = false
for (let i = 0; i < 20 && !loggedIn; i++) {
  loggedIn = await page.evaluate(loginOnce).catch(() => false)
  if (!loggedIn) await sleep(300)
}
check('登录成功', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1200)

console.log('[2] 左栏「表格」视图与三项入口')
const leftClicked = await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.tree-head-tab')].find(x=>x.textContent.trim()==='表格');if(!b)return false;b.click();return true})()`)
check('左栏出现并切到「表格」', leftClicked)
check('三项表格视图入口齐全', await waitFor(page, `document.querySelectorAll('[data-table-view-id]').length===3`))

const openView = async (id) => {
  await page.evaluate(`document.querySelector('[data-table-view-id="${id}"]')?.click()`)
  await sleep(400)
}

console.log('[3] 需求表')
await openView('requirement-table')
const req = await page.evaluate(`(()=>{const v=document.querySelector('.table-view[data-table-view="requirement"]');
 if(!v)return null; const heads=[...v.querySelectorAll('thead th')].map(x=>x.textContent.trim());
 const tools=[...v.querySelectorAll('.v-table-toolbar button')].map(x=>x.textContent.trim());
 return {heads,tools,rows:v.querySelectorAll('tbody tr').length,
   status:!!v.querySelector('.tv-status'), empty:!!v.querySelector('.tv-empty')}})()`)
check('需求表视图已打开', !!req)
check('列定义含满足 / 验证来源与状态', !!req && ['名称', '满足来源', '验证来源', '状态'].every((h) => req.heads.includes(h)), JSON.stringify(req?.heads))
check('工具栏含新建需求与导出 CSV', !!req && req.tools.includes('新建需求') && req.tools.includes('导出 CSV'), JSON.stringify(req?.tools))
check('有需求行或明确空态', !!req && (req.rows > 0 || req.empty))

console.log('[4] 通用表')
await openView('generic-table')
const generic = await page.evaluate(`(()=>{const v=document.querySelector('.table-view[data-table-view="generic"]');
 if(!v)return null; const heads=[...v.querySelectorAll('thead th')].map(x=>x.textContent.trim());
 const tools=[...v.querySelectorAll('.v-table-toolbar button')].map(x=>x.textContent.trim());
 return {heads,tools,selects:v.querySelectorAll('.v-table-toolbar select').length,
   rows:v.querySelectorAll('tbody tr').length, empty:!!v.querySelector('.tv-empty')}})()`)
check('通用表视图已打开', !!generic)
check('列定义含类型 / 构造型 / 所有者 / 文档', !!generic && ['类型', '构造型', '所有者', '文档'].every((h) => generic.heads.includes(h)), JSON.stringify(generic?.heads))
check('工具栏含类型筛选 / 新建元素 / 导出', !!generic && generic.selects === 1 && generic.tools.includes('新建元素') && generic.tools.includes('导出 CSV'), JSON.stringify(generic))
check('有元素行或明确空态', !!generic && (generic.rows > 0 || generic.empty))

console.log('[5] 通用矩阵')
await openView('generic-matrix')
const matrix = await page.evaluate(`(()=>{const v=document.querySelector('.table-view[data-table-view="matrix"]');
 if(!v)return null; const table=v.querySelector('.matrix-table');
 return {hasTable:!!table, selects:v.querySelectorAll('.v-table-toolbar select').length,
   swap:[...v.querySelectorAll('.v-table-toolbar button')].some(x=>/行列互换/.test(x.textContent)),
   cells:table?table.querySelectorAll('.matrix-cell').length:0,
   note:!!v.querySelector('.vt-footnote')}})()`)
check('通用矩阵视图已打开', !!matrix?.hasTable)
check('行 / 列类型与关系准则三个下拉齐全', !!matrix && matrix.selects === 3, JSON.stringify(matrix))
check('行列互换与单元格可用', !!matrix && matrix.swap && matrix.cells > 0, JSON.stringify(matrix))
const shot1 = await page.screenshot('matrix-view')
console.log(`    截图：${shot1}`)

console.log('[6] 华望式「新建元素」分组弹窗')
const menuOpened = await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.mb-btn')].find(x=>x.textContent.trim()==='文件');if(!b)return false;b.click();return true})()`)
check('文件菜单可打开', menuOpened)
const dialogOpened = await waitFor(page, `(()=>{const e=[...document.querySelectorAll('.mb-entry')].find(x=>/新建元素/.test(x.textContent));if(!e)return false;e.click();return true})()`, 20, 200)
check('新建元素弹窗已打开', dialogOpened && await waitFor(page, `!!document.querySelector('.choose-element')`))
const groups = await page.evaluate(`(()=>{const v=document.querySelector('.choose-element');if(!v)return null;
 return {groups:[...v.querySelectorAll('.ce-group h3')].map(x=>x.textContent.trim()),
   items:v.querySelectorAll('.ce-item').length, search:!!v.querySelector('.ce-search')}})()`)
check('弹窗按华望语义分组', !!groups && groups.groups.length >= 2 && groups.groups.includes('常用元素'), JSON.stringify(groups))
check('元素种类可搜索', !!groups?.search && groups.items > 0)
const before = groups?.items ?? 0
const after = await page.evaluate(`(()=>{const input=document.querySelector('.ce-search');if(!input)return -1;
 const set=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set;set.call(input,'Requirement');input.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`)
await sleep(300)
const filtered = await page.evaluate(`document.querySelectorAll('.ce-item').length`)
check('关键字过滤生效', after === 1 && filtered > 0 && filtered < before, `before=${before} after=${filtered}`)
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.modal-actions button')].find(x=>/取消/.test(x.textContent));b?.click();return 1})()`)

console.log('[7] 无 console error / 资源加载失败')
const realErrors = page.events.filter(e => !/favicon/i.test(e))
check('无控制台错误 / 异常 / 加载失败', realErrors.length === 0, realErrors.slice(0, 5).join(' | '))

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
page.close()
process.exit(failed ? 1 : 0)
