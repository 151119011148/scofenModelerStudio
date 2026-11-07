/**
 * 初始化失败自愈的浏览器级回归。
 *
 * 模拟「页面加载时后端/网络瞬时不可用」这一真实故障：登录成功后阻断所有 /api
 * 请求并刷新页面，验证界面给出明确横幅、不再用误导性文案伪装成元模型规则；
 * 随后解除阻断，分别验证「自动退避重试」与「立即重试按钮」都能让页面自愈。
 *
 * 运行方式见 tools/verify/README.md。Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9453)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
let failed = 0
function check(label, cond, extra = '') {
  if (cond) { passed++; console.log(`    PASS — ${label}`) }
  else { failed++; console.log(`    FAIL — ${label}${extra ? ' :: ' + extra : ''}`) }
  return cond
}

async function connect() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
  const ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)) } }, 30000)
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (m, p = {}) => send(m, p, sessionId)
  await call('Page.enable'); await call('Runtime.enable'); await call('DOM.enable'); await call('Network.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
  const goto = async (url) => { await call('Page.navigate', { url }); await sleep(2000) }
  const reload = async () => { await call('Page.reload', { ignoreCache: true }); await sleep(2500) }
  const block = (on) => call('Network.setBlockedURLs', { urls: on ? ['*api/*'] : [] })
  const screenshot = async (name) => {
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`/tmp/scofen-reconnect-${name}.png`, Buffer.from(data, 'base64'))
  }
  return { call, evaluate, goto, reload, block, screenshot, close: () => ws.close() }
}

async function waitFor(page, expr, tries = 60, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try { if (await page.evaluate(expr)) return true } catch { /* 页面尚未就绪 */ }
    await sleep(gap)
  }
  return false
}

/** 页面可直接观察到的数据就绪程度。 */
const probeExpr = `(async()=>{
  const t=localStorage.getItem('scofen.modeler.token');
  let model=null;
  try { const r=await fetch('api/model',{headers:{Authorization:'Bearer '+t}}); if(r.ok) model=await r.json(); } catch {}
  const banner=document.querySelector('.connection-banner');
  return {
    banner: banner ? banner.innerText.slice(0,180) : null,
    retryButton: !!banner && [...banner.querySelectorAll('button')].some(b=>/立即重试|Retry now/.test(b.textContent)),
    title: document.querySelector('.project-picker strong')?.textContent ?? null,
    rev: (document.body.innerText.match(/rev\\s*(\\d+)/)||[])[1] ?? null,
    online: /在线|已连接/.test(document.body.innerText),
    hasRoot: model ? model.elements.some(e=>!e.ownerId && e.type==='Package') : false,
    elementCount: model ? model.elements.length : 0,
  }
})()`

/** 打开「模型 → 在项目根下新建元素…」，返回对话框摘要。 */
async function openCreateDialog(page) {
  await page.evaluate(`(()=>{document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1})()`)
  await sleep(180)
  await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button,.menubar-item')].find(x=>x.textContent.trim()==='模型');if(b){b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));b.click()}return 1})()`)
  await sleep(350)
  await page.evaluate(`(()=>{const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&/在项目根下新建元素/.test(x.textContent||''));if(e)e.click();return 1})()`)
  await sleep(400)
  return page.evaluate(`(()=>{const m=document.querySelector('.modal');return m?{text:m.innerText.slice(0,200),options:m.querySelectorAll('select option').length}:null})()`)
}

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录并建立基线')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`, 100, 250)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录后进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(2200)
const baseline = await page.evaluate(probeExpr, true)
check('基线：无错误横幅', baseline.banner === null)
check('基线：模型已就绪（有 Package 根）', baseline.hasRoot, JSON.stringify(baseline))
check('基线：状态栏在线', baseline.online)

console.log('\n[2] 阻断 /api 后刷新，复现初始化失败')
await page.block(true)
await page.reload()
const broken = await page.evaluate(probeExpr, true)
check('出现连接失败横幅', !!broken.banner, String(broken.banner))
check('横幅含「立即重试」按钮', broken.retryButton)
check('界面处于未连接状态', !broken.online)
check('模型快照为空（rev 0）', broken.rev === '0', String(broken.rev))
await page.screenshot('blocked')

console.log('\n[3] 阻断态不得再用误导性文案伪装成元模型规则')
const dialog = await openCreateDialog(page)
check('不再打开空的新建对话框', dialog === null, JSON.stringify(dialog))
const msg = await page.evaluate(`document.querySelector('.sb-message')?.textContent ?? document.body.innerText.slice(-200)`)
check('状态栏提示是「模型数据尚未就绪」而非规则限制', /模型数据尚未就绪|Model data is not ready/.test(msg), msg)
await page.screenshot('blocked-hint')

console.log('\n[4] 解除阻断 → 自动退避重试应自愈')
await page.block(false)
const recovered = await waitFor(page, `!document.querySelector('.connection-banner') && /在线|已连接/.test(document.body.innerText)`, 60, 250)
check('横幅消失且状态栏恢复在线', recovered)
await sleep(600)
const after = await page.evaluate(probeExpr, true)
check('模型快照恢复（rev 非 0）', after.rev !== '0' && after.rev !== null, String(after.rev))
check('项目根恢复显示', after.hasRoot)
check('顶栏不再是「未命名项目」', after.title !== '未命名项目', String(after.title))
await page.screenshot('recovered')

console.log('\n[5] 恢复后新建元素候选完整')
const goodDialog = await openCreateDialog(page)
check('新建对话框正常打开', !!goodDialog, JSON.stringify(goodDialog))
check('类型候选 ≥ 17 项', (goodDialog?.options ?? 0) >= 17, String(goodDialog?.options))
check('父节点显示项目名', !!goodDialog && !/父节点：项目根/.test(goodDialog.text), goodDialog?.text?.slice(0, 60))

console.log('\n[6] 再次故障后点「立即重试」也能立刻恢复')
await page.evaluate(`(()=>{const m=document.querySelector('.modal');if(m){const b=[...m.querySelectorAll('button')].find(x=>/取消|Cancel/.test(x.textContent));if(b)b.click()}return 1})()`)
await page.block(true)
await page.reload()
check('再次出现故障横幅', await waitFor(page, `!!document.querySelector('.connection-banner')`, 30, 200))
await page.block(false)
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.connection-banner button')].find(x=>/立即重试|Retry now/.test(x.textContent));if(b)b.click();return 1})()`)
const manual = await waitFor(page, `!document.querySelector('.connection-banner') && /在线|已连接/.test(document.body.innerText)`, 24, 250)
check('手动「立即重试」在 6 秒内恢复', manual)

console.log(`\n结果: ${passed} PASS / ${failed} FAIL`)
page.close()
if (failed > 0) process.exitCode = 1
