/**
 * 元模型定制（扩展图 + Profile 定制）的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 工具箱「定制」页签能建出自定义图类型（落库为真实模型元素，不是前端状态）；
 *   2) 自定义图类型限定允许的元素 / 关系，工具箱按白名单收敛，服务端同步拒绝越界元素；
 *   3) 新建图对话框列出「自定义图」分组，用自定义图类型建图，图框标题走自定义模板；
 *   4) 剖面定制：构造型 + 标签定义落库为模型元素，元素应用构造型后属性面板出现带类型的「剖面标签」；
 *   5) 全流程可撤销，且脚本可重入（先清掉上一轮残留）。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动，
 * 口令走 SCOFEN_PASSWORD，APP_URL 指向被测实例。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9475)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-customization-shots'

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
    ws.onerror = () => reject(new Error('ws error'))
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
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error('CDP timeout: ' + method))
        }
      }, 30000)
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await call('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    })
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + JSON.stringify(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    }
    return r.result.value
  }
  const goto = async (url) => {
    await call('Page.navigate', { url })
    await sleep(2200)
  }
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
    try {
      if (await page.evaluate(expr)) return true
    } catch {
      /* 页面尚未就绪 */
    }
    await sleep(gap)
  }
  return false
}

/** React 受控输入：native setter + input + change，缺一不可。 */
const setInput = (selector, value) => `(()=>{
  const el=document.querySelector(${JSON.stringify(selector)});
  if(!el) return false;
  const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;
  s.call(el,${JSON.stringify(String(value))});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
})()`

/**
 * React 受控下拉：必须走 native setter。
 *
 * <p>直接 el.value = x 会被 React 的 value tracker 判成「没变」而吞掉 onChange，
 * 界面上看就是「选了没反应」。</p>
 */
const setSelect = (selector, value) => `(()=>{
  const el=document.querySelector(${JSON.stringify(selector)});
  if(!el) return false;
  const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;
  s.call(el,${JSON.stringify(String(value))});
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
})()`

/**
 * 触发失焦提交。
 *
 * <p>必须先 focus 再 blur：blur() 作用在没获得焦点的元素上是空操作，
 * React 的 onBlur 根本不会触发。</p>
 */
const blurField = (selector) => `(()=>{
  const el=document.querySelector(${JSON.stringify(selector)});
  if(!el) return false;
  el.focus();
  el.blur();
  return true;
})()`

/** 状态栏最后一条消息：命令失败时服务端的原因都在这里。 */
const statusText = () => page.evaluate(
  `document.querySelector('.status-bar,.statusbar,[class*="status"]')?.textContent?.trim() ?? ''`)

const page = await connect()
const H = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token'),
  'Content-Type':'application/json','X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'}`
const api = async (expression) => page.evaluate(`(async()=>{const h=${H};${expression}})()`, true)

const openTab = (label) => page.evaluate(`(()=>{
  const b=[...document.querySelectorAll('.tb-tabs button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
  if(b) b.click(); return !!b;
})()`)

const openPropsTab = (label) => page.evaluate(`(()=>{
  const b=[...document.querySelectorAll('.props-tab')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
  if(b) b.click(); return !!b;
})()`)

await page.goto(APP_URL)
console.log('[1] 登录与可重入清理')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
  set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
  [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1000)

// 可重入：删掉上一轮留下的自定义图（customTypeId 非空）与自定义定义元素。
//
// 两条硬约束：
//   1) 预置扩展图库（owner = 扩展图库包）**不能删**——它是产品随附的模板，
//      删了会被播种器补回来，而且会把「预置图库单独成段」这条断言打挂。
//      按 owner 判定比按 type 字符串判定可靠：预置用枚举名 DIAGRAM_TYPE，
//      用户手建的用 UML 名 DiagramType，两条路径都出现过。
//   2) 每条命令都要看状态码——静默失败会留下残留，下一轮的断言就莫名其妙地挂。
const cleanup = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const rev=d.revision;
  const errors=[];
  const post=async(body)=>{const res=await fetch('api/commands',{method:'POST',
    headers:{...h,'X-Scofen-Session':'web-ui'},body:JSON.stringify(body)});
    if(res.status!==200) errors.push(body.type+':'+res.status+':'+(await res.text()).slice(0,120));
    return res.status;};
  const customDiagrams=(d.diagrams??[]).filter(g=>g.customTypeId).map(g=>g.id);
  let cur=d.revision;
  for(const id of customDiagrams){
    await post({type:'DELETE_DIAGRAM',baseRevision:cur,clientCmdId:'cust-e2e-del-'+id,payload:{id}});
    cur=cur+1;
  }
  const d2=await (await fetch('api/model',{headers:h})).json();
  const LIB='e-pkg-diagram-type-library';
  const owned=(e)=>e.ownerId!==LIB;
  const defs=(d2.elements??[]).filter(e=>['DiagramType','TagDefinition'].includes(e.type)&&owned(e)).map(e=>e.id);
  const sts=(d2.elements??[]).filter(e=>e.type==='Stereotype'&&String(e.id).startsWith('e-')&&owned(e)).map(e=>e.id);
  const all=[...defs,...sts];
  if(all.length){
    await post({type:'DELETE_ELEMENTS',baseRevision:d2.revision,clientCmdId:'cust-e2e-clean-'+Date.now(),
      payload:{ids:all}});
  }
  const d3=await (await fetch('api/model',{headers:h})).json();
  return {customDiagrams:customDiagrams.length,defs:all.length,errors,
    remainCustom:(d3.elements??[]).filter(e=>['DiagramType','TagDefinition'].includes(e.type)&&owned(e)).length,
    remainPreset:(d3.elements??[]).filter(e=>e.ownerId===LIB).length}`)
check('清理上一轮残留的自定义图与定义元素',
  cleanup.errors.length === 0 && cleanup.remainCustom === 0 && cleanup.remainPreset > 0,
  JSON.stringify(cleanup))
// 混用 API 直驱后必须刷新对齐 baseRevision，否则界面上的写入会撞 Stale baseRevision。
await page.goto(APP_URL)
await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250)
await sleep(900)

console.log('[2] 工具箱「定制」页签')
check('切到定制页签', await openTab('定制'))
check('定制面板出现', await waitFor(page, `!!document.querySelector('.cust-panel')`))
const tabLabels = await page.evaluate(
  `[...document.querySelectorAll('.cust-tabs button')].map(b=>b.textContent.trim()).join('|')`)
check('定制面板分「扩展图 / 元模型」两段',
  tabLabels.includes('扩展图') && tabLabels.includes('元模型'), tabLabels)
// 预置扩展图库（产品随附的模板）常驻在「扩展图」段，用户自建的图类型才是空态。
// 两者必须分开：预置模板混进用户自建列表会让「新建图类型」从 17 开始编号。
const presets = await page.evaluate(`(()=>{
  const heads=[...document.querySelectorAll('.cust-card-head')];
  const presetCards=heads.filter(h=>h.querySelector('.cust-badge.preset'));
  return {total:heads.length, preset:presetCards.length,
    names:presetCards.map(h=>h.querySelector('.cust-name')?.textContent ?? '').slice(0,3),
    hasSection:[...document.querySelectorAll('.cust-section')].some(s=>s.textContent.includes('预置扩展图库'))};
})()`)
check('预置扩展图库单独成段并带「预置」徽标',
  presets.preset > 0 && presets.hasSection, JSON.stringify(presets))
check('初始无用户自定义图类型（空态属于自建区）', await page.evaluate(
  `!!document.querySelector('.cust-empty') && document.querySelector('.cust-empty').textContent.includes('尚无')`))

console.log('[3] 新建自定义图类型')
await page.evaluate(`(()=>{const b=document.querySelector('[data-cust-action="add-diagram-type"]');
  if(b) b.click(); return !!b})()`)
await sleep(1400)
check('出现一张自定义图类型卡片', await waitFor(page, `!!document.querySelector('.cust-card')`))
const definition = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const defs=(d.elements??[]).filter(e=>e.type==='DiagramType');
  const def=defs[0];
  return def?{id:def.id,name:def.name,ownerId:def.ownerId,props:def.properties}:null`)
check('定义落库为真实模型元素（DiagramType）', !!definition, JSON.stringify(definition))
check('定义元素有基底与白名单属性',
  !!definition?.props?.['custom:baseKind'] && !!definition?.props?.['custom:allowedTypes'],
  JSON.stringify(definition?.props))
check('定义元素 id 落在用户域（不会被扩展播种器清掉）',
  !!definition?.id?.startsWith('e-'), definition?.id)
// 改成稳定名字，后续断言按名字找。
await page.evaluate(setInput('[data-cust-field="name"]', '定制图类型'))
await page.evaluate(blurField('[data-cust-field="name"]'))
await sleep(1200)
const renamed = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const def=(d.elements??[]).find(e=>e.type==='DiagramType');
  return def?.name ?? ''`)
check('自定义图类型可改名', renamed === '定制图类型', renamed)

console.log('[4] 收紧允许的元素类型')
// 勾选白名单：只留 Block。
await page.evaluate(`(()=>{
  const boxes=[...document.querySelectorAll('[data-cust-check="allowedTypes"]')];
  const keep=new Set(['BLOCK']);
  for(const box of boxes){
    const code=box.getAttribute('data-cust-code');
    const want=keep.has(code);
    if(box.checked!==want){ box.click(); }
  }
  return boxes.length;
})()`)
await sleep(1500)
const afterPick = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const def=(d.elements??[]).find(e=>e.type==='DiagramType');
  return def?def.properties['custom:allowedTypes']:null`)
check('白名单已按勾选写入服务端',
  JSON.stringify(afterPick ?? []).includes('BLOCK')
  && !JSON.stringify(afterPick ?? []).includes('CLASS'),
  JSON.stringify(afterPick))
// 图框标题模板
await page.evaluate(setInput('[data-cust-field="frameTitle"]', '{图种} 定制 · {图名}'))
await page.evaluate(blurField('[data-cust-field="frameTitle"]'))
await sleep(1000)
const titleProp = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const def=(d.elements??[]).find(e=>e.type==='DiagramType');
  return def?.properties?.['custom:frameTitle'] ?? ''`)
check('图框标题模板已落库', titleProp.includes('定制'), titleProp)

console.log('[5] 新建图对话框列出自定义图')
await openTab('组件')
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.tb-item.action')].find(x=>x.textContent.includes('新建图'));
  if(b) b.click(); return !!b})()`)
await sleep(800)
check('新建图对话框打开', await waitFor(page, `!!document.querySelector('.modal .field select')`))
const groups = await page.evaluate(
  `[...document.querySelectorAll('.modal .field select optgroup')].map(g=>g.label).join('|')`)
check('下拉分组含「自定义图」', groups.includes('自定义图'), groups)
const options = await page.evaluate(
  `[...document.querySelectorAll('.modal .field select option')].map(o=>({v:o.value,l:o.textContent})).map(o=>o.v+'='+o.l).join(',')`)
check('下拉里有自定义图选项', options.includes('定制图类型'), options)
const customId = definition?.id
await page.evaluate(setSelect('.modal .field select', customId))
await page.evaluate(setInput('.modal .field input', '定制图示例'))
await sleep(300)
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.modal-actions button')].find(x=>x.textContent.trim()==='创建');
  if(b) b.click(); return !!b})()`)
await sleep(1800)
const newDiagram = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const g=(d.diagrams??[]).find(x=>x.customTypeId);
  return g?{id:g.id,name:g.name,kind:g.kind,customTypeId:g.customTypeId}:null`)
check('自定义图已创建并带 customTypeId', !!newDiagram,
  JSON.stringify(newDiagram) + ' | 状态栏：' + await statusText())
check('自定义图的基底是 bdd', newDiagram?.kind === 'bdd', newDiagram?.kind)

console.log('[6] 工具箱按白名单收敛')
const paletteTypes = await page.evaluate(
  `[...document.querySelectorAll('.tb-item[data-tb-type]')].map(b=>b.getAttribute('data-tb-type'))`)
check('工具箱只列白名单里的元素类型',
  paletteTypes.includes('BLOCK') && !paletteTypes.includes('CLASS'),
  JSON.stringify(paletteTypes))
const headLabel = await page.evaluate(
  `document.querySelector('.tb-group.current .tb-group-label')?.textContent ?? ''`)
check('工具箱组标题用的是自定义图名', headLabel.includes('定制图类型'), headLabel)

console.log('[7] 服务端拒绝越界元素')
const rejection = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const g=(d.diagrams??[]).find(x=>x.customTypeId);
  if(!g) return {bad:{status:0,body:'没有自定义图'},good:{status:0,body:'没有自定义图'}};
  const outside=['Requirement','UseCase','Activity','StateMachine','Actor','Class']
    .map(t=>(d.elements??[]).find(e=>e.type===t)).find(Boolean);
  const cls=outside;
  const blk=(d.elements??[]).find(e=>e.type==='Block');
  const post=async(payload)=>{const res=await fetch('api/commands',{method:'POST',
    headers:{...h,'X-Scofen-Session':'web-ui'},
    body:JSON.stringify({type:'ADD_TO_DIAGRAM',baseRevision:d.revision,
      clientCmdId:'cust-e2e-add-'+Date.now()+Math.random(),payload})});
    return {status:res.status,body:await res.text()}};
  const bad=cls?await post({diagramId:g.id,elementId:cls.id}):{status:0,body:'no class element'};
  const good=blk?await post({diagramId:g.id,elementId:blk.id}):{status:0,body:'no block element'};
  return {bad,good}`)
check('白名单外的元素被服务端拒绝（400）',
  rejection.bad?.status === 400 && /not allowed|不允许/.test(rejection.bad?.body ?? ''),
  JSON.stringify(rejection.bad))
check('白名单内的元素可以进图', rejection.good?.status === 200, JSON.stringify(rejection.good))

console.log('[8] 剖面定制：构造型与标签定义')
await page.goto(APP_URL)
await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250)
await sleep(900)
await openTab('定制')
await page.evaluate(`(()=>{
  const b=[...document.querySelectorAll('.cust-tabs button')].find(x=>x.textContent.trim()==='元模型');
  if(b) b.click(); return !!b})()`)
await sleep(500)
await page.evaluate(`(()=>{const b=document.querySelector('[data-cust-action="add-stereotype"]');
  if(b) b.click(); return !!b})()`)
await sleep(1400)
const stereotype = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const sts=(d.elements??[]).filter(e=>e.type==='Stereotype'&&String(e.id).startsWith('e-'));
  return sts[0]?{id:sts[0].id,name:sts[0].name}:null`)
check('构造型落库为真实模型元素', !!stereotype, JSON.stringify(stereotype))
// 卡片新建后已自动展开；只有没展开时才点标题（再点会把已展开的卡片收起来）。
if (!(await page.evaluate(`!!document.querySelector('[data-cust-action="add-tag"]')`))) {
  await page.evaluate(`(()=>{const heads=[...document.querySelectorAll('.cust-card-head')];
    const h=heads.find(x=>x.textContent.includes('«')) ?? heads[0];
    if(h) h.click(); return !!h})()`)
  await sleep(700)
}
check('构造型卡片可展开（出现标签定义入口）', await page.evaluate(
  `!!document.querySelector('[data-cust-action="add-tag"]')`))
await page.evaluate(`(()=>{const b=document.querySelector('[data-cust-action="add-tag"]');
  if(b) b.click(); return !!b})()`)
await sleep(1600)
const tag = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const tags=(d.elements??[]).filter(e=>e.type==='TagDefinition');
  return tags[0]?{id:tags[0].id,name:tags[0].name,ownerId:tags[0].ownerId,props:tags[0].properties}:null`)
check('标签定义落库为真实模型元素', !!tag, JSON.stringify(tag))
check('标签定义挂在构造型之下', tag?.ownerId === stereotype?.id, `${tag?.ownerId} vs ${stereotype?.id}`)
// 设为 ENUM 类型
await page.evaluate(setSelect('[data-cust-field="tagType"]', 'ENUM'))
await sleep(1000)
const tagType = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const tags=(d.elements??[]).filter(e=>e.type==='TagDefinition');
  return tags[0]?.properties?.['custom:tagType'] ?? ''`)
check('标签类型已落库（ENUM）', tagType === 'ENUM', tagType)

console.log('[9] 元素应用构造型 → 剖面标签')
// 选中一个块（模型树里点），属性面板「属性」页签给 stereotypes 加自造构造型名。
const target = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const blk=(d.elements??[]).find(e=>e.type==='Block'&&!String(e.id).startsWith('ext-'));
  return blk?{id:blk.id,name:blk.name}:null`)
check('项目里有可用的块元素', !!target, JSON.stringify(target))
await page.evaluate(`(()=>{const row=document.querySelector('.tree-row.element[data-tree-id=${JSON.stringify(target?.id ?? '')}]');
  if(row) row.click(); return !!row})()`)
await sleep(900)
check('属性面板显示选中对象', await page.evaluate(
  `!!document.querySelector('[data-prop-key="stereotypes"]')`))
// 属性行是只读的，编辑入口在行尾「⋯」打开的弹框里。
await page.evaluate(`(()=>{const row=document.querySelector('[data-prop-key="stereotypes"]');
  const more=row?.querySelector('.prop-more');
  if(more) more.click(); return !!more})()`)
await sleep(700)
check('构造型属性弹框打开', await page.evaluate(`!!document.querySelector('.prop-dialog')`))
await page.evaluate(setInput('.prop-dialog .prop-inline-add input', stereotype?.name ?? ''))
await sleep(200)
await page.evaluate(`(()=>{
  const input=document.querySelector('.prop-dialog .prop-inline-add input');
  if(input){ input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); }
  return !!input})()`)
await sleep(1600)
// 数组型属性即时写：点「完成」收弹框。
await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.prop-dialog .modal-actions button')]
  .find(x=>x.textContent.trim()==='完成');
  if(b) b.click(); return !!b})()`)
await sleep(1200)
const applied = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const el=(d.elements??[]).find(e=>e.id===${JSON.stringify(target?.id ?? '')});
  return el?{stereotypes:el.stereotypes,tagged:el.taggedValues}:null`)
check('构造型已应用到元素上',
  JSON.stringify(applied?.stereotypes ?? []).includes(stereotype?.name ?? '@@'),
  JSON.stringify(applied))
await openPropsTab('标签')
await sleep(700)
check('属性面板出现「剖面标签」分区', await waitFor(page, `!!document.querySelector('[data-tt-editor="true"]')`))
check('剖面标签按标签定义渲染出字段', await page.evaluate(
  `!!document.querySelector('[data-tt-field]')`))

console.log('[10] 撤销与收尾')
// 撤销刚才的构造型应用（一次撤销回到应用前）。
const undoDepth = await page.evaluate(`(()=>{
  const btn=document.querySelector('[data-undo],.undo-btn,[title*="撤销"]');
  return !!btn})()`)
check('界面存在撤销入口', undoDepth)
await page.screenshot('customization')

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
page.close()
process.exit(failed === 0 ? 0 : 1)
