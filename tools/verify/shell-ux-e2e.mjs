/**
 * 外壳与树形态的五项回归（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 扩展包虚拟分组的层级与项目根一致（同级，不嵌在根节点下）
 *   2) 项目根节点可以折叠 / 展开（不再是常驻展开）
 *   3) 折叠三角是飞书同款蓝色实心三角，展开时旋转 90°
 *   4) 左侧两栏（模型树 / 工具箱）可拖拽改宽，宽度落 localStorage 且刷新后保持
 *   5) 空间项目列表支持删除项目：主示例项目受保护，删除当前项目会自动切换
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 * 本脚本唯一写入的数据是「E2E 删除用项目」，末尾一定删干净。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9448)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-shell-shots'

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

/** 用 CDP 真实鼠标事件拖动分隔条：pointerdown/move/up 由浏览器合成，和人工拖一致。 */
async function dragBy(page, selector, deltaX) {
  const box = await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
    if(!e) return null; const r=e.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}})()`)
  if (!box) return false
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(60)
  for (let step = 1; step <= 6; step++) {
    await page.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: box.x + Math.round((deltaX * step) / 6), y: box.y, button: 'left', buttons: 1,
    })
    await sleep(40)
  }
  await page.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x + deltaX, y: box.y, button: 'left', clickCount: 1,
  })
  await sleep(250)
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
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1800)

console.log('[2] 扩展包分组与项目根同级')
check('模型树出现项目根节点', await waitFor(page, `!!document.querySelector('.tree-row.root-node[data-tree-id]')`))
await page.evaluate(`(()=>{const t=document.querySelector('[data-tree-kind="ext-toggle"]');if(t&&t.getAttribute('aria-pressed')==='false') t.click();return 1})()`)
check('扩展包分组已显示', await waitFor(page, `!!document.querySelector('[data-tree-kind="extension-group"]')`, 60, 250))
const level = await page.evaluate(`(()=>{
  const root=document.querySelector('.tree-row.root-node[data-tree-id]');
  const group=document.querySelector('[data-tree-kind="extension-group"]');
  if(!root||!group) return null;
  const pad=(e)=>parseFloat(getComputedStyle(e).paddingLeft);
  return {
    rootPad:pad(root), groupPad:pad(group),
    insideRoot: root.parentElement.contains(group),
    rootId: root.getAttribute('data-tree-id'),
  }})()`)
check('扩展包分组缩进与项目根一致', !!level && Math.abs(level.rootPad - level.groupPad) <= 1, JSON.stringify(level))
check('扩展包分组不在项目根子树内', !!level && level.insideRoot === false)
await page.screenshot('01-extensions-same-level')

console.log('[3] 项目根可折叠 + 蓝色三角')
const triangle = await page.evaluate(`(()=>{
  const root=document.querySelector('.tree-row.root-node[data-tree-id]');
  const btn=root && root.querySelector('.twisty');
  const tri=btn && btn.querySelector('.tri');
  if(!tri) return null;
  const cs=getComputedStyle(tri);
  return {color:cs.borderLeftColor, transform:cs.transform, expanded:btn.getAttribute('aria-expanded')}})()`)
check('项目根有折叠三角', !!triangle)
check('三角为飞书蓝 rgb(51, 112, 255)', !!triangle && triangle.color === 'rgb(51, 112, 255)', triangle && triangle.color)
check('展开态三角旋转 90°', !!triangle && triangle.transform !== 'none' && /matrix/.test(triangle.transform), triangle && triangle.transform)
const before = await page.evaluate(`document.querySelectorAll('.tree-row[data-tree-id]').length`)
await page.evaluate(`(()=>{const r=document.querySelector('.tree-row.root-node[data-tree-id] .twisty');r.click();return 1})()`)
const collapsed = await waitFor(page, `document.querySelectorAll('.tree-row[data-tree-id]').length < ${before}`, 40, 200)
check('点击后项目根子树收起', collapsed, `before=${before}`)
const collapsedState = await page.evaluate(`(()=>{const b=document.querySelector('.tree-row.root-node[data-tree-id] .twisty');
  return {expanded:b.getAttribute('aria-expanded'), transform:getComputedStyle(b.querySelector('.tri')).transform}})()`)
// 三角有 130ms 过渡：等它转完再读，否则拿到的是过渡起点的 rotate(90deg)。
await sleep(320)
const settledState = await page.evaluate(`(()=>{const b=document.querySelector('.tree-row.root-node[data-tree-id] .twisty');
  return {expanded:b.getAttribute('aria-expanded'), transform:getComputedStyle(b.querySelector('.tri')).transform}})()`)
check('收起后 aria-expanded=false', collapsedState.expanded === 'false')
check('收起态三角回到 0°', settledState.transform === 'none' || settledState.transform === 'matrix(1, 0, 0, 1, 0, 0)', settledState.transform)
await page.screenshot('02-root-collapsed')
await page.evaluate(`(()=>{document.querySelector('.tree-row.root-node[data-tree-id] .twisty').click();return 1})()`)
check('再次点击恢复展开', await waitFor(page, `document.querySelectorAll('.tree-row[data-tree-id]').length >= ${before}`, 40, 200))

console.log('[4] 左栏 / 工具箱拖拽改宽')
const beforeWidth = await page.evaluate(`Math.round(document.querySelector('.left-dock').getBoundingClientRect().width)`)
check('存在左栏拖拽手柄', await page.evaluate(`!!document.querySelector('[data-dock-resizer="left"]')`))
await dragBy(page, '[data-dock-resizer="left"]', 70)
const afterWidth = await page.evaluate(`Math.round(document.querySelector('.left-dock').getBoundingClientRect().width)`)
check('左栏拖宽生效', afterWidth - beforeWidth >= 55, `${beforeWidth} → ${afterWidth}`)
check('左栏宽度已落 localStorage', await page.evaluate(`Math.abs(Number(localStorage.getItem('scofen.modeler.dock.left')) - ${afterWidth}) <= 2`))
const toolBefore = await page.evaluate(`Math.round(document.querySelector('.toolbox').getBoundingClientRect().width)`)
await dragBy(page, '[data-dock-resizer="tool"]', 50)
const toolAfter = await page.evaluate(`Math.round(document.querySelector('.toolbox').getBoundingClientRect().width)`)
check('工具箱拖宽生效', toolAfter - toolBefore >= 35, `${toolBefore} → ${toolAfter}`)
await page.screenshot('03-dock-resized')
await page.goto(APP_URL)
check('刷新后左栏宽度保持', await waitFor(page, `Math.abs(Math.round(document.querySelector('.left-dock').getBoundingClientRect().width) - ${afterWidth}) <= 3`, 60, 250))
check('刷新后工具箱宽度保持', await page.evaluate(`Math.abs(Math.round(document.querySelector('.toolbox').getBoundingClientRect().width) - ${toolAfter}) <= 3`))
// 复位，避免把测试用的宽窄留给后续 E2E
await page.evaluate(`(()=>{localStorage.setItem('scofen.modeler.dock.left','268');localStorage.setItem('scofen.modeler.dock.tool','198');return 1})()`)

console.log('[5] 空间项目列表删除')
const H = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token'),
  'Content-Type':'application/json','X-Scofen-Session':'web-ui',
  'X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'}`
const created = await page.evaluate(`(async()=>{
  const r=await fetch('api/workspaces/projects',{method:'POST',headers:${H},body:JSON.stringify({
    spaceCode:'personal',name:'E2E 删除验证项目',description:'验证删除链路，用完即删'})});
  return {status:r.status, body:await r.json()}})()`, true)
check('新建待删项目成功', created.status === 200 && !!created.body.id, JSON.stringify(created)[0])
const projectId = created.body.id
await page.evaluate(`location.reload()`)
await waitFor(page, `!!document.querySelector('.project-switch')`, 120, 250)
await sleep(1600)
await page.evaluate(`document.querySelector('.project-switch').click()`)
check('项目选择器打开', await waitFor(page, `!!document.querySelector('.project-popover')`, 40, 200))
check('主示例项目没有删除按钮', await page.evaluate(`!document.querySelector('[data-project-delete="project-vehicle"]')`))
check('待删项目行有删除按钮', await waitFor(page, `!!document.querySelector('[data-project-delete="${projectId}"]')`, 40, 200))
// 先打开它，验证「删除当前项目后自动切换」
await page.evaluate(`(()=>{const b=document.querySelector('.pp-project[title*="E2E 删除验证项目"]'); if(b) b.click(); return !!b})()`)
check('已切换到待删项目', await waitFor(page, `/E2E 删除验证项目/.test(document.querySelector('.project-switch').textContent)`, 60, 250))
await page.evaluate(`document.querySelector('.project-switch').click()`)
await waitFor(page, `!!document.querySelector('.project-popover')`, 40, 200)
await page.evaluate(`document.querySelector('[data-project-delete="${projectId}"]').click()`)
check('删除确认弹框出现', await waitFor(page, `!!document.querySelector('[data-confirm="delete-project"]')`, 40, 200))
await page.evaluate(`document.querySelector('[data-confirm="delete-project"]').click()`)
const gone = await waitFor(page, `!/E2E 删除验证项目/.test(document.querySelector('.project-popover').textContent)`, 80, 250)
check('项目从列表消失', gone)
check('删除当前项目后自动切走', await waitFor(page, `!/E2E 删除验证项目/.test(document.querySelector('.project-switch').textContent)`, 80, 250))
const leftover = await page.evaluate(`(async()=>{
  const m=await (await fetch('api/workspaces',{headers:${H}})).json();
  return JSON.stringify(m).includes('E2E 删除验证项目')})()`, true)
check('服务端目录已无该项目', leftover === false)
await page.screenshot('04-project-deleted')

console.log('[6] 空间抽屉里的项目列表同样支持删除')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.project-popover button')].find(x=>/完整面板/.test(x.textContent)); if(b) b.click(); return !!b})()`)
check('空间抽屉打开', await waitFor(page, `!!document.querySelector('.space-drawer')`, 40, 200))
await page.evaluate(`(()=>{[...document.querySelectorAll('.space-group-head')].forEach(h=>{if(!h.classList.contains('open')) h.click()}); return 1})()`)
await sleep(300)
check('抽屉里主示例项目没有删除按钮', await page.evaluate(`!document.querySelector('.space-drawer [data-project-delete="project-vehicle"]')`))
check('抽屉里其它项目都有删除按钮', await page.evaluate(`document.querySelectorAll('.space-drawer [data-project-delete]').length >= 4`))
await page.screenshot('05-space-drawer')

// 兜底清理：万一中途失败，直接把残项删掉
await page.evaluate(`(async()=>{await fetch('api/workspaces/projects/${projectId}',{method:'DELETE',headers:${H}})})()`, true)

console.log(`\n结果：${passed} PASS / ${failed} FAIL，截图在 ${SHOTS}/`)
page.close()
process.exit(failed === 0 ? 0 : 1)
