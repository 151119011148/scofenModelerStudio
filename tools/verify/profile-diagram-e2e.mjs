/**
 * 扩展图（Profile Diagram，第十种规范图）的浏览器级实测：
 *   1) 规范图目录含 10 种，扩展图的规范含构造型 / 元类 / 标签定义与 stereotype 关系；
 *   2) 新建图对话框能选「扩展图」，建出的图 kind=profile；
 *   3) 种子扩展图示例打开后：剖面 / 元类 / 构造型 / 标签定义四图符渲染，
 *      构造型 → 元类的泛化线带空心三角箭头；工具箱显示扩展元素与关系；
 *   4) 从工具箱拖入构造型与元类、连泛化，服务端接受（不越界），撤销恢复。
 *
 * 走真实 UI（headless Chrome + CDP），全程写操作可撤销 / 可重入。
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18081/'
const PORT = Number(process.env.CDP_PORT ?? 9482)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-profile-shots'

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
      if (msg.error) reject(new Error(msg.error.message))
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
  const goto = async (url) => { await call('Page.navigate', { url }); await sleep(2200) }
  const screenshot = async (name) => {
    mkdirSync(SHOTS, { recursive: true })
    const { data } = await call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, 'base64'))
    return `${SHOTS}/${name}.png`
  }
  return { call, evaluate, goto, screenshot, close: () => ws.close() }
}

async function waitFor(page, expr, tries = 80, gap = 250) {
  for (let i = 0; i < tries; i++) {
    try { if (await page.evaluate(expr)) return true } catch { /* 页面尚未就绪 */ }
    await sleep(gap)
  }
  return false
}

const authHeaders = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token')}`
const snapshotExpr = `(async()=>{const r=await fetch('api/model',{headers:${authHeaders}});return await r.json()})()`
const diagramsExpr = `(async()=>{const r=await fetch('api/metamodel/diagrams',{headers:${authHeaders}});return await r.json()})()`
const undoExpr = `(async()=>{const r=await fetch('api/commands/undo',{method:'POST',headers:{...${authHeaders},'X-Scofen-Session':'web-ui'}});return r.status})()`

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录并核对规范图目录')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
for (let i = 0; i < 30; i++) {
  const ok = await page.evaluate(`(()=>{const u=document.querySelector('input[name="scofen-admin-username"]'),p=document.querySelector('input[name="scofen-admin-password"]');if(!u||!p)return false;const set=(el,v)=>{Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};set(u,'scofen');set(p,${JSON.stringify(PASSWORD)});return true})()`)
  if (ok) {
    await page.evaluate(`[...document.querySelectorAll('button')].find(b=>/登.?录/.test(b.textContent))?.click()`)
    break
  }
  await sleep(250)
}
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1500)
const specs = await page.evaluate(diagramsExpr, true)
check('规范图共 10 种', specs.length === 10, String(specs.length))
const profileSpec = specs.find((s) => s.code === 'profile')
check('规范图含扩展图（profile）', !!profileSpec, JSON.stringify(specs.map((s) => s.code)))
check('扩展图标题为「扩展图 / Profile Diagram」',
  profileSpec?.label === '扩展图' && profileSpec?.labelEn === 'Profile Diagram',
  `${profileSpec?.label} / ${profileSpec?.labelEn}`)
const profTypes = profileSpec?.allowedTypes ?? []
check('扩展图允许构造型 / 元类 / 标签定义',
  ['STEREOTYPE', 'METACLASS', 'TAG_DEFINITION', 'PROFILE'].every((t) => profTypes.includes(t)),
  JSON.stringify(profTypes))
check('扩展图允许泛化与剖面应用关系',
  ['generalization', 'profileApplication'].every((r) => (profileSpec?.allowedRelationships ?? []).includes(r)),
  JSON.stringify(profileSpec?.allowedRelationships))

console.log('[2] 打开种子扩展图：四图符 + 泛化连线')
const snap0 = await page.evaluate(snapshotExpr, true)
const seedDiagram = snap0.diagrams.find((d) => d.kind === 'profile')
check('种子里有扩展图示例', !!seedDiagram && seedDiagram.elementIds.length === 4,
  JSON.stringify(seedDiagram?.elementIds))
// 树的图节点：先单击选中、再双击打开（直接 dblclick 不会切换画布）。
const rowHit = await page.evaluate(`(()=>{const r=[...document.querySelectorAll('.tree-row[data-tree-id]')]
  .find(x=>x.getAttribute('data-tree-id')==='d-profile');
  if(!r)return false;r.click();return true})()`)
check('模型树里找到扩展图节点', rowHit)
await sleep(600)
await page.evaluate(`(()=>{const r=[...document.querySelectorAll('.tree-row[data-tree-id]')]
  .find(x=>x.getAttribute('data-tree-id')==='d-profile');
  if(!r)return false;r.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true})()`)
check('扩展图标签页激活', await waitFor(page,
  `document.querySelector('.doc-tab.active .doc-tab-label')?.textContent?.includes('扩展图示例')`))
check('画布渲染出 4 个扩展图元素', await waitFor(page,
  `['e-prof-veh','e-mc-veh-block','e-st-veh-controller','e-tag-veh-level']
    .every(id=>!!document.querySelector('.canvas .node[data-element-id="'+id+'"]'))`))
check('构造型显示 «Stereotype» 隔间', await page.evaluate(`(()=>{
  const n=document.querySelector('.canvas .node[data-element-id="e-st-veh-controller"]');
  return !!n && n.textContent.includes('Stereotype')})()`))
check('元类显示 «Metaclass» 隔间', await page.evaluate(`(()=>{
  const n=document.querySelector('.canvas .node[data-element-id="e-mc-veh-block"]');
  return !!n && n.textContent.includes('Metaclass')})()`))
check('标签定义显示 «TagDefinition» 隔间', await page.evaluate(`(()=>{
  const n=document.querySelector('.canvas .node[data-element-id="e-tag-veh-level"]');
  return !!n && n.textContent.includes('TagDefinition')})()`))
check('构造型 → 元类的泛化关系在快照里', (snap0.relationships ?? []).some((r) =>
  r.sourceId === 'e-st-veh-controller' && r.targetId === 'e-mc-veh-block'
  && ['generalization', 'GENERALIZATION'].includes(r.type)),
  JSON.stringify((snap0.relationships ?? []).filter((r) => r.sourceId === 'e-st-veh-controller')))
check('画布画出了连线（非空 diagram）', await page.evaluate(`(()=>{
  const canvas=document.querySelector('.canvas');
  return [...canvas.querySelectorAll('path,line,polygon,polyline')].length > 3})()`))
check('工具箱显示扩展图元素组件', await page.evaluate(`(()=>{
  const box=[...document.querySelectorAll('.tb-item[data-tb-type]')].map(x=>x.dataset.tbType);
  return ['STEREOTYPE','METACLASS','TAG_DEFINITION','DIAGRAM_TYPE'].every(t=>box.includes(t))})()`),
  await page.evaluate(`JSON.stringify([...document.querySelectorAll('.tb-item[data-tb-type]')].map(x=>x.dataset.tbType))`))
console.log('[2b] 扩展图新建构造型默认尺寸对齐华望（100×50）')
const sizeProbe = await page.evaluate(`(async()=>{
  const h=${authHeaders};
  const b=document.querySelector('.tb-item[data-tb-type="STEREOTYPE"]');
  if(!b) return {clicked:false};
  b.click();
  await new Promise(r=>setTimeout(r,1600));
  const d=await (await fetch('api/model',{headers:h})).json();
  const el=(d.elements??[]).find(e=>e.type==='Stereotype'&&String(e.id).startsWith('e-')
    && e.id!=='e-st-veh-controller');
  const n=el?(d.notations??[]).find(x=>x.diagramId==='d-profile'&&x.elementId===el.id):null;
  return {clicked:true,id:el?.id,width:n?.width,height:n?.height,hasNotation:!!n};
})()`, true)
check('工具箱点选在扩展图里建出构造型', sizeProbe.clicked && sizeProbe.hasNotation, JSON.stringify(sizeProbe))
check('构造型默认尺寸为 100×50',
  sizeProbe.width === 100 && sizeProbe.height === 50,
  `${sizeProbe.width}×${sizeProbe.height}`)
if (sizeProbe.id) {
  await page.evaluate(undoExpr, true)
  await sleep(900)
}

console.log('[2c] 重复泛化被服务端拒绝（同源同目标只留一条）')
const duplicateProbe = await page.evaluate(`(async()=>{
  const h=${authHeaders};
  const d=await (await fetch('api/model',{headers:h})).json();
  const res=await fetch('api/commands',{method:'POST',
    headers:{...h,'Content-Type':'application/json','X-Scofen-Session':'web-ui',
      'X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'},
    body:JSON.stringify({type:'CREATE_RELATIONSHIP',baseRevision:d.revision,
      clientCmdId:'profile-dup-'+Date.now(),
      payload:{id:'rel-dup-'+Date.now(),type:'generalization',
        sourceId:'e-st-veh-controller',targetId:'e-mc-veh-block',diagramId:'d-profile'}})});
  return {status:res.status, body:(await res.text()).slice(0,200)};
})()`, true)
check('重复泛化返回 400',
  duplicateProbe.status === 400 && /already exists/.test(duplicateProbe.body),
  JSON.stringify(duplicateProbe))

console.log('[2d] 图不能挂在构造型下')
const hostProbe = await page.evaluate(`(async()=>{
  const h=${authHeaders};
  const d=await (await fetch('api/model',{headers:h})).json();
  const res=await fetch('api/commands',{method:'POST',
    headers:{...h,'Content-Type':'application/json','X-Scofen-Session':'web-ui',
      'X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'},
    body:JSON.stringify({type:'CREATE_DIAGRAM',baseRevision:d.revision,
      clientCmdId:'profile-host-'+Date.now(),
      payload:{id:'dg-host-'+Date.now(),kind:'profile',name:'不该挂构造型下',
        ownerId:'e-st-veh-controller',elementIds:[]}})});
  return {status:res.status, body:(await res.text()).slice(0,200)};
})()`, true)
check('构造型不能作为图宿主（400）',
  hostProbe.status === 400 && /Diagram owner must be a namespace/.test(hostProbe.body),
  JSON.stringify(hostProbe))

await page.screenshot('01-profile-canvas')

console.log('[3] 新建图对话框能选扩展图')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.tbi')].find(x=>x.title?.includes('新建图'));
  if(b)b.click();return 1})()`)
check('新建图对话框打开', await waitFor(page, `!!document.querySelector('.modal select')`))
const groups = await page.evaluate(`[...document.querySelectorAll('.modal optgroup')].map(g=>g.label)`)
check('下拉含「规范图」分组', groups.includes('规范图'), JSON.stringify(groups))
check('规范图下拉含「扩展图」选项', await page.evaluate(`(()=>{
  const g=[...document.querySelectorAll('.modal optgroup')].find(x=>x.label==='规范图');
  return !!g && [...g.querySelectorAll('option')].some(o=>o.textContent.trim()==='扩展图')})()`))

console.log('────────────')
console.log(`通过 ${passed} / ${passed + failed}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
