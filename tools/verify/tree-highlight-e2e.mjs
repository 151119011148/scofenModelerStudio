/**
 * 华望式「树上高亮」浏览器级实测：
 *   1) 属性框顶部对象头右键 → 菜单含「树上高亮」→ 点击后树行持久选中（不自动消隐）；
 *   2) 画布图形右键「树上高亮」→ 对应树行持久选中；
 *   3) 图对象右键、关系行右键各有「树上高亮」→ 树中对应行持久选中；
 *   4) 三态互斥：高亮另一对象后，前一个对象不再选中。
 *
 * 高亮即树的 .selected 持久态（华望 SelectOnTreeAction 语义），不再是 2.4s 黄色脉冲。
 * 灌数走 API（固定 id，可重入）。运行方式见 tools/verify/README.md：
 * Chrome 必须与本脚本在同一次 Bash 调用内启动，每脚本独立 --user-data-dir。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9472)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-tree-highlight-shots'

const IDS = {
  src: 'e2e-thl-src', tgt: 'e2e-thl-tgt',
  dgm: 'e2e-thl-dgm', rel: 'e2e-thl-rel',
}
const NAMES = {
  src: '树上高亮E2E·源', tgt: '树上高亮E2E·目标',
  dgm: '树上高亮E2E图',
}

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

/* ── 灌数：固定 id，可重入 ── */
async function seed() {
  const login = await fetch(`${APP_URL}api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'scofen', password: PASSWORD }),
  })
  if (!login.ok) throw new Error('灌数登录失败 HTTP ' + login.status)
  const auth = { Authorization: `Bearer ${(await login.json()).token}`, 'Content-Type': 'application/json', 'X-Scofen-Session': 'web-ui' }
  const model = await (await fetch(`${APP_URL}api/model`, { headers: auth })).json()
  const rootId = (model.elements ?? []).find((e) => !e.ownerId)?.id ?? 'model-root'
  let revision = model.revision
  const haveE = new Set((model.elements ?? []).map((e) => e.id))
  const haveD = new Set((model.diagrams ?? []).map((d) => d.id))
  const haveR = new Set((model.relationships ?? []).map((r) => r.id))
  let seq = 0
  const cmd = async (type, payload) => {
    const res = await fetch(`${APP_URL}api/commands`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ type, payload, baseRevision: revision, clientCmdId: `thl-e2e-${type}-${++seq}` }),
    })
    if (!res.ok) throw new Error(`${type} → HTTP ${res.status} ${JSON.stringify(await res.json().catch(() => ({}))).slice(0, 200)}`)
    revision = (await res.json()).revision
  }
  if (!haveE.has(IDS.src)) await cmd('CREATE_ELEMENT', { id: IDS.src, type: 'Class', name: NAMES.src, ownerId: rootId })
  if (!haveE.has(IDS.tgt)) await cmd('CREATE_ELEMENT', { id: IDS.tgt, type: 'Class', name: NAMES.tgt, ownerId: rootId })
  if (!haveD.has(IDS.dgm)) await cmd('CREATE_DIAGRAM', { id: IDS.dgm, kind: 'bdd', name: NAMES.dgm, ownerId: rootId, elementIds: [IDS.src, IDS.tgt] })
  if (!haveR.has(IDS.rel)) await cmd('CREATE_RELATIONSHIP', { id: IDS.rel, type: 'Association', sourceId: IDS.src, targetId: IDS.tgt })
}

/* 在指定元素上触发 contextmenu（传 DOM 元素选择器回调） */
const ctxExpr = (findJs) => `(()=>{const el=(${findJs});if(!el)return 0;
  const r=el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(r.x+r.width/2),clientY:Math.round(r.y+r.height/2)}));
  return 1})()`
const clickMenuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click(); 1`
const treeRowSelected = (attr, id) => `!!document.querySelector('.tree-row[${attr}=${JSON.stringify(id)}].selected')`

const page = await connect()
await seed()
await page.goto(APP_URL)

console.log('[1] 登录并选中源元素')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
// 登录表单存在重挂竞态：注入瞬间 input 可能短暂为 null，判空重试直到成功。
let loginInjected = false
for (let i = 0; i < 20 && !loginInjected; i++) {
  try {
    loginInjected = await page.evaluate(`(()=>{const q=(n)=>document.querySelector('input[name="scofen-admin-'+n+'"]');
      if(!q('username')||!q('password')) return false;
      const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set(q('username'),'scofen');
      set(q('password'),${JSON.stringify(PASSWORD)});
      [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent))?.click();return true})()`)
  } catch { /* 表单重挂中，重试 */ }
  if (!loginInjected) await sleep(250)
}
check('登录注入成功', loginInjected || await page.evaluate(`!!document.querySelector('.props-dock')`))
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1200)

const pickTreeRow = async (name) => {
  for (let i = 0; i < 60; i++) {
    const id = await page.evaluate(`(()=>{const row=[...document.querySelectorAll('.tree-row[data-tree-id]')]
      .find(r=>r.textContent.includes(${JSON.stringify(name)}));
      return row?row.getAttribute('data-tree-id'):null})()`)
    if (id) return id
    await sleep(300)
  }
  return null
}

const srcRow = await pickTreeRow(NAMES.src)
check('灌数源元素已出现在树上', srcRow === IDS.src, String(srcRow))
await page.evaluate(`(()=>{const r=[...document.querySelectorAll('.tree-row[data-tree-id]')]
  .find(x=>x.getAttribute('data-tree-id')===${JSON.stringify(IDS.src)});if(r)r.click();return 1})()`)
await waitFor(page, `document.querySelector('.props-object')?.textContent.includes(${JSON.stringify(NAMES.src)})`)

console.log('[2] 属性框对象头右键 → 树上高亮（持久）')
await page.evaluate(ctxExpr(`document.querySelector('.props-object')`))
check('对象头右键菜单出现且含树上高亮', await waitFor(page,
  `!!document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('树上高亮')`))
await page.evaluate(clickMenuItem('树上高亮'))
check('源元素树行选中', await waitFor(page, treeRowSelected('data-tree-id', IDS.src)))
await page.screenshot('01-props-head-highlight')
// 华望式持久：等超过旧实现的 2.4s 消隐窗口后仍应选中。
await sleep(2800)
check('3 秒后仍持久高亮（非 2.4s 脉冲）', await page.evaluate(treeRowSelected('data-tree-id', IDS.src)))

console.log('[3] 画布图形右键 → 树上高亮')
// 切到含源/目标的图，点选目标图形后右键。
await page.evaluate(`(()=>{const r=[...document.querySelectorAll('.tree-row[data-tree-id]')]
  .find(x=>x.getAttribute('data-tree-id')===${JSON.stringify(IDS.dgm)});if(r){r.click();r.click()}return !!r})()`)
await waitFor(page, `!!document.querySelector('.canvas svg [data-element-id=${JSON.stringify(IDS.tgt)}]')`, 60, 300)
await page.evaluate(ctxExpr(`document.querySelector('.canvas svg [data-element-id=${JSON.stringify(IDS.tgt)}]')`))
check('画布图形右键菜单含树上高亮', await waitFor(page,
  `!!document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('树上高亮')`))
await page.evaluate(clickMenuItem('树上高亮'))
check('目标元素树行选中（画布链路）', await waitFor(page, treeRowSelected('data-tree-id', IDS.tgt)))
check('互斥：源元素不再选中', await page.evaluate(`!document.querySelector('.tree-row[data-tree-id=${JSON.stringify(IDS.src)}].selected')`))
await page.screenshot('02-canvas-highlight')

console.log('[4] 图对象右键 → 树上高亮')
await page.evaluate(ctxExpr(`[...document.querySelectorAll('.tree-row[data-tree-id]')].find(r=>r.getAttribute('data-tree-id')===${JSON.stringify(IDS.dgm)})`))
check('图右键菜单含树上高亮', await waitFor(page,
  `!!document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('树上高亮')`))
await page.evaluate(clickMenuItem('树上高亮'))
check('图树行选中', await waitFor(page, treeRowSelected('data-tree-id', IDS.dgm)))
await page.screenshot('03-diagram-highlight')

console.log('[5] 关系行右键 → 树上高亮')
// 关系挂在源元素下；源元素行需展开才能看到关系行。
// 用 dispatchEvent 而非 HTMLElement.click()：无头 Chrome 里后者偶发不触发 React 的 onClick。
await page.evaluate(`(()=>{const r=document.querySelector('.tree-row[data-tree-id=${JSON.stringify(IDS.src)}]');
  const tw=r?.querySelector('.twisty');
  if(tw && tw.getAttribute('aria-expanded')!=='true'){tw.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))}
  return 1})()`)
await waitFor(page, `document.querySelector('.tree-row[data-tree-id=${JSON.stringify(IDS.src)}] .twisty')?.getAttribute('aria-expanded')==='true'`, 20, 200)
const relRowExists = await waitFor(page, `!!document.querySelector('[data-relation-id=${JSON.stringify(IDS.rel)}]')`, 40, 250)
check('关系行已渲染', relRowExists)
if (relRowExists) {
  await page.evaluate(ctxExpr(`document.querySelector('[data-relation-id=${JSON.stringify(IDS.rel)}]')`))
  check('关系右键菜单含树上高亮', await waitFor(page,
    `!!document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('树上高亮')`))
  const relMenuText = await page.evaluate(`document.querySelector('.context-menu')?.innerText||''`)
  check('右键菜单是关系菜单（含「查看关系属性」）', relMenuText.includes('查看关系属性'), relMenuText)
  await page.evaluate(clickMenuItem('树上高亮'))
  const afterMsg = await page.evaluate(`document.querySelector('.sb-message')?.textContent||''`)
  check('提示指向灌数关系（非样本同名关系）', afterMsg.includes('Association'), afterMsg)
  check('关系树行选中', await waitFor(page, treeRowSelected('data-relation-id', IDS.rel)))
  await page.screenshot('04-relation-highlight')
}

console.log('[5b] 画布已选中连线 / 属性栏正文右键 → 树上高亮')
const hitLine = `[...document.querySelectorAll('.canvas svg polyline')].find(n=>
  n.getAttribute('stroke-opacity')==='0' && n.getAttribute('stroke-width')==='12')`
await page.evaluate(ctxExpr(hitLine))
check('未选中时连线右键含树上高亮', await waitFor(page,
  `!!document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('树上高亮')`))
await page.evaluate(clickMenuItem('查看关系属性'))
check('关系属性面板已打开', await waitFor(page, `!!document.querySelector('.rel-endpoints')`, 30, 200))
// 选中后 14px 段拖拽手柄会盖住 12px 命中线：右键手柄也必须出菜单。
const handleLine = `[...document.querySelectorAll('.canvas svg polyline')].find(n=>
  n.getAttribute('stroke-opacity')==='0' && n.getAttribute('stroke-width')==='14')`
await page.evaluate(ctxExpr(handleLine))
check('已选中连线的线柄右键含树上高亮', await waitFor(page,
  `!!document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('树上高亮')`))
await page.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
await sleep(200)
// 属性栏正文（非对象头、非输入框）右键
await page.evaluate(`(()=>{const el=document.querySelector('.rel-tab-head')||document.querySelector('.rel-tab-group')||document.querySelector('.props-dock');
  const r=el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,
    clientX:Math.round(r.x+r.width/2),clientY:Math.round(r.y+r.height/2)}));return 1})()`)
check('属性栏正文右键含树上高亮', await waitFor(page,
  `!!document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('树上高亮')`))
await page.evaluate(clickMenuItem('树上高亮'))
check('属性栏右键后关系树行选中', await waitFor(page, treeRowSelected('data-relation-id', IDS.rel)))
await page.screenshot('05-diagram-relation-menu')

console.log('[6] 左栏筛选：滚动后按名称输入仍回到顶部命中')
await page.evaluate(`(()=>{const b=document.querySelector('.browser');
  if(b){b.scrollTop=b.scrollHeight;b.dispatchEvent(new Event('scroll',{bubbles:true}))}return 1})()`)
await sleep(500)
const scrolledBefore = await page.evaluate(`document.querySelector('.browser')?.scrollTop ?? 0`)
await page.evaluate(`(()=>{const i=document.querySelector('.browser-filter input');i.focus();i.select();return 1})()`)
for (const ch of '整车') {
  await page.call('Input.insertText', { text: ch })
  await sleep(250)
}
await sleep(600)
const filterProbe = await page.evaluate(`(()=>{const b=document.querySelector('.browser');
  const rows=[...document.querySelectorAll('.tree-row')];
  return {value:document.querySelector('.browser-filter input')?.value,top:b?.scrollTop,
    rows:rows.length,hasHit:rows.some(r=>/整车/.test(r.textContent))}})()`)
check('滚动后按名称筛选仍能命中且树回到顶部',
  scrolledBefore > 0 && filterProbe.value === '整车' && filterProbe.rows > 0
    && filterProbe.top === 0 && filterProbe.hasHit,
  JSON.stringify({ scrolledBefore, filterProbe }))
await page.evaluate(`(()=>{const b=document.querySelector('.browser-filter .clear-filter');b?.click();return 1})()`)

console.log('────────────')
console.log(`通过 ${passed} / ${passed + failed}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
