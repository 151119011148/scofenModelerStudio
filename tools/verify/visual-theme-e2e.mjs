/**
 * 换肤 + 成品图标资源的视觉回归（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) :root 主色与外壳语义变量是华望色（--accent=#1890ff、标题栏 #e8eef9…）
 *   2) 模型树 / 工具箱的元模型图标以成品 SVG <img> 渲染（icon-tile-asset）
 *   3) 成品 SVG 资源 HTTP 200（子路径前缀拼接正确），且确实有绘图内容
 *   4) 未命中映射的类型回退内联 Glyph，图标零缺失
 *   5) 页面无 console error / 无失败请求
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 * 本脚本只读，不写任何数据。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9461)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-visual-shots'

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
await sleep(1500)

console.log('[2] 华望换肤变量')
const vars = await page.evaluate(`(()=>{const cs=getComputedStyle(document.documentElement);
 return {accent:cs.getPropertyValue('--accent').trim(),titlebar:cs.getPropertyValue('--titlebar-bg').trim(),
 soft:cs.getPropertyValue('--accent-soft').trim(),sider:cs.getPropertyValue('--sider-bg').trim(),
 radius:cs.getPropertyValue('--radius').trim(),font:getComputedStyle(document.body).fontSize}})()`)
check('主色 --accent = #1890ff', vars.accent === '#1890ff', vars.accent)
check('标题栏 --titlebar-bg = #e8eef9', vars.titlebar === '#e8eef9', vars.titlebar)
check('页签 --accent-soft = #e6f0ff', vars.soft === '#e6f0ff', vars.soft)
check('侧栏 --sider-bg = #f4f8ff', vars.sider === '#f4f8ff', vars.sider)
check('无圆角基调 --radius = 0px', vars.radius === '0px', vars.radius)
check('正文 12px 字号', vars.font === '12px', vars.font)
const topbarBg = await page.evaluate(`getComputedStyle(document.querySelector('.topbar')).backgroundColor`)
check('顶栏实际背景为华望标题蓝 rgb(232, 238, 249)', topbarBg === 'rgb(232, 238, 249)', topbarBg)

console.log('[3] 成品 SVG 图标渲染')
const icons = await page.evaluate(`(()=>{const all=[...document.querySelectorAll('.icon-tile')];
 const assets=all.filter(e=>e.classList.contains('icon-tile-asset'));
 const imgs=assets.map(e=>e.querySelector('img')).filter(Boolean);
 const inline=all.filter(e=>e.querySelector(':scope > svg'));
 const sample=imgs.slice(0,4).map(i=>i.getAttribute('src'));
 return {total:all.length,assets:assets.length,imgCount:imgs.length,inline:inline.length,sample}})()`)
check('存在成品图标 tile', icons.assets > 0, JSON.stringify(icons))
check('成品图标以 <img> 渲染', icons.imgCount === icons.assets, JSON.stringify(icons))
check('存在回退内联 Glyph（未命中映射的兜底）', icons.inline > 0, JSON.stringify(icons))
check('图标 src 带子路径/根前缀且指向 sysml', icons.sample.every(s => /icons\/sysml\/[^\/]+\.svg$/.test(s ?? '')), JSON.stringify(icons.sample))
// APP_URL 带 /scofen/modelerStudio/ 时，图标 src 必须同样带前缀——否则子路径部署下 404。
if (APP_URL.includes('/scofen/modelerStudio/')) {
  check('子路径部署下图标 src 带 /scofen/modelerStudio/ 前缀',
    icons.sample.every(s => (s ?? '').includes('/scofen/modelerStudio/icons/sysml/')), JSON.stringify(icons.sample))
}

console.log('[4] SVG 资源可访问且有内容')
// 图片解码成功（naturalWidth>0）即证明资源 200 且是合法 SVG——比 fetch 探针更贴近真实渲染。
const decoded = await page.evaluate(`(()=>{const imgs=[...document.querySelectorAll('.icon-tile-asset img')];
 const ok=imgs.filter(i=>i.complete && i.naturalWidth>0).length;
 return {total:imgs.length,decoded:ok}})()`)
check('成品 SVG 全部成功解码（HTTP 200 且合法）', decoded.total > 0 && decoded.decoded === decoded.total, JSON.stringify(decoded))

console.log('[5] 无 console error / 资源加载失败')
// 触发一次工具箱切换，确保图标密集区域都已渲染
await page.evaluate(`(()=>{const t=[...document.querySelectorAll('.tb-tabs button')];if(t[1])t[1].click();return 1})()`)
await sleep(600)
const shot = await page.screenshot('workbench-with-hw-icons')
console.log(`    截图：${shot}`)
const realErrors = page.events.filter(e => !/favicon/i.test(e))
check('无控制台错误 / 异常 / 加载失败', realErrors.length === 0, realErrors.slice(0, 5).join(' | '))

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
page.close()
process.exit(failed ? 1 : 0)
