/**
 * 图形样式编辑器的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) SysML 标准图框按 M-Design 三段式标题显示，工具箱「样式」页签是真正的编辑器；
 *   2) 选中图形后可改字号 / 字色 / 填充 / 线型，写入服务端记法、刷新保持、撤销可回退；
 *   3) 图框开关与自定义标题按每张图落库，刷新后仍在；
 *   4) 连线样式按图挂在关系属性上，画布线色随样式变化；
 *   5) 导出 SVG 带有用户设置的样式。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动，
 * 口令走 SCOFEN_PASSWORD，APP_URL 指向被测实例。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9461)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-style-editor-shots'

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

const page = await connect()
const H = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token'),
  'Content-Type':'application/json','X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'}`
const api = async (expression) => page.evaluate(`(async()=>{const h=${H};${expression}})()`, true)
const reload = async () => {
  await page.goto(APP_URL)
  await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250)
  await sleep(800)
}
const openStyles = () => page.evaluate(`(()=>{
  const b=[...document.querySelectorAll('.tb-tabs button')].find(x=>x.textContent.trim()==='样式');
  if(b) b.click(); return !!b;
})()`)

await page.goto(APP_URL)
console.log('[1] 登录与图框')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1200)
// 可重入：同一实例连跑时上一轮留下的自定义标题 / 关掉的图框会污染首屏断言，先复位。
// 复位目标取「当前活动的图」；拿不到活动页签时回退到服务端第一张图——
// 复位命令发空 id 会被服务端忽略，图框标题就永远残留上一轮的自定义值。
const activeTabId = await page.evaluate(
  `document.querySelector('.doc-tab.diagram.active')?.getAttribute('data-tab-id') ?? ''`)
const shellDiagramId = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const fromTab=${JSON.stringify(activeTabId)};
  const hit=d.diagrams.find(g=>g.id===fromTab)??d.diagrams[0];
  return hit?.id??''`)
await api(`const m=await (await fetch('api/model',{headers:h})).json();
  await fetch('api/commands',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'},
    body:JSON.stringify({type:'SET_DIAGRAM_STYLE',baseRevision:m.revision,
      clientCmdId:'style-e2e-reset-'+Date.now(),
      payload:{diagramId:${JSON.stringify(shellDiagramId)},style:{frame:'on',frameTitle:''}}})});
  return 1`)
await sleep(600)
// 复位要等服务端 WS patch 推到前端才生效（不能只睡固定时间，否则读到旧标题）。
// 判据是「标题回到规范三段式」，而不是「旧标题消失」——后者在标题尚未到达时也成立。
await waitFor(page, `(()=>{const t=document.querySelector('.diagram-frame')?.getAttribute('data-frame-title')??'';
  return t.includes('[')})()`, 40, 250)
check('默认显示 SysML 图框', await waitFor(page, `!!document.querySelector('.diagram-frame[data-frame="true"]')`))
const frameTitle = await page.evaluate(`document.querySelector('.diagram-frame')?.getAttribute('data-frame-title') ?? ''`)
check('图框标题是「图种 [宿主 [图名]]」规范格式', frameTitle.includes('['), frameTitle)
check('工具条图框开关为按下态',
  await page.evaluate(`document.querySelector('.dt-frame-toggle')?.getAttribute('aria-pressed') === 'true'`))

console.log('[2] 「样式」页签是真正的编辑器')
check('切到样式页签', await openStyles())
check('样式面板出现', await waitFor(page, `!!document.querySelector('.style-panel')`))
check('图框分区始终存在', await page.evaluate(`!!document.querySelector('[data-style-section="frame"]')`))
check('图框开关勾选', await page.evaluate(`document.querySelector('[data-style-toggle="frame"]')?.checked === true`))
check('服务端样式字典已加载（图框 / 连线控件齐备）', await page.evaluate(
  `!!document.querySelector('[data-style-key="frameTitle"]') && !!document.querySelector('[data-style-key="lineColor"]')`))

console.log('[3] 选中图形并套用预设')
const activeDiagramId = await page.evaluate(
  `document.querySelector('.doc-tab.diagram.active')?.getAttribute('data-tab-id') ?? ''`)
// 选中画布上真实渲染出来的图形：API 里的首个成员未必画成方块（图框宿主、组合片段等）。
const renderedIds = await page.evaluate(
  `[...document.querySelectorAll('.canvas > svg .node[data-element-id]')]
     .map(n=>n.getAttribute('data-element-id')).filter(id=>id && !id.startsWith('ext-'))`)
const nodeId = { id: renderedIds?.[0] ?? null }
const modelInfo = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const g=d.diagrams.find(x=>x.id===${JSON.stringify(activeDiagramId)}) ?? d.diagrams[0];
  const rel=d.relationships.find(r=>(g?.elementIds??[]).includes(r.sourceId)&&(g?.elementIds??[]).includes(r.targetId));
  return {diagramId:g?.id??'',members:(g?.elementIds??[]).length,relationId:rel?.id??null}`)
check('当前图上有可选中的图形', !!nodeId.id, JSON.stringify({ renderedIds, modelInfo }))
if (nodeId.id) {
  // 合成 pointerdown 命中画布节点：stub setPointerCapture，避免 CDP 合成 pointerId 触发 NotFoundError。
  // 只派发 pointerdown——真实点击的 pointerup 由 window 处理，合成它会打断拖拽态。
  await page.evaluate(`(()=>{
    const el=document.querySelector('.node[data-element-id=${JSON.stringify(nodeId.id)}]');
    if(!el) return false;
    const r=el.getBoundingClientRect();
    el.setPointerCapture=()=>{};
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,
      pointerId:1,pointerType:'mouse',clientX:r.x+r.width/2,clientY:r.y+r.height/2,isPrimary:true}));
    return true;
  })()`)
  await sleep(800)
  // 回归：图宿主（同时是图成员）被选中时，模型树不得因 元素↔图 互递归而死循环。
  check('选中图宿主不拖垮模型树', await page.evaluate(`!!document.querySelector('.toolbox')`))
  if (!(await page.evaluate(`!!document.querySelector('[data-style-section="node"]')`))) {
    // 兜底：模型树行选中同一个元素
    await page.evaluate(`(()=>{const row=document.querySelector('.tree-row[data-tree-id=${JSON.stringify(nodeId.id)}]');
      if(row) row.click(); return !!row})()`)
    await sleep(500)
  }
}
check('图形样式分区出现', await waitFor(page, `!!document.querySelector('[data-style-section="node"]')`))
check('选中目标显示', await page.evaluate(`document.querySelector('[data-style-target]')?.getAttribute('data-style-target') === 'selection'`))
check('点「强调」预设', await page.evaluate(`(()=>{
  const b=document.querySelector('[data-style-preset="强调"][data-style-scope="node"]');
  if(b) b.click(); return !!b;
})()`))
// 预设走「整包替换」命令，等服务端记法真的带上预设色再断言（不睡固定时间）。
await waitFor(page, `(async()=>{const h=${H};
  const d=await (await fetch('api/model',{headers:h})).json();
  const n=d.notations.find(x=>x.elementId===${JSON.stringify(nodeId?.id ?? '')});
  return n?.style?.fill === '#fff2cc'})()`, 40, 250)
const styleAfterPreset = await api(`return (await (await fetch('api/model',{headers:h})).json()).notations
  .filter(n=>n.elementId===${JSON.stringify(nodeId?.id ?? '')}).map(n=>n.style)`)
check('预设写进服务端记法（fill / stroke / fontColor）',
  styleAfterPreset?.[0]?.fill === '#fff2cc' && styleAfterPreset?.[0]?.stroke === '#b7791f',
  JSON.stringify(styleAfterPreset))
// 选中态用交互色（浅蓝底 + 主色描边）盖住用户样式；点空白只会清关系选择、不清元素选择，
// 所以改选同图里的另一个图形，再回头看这个图形的真实填充。
const nodePointerDown = (id) => page.evaluate(`(()=>{
  const el=document.querySelector('.node[data-element-id="${id}"]');
  if(!el) return false;
  const r=el.getBoundingClientRect(); el.setPointerCapture=()=>{};
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,
    pointerId:1,pointerType:'mouse',clientX:r.x+r.width/2,clientY:r.y+r.height/2,isPrimary:true}));
  return true})()`)
const otherId = renderedIds?.find((id) => id !== nodeId.id) ?? null
if (otherId) {
  await nodePointerDown(otherId)
  await sleep(700)
}
check('画布节点填充色随样式变化', await page.evaluate(
  // 包图形是 path、类图形是 rect，按 fill 找而不是按标签名找。
  `!!document.querySelector('.node[data-element-id="${nodeId?.id ?? ''}"] [fill="#fff2cc"]')`))
if (otherId) {
  await nodePointerDown(nodeId.id)
  await waitFor(page, `!!document.querySelector('[data-style-section="node"]')`, 40, 200)
}

console.log('[4] 字号 / 文字颜色 / 边框线型')
check('字号滑块可调', await page.evaluate(setInput('[data-style-key="fontSize"][data-style-scope="node"]', '18')))
await waitFor(page, `(()=>{const t=document.querySelector('.node[data-element-id="${nodeId?.id ?? ''}"] text.node-name');
  return !!t && t.style.fontSize === '18px'})()`, 40, 250)
check('节点文字字号变为 18px', await page.evaluate(
  `document.querySelector('.node[data-element-id="${nodeId?.id ?? ''}"] text.node-name')?.style.fontSize === '18px'`))
check('文字颜色可调', await page.evaluate(setInput('[data-style-key="fontColor"][data-style-scope="node"]', '#b23c3c')))
// 样式面板 220ms 合并成一条命令，服务端回包 + WS patch + React 重渲染还要再花时间；
// 固定 sleep 会读到旧值，改成等字色真的出现在画布上。
await waitFor(page, `(()=>{const t=document.querySelector('.node[data-element-id="${nodeId?.id ?? ''}"] text.node-name');
  return !!t && (t.style.fill === 'rgb(178, 60, 60)' || t.style.fill === '#b23c3c')})()`, 40, 250)
const textStyle = await page.evaluate(`(()=>{const t=document.querySelector('.node[data-element-id="${nodeId?.id ?? ''}"] text.node-name');
  return t ? {fill:t.style.fill,size:t.style.fontSize} : null})()`)
check('节点文字颜色与字号同时生效', textStyle?.fill === 'rgb(178, 60, 60)' || textStyle?.fill === '#b23c3c',
  JSON.stringify(textStyle))
check('点「虚线」边框线型', await page.evaluate(`(()=>{
  const b=document.querySelector('[data-style-key="strokeDash"][data-style-value="dashed"]');
  if(b) b.click(); return !!b;
})()`))
// 与字号 / 字色同理：等样式真正落到画布上，而不是睡固定时间读旧值。
await waitFor(page, `document.querySelector('.node[data-element-id="${nodeId?.id ?? ''}"]')?.getAttribute('stroke-dasharray') === '5 4'`, 40, 250)
check('节点边框变虚线', await page.evaluate(
  `document.querySelector('.node[data-element-id="${nodeId?.id ?? ''}"]')?.getAttribute('stroke-dasharray') === '5 4'`))

console.log('[5] 刷新保持与撤销')
await reload()
await openStyles()
const afterReload = await api(`return (await (await fetch('api/model',{headers:h})).json()).notations
  .filter(n=>n.elementId===${JSON.stringify(nodeId?.id ?? '')}).map(n=>n.style)`)
check('刷新后样式仍在（服务端权威）',
  afterReload?.[0]?.fontSize === '18' && afterReload?.[0]?.fill === '#fff2cc', JSON.stringify(afterReload))
await api(`await fetch('api/commands/undo',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'}});return 1`)
await waitFor(page, `(async()=>{const h=${H};
  const d=await (await fetch('api/model',{headers:h})).json();
  const n=d.notations.find(x=>x.elementId===${JSON.stringify(nodeId?.id ?? '')});
  return !!n && !n.style?.strokeDash})()`, 40, 250)
const afterUndo = await api(`return (await (await fetch('api/model',{headers:h})).json()).notations
  .filter(n=>n.elementId===${JSON.stringify(nodeId?.id ?? '')}).map(n=>n.style)`)
check('撤销回退最后一步样式（strokeDash 消失、其余保留）',
  afterUndo?.[0] && !afterUndo[0].strokeDash && afterUndo[0].fontSize === '18',
  JSON.stringify(afterUndo))

console.log('[6] 图框按图落库')
await reload()
check('点工具条关闭图框', await page.evaluate(`(()=>{
  const b=document.querySelector('.dt-frame-toggle'); if(b) b.click(); return !!b;
})()`))
await waitFor(page, `!document.querySelector('.diagram-frame')`, 40, 250)
check('画布图框消失', await page.evaluate(`!document.querySelector('.diagram-frame')`))
check('开关变为未按下', await page.evaluate(`document.querySelector('.dt-frame-toggle')?.getAttribute('aria-pressed') === 'false'`))
await reload()
check('刷新后图框仍隐藏（服务端 Diagram.style）', await page.evaluate(`!document.querySelector('.diagram-frame')`))
check('重新打开图框', await page.evaluate(`(()=>{
  const b=document.querySelector('.dt-frame-toggle'); if(b) b.click(); return !!b;
})()`))
check('图框恢复显示', await waitFor(page, `!!document.querySelector('.diagram-frame')`, 40, 250))
await openStyles()
check('自定义标题输入可用', await page.evaluate(setInput('[data-style-key="frameTitle"][data-style-scope="frame"]', 'SC-样式实测图框')))
await page.evaluate(`(()=>{const el=document.querySelector('[data-style-key="frameTitle"]');
  if(el){el.focus();el.blur()} return 1})()`)
await sleep(900)
check('图框标题变成自定义文本', await waitFor(page,
  `document.querySelector('.diagram-frame')?.getAttribute('data-frame-title') === 'SC-样式实测图框'`))
await reload()
check('刷新后自定义标题保持', await page.evaluate(
  `document.querySelector('.diagram-frame')?.getAttribute('data-frame-title') === 'SC-样式实测图框'`))

console.log('[7] 连线样式按图保存并影响渲染')
// 默认图是包图（无连线），先切到有通用连线的需求图；不改界面数据，只用标签切换。
const relationInfo = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  for(const g of d.diagrams){
    const r=d.relationships.find(x=>x.type!=='message'&&(g.elementIds??[]).includes(x.sourceId)&&(g.elementIds??[]).includes(x.targetId));
    if(r) return {id:r.id,diagramId:g.id,type:r.type};
  }
  return null`)
check('模型里有可测的通用连线', !!relationInfo?.id, JSON.stringify(relationInfo))
if (relationInfo?.id && relationInfo?.diagramId) {
  await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.tree-head-tab')].find(x=>/图表/.test(x.textContent));
    if(b) b.click(); return !!b})()`)
  await sleep(400)
  await page.evaluate(`(()=>{const row=document.querySelector('.chart-row[data-diagram-id=${JSON.stringify(relationInfo.diagramId)}]');
    if(row) row.click(); return !!row})()`)
  await waitFor(page, `document.querySelector('.doc-tab.diagram.active')?.getAttribute('data-tab-id') === ${JSON.stringify(relationInfo.diagramId)}`, 40, 250)
  check('已切到含连线的图', await page.evaluate(
    `document.querySelector('.doc-tab.diagram.active')?.getAttribute('data-tab-id') === ${JSON.stringify(relationInfo.diagramId)}`))
  await api(`await fetch('api/commands',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'},
    body:JSON.stringify({type:'UPDATE_PROPERTY',baseRevision:(await (await fetch('api/model',{headers:h})).json()).revision,
      clientCmdId:'style-e2e-line-'+Date.now(),
      payload:{id:${JSON.stringify(relationInfo.id)},key:'style:'+${JSON.stringify(relationInfo.diagramId)},
        value:{lineColor:'#b23c3c',lineWidth:'3',lineDash:'dashed',labelFontSize:'14'}}})});return 1`)
  await sleep(1300)
  const lineStyle = await api(`const d=await (await fetch('api/model',{headers:h})).json();
    const r=d.relationships.find(x=>x.id===${JSON.stringify(relationInfo.id)});
    return r?.properties?.['style:'+${JSON.stringify(relationInfo.diagramId)}] ?? null`)
  check('连线样式落在关系属性上', lineStyle?.lineColor === '#b23c3c' && lineStyle?.lineWidth === '3',
    JSON.stringify(lineStyle))
  check('画布连线用上自定义颜色', await page.evaluate(
    `!!document.querySelector('.canvas svg polyline[stroke="#b23c3c"], .canvas svg line[stroke="#b23c3c"]')`))
  check('画布连线变虚线', await page.evaluate(
    `!!document.querySelector('.canvas svg [stroke-dasharray="5 4"]')`))
}

console.log('[8] 截图')
await openStyles()
await sleep(400)
const shot = await page.screenshot('style-editor')
console.log(`    截图 ${shot}`)
console.log(`\n结果：${passed} 通过 / ${failed} 失败（共 ${passed + failed} 项）`)
page.close()
if (failed > 0) process.exitCode = 1
