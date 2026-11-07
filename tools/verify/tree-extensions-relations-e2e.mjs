/**
 * 模型树两项改造的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 模型搜索栏右侧「扩展包显示 / 隐藏」开关；UML / SysML 扩展包与项目隔离、
 *      但以内嵌虚拟分组展示；项目元素计数与筛选都不含扩展包。
 *   2) 关系不再全局平铺，而是挂到「关系」虚拟节点下，父 id 为关系端点的元素；
 *      单向关系只挂源端一方，双向关系同时挂两端。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 * 双向关系是本脚本唯一写入的数据，末尾用 DELETE_RELATIONSHIP 清理。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9448)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-tree-shots'

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

/** 截图前把目标虚拟节点滚进模型树视口，避免关键行被视口截断。 */
const scrollToExpr = (selector) => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});
  if(e) e.scrollIntoView({block:'center'}); return !!e})()`

const H = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token'),
  'Content-Type':'application/json','X-Scofen-Session':'web-ui',
  'X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'}`

/** 直接走命令接口创建 / 删除关系，baseRevision 每次实时取，避免 409。 */
const commandExpr = (type, payload) => `(async()=>{
  const h=${H};
  const m=await (await fetch('api/model',{headers:h})).json();
  const r=await fetch('api/commands',{method:'POST',headers:h,body:JSON.stringify({
    type:${JSON.stringify(type)},payload:${JSON.stringify(payload)},
    baseRevision:m.revision,clientCmdId:'e2e-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)
  })});
  return {status:r.status,body:await r.text()};
})()`

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1600)

console.log('[2] 扩展包显示 / 隐藏开关（隔离 + 内嵌）')
check('搜索栏右侧有扩展包切换按钮', await waitFor(page, `!!document.querySelector('[data-tree-kind="ext-toggle"]')`))
check('切换按钮位于搜索输入之后', await page.evaluate(`(()=>{const f=document.querySelector('.browser-filter');
  if(!f) return false; const kids=[...f.children]; const i=kids.findIndex(e=>e.tagName==='INPUT');
  const t=kids.findIndex(e=>e.dataset.treeKind==='ext-toggle'); return i>=0 && t>i})()`))
check('默认隐藏扩展包', await page.evaluate(`document.querySelectorAll('[data-tree-kind="extension-group"]').length===0`))
check('按钮初始 aria-pressed=false', await page.evaluate(`document.querySelector('[data-tree-kind="ext-toggle"]').getAttribute('aria-pressed')==='false'`))

const counts = await page.evaluate(`(async()=>{
  const h=${H};
  const m=await (await fetch('api/model',{headers:h})).json();
  const x=await (await fetch('api/metamodel/extension',{headers:h})).json();
  return {total:m.elements.length, ext:(x.elements||[]).length,
    shown:Number(document.querySelector('.tree-head-count').textContent.trim()),
    packages:(x.packages||[]).length};
})()`, true)
check('元模型目录独立下发扩展包定义', counts.ext > 100, JSON.stringify(counts))
check('项目元素计数排除隔离的扩展包', counts.shown === counts.total - counts.ext, JSON.stringify(counts))
check('扩展包目录为 UML + SysML 两个 Profile 起头', counts.packages >= 2, JSON.stringify(counts))

await page.evaluate(`document.querySelector('[data-tree-kind="ext-toggle"]').click()`)
check('开关切换为按下态', await waitFor(page, `document.querySelector('[data-tree-kind="ext-toggle"]').getAttribute('aria-pressed')==='true'`))
check('项目树内嵌出现「扩展包」虚拟分组', await waitFor(page, `!!document.querySelector('[data-tree-kind="extension-group"]')`))
check('虚拟分组带「系统 · 隔离」标识', await page.evaluate(`/系统|System/.test(document.querySelector('[data-tree-kind="extension-group"]').textContent)`))
await page.evaluate(`document.querySelector('[data-tree-kind="extension-group"]').click()`)
check('展开后列出两个顶层扩展包', await waitFor(page, `document.querySelectorAll('[data-tree-kind="extension-element"]').length>=2`))
const pkgNames = await page.evaluate(`[...document.querySelectorAll('[data-tree-kind="extension-element"]')].map(e=>e.textContent.trim())`)
check('包含 UML 与 SysML 扩展包', pkgNames.some((n) => n.includes('UML')) && pkgNames.some((n) => n.includes('SysML')), pkgNames.join(' | '))
check('扩展包元素未混入项目树普通行', await page.evaluate(`(()=>{
  const ids=[...document.querySelectorAll('[data-tree-kind="extension-element"]')].map(e=>e.getAttribute('data-element-id'));
  return ids.includes('ext-sysml') && !document.querySelector('.tree-row[data-tree-id="ext-sysml"]:not(.virtual-group)');
})()`))
await page.evaluate(`(()=>{const r=[...document.querySelectorAll('[data-tree-kind="extension-element"]')]
  .find(e=>e.getAttribute('data-element-id')==='ext-sysml'); if(r) r.click(); return 1})()`)
check('扩展包内可继续展开元类 / 构造型', await waitFor(page, `document.querySelectorAll('[data-tree-kind="extension-element"]').length>2`))
const extIds = await page.evaluate(`[...document.querySelectorAll('[data-tree-kind="extension-element"]')].map(e=>e.getAttribute('data-element-id'))`)
check('子项来自静态目录（mc- / st- id）', extIds.some((id) => /^(mc-|st-|ext-sysml-)/.test(id)), extIds.slice(0, 8).join(','))
await page.evaluate(scrollToExpr('[data-tree-kind="extension-group"]'))
await sleep(220)
await page.screenshot('01-extensions-visible')

await page.evaluate(`document.querySelector('[data-tree-kind="ext-toggle"]').click()`)
check('隐藏后虚拟分组与子树全部消失', await waitFor(page, `document.querySelectorAll('[data-tree-kind="extension-group"],[data-tree-kind="extension-element"]').length===0`))
await page.goto(APP_URL)
check('刷新后偏好持久化（仍隐藏）', await waitFor(page,
  `!!document.querySelector('[data-tree-kind="ext-toggle"]') && document.querySelector('[data-tree-kind="ext-toggle"]').getAttribute('aria-pressed')==='false'`, 60, 250))

console.log('[3] 关系虚拟节点：单向挂一方、双向挂两方')
const relCatalog = await page.evaluate(`(async()=>{const h=${H};
  return await (await fetch('api/metamodel/relationships',{headers:h})).json()})()`, true)
check('关系目录由服务端下发 directed 方向标记',
  relCatalog.length > 20 && relCatalog.every((r) => typeof r.directed === 'boolean'),
  `目录 ${relCatalog.length} 项`)
check('association 标为双向、satisfy 标为单向',
  relCatalog.find((r) => r.code === 'association')?.directed === false
  && relCatalog.find((r) => r.code === 'satisfy')?.directed === true)
check('旧的全局平铺关系节点已移除', await page.evaluate(`!document.querySelector('.relation-toggle') && !document.querySelector('.relation-list')`))
check('按端点生成了「关系」虚拟节点', await waitFor(page, `document.querySelectorAll('[data-tree-kind="relation-group"]').length>=2`, 60, 250))
const groups = await page.evaluate(`[...document.querySelectorAll('[data-tree-kind="relation-group"]')].map(e=>e.getAttribute('data-owner-id'))`)
check('虚拟节点父 id 是关系端点的元素', groups.includes('e-vcu') && groups.includes('tc-range'), groups.join(','))
check('satisfy（单向）只挂在源端 e-vcu', await page.evaluate(`(()=>{
  const rows=[...document.querySelectorAll('[data-tree-kind="relation"][data-relation-id="rel-1"]')];
  return rows.length===1 && rows[0].getAttribute('data-owner-id')==='e-vcu' && rows[0].getAttribute('data-direction')==='out';
})()`))
check('satisfy 不挂在目标端 r-range', await page.evaluate(`!document.querySelector('[data-tree-kind="relation"][data-relation-id="rel-1"][data-owner-id="r-range"]')`))
check('verify（单向）只挂在源端 tc-range', await page.evaluate(`(()=>{
  const rows=[...document.querySelectorAll('[data-tree-kind="relation"][data-relation-id="rel-2"]')];
  return rows.length===1 && rows[0].getAttribute('data-owner-id')==='tc-range';
})()`))
check('关系行显示对端名称', await page.evaluate(`/续航里程/.test(document.querySelector('[data-tree-kind="relation"][data-relation-id="rel-1"]').textContent)`))
await page.evaluate(`document.querySelector('[data-tree-kind="relation"][data-relation-id="rel-1"]').click()`)
check('点击关系行可选中并进入属性窗口', await waitFor(page,
  `!!document.querySelector('[data-tree-kind="relation"][data-relation-id="rel-1"].selected') && /satisfy|满足/.test(document.querySelector('.props-object').textContent)`, 40, 250))
await page.evaluate(`document.querySelector('[data-tree-kind="relation-group"][data-owner-id="tc-range"] .twisty').click()`)
check('关系虚拟节点可折叠', await waitFor(page, `!document.querySelector('[data-tree-kind="relation"][data-relation-id="rel-2"]')`, 40, 250))
await page.evaluate(`document.querySelector('[data-tree-kind="relation-group"][data-owner-id="tc-range"] .twisty').click()`)
check('关系虚拟节点可再次展开', await waitFor(page, `!!document.querySelector('[data-tree-kind="relation"][data-relation-id="rel-2"]')`, 40, 250))
await page.evaluate(scrollToExpr('[data-tree-kind="relation-group"][data-owner-id="e-vcu"]'))
await sleep(220)
await page.screenshot('02-relation-groups')

console.log('[4] 双向关系两端都挂载（写入后清理）')
const biId = `rel-e2e-bi-${Date.now()}`
const created = await page.evaluate(commandExpr('CREATE_RELATIONSHIP', {
  id: biId, type: 'association', sourceId: 'e-vcu', targetId: 'e-bat',
}), true)
check('创建双向 association 成功', created.status === 200, JSON.stringify(created).slice(0, 300))
if (created.status === 200) {
  check('双向关系在两端各出现一次', await waitFor(page,
    `document.querySelectorAll('[data-tree-kind="relation"][data-relation-id="${biId}"]').length===2`, 60, 250))
  const mounts = await page.evaluate(`[...document.querySelectorAll('[data-tree-kind="relation"][data-relation-id="${biId}"]')]
    .map(e=>({owner:e.getAttribute('data-owner-id'),direction:e.getAttribute('data-direction')}))`)
  check('挂载点正好是源端 e-vcu 与目标端 e-bat',
    mounts.some((m) => m.owner === 'e-vcu') && mounts.some((m) => m.owner === 'e-bat'), JSON.stringify(mounts))
  check('两端方向标记均为 both', mounts.length === 2 && mounts.every((m) => m.direction === 'both'), JSON.stringify(mounts))
  await page.evaluate(scrollToExpr('[data-tree-kind="relation-group"][data-owner-id="e-vcu"]'))
  await sleep(220)
  await page.screenshot('03-bidirectional-source')
  await page.evaluate(scrollToExpr('[data-tree-kind="relation-group"][data-owner-id="e-bat"]'))
  await sleep(220)
  await page.screenshot('04-bidirectional-target')
}
const removed = await page.evaluate(commandExpr('DELETE_RELATIONSHIP', { id: biId }), true)
check('清理双向关系成功', removed.status === 200, JSON.stringify(removed).slice(0, 300))
check('清理后关系行从两端消失', await waitFor(page,
  `document.querySelectorAll('[data-tree-kind="relation"][data-relation-id="${biId}"]').length===0`, 60, 250))
const finalModel = await page.evaluate(`(async()=>{const h=${H};return await (await fetch('api/model',{headers:h})).json()})()`, true)
check('线上模型无 E2E 残留关系', !finalModel.relationships.some((r) => r.id.startsWith('rel-e2e-')),
  finalModel.relationships.map((r) => r.id).join(','))

console.log(`\n结果：${passed} PASS / ${failed} FAIL，截图在 ${SHOTS}/`)
await page.close()
process.exit(failed === 0 ? 0 : 1)
