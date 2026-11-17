/**
 * 符号记法与图标同源的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) UML / SysML 规范记法到位：参与者是火柴人、用例是椭圆、类是三栏矩形、
 *      组件双缺口伸出边框、部署节点是立方体、接口有凸出半圆、枚举有隔间、
 *      数据类型有双斜线、制品是折角纸片；
 *   2) 统一配色：默认描边是中性深灰 rgb(63,74,90)，不再是几乎看不见的浅灰；
 *   3) 工具箱图标与画布符号同源（同一套几何，元素数量一致）。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动，
 * 口令走 SCOFEN_PASSWORD，APP_URL 指向被测实例。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9521)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-shape-notation-shots'

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

console.log('[1] 登录')
await page.goto(APP_URL)
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-password"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;
  s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};
  set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
  set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
  [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent))?.click(); return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1800)

// 可重入：先清掉上一轮残留的实测元素
const stamp = Date.now()
const cleanup = await api(`const r=await fetch('api/model',{headers:h});
  if(!r.ok) return {error:'http-'+r.status};
  const d=await r.json();
  const olds=(d.elements||[]).filter(e=>String(e.id||'').startsWith('e-shape-'));
  if(!olds.length) return {cleaned:0};
  await fetch('api/commands',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'},
    body:JSON.stringify({type:'DELETE_ELEMENTS',baseRevision:d.revision,
      clientCmdId:'shape-clean-'+Date.now(),payload:{ids:olds.map(e=>e.id)}})});
  return {cleaned:olds.length}`)
if (cleanup?.error) {
  console.log(`    模型接口未就绪：${cleanup.error}`)
} else if (cleanup.cleaned > 0) {
  console.log(`    清理上一轮残留 ${cleanup.cleaned} 个`)
  await page.goto(APP_URL)
  await sleep(1200)
}

console.log('[2] 建立各类型元素（记法实测样本）')
// 元素类型 → 期望的图形语义
const CASES = [
  { id: 'e-shape-actor', type: 'Actor', name: '驾驶员', diagram: 'uc' },
  { id: 'e-shape-usecase', type: 'UseCase', name: '启动车辆', diagram: 'uc' },
  { id: 'e-shape-class', type: 'Class', name: '车辆系统', diagram: 'pkg' },
  { id: 'e-shape-iface', type: 'Interface', name: '动力接口', diagram: 'pkg' },
  { id: 'e-shape-comp', type: 'Component', name: '动力控制组件', diagram: 'pkg' },
  { id: 'e-shape-node', type: 'Node', name: '整车节点', diagram: 'pkg' },
  { id: 'e-shape-artifact', type: 'Artifact', name: '部署脚本', diagram: 'pkg' },
  { id: 'e-shape-enum', type: 'Enumeration', name: '档位', diagram: 'pkg' },
  { id: 'e-shape-dt', type: 'DataType', name: '车速', diagram: 'pkg' },
  { id: 'e-shape-req', type: 'Requirement', name: '需求-制动', diagram: 'req' },
  { id: 'e-shape-comment', type: 'Comment', name: '备注', diagram: 'pkg' },
]
const created = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const kinds={uc:'d-uc',pkg:'d-pkg',req:'d-req'};
  const specs=${JSON.stringify(CASES)};
  const rows=specs.map(s=>({
    id:s.id, type:s.type, name:s.name+'-${stamp}', ownerId:'model-root',
    stereotypes:[], documentation:'', taggedValues:{}, properties:{}
  }));
  await fetch('api/commands',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'},
    body:JSON.stringify({type:'CREATE_ELEMENTS',baseRevision:d.revision,
      clientCmdId:'shape-make-'+Date.now(),payload:{elements:rows,diagramIds:[]}})});
  return rows.map(r=>r.id)`)
check('元素已批量建立', Array.isArray(created) && created.length === CASES.length, JSON.stringify(created))

// 挂到对应图上（ADD_TO_DIAGRAM 载荷键是 elementId，可带 x/y 定位）
const attach = await api(`const d=await (await fetch('api/model',{headers:h})).json();
  const groups={uc:['e-shape-actor','e-shape-usecase'],pkg:['e-shape-class','e-shape-iface','e-shape-comp',
    'e-shape-node','e-shape-artifact','e-shape-enum','e-shape-dt','e-shape-comment'],req:['e-shape-req']};
  const out={};
  for(const [kind,ids] of Object.entries(groups)){
    const dg=d.diagrams.find(x=>x.kind===kind||x.id===kind);
    if(!dg){out[kind]='no-diagram';continue}
    let n=0;
    for(const id of ids){
      const rev=(await (await fetch('api/model',{headers:h})).json()).revision;
      const r=await fetch('api/commands',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'},
        body:JSON.stringify({type:'ADD_TO_DIAGRAM',baseRevision:rev,
          clientCmdId:'shape-add-'+id+'-'+Date.now(),
          payload:{elementId:id,diagramId:dg.id,x:70+(n%4)*180,y:70+Math.floor(n/4)*150}})});
      if(!r.ok) out[kind+':'+id]='http-'+r.status;
      n++;
    }
    out[kind]=dg.id;
  }
  return out`)
console.log('    图 id 映射 ' + JSON.stringify(attach))

// 元素进图后按 id 重新定位：ADD_TO_DIAGRAM 会建 Notation
await page.goto(APP_URL)
await sleep(1500)

console.log('[3] 打开各图并核对记法')
/** 用全局搜索打开图：点搜索按钮 → 弹层输入 → 点第一条结果。
 *  （图表视图是虚拟滚动列表，直接点 .chart-row 常点不到目标图。） */
const openDiagram = async (name) => {
  await page.evaluate(`(()=>{const b=document.querySelector('.tree-head-search'); if(b) b.click(); return !!b})()`)
  await sleep(400)
  const opened = await page.evaluate(`!!document.querySelector('.search-palette')`)
  if (!opened) return false
  await page.evaluate(setInput('.search-input-row input', name))
  await sleep(900)
  const clicked = await page.evaluate(`(()=>{
    const rows=[...document.querySelectorAll('.search-row')];
    const hit=rows.find(r=>r.textContent.includes(${JSON.stringify(name)}))??rows[0];
    if(hit){hit.click(); return hit.textContent}
    return null})()`)
  await sleep(1500)
  return !!clicked
}

/** 取某个元素在画布上的图形结构统计。
 *  描边取「有效描边」：actor 的 stroke 挂在父 <g> 上，子元素自身没有 stroke 属性。 */
const shapeOf = (elementId) => page.evaluate(`(()=>{
  const g=document.querySelector('.canvas svg g.node[data-element-id=${JSON.stringify(elementId)}]');
  if(!g) return null;
  const q=(s)=>g.querySelectorAll(s).length;
  const paint=g.querySelector('rect,circle,ellipse,path,line');
  const stroke=paint?.getAttribute('stroke')
    ?? g.getAttribute('stroke')
    ?? (paint?getComputedStyle(paint).stroke:null);
  return {
    rect:q('rect'), circle:q('circle'), ellipse:q('ellipse'), line:q('line'),
    path:q('path'), polygon:q('polygon'),
    stroke,
    text:g.textContent??''
  };
})()`)

/** 颜色比较：兼容 hex 与 rgb() 两种形态（CSS 计算值一律是 rgb()）。 */
const sameColor = (a, b) => {
  if (!a) return false
  const norm = (c) => {
    const s = String(c).trim().toLowerCase()
    if (s.startsWith('#')) {
      const h = s.length === 4
        ? s.slice(1).split('').map((x) => x + x).join('')
        : s.slice(1)
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')
    }
    const m = s.match(/rgba?\(([^)]+)\)/)
    return m ? m[1].split(',').slice(0, 3).map((x) => x.trim()).join(',') : s
  }
  return norm(a) === norm(b)
}

const ucOpen = await openDiagram('用例图')
check('用例图已打开', ucOpen)

const actor = await shapeOf('e-shape-actor')
check('参与者渲染出来了', !!actor, JSON.stringify(actor))
if (actor) {
  check('参与者是火柴人（1 个头 + 4 条身体线）',
    actor.circle === 1 && actor.line === 4,
    `circle=${actor.circle} line=${actor.line} path=${actor.path} rect=${actor.rect}`)
  check('参与者没有用矩形冒充', actor.rect === 0, `rect=${actor.rect}`)
  check('参与者描边是中性深灰', sameColor(actor.stroke, '#3f4a5a'), String(actor.stroke))
}
const usecase = await shapeOf('e-shape-usecase')
check('用例是椭圆', usecase?.ellipse === 1, JSON.stringify(usecase))
// 用例按 UML 惯例用绿色识别色（不是中性灰），这是有意为之。
check('用例描边是 UML 惯例绿', sameColor(usecase?.stroke, '#15803d'), String(usecase?.stroke))

// 用例图打开时，工具箱白名单里含参与者与用例。
console.log('[4] 工具箱图标：成品 SVG 优先、内联 Glyph 兜底')
// 换肤后工具箱图标改用华望成品 SVG（<img src="…/Actor.svg">）；
// 未命中映射的类型仍回退内联 <svg>。两种形态都算图标，且都必须成功渲染。
const icons = await page.evaluate(`(()=>{
  const tiles=[...document.querySelectorAll('.toolbox .icon-tile')];
  const imgs=tiles.map(t=>t.querySelector('img')).filter(Boolean);
  const svgs=tiles.map(t=>t.querySelector(':scope > svg')).filter(Boolean);
  const srcs=imgs.map(i=>i.getAttribute('src')||'');
  const decoded=imgs.filter(i=>i.complete&&i.naturalWidth>0).length;
  return {count:tiles.length, asset:imgs.length, inline:svgs.length, decoded,
    hasActor:srcs.some(s=>/Actor\\.svg/.test(s)), hasUsecase:srcs.some(s=>/UseCase\\.svg/.test(s)),
    sample:srcs.slice(0,8)};
})()`)
check('工具箱有图标', !!icons && icons.count > 0, JSON.stringify(icons?.count))
check('工具箱图标含成品 SVG 且全部成功解码', !!icons?.asset && icons.decoded === icons.asset, JSON.stringify(icons))
check('工具箱有参与者成品图标 Actor.svg', !!icons?.hasActor, JSON.stringify(icons?.sample))
check('工具箱有用例成品图标 UseCase.svg', !!icons?.hasUsecase, JSON.stringify(icons?.sample))

const pkgOpen = await openDiagram('包图')
check('包图已打开', pkgOpen)

const cls = await shapeOf('e-shape-class')
check('类渲染出来了', !!cls, JSON.stringify(cls))
if (cls) {
  check('类保留三栏结构（2 条分隔线）', cls.line === 2, `line=${cls.line}`)
  check('类描边是中性深灰', sameColor(cls.stroke, '#3f4a5a'), String(cls.stroke))
}
const iface = await shapeOf('e-shape-iface')
check('接口是圆 + 凸出半圆插座', iface?.circle === 1 && iface?.path === 1,
  JSON.stringify(iface))
const comp = await shapeOf('e-shape-comp')
check('组件是矩形 + 两个伸出缺口', comp?.rect === 3, JSON.stringify(comp))
const node = await shapeOf('e-shape-node')
check('部署节点是立方体（2 个面 path + 正面 rect）', node?.path === 2 && node?.rect === 1,
  JSON.stringify(node))
const artifact = await shapeOf('e-shape-artifact')
check('制品是折角纸片（1 个 path）', artifact?.path === 1, JSON.stringify(artifact))
const enumEl = await shapeOf('e-shape-enum')
check('枚举有隔间线', enumEl?.line === 1, JSON.stringify(enumEl))
const dt = await shapeOf('e-shape-dt')
check('数据类型有双斜线（2 个 path）', dt?.path === 2, JSON.stringify(dt))
const comment = await shapeOf('e-shape-comment')
check('注释渲染出来了', !!comment, JSON.stringify(comment))

const reqOpen = await openDiagram('需求图')
check('需求图已打开', reqOpen)
const req = await shapeOf('e-shape-req')
check('需求是折角纸片', req?.path === 1, JSON.stringify(req))

console.log('[5] 截图')
const shotUc = await page.screenshot('shape-notation')
console.log(`    截图 ${shotUc}`)

console.log('[6] 清理实测元素')
const removed = await api(`const r=await fetch('api/model',{headers:h});
  if(!r.ok) return {error:'http-'+r.status};
  const d=await r.json();
  const ids=(d.elements||[]).filter(e=>String(e.id||'').startsWith('e-shape-')).map(e=>e.id);
  if(!ids.length) return {removed:0};
  await fetch('api/commands',{method:'POST',headers:{...h,'X-Scofen-Session':'web-ui'},
    body:JSON.stringify({type:'DELETE_ELEMENTS',baseRevision:d.revision,
      clientCmdId:'shape-clean-'+Date.now(),payload:{ids}})});
  return {removed:ids.length}`)
console.log(removed?.error ? `    清理失败：${removed.error}` : `    已清理 ${removed?.removed} 个实测元素`)

console.log(`\n结果：${passed} 通过 / ${failed} 失败（共 ${passed + failed} 项）`)
page.close()
if (failed > 0) process.exitCode = 1
