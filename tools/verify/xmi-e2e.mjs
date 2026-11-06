/**
 * XMI 导入导出的浏览器级实测。
 *
 * 走真实 UI：登录 → 打开「文件」菜单 → 导出 XMI / 导出布局侧车 / 导出项目快照
 * → 打开「导入 XMI…」对话框 → 选文件 → 导入 → 撤销。
 *
 * 关键：Chrome 必须与本脚本在同一次 Bash 调用里启动，并带 --no-sandbox，
 * 否则沙箱内 Chrome 会因 GPU 进程不可用而自杀。
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
// 口令从环境变量传入，脚本与仓库里都不留明文。
const ADMIN_PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const PORT = Number(process.env.CDP_PORT ?? 9444)
const SHOTS = '/tmp/scofen-xmi-shots'
const TMP = '/tmp/scofen-xmi-files'

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
  await call('Network.enable')
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

/** 打开顶栏菜单并点击指定条目。菜单是开合切换，因此先确保当前是收起状态。 */
async function clickMenu(page, menuLabel, entryLabel) {
  await page.evaluate(`(()=>{
    // 若有菜单已展开，先收起，避免「点一下反而关掉」。
    const open=document.querySelector('.mb-drop');
    if(open){ document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); }
    return 1})()`)
  await sleep(350)
  await page.evaluate(`(()=>{
    const btn=[...document.querySelectorAll('.mb-btn')].find(b=>b.textContent.trim()==='${menuLabel}');
    if(!btn) throw new Error('未找到菜单 '+ '${menuLabel}');
    btn.click(); return 1})()`)
  await sleep(450)
  const ok = await page.evaluate(`(()=>{
    const item=[...document.querySelectorAll('.mb-entry-label')].find(e=>e.textContent.trim()==='${entryLabel}');
    if(!item) return false; item.closest('button').click(); return true})()`)
  await sleep(500)
  return ok
}

const page = await connect()
await page.goto(APP_URL)

// ── 登录 ──
console.log('[1] 登录')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),ADMIN_PASSWORD);
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
const loggedIn = await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250)
check('登录成功进入工作台', loggedIn)
await sleep(2500)

// ── 菜单入口存在性 ──
console.log('[2] 菜单入口')
await page.evaluate(`(()=>{
  const btn=[...document.querySelectorAll('.mb-btn')].find(b=>b.textContent.trim()==='文件');
  if(!btn) throw new Error('未找到「文件」菜单');
  btn.click(); return 1})()`)
await sleep(500)
const entries = await page.evaluate(`[...document.querySelectorAll('.mb-entry-label')].map(e=>e.textContent.trim())`)
check('文件菜单含「导入 XMI…」', entries.includes('导入 XMI…'), entries.join('|'))
check('文件菜单含「导出 XMI…」', entries.includes('导出 XMI…'), entries.join('|'))
check('文件菜单含「导出布局侧车…」', entries.includes('导出布局侧车…'), entries.join('|'))
check('文件菜单含「导出项目快照…」', entries.includes('导出项目快照…'), entries.join('|'))
await page.screenshot('01-menu')

// ── 导出：抓网络响应体 ──
console.log('[3] 导出')
// 直接走 API 更稳（导出走的是 fetch + blob 下载），先验 API 契约：
const apiGet = async (p) => await page.evaluate(`(async()=>{
  const r = await fetch('${p}', {headers:{'X-Scofen-Project':'project-vehicle','Authorization':'Bearer ' + localStorage.getItem('scofen.modeler.token')}});
  const t = await r.text();
  return {status:r.status, text:t};
})()`, true)

const xmiRes = await apiGet('api/exchange/xmi')
check('GET /api/exchange/xmi 200', xmiRes.status === 200, String(xmiRes.status))
check('导出含标准 XMI 根元素', xmiRes.text.includes('xmi:XMI'))
check('导出含 uml:Model', xmiRes.text.includes('uml:Model'))
check('导出含 scofen 扩展命名空间', xmiRes.text.includes('scofen:'))

const sidecarRes = await apiGet('api/exchange/xmi.di.json')
check('GET /api/exchange/xmi.di.json 200', sidecarRes.status === 200, String(sidecarRes.status))
check('侧车含 diagrams 与 notations', sidecarRes.text.includes('"diagrams"') && sidecarRes.text.includes('"notations"'))

const nativeRes = await apiGet('api/exchange/scofen.json')
check('GET /api/exchange/scofen.json 200', nativeRes.status === 200, String(nativeRes.status))

const previewRes = await apiGet('api/exchange/sidecar/preview')
check('侧车预览返回九图规格', previewRes.text.includes('"expectedKinds":9'), previewRes.text.slice(0, 200))

// ── 落盘导出文件，供导入用 ──
console.log('[4] 准备导入文件')
mkdirSync(TMP, { recursive: true })
writeFileSync(`${TMP}/model.xmi`, xmiRes.text, 'utf8')
writeFileSync(`${TMP}/model.di.json`, sidecarRes.text, 'utf8')
const before = await page.evaluate(`(async()=>{
  const r = await fetch('api/model', {headers:{'X-Scofen-Project':'project-vehicle','Authorization':'Bearer ' + localStorage.getItem('scofen.modeler.token')}});
  const m = await r.json();
  return {rev:m.revision, elements:m.elements.length, diagrams:m.diagrams.length, notations:m.notations.length};
})()`, true)
console.log('    导入前：', JSON.stringify(before))

// ── 导入对话框 ──
console.log('[5] 导入对话框')
await clickMenu(page, '文件', '导入 XMI…')
await sleep(600)
const dialogOpen = await page.evaluate(`!!document.querySelector('.modal-title') && document.querySelector('.modal-title').textContent.includes('导入')`)
check('「导入 XMI…」打开导入对话框', dialogOpen)
const fileInputs = await page.evaluate(`document.querySelectorAll('.modal input[type=file]').length`)
check('对话框有两个文件选择器（语义 + 侧车）', fileInputs === 2, String(fileInputs))
await page.screenshot('02-import-dialog')

// 通过 CDP DOM.setFileInputFiles 选文件
const { root } = await page.call('DOM.getDocument', { depth: -1 })
const { nodeIds } = await page.call('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.modal input[type=file]' })
check('取到两个文件输入节点', nodeIds.length === 2, JSON.stringify(nodeIds))
await page.call('DOM.setFileInputFiles', { files: [`${TMP}/model.xmi`], nodeId: nodeIds[0] })
await sleep(400)
await page.call('DOM.setFileInputFiles', { files: [`${TMP}/model.di.json`], nodeId: nodeIds[1] })
await sleep(600)
const picked = await page.evaluate(`[...document.querySelectorAll('.modal .hint')].map(e=>e.textContent.trim()).filter(t=>t.includes('model.'))`)
check('语义文件已选中', picked.some((t) => t.includes('model.xmi')), picked.join('|'))
check('侧车文件已选中', picked.some((t) => t.includes('model.di.json')), picked.join('|'))
await page.screenshot('03-import-files')

// 点「导入」
const clicked = await page.evaluate(`(()=>{
  const btn=[...document.querySelectorAll('.modal-actions button')].find(b=>b.textContent.trim()==='导入');
  if(!btn) return false; btn.click(); return true})()`)
check('点击「导入」按钮', clicked)
await sleep(3000)

const after = await page.evaluate(`(async()=>{
  const r = await fetch('api/model', {headers:{'X-Scofen-Project':'project-vehicle','Authorization':'Bearer ' + localStorage.getItem('scofen.modeler.token')}});
  const m = await r.json();
  return {rev:m.revision, elements:m.elements.length, diagrams:m.diagrams.length, notations:m.notations.length,
          hasRoot: m.elements.some(e=>e.id==='model-root'),
          hasExt: m.elements.some(e=>e.id==='ext-sysml')};
})()`, true)
console.log('    导入后：', JSON.stringify(after))
check('导入后 revision 前进', after.rev > before.rev, `${before.rev} → ${after.rev}`)
check('导入后元素数与导入前一致', after.elements === before.elements, `${before.elements} → ${after.elements}`)
check('导入后图数与导入前一致', after.diagrams === before.diagrams, `${before.diagrams} → ${after.diagrams}`)
check('导入后记号数与导入前一致', after.notations === before.notations, `${before.notations} → ${after.notations}`)
check('导入后项目根仍在', after.hasRoot)
check('导入后扩展包仍在', after.hasExt)
const dialogClosed = await page.evaluate(`!document.querySelector('.modal-title')`)
check('导入完成后对话框关闭', dialogClosed)
await page.screenshot('04-after-import')

// ── 撤销 ──
console.log('[6] 撤销')
await clickMenu(page, '编辑', '撤销')
await sleep(2500)
const undone = await page.evaluate(`(async()=>{
  const r = await fetch('api/model', {headers:{'X-Scofen-Project':'project-vehicle','Authorization':'Bearer ' + localStorage.getItem('scofen.modeler.token')}});
  const m = await r.json();
  return {rev:m.revision, elements:m.elements.length, diagrams:m.diagrams.length, notations:m.notations.length};
})()`, true)
console.log('    撤销后：', JSON.stringify(undone))
check('撤销后元素数回到导入前', undone.elements === before.elements, `${before.elements} → ${undone.elements}`)
check('撤销后图数回到导入前', undone.diagrams === before.diagrams, `${before.diagrams} → ${undone.diagrams}`)
await page.screenshot('05-after-undo')

// ── 无侧车导入 → 服务端重排九图 ──
console.log('[7] 无侧车导入（服务端重排）')
const importNoSidecar = await page.evaluate(`(async()=>{
  const res = await fetch('api/exchange/xmi', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Scofen-Project':'project-vehicle','X-Scofen-Session':'web-ui',
             'Authorization':'Bearer ' + localStorage.getItem('scofen.modeler.token')},
    body: JSON.stringify({semantic: ${JSON.stringify(xmiRes.text)}})
  });
  return {status: res.status, body: await res.text()};
})()`, true)
check('无侧车导入 200', importNoSidecar.status === 200, String(importNoSidecar.status))
await sleep(1200)
const relaid = await page.evaluate(`(async()=>{
  const r = await fetch('api/model', {headers:{'X-Scofen-Project':'project-vehicle','Authorization':'Bearer ' + localStorage.getItem('scofen.modeler.token')}});
  const m = await r.json();
  return {diagrams:m.diagrams.length, kinds:m.diagrams.map(d=>d.kind), notations:m.notations.length};
})()`, true)
console.log('    重排后：', JSON.stringify(relaid))
check('无侧车导入后服务端补齐九图', relaid.diagrams === 9, String(relaid.diagrams))
check('九图种类齐全', ['pkg','req','bdd','ibd','par','act','seq','stm','uc'].every((k) => relaid.kinds.includes(k)), relaid.kinds.join(','))
check('重排后生成了记号', relaid.notations > 0, String(relaid.notations))

// ── 撤销回干净基线 ──
await page.evaluate(`(async()=>{
  const r = await fetch('api/commands/undo', {method:'POST', headers:{'X-Scofen-Project':'project-vehicle','X-Scofen-Session':'web-ui','Authorization':'Bearer ' + localStorage.getItem('scofen.modeler.token')}});
  return r.status})()`, true)
await sleep(1200)

console.log(`\n[结果] PASS ${passed} / FAIL ${failed}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
