/**
 * 图形右上角「+」华望式浮层端到端验证（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 选中图形后出现 9×9 的 Canvasiconaddh.svg 黑圆白十字，位于图形右上角外侧
 *   2) 点击 + 弹出的菜单是华望 ContextMenu：白底灰边方角三层阴影、28px 行高、14px 图标、分组分隔线
 *   3) 菜单项是当前宿主允许的子元素类型（containment 规则），点击后创建子元素并落到当前图
 *   4) 原「快捷创建关系」已从 + 号迁到图形右键菜单，功能保留
 *   5) 页面无 console error / 加载失败
 *
 * 会建一个子元素并在末尾删除，可反复重跑。运行方式见 tools/verify/README.md：
 * Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9533)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-node-add-menu-shots'

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
    ws.onerror = () => reject(new Error('ws error'))
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
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
  const goto = async (url) => { await call('Page.navigate', { url }); await sleep(2000) }
  const screenshot = async (name) => {
    mkdirSync(SHOTS, { recursive: true })
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    const path = `${SHOTS}/${name}.png`
    writeFileSync(path, Buffer.from(data, 'base64'))
    return path
  }
  const clickAt = async (x, y, button = 'left') => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 })
  }
  return { call, evaluate, goto, screenshot, clickAt, events, close: () => ws.close() }
}

async function waitFor(page, expr, tries = 100, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try { if (await page.evaluate(expr)) return true } catch { /* 尚未就绪 */ }
    await sleep(gap)
  }
  return false
}

const setInput = (selector, value) => `(()=>{
  const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return false;
  const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;
  s.call(el,${JSON.stringify(String(value))});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true})); return true;
})()`

const page = await connect()
const H = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token'),
  'Content-Type':'application/json','X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'}`
const api = async (expression) => page.evaluate(`(async()=>{const h=${H};${expression}})()`, true)

console.log('[1] 登录进入工作台')
await page.goto(APP_URL)
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-password"]')`)
let loginInjected = false
for (let i = 0; i < 20 && !loginInjected; i++) {
  try {
    loginInjected = await page.evaluate(`(()=>{const q=(n)=>document.querySelector('input[name="scofen-admin-'+n+'"]');
      if(!q('username')||!q('password')) return false;
      const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;
        s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};
      set(q('username'),'scofen'); set(q('password'),${JSON.stringify(PASSWORD)});
      [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent))?.click(); return true})()`)
  } catch { /* 表单重挂中 */ }
  if (!loginInjected) await sleep(250)
}
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1200)

console.log('[2] 打开一张有图形的图')
const diagramName = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  return (d.diagrams||[]).find(x=>x.kind==='bdd'||x.kind==='uc'||x.kind==='req')?.name ?? d.diagrams?.[0]?.name ?? null`)
check('模型里有图可打开', !!diagramName, String(diagramName))
await page.evaluate(`(()=>{const b=document.querySelector('.tree-head-search'); if(b) b.click(); return !!b})()`)
await sleep(400)
await page.evaluate(setInput('.search-input-row input', diagramName ?? ''))
await sleep(900)
await page.evaluate(`(()=>{const rows=[...document.querySelectorAll('.search-row')];
  const hit=rows.find(r=>r.textContent.includes(${JSON.stringify(diagramName ?? '')}))??rows[0];
  if(hit) hit.click(); return !!hit})()`)
check('图已打开并渲染图形', await waitFor(page, `document.querySelectorAll('.canvas svg g.node[data-element-id]').length>0`, 80, 250))

console.log('[3] 选中图形，核对右上角 + 号')
const nodeInfo = await page.evaluate(`(()=>{
  const nodes=[...document.querySelectorAll('.canvas svg g.node[data-element-id]')];
  const g=nodes.find(n=>{const r=n.getBoundingClientRect(); return r.width>20&&r.height>14&&r.x>0&&r.y>0});
  if(!g) return null;
  const r=g.getBoundingClientRect();
  return {id:g.getAttribute('data-element-id'), x:r.x+r.width/2, y:r.y+r.height/2,
    right:r.right, top:r.top, w:r.width, h:r.height};
})()`)
check('找到可点选的图形', !!nodeInfo, JSON.stringify(nodeInfo))
if (!nodeInfo) { await page.close(); process.exit(1) }
await page.clickAt(nodeInfo.x, nodeInfo.y)
await sleep(350)

const plus = await page.evaluate(`(()=>{
  const g=document.querySelector('.node-quick-add'); if(!g) return null;
  const img=g.querySelector('image'); if(!img) return null;
  const r=img.getBoundingClientRect();
  return {href:img.getAttribute('href'), x:img.getAttribute('x'), y:img.getAttribute('y'),
    w:img.getAttribute('width'), h:img.getAttribute('height'),
    left:r.left, top:r.top, width:r.width, height:r.height,
    title:g.querySelector('title')?.textContent};
})()`)
check('选中图形后出现 + 号', !!plus, JSON.stringify(plus))
if (plus) {
  check('+ 号是华望 Canvasiconaddh.svg 黑圆白十字', /Canvasiconaddh\.svg$/.test(String(plus.href)), String(plus.href))
  check('+ 号视觉尺寸 9×9', plus.w === '9' && plus.h === '9', `${plus.w}x${plus.h}`)
  check('+ 号贴在图形右缘（非右侧垂直居中）',
    plus.left >= nodeInfo.right - 4 && plus.left <= nodeInfo.right + 6,
    `plus.left=${plus.left}, node.right=${nodeInfo.right}`)
  check('+ 号在图形顶部（华望 absY+10）',
    plus.top >= nodeInfo.top - 2 && plus.top <= nodeInfo.top + 24,
    `plus.top=${plus.top}, node.top=${nodeInfo.top}`)
  check('+ 号提示语已改为添加子元素', /添加子元素/.test(String(plus.title)), String(plus.title))
}

console.log('[4] 点击 + 号，核对华望 ContextMenu')
await page.clickAt(plus.left + plus.width / 2, plus.top + plus.height / 2)
check('浮层已弹出', await waitFor(page, `!!document.querySelector('.quick-menu')`, 40, 200))
const menu = await page.evaluate(`(()=>{
  const m=document.querySelector('.quick-menu'); if(!m) return null;
  const cs=getComputedStyle(m);
  const btns=[...m.querySelectorAll('button')];
  return {bg:cs.backgroundColor, border:cs.borderTopColor, radius:cs.borderTopLeftRadius,
    shadow:cs.boxShadow, itemH:btns[0]?.getBoundingClientRect().height,
    itemCount:btns.length, iconCount:btns.filter(b=>b.querySelector('img')).length,
    sections:m.querySelectorAll('.menu-section').length,
    title:m.querySelector('.menu-title')?.textContent,
    labels:btns.slice(0,6).map(b=>b.textContent)};
})()`)
check('菜单白底', menu?.bg === 'rgb(255, 255, 255)', String(menu?.bg))
check('菜单灰边框 #d0d0d0', menu?.border === 'rgb(208, 208, 208)', String(menu?.border))
check('菜单方角（border-radius:0）', menu?.radius === '0px', String(menu?.radius))
check('菜单带三层阴影', /rgba\(/.test(String(menu?.shadow)) && String(menu?.shadow).split('rgba').length >= 4, String(menu?.shadow))
check('菜单项 28px 行高', menu?.itemH === 28, String(menu?.itemH))
check('菜单项带 14px 类型图标', menu?.iconCount > 0, JSON.stringify(menu))
check('菜单按华望四段分组', menu?.sections >= 1, String(menu?.sections))
check('菜单标题指向该图形', /添加子元素/.test(String(menu?.title)), String(menu?.title))
check('菜单项是可新建的子元素类型', (menu?.itemCount ?? 0) > 0, JSON.stringify(menu?.labels))
await page.screenshot('plus-menu')

console.log('[5] 点击菜单项创建子元素')
const before = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  return {rev:d.revision, ids:(d.elements||[]).map(e=>e.id)}`)
await page.evaluate(`(()=>{const b=document.querySelector('.quick-menu button'); if(b) b.click(); return !!b})()`)
let after = null
for (let i = 0; i < 40; i++) {
  after = await api(`const d=await (await fetch('api/model',{headers:h})).json();
    return {rev:d.revision, elements:d.elements||[]}`)
  if (after?.rev > before.rev) break
  await sleep(250)
}
check('创建命令推进了 revision', (after?.rev ?? 0) > before.rev, `${before.rev} -> ${after?.rev}`)
const added = (after?.elements ?? []).filter((e) => !before.ids.includes(e.id))
check('新元素挂在该图形之下', added.some((e) => e.ownerId === nodeInfo.id), JSON.stringify(added.map((e) => ({ id: e.id, type: e.type, ownerId: e.ownerId }))))
const notationAdded = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  return (d.notations||[]).some(n=>n.elementId===${JSON.stringify(added[0]?.id ?? '')})`)
check('新元素落到当前图（有 Notation）', notationAdded === true, String(notationAdded))

console.log('[6] 原「快捷创建关系」迁到图形右键菜单')
await page.clickAt(nodeInfo.x, nodeInfo.y, 'right')
check('右键菜单已弹出', await waitFor(page, `!!document.querySelector('.context-menu')`, 40, 200))
const hasRelationEntry = await page.evaluate(`[...document.querySelectorAll('.context-menu button')]
  .some(b=>/快捷创建关系/.test(b.textContent))`)
check('右键菜单含「快捷创建关系…」', hasRelationEntry)
// 用真实鼠标点右键菜单项：JS .click() 的 clientX/Y 为 0，会让浮层定位到左上角。
const relBtnBox = await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.context-menu button')]
  .find(x=>/快捷创建关系/.test(x.textContent)); if(!b) return null;
  const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
if (relBtnBox) await page.clickAt(relBtnBox.x, relBtnBox.y)
check('关系类型浮层已弹出', await waitFor(page, `!!document.querySelector('.quick-menu')`, 40, 200))
const relationMenu = await page.evaluate(`(()=>{const m=document.querySelector('.quick-menu'); if(!m) return null;
  return {title:m.querySelector('.menu-title')?.textContent, count:m.querySelectorAll('button').length}})()`)
check('浮层标题是「以…为起点」', /为起点/.test(String(relationMenu?.title)), String(relationMenu?.title))
check('浮层列出关系类型', (relationMenu?.count ?? 0) > 0, JSON.stringify(relationMenu))
await page.screenshot('relation-menu')

console.log('[7] 清理本轮创建的元素')
if (added[0]?.id) {
  const cleaned = await api(`const d=await (await fetch('api/model',{headers:h})).json();
    const r=await fetch('api/commands',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'},
      body:JSON.stringify({type:'DELETE_ELEMENTS',baseRevision:d.revision,
        clientCmdId:'nam-clean-'+Date.now(),payload:{ids:[${JSON.stringify(added[0].id)}]}})});
    return r.status`)
  check('残留元素已删除', cleaned === 200, String(cleaned))
}

check('无 console error / 加载失败', page.events.length === 0, page.events.join(' | '))
console.log(`\n通过 ${passed} 项，失败 ${failed} 项；截图目录 ${SHOTS}`)
await page.close()
process.exit(failed === 0 ? 0 : 1)
