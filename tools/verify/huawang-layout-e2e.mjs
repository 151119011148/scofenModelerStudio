/**
 * 华望二轮对齐验证（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 项目根节点与普通节点同款：无加粗、行末「项目根」是细小灰字而非黄底徽章
 *   2) 新建图弹窗是华望式分组标签 + 搜索 + 卡片墙，且保留 select 兼容入口
 *   3) 自动排布弹窗新增方向与名称次序两个 select，索引 0 仍是范围（脚本兼容）
 *   4) 页面骨架：菜单 24px / 工具条 36px / 状态栏 30px / 左栏 244px
 * 只读脚本：只打开对话框并取消，不写任何模型数据。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9474)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-hw-layout-shots'

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
  await call('Page.enable'); await call('Runtime.enable'); await call('DOM.enable')
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
for (let i = 0; i < 20; i++) {
  if (await page.evaluate(loginOnce).catch(() => false)) break
  await sleep(300)
}
check('登录成功', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1200)

console.log('[2] 页面骨架尺寸（华望）')
const frame = await page.evaluate(`(()=>{
 const g=(s)=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().height):-1}
 const left=document.querySelector('.left-dock')
 return {menu:g('.topbar .menubar'),tool:g('.topbar .toolbar'),status:g('.statusbar'),
         left:left?Math.round(left.getBoundingClientRect().width):-1}})()`)
check('菜单行 24px', frame.menu === 24, JSON.stringify(frame))
check('工具条 36px', frame.tool === 36, JSON.stringify(frame))
check('状态栏 30px', frame.status === 30, JSON.stringify(frame))
check('左栏默认 244px', frame.left === 244, JSON.stringify(frame))

console.log('[3] 项目根节点样式（华望：与子层同款，无黄底徽章）')
const root = await page.evaluate(`(()=>{
 const r=document.querySelector('.tree-row.root-node');if(!r)return null
 const tag=r.querySelector('.root-tag');const cs=getComputedStyle(r);const ts=tag?getComputedStyle(tag):null
 return {weight:cs.fontWeight,tagText:tag?.textContent?.trim()??'',tagBg:ts?.backgroundColor??'',
         tagColor:ts?.color??'',tagRadius:ts?.borderRadius??''}})()`)
check('根节点存在且保留「项目根」文案', !!root && root.tagText.includes('项目根'), JSON.stringify(root))
check('根节点不再加粗（华望同子层）', root?.weight === '400', JSON.stringify(root))
check('根标记无黄底（背景透明）', root?.tagBg === 'rgba(0, 0, 0, 0)', JSON.stringify(root))
check('根标记为灰字方角', root?.tagRadius === '0px', JSON.stringify(root))

console.log('[4] 新建图卡片墙（华望 NewGraph）')
const openedDiagram = await page.evaluate(`(()=>{
 const b=[...document.querySelectorAll('button.tbi')].find(x=>x.title.includes('新建图')||x.textContent.includes('▧'))
 if(!b)return false
 b.click();return true})()`)
check('新建图按钮可点', openedDiagram, String(openedDiagram))
check('新建图弹窗打开', await waitFor(page, `!!document.querySelector('.new-graph')`, 40, 200))
const ng = await page.evaluate(`(()=>{
 const labels=[...document.querySelectorAll('.ng-label')].map(x=>x.textContent.trim())
 const cards=document.querySelectorAll('.ng-card').length
 const search=!!document.querySelector('.ng-search')
 const compat=!!document.querySelector('.ng-compat-field select')
 return {labels,cards,search,compat}})()`)
check('分组标签含全部图表 / 规范图', ng.labels.includes('全部图表') && ng.labels.includes('规范图'), JSON.stringify(ng))
check('卡片墙有缩略图卡片', ng.cards >= 9, JSON.stringify(ng))
check('有搜索框', ng.search, JSON.stringify(ng))
check('保留 select 兼容入口', ng.compat, JSON.stringify(ng))
// 搜索过滤
await page.evaluate(`(()=>{const s=document.querySelector('.ng-search');
 const proto=Object.getPrototypeOf(s)
 const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set
 if(setter) setter.call(s,'需求'); else s.value='需求'
 s.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`)
await sleep(400)
const filtered = await page.evaluate(`document.querySelectorAll('.ng-card').length`)
check('搜索框能过滤卡片', filtered > 0 && filtered < ng.cards, `filtered=${filtered} total=${ng.cards}`)
await page.screenshot('new-graph-wall')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.modal-actions button')].find(x=>x.textContent.trim()==='取消');if(b)b.click();return 1})()`)

console.log('[5] 自动排布方向 / 名称次序（华望）')
const openedLayout = await page.evaluate(`(()=>{
 const b=[...document.querySelectorAll('button.tbi')].find(x=>x.textContent.trim()==='排布'&&x.className.includes('wide'))
 if(!b)return false
 b.click();return true})()`)
check('排布按钮可点', openedLayout, String(openedLayout))
check('排布弹窗打开', await waitFor(page, `!!document.querySelector('.modal')`, 40, 200))
const lay = await page.evaluate(`(()=>{
 const s=[...document.querySelectorAll('.modal select')]
 return {count:s.length,first:s[0]?.selectedOptions[0]?.textContent??'',
         opts:s.map(x=>[...x.options].map(o=>o.textContent).join('/'))}})()`)
check('四个 select：范围 / 策略 / 方向 / 名称次序', lay.count === 4, JSON.stringify(lay))
check('索引 0 仍是范围（脚本兼容）', lay.first.includes('仅当前图'), JSON.stringify(lay))
check('方向含向下 / 向右', lay.opts[2]?.includes('向下') && lay.opts[2]?.includes('向右'), JSON.stringify(lay))
check('名称次序含正序 / 倒序', lay.opts[3]?.includes('正序') && lay.opts[3]?.includes('倒序'), JSON.stringify(lay))
await page.screenshot('layout-options')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.modal-actions button')].find(x=>x.textContent.trim()==='取消');if(b)b.click();return 1})()`)

check('无 console error', page.events.length === 0, page.events.join(' | '))
page.close()
console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
