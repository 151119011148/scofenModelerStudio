/**
 * 属性面板「模型引用」右键菜单的浏览器级实测：
 *   1) 引用卡片右键出现「树上高亮 / 画上高亮 / 移除」三项；
 *   2) 目标元素已入图：点「画上高亮」切到所在图、选中并居中；
 *   3) 目标元素离图：「画上高亮」置灰并给出提示，树上高亮仍可用。
 *   4) 派生所有者、拥有的元素同样支持定位，并按目标逐项操作。
 *
 * 灌数走 API（Class 引用 Block，Block 在 bdd 图上），可重入：固定 id，已存在则跳过。
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9468)
const USERNAME = process.env.SCOFEN_USERNAME ?? 'scofen'
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = process.env.SCOFEN_VERIFY_SHOTS ?? '/tmp/scofen-ref-shots'

const IDS = { cls: 'e2e-ref-cls', blk: 'e2e-ref-blk', blk2: 'e2e-ref-blk2', dgm: 'e2e-ref-dgm' }
const NAMES = { cls: '引用高亮E2E·类', blk: '引用高亮E2E·块', blk2: '引用高亮E2E·离图块', dgm: '引用高亮E2E图' }

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

const setInputExpr = (selector, value) => `(()=>{const el=document.querySelector(${JSON.stringify(selector)});
  if(!el) return 0;
  const setter=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;
  setter.call(el,${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  return 1})()`

const setSelectExpr = (selector, value) => `(()=>{const el=document.querySelector(${JSON.stringify(selector)});
  if(!el) return 0;
  const setter=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;
  setter.call(el,${JSON.stringify(value)});
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return 1})()`

const authHeaders = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token')}`
const snapshotExpr = `(async()=>{const r=await fetch('api/model',{headers:${authHeaders}});return await r.json()})()`

/* ── 灌数：固定 id，可重入 ── */
async function seed() {
  const login = await fetch(`${APP_URL}api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })
  if (!login.ok) throw new Error('灌数登录失败 HTTP ' + login.status)
  const auth = { Authorization: `Bearer ${(await login.json()).token}`, 'Content-Type': 'application/json', 'X-Scofen-Session': 'web-ui' }
  const model = await (await fetch(`${APP_URL}api/model`, { headers: auth })).json()
  const rootId = (model.elements ?? []).find((e) => !e.ownerId)?.id ?? 'model-root'
  let revision = model.revision
  const have = new Set((model.elements ?? []).map((e) => e.id))
  const diagrams = new Set((model.diagrams ?? []).map((d) => d.id))
  let seq = 0
  const cmd = async (type, payload) => {
    const res = await fetch(`${APP_URL}api/commands`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ type, payload, baseRevision: revision, clientCmdId: `ref-e2e-${type}-${++seq}` }),
    })
    if (!res.ok) throw new Error(`${type} → HTTP ${res.status} ${JSON.stringify(await res.json().catch(() => ({}))).slice(0, 200)}`)
    revision = (await res.json()).revision
  }
  if (!have.has(IDS.cls)) await cmd('CREATE_ELEMENT', { id: IDS.cls, type: 'Class', name: NAMES.cls, ownerId: rootId })
  if (!have.has(IDS.blk)) await cmd('CREATE_ELEMENT', { id: IDS.blk, type: 'Block', name: NAMES.blk, ownerId: rootId })
  if (!have.has(IDS.blk2)) await cmd('CREATE_ELEMENT', { id: IDS.blk2, type: 'Block', name: NAMES.blk2, ownerId: rootId })
  if (!diagrams.has(IDS.dgm)) {
    await cmd('CREATE_DIAGRAM', { id: IDS.dgm, kind: 'bdd', name: NAMES.dgm, ownerId: rootId, elementIds: [IDS.blk] })
  }
  for (const [key, target] of [['classifierBehavior', IDS.blk], ['representation', IDS.blk2]]) {
    const current = (model.elements.find((e) => e.id === IDS.cls)?.properties ?? {})[key]
    if (current !== target) {
      await cmd('UPDATE_PROPERTY', { id: IDS.cls, key, value: target })
    }
  }
  return rootId
}

const page = await connect()
const rootId = await seed()
await page.goto(APP_URL)

console.log('[1] 登录并选中引用方元素')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),${JSON.stringify(USERNAME)});
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1200)
// 模型树是异步填充的：项目里元素多了（预置扩展图库 16 条模板也在树里），
// 登录后一小会儿只有根节点一行。固定 sleep 会偶发扑空，必须轮询等目标行出现。
const clsId = await (async () => {
  for (let i = 0; i < 60; i++) {
    const id = await page.evaluate(`(()=>{const row=[...document.querySelectorAll('.tree-row[data-tree-id]')]
      .find(r=>r.textContent.includes(${JSON.stringify(NAMES.cls)}));
      return row?row.getAttribute('data-tree-id'):null})()`)
    if (id) return id
    await sleep(300)
  }
  return null
})()
check('选中引用方元素', clsId === IDS.cls, String(clsId))
if (clsId) {
  await page.evaluate(`(()=>{const row=[...document.querySelectorAll('.tree-row[data-tree-id]')]
    .find(r=>r.getAttribute('data-tree-id')===${JSON.stringify(IDS.cls)}); if(row) row.click(); return !!row})()`)
}
await waitFor(page, `!!document.querySelector('.props-dock .prop-toolbar')`)
await page.evaluate(setSelectExpr('.prop-view-select', 'ALL'))
await sleep(300)

console.log('[2] 引用卡片渲染 + 右键菜单三项')
await waitFor(page, `!!document.querySelector('.prop-search-row input') || !!document.querySelector('.prop-tool')`)
if (!await page.evaluate(`!!document.querySelector('.prop-search-row input')`)) {
  await page.evaluate(`document.querySelectorAll('.prop-tool')[0].click()`)
  await waitFor(page, `!!document.querySelector('.prop-search-row input')`)
}
await page.evaluate(setInputExpr('.prop-search-row input', 'classifierBehavior'))
await sleep(300)
check('搜索命中 classifierBehavior 行', await waitFor(page, `!!document.querySelector('.prop-row[data-prop-key="classifierBehavior"]')`))
check('引用卡片显示目标名', await page.evaluate(
  `[...document.querySelectorAll('.prop-row[data-prop-key="classifierBehavior"] .prop-ref-card')].some(c=>c.textContent.includes(${JSON.stringify(NAMES.blk)}))`))
await page.evaluate(`(()=>{
  const card=document.querySelector('.prop-row[data-prop-key="classifierBehavior"] .prop-ref-card');
  const r=card.getBoundingClientRect();
  card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(r.x+r.width/2),clientY:Math.round(r.y+r.height/2)}));
  return 1})()`)
check('右键菜单出现且标题为目标元素', await waitFor(page,
  `!!document.querySelector('.context-menu') && document.querySelector('.context-menu .menu-title').textContent.includes(${JSON.stringify(NAMES.blk)})`))
const menuText = await page.evaluate(`document.querySelector('.context-menu').innerText`)
check('菜单含「树上高亮」', menuText.includes('树上高亮'), JSON.stringify(menuText))
check('菜单含「画上高亮」', menuText.includes('画上高亮'), JSON.stringify(menuText))
check('菜单含「移除」', menuText.includes('移除'), JSON.stringify(menuText))
await page.screenshot('01-ref-menu')

console.log('[3] 目标已入图：点「画上高亮」切图 + 选中 + 居中')
await page.evaluate(`[...document.querySelectorAll('.context-menu button')]
  .find(b=>b.textContent.trim()==='画上高亮').click(); 1`)
check('菜单已关闭', await waitFor(page, `!document.querySelector('.context-menu')`))
check('切到目标所在图（活动标签）', await waitFor(page,
  `(()=>{const t=document.querySelector('.doc-tab.active .doc-tab-label');
  return !!t && t.textContent.includes(${JSON.stringify(NAMES.dgm)})})()`))
check('画布渲染出目标节点', await waitFor(page,
  `!!document.querySelector('.canvas .node[data-element-id="${IDS.blk}"]')`))
check('目标节点为选中态（状态栏）', await waitFor(page,
  `document.querySelector('.sb-selected')?.textContent.includes(${JSON.stringify(NAMES.blk)})`))
check('目标节点大致居中于画布视口', await page.evaluate(`(()=>{
  const canvas=document.querySelector('.canvas'), node=document.querySelector('.canvas .node[data-element-id="${IDS.blk}"]');
  if(!canvas||!node) return false;
  const c=canvas.getBoundingClientRect(), n=node.getBoundingClientRect();
  const cx=(n.x+n.width/2-c.x), cy=(n.y+n.height/2-c.y);
  return cx>0&&cx<c.width&&cy>0&&cy<c.height
    && Math.abs(cx-c.width/2)<c.width*0.35 && Math.abs(cy-c.height/2)<c.height*0.35})()`))
await page.screenshot('02-located-on-canvas')

console.log('[4] 离图引用：画上高亮置灰，树上高亮可用')
// [3] 的「画上高亮」把选中切到了目标元素，这里重新选回引用方类再查 representation。
await page.evaluate(`(()=>{
  const row=[...document.querySelectorAll('.tree-row[data-tree-id]')].find(r=>r.getAttribute('data-tree-id')==='e2e-ref-cls');
  if(row) row.click(); return 1})()`)
await waitFor(page, `document.querySelector('.sb-selected')?.textContent.includes(${JSON.stringify(NAMES.cls)})`)
await sleep(400)
await page.evaluate(setSelectExpr('.prop-view-select', 'ALL'))
await sleep(300)
if (!await page.evaluate(`!!document.querySelector('.prop-search-row input')`)) {
  await page.evaluate(`document.querySelectorAll('.prop-tool')[0].click()`)
  await waitFor(page, `!!document.querySelector('.prop-search-row input')`)
}
await page.evaluate(setInputExpr('.prop-search-row input', 'representation'))
await sleep(300)
check('representation 行引用卡片显示离图块', await waitFor(page,
  `[...document.querySelectorAll('.prop-row[data-prop-key="representation"] .prop-ref-card')].some(c=>c.textContent.includes(${JSON.stringify(NAMES.blk2)}))`))
await page.evaluate(`(()=>{
  const card=document.querySelector('.prop-row[data-prop-key="representation"] .prop-ref-card');
  const r=card.getBoundingClientRect();
  card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(r.x+r.width/2),clientY:Math.round(r.y+r.height/2)}));
  return 1})()`)
check('离图引用菜单出现', await waitFor(page, `!!document.querySelector('.context-menu')`))
check('离图时「画上高亮」置灰且带提示', await page.evaluate(`(()=>{
  const b=[...document.querySelectorAll('.context-menu button')].find(x=>x.textContent.trim()==='画上高亮');
  return !!b && b.disabled && (b.title||'').includes('尚未加入任何图')})()`))
await page.evaluate(`[...document.querySelectorAll('.context-menu button')]
  .find(b=>b.textContent.trim()==='树上高亮').click(); 1`)
check('树上高亮仍可用（状态栏选中离图块）', await waitFor(page,
  `document.querySelector('.sb-selected')?.textContent.includes(${JSON.stringify(NAMES.blk2)})`))
check('树上高亮后未切图（活动标签不变）', await page.evaluate(
  `(()=>{const t=document.querySelector('.doc-tab.active .doc-tab-label');
  return !!t && t.textContent.includes(${JSON.stringify(NAMES.dgm)})})()`))
await page.screenshot('03-off-diagram-disabled')

console.log('[5] 派生所有者与拥有的元素支持逐项定位')
const cardSelector = (key, id) => `.prop-row[data-prop-key="${key}"] .prop-ref-card[data-reference-id="${id}"]`
const openReference = async (selector) => {
  await page.evaluate(`(()=>{
    const card=document.querySelector(${JSON.stringify(selector)});
    if(!card) return false;
    const r=card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left,clientY:r.top}));
    return true;
  })()`)
  return waitFor(page, `!!document.querySelector('.context-menu.reference-menu')`)
}
const clickTreeHighlight = () => page.evaluate(`[...document.querySelectorAll('.context-menu button')]
  .find(b=>b.textContent.trim()==='树上高亮')?.click()`)
await page.evaluate(setInputExpr('.prop-search-row input', 'owner'))
const ownerSelector = cardSelector('owner', rootId)
check('派生所有者显示真实对象', await waitFor(page, `!!document.querySelector(${JSON.stringify(ownerSelector)})`))
check('派生所有者可打开右键菜单', await openReference(ownerSelector))
check('派生引用菜单只提供定位操作', await page.evaluate(`(() => {
  const buttons=[...document.querySelectorAll('.context-menu.reference-menu button')].map(b=>b.textContent.trim());
  return buttons.includes('树上高亮') && buttons.includes('画上高亮') && !buttons.includes('移除');
})()`))
await clickTreeHighlight()
check('所有者在模型树中选中', await waitFor(page, `!!document.querySelector('.tree-row.selected[data-tree-id="${rootId}"]')`))
await page.evaluate(setInputExpr('.prop-search-row input', 'ownedElement'))
const childSelector = cardSelector('ownedElement', IDS.blk2)
check('拥有的元素列表保留每个对象的标识', await waitFor(page, `!!document.querySelector(${JSON.stringify(childSelector)})`))
check('可以单独右键列表里的第二个目标', await openReference(childSelector))
await clickTreeHighlight()
check('树上选中的是实际右键的子元素', await waitFor(page, `!!document.querySelector('.tree-row.selected[data-tree-id="${IDS.blk2}"]')`))

console.log('────────────')
console.log(`通过 ${passed} / ${passed + failed}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
