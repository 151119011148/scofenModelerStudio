/**
 * 用户管理保存反馈端到端验证（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 用户与角色面板可打开，可进入新建用户表单
 *   2) 点保存后，错误直接显示在面板内（而不是只落到左下角状态栏）
 *   3) 后端 ResponseStatusException 带出 message，前端不再只显示「HTTP 400」
 *   4) 页面无 console error / 加载失败
 *
 * 本地 jar 默认是内存态，保存用户会返回 400「需要持久化模式」，正好用于验证错误反馈链路。
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 * 本脚本只读，不在数据库里创建用户。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9470)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-admin-shots'

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
await sleep(1000)

console.log('[2] 打开用户与角色面板')
// 顶栏用户区「用户」按钮（仅 canManageUsers 时显示）
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.user-chip button')].find(x=>/用户/.test(x.textContent));if(b)b.click();return 1})()`)
check('面板打开', await waitFor(page, `!!document.querySelector('.admin-panel')`, 40, 250))
// 进入新建用户表单
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.admin-panel .prop-link')].find(x=>/新建用户/.test(x.textContent));if(b)b.click();return 1})()`)
check('新建用户表单打开', await waitFor(page, `!!document.querySelector('.admin-form input[type="password"]')`, 40, 250))

console.log('[3] 保存失败反馈就在表单上方')
const before = await page.evaluate(`(()=>({
  feedback: !!document.querySelector('.admin-feedback'),
  save: [...document.querySelectorAll('.admin-actions button')].some(b=>/保存/.test(b.textContent))
}))()`)
check('保存按钮存在', before.save, JSON.stringify(before))
check('提交前无错误反馈', !before.feedback, JSON.stringify(before))

// 填一个合法用户名与口令；本地内存态会在服务端返回 400「需要持久化模式」。
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}
 const inputs=[...document.querySelectorAll('.admin-form input')]
 if(inputs[0])set(inputs[0],'e2e_user')
 if(inputs[1])set(inputs[1],'E2E User')
 if(inputs[2])set(inputs[2],'Test@12345')
 return inputs.length})()`)
await sleep(200)
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.admin-actions button')].find(x=>/保存/.test(x.textContent));if(b)b.click();return 1})()`)

check('面板内出现错误反馈', await waitFor(page, `!!document.querySelector('.admin-feedback.error')`, 60, 250))
const feedback = await page.evaluate(`(()=>{const e=document.querySelector('.admin-feedback.error');return e?e.textContent.trim():''})()`)
check('错误文案带出服务端原因（非裸 HTTP 400）',
  feedback.length > 0 && !/^HTTP\s*\d+$/.test(feedback) && /持久化|mysql|模式/.test(feedback), feedback)
console.log(`    反馈文本：${feedback}`)

const shot = await page.screenshot('save-user-feedback')
console.log(`    截图：${shot}`)

console.log('[4] 无 console error / 资源失败')
const realErrors = page.events.filter((e) => !/favicon/i.test(e))
check('无控制台错误 / 异常 / 加载失败', realErrors.length === 0, realErrors.slice(0, 5).join(' | '))

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
page.close()
process.exit(failed === 0 ? 0 : 1)
