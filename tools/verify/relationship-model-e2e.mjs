/**
 * 关系模型进扩展包的浏览器级实测（headless Chrome + CDP，无 puppeteer 依赖）：
 *   1) 扩展包虚拟分组里，SysML / UML 两个 Profile 下都有「关系」子包；
 *   2) SysML 关系子包含 9 条构造型关系（satisfy / verify / refine / deriveReqt / copy /
 *      trace / allocate / itemFlow / constraintParameter），UML 关系子包含 28 条；
 *   3) 关系条目可点选，属性窗口用「扩展的元类」显示它归属的规范元类（satisfy → Dependency）；
 *   4) 关系条目不会漏进项目树（扩展域 id 一律隔离）。
 *
 * 只读：本脚本不写入任何模型数据，跑完不需要清理。
 *
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9456)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-relationship-model-shots'

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
    await sleep(2000)
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

const extRow = (id) =>
  `[data-tree-kind="extension-element"][data-element-id="${id}"]`
const clickExt = (id) =>
  `(()=>{const r=document.querySelector('${extRow(id)}'); if(r) r.click(); return !!r})()`

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1500)

console.log('[2] 扩展包里出现「关系」子包')
await page.evaluate(`(()=>{const t=document.querySelector('[data-tree-kind="ext-toggle"]');
  if(t && t.getAttribute('aria-pressed')!=='true') t.click(); return 1})()`)
check('扩展包虚拟分组出现', await waitFor(page, `!!document.querySelector('[data-tree-kind="extension-group"]')`))
await page.evaluate(`document.querySelector('[data-tree-kind="extension-group"]').click()`)
check('两个顶层扩展包展开',
  await waitFor(page, `document.querySelectorAll('[data-tree-kind="extension-element"]').length>=2`))

// 子包是 Profile 的子节点：必须先展开 Profile，行才会渲染（与项目树同一套父子递归）。
const H = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token'),
  'Content-Type':'application/json','X-Scofen-Project':localStorage.getItem('scofen.modeler.project')||'project-vehicle'}`
const catalog = await page.evaluate(`(async()=>{const h=${H};
  const d=await (await fetch('api/metamodel/extension',{headers:h})).json();
  const rel=(d.elements||[]).filter(e=>e.id.startsWith('rel-'));
  const ownerOf=(id)=>((d.elements||[]).find(e=>e.id===id)||{}).ownerId;
  return {
    sysml: rel.filter(e=>ownerOf(e.id)==='ext-sysml-rel').length,
    uml: rel.filter(e=>ownerOf(e.id)==='ext-uml-rel').length,
    total: rel.length,
    packages: (d.packages||[]).filter(p=>p.id.endsWith('-rel'))
      .map(p=>({id:p.id, name:p.name, count:p.relationshipCount})),
  }})()`, true)
check('目录下发两个「关系」子包',
  catalog.packages.length === 2 && catalog.packages.every((p) => p.name === '关系'),
  JSON.stringify(catalog.packages))
check('SysML 关系子包 9 条、UML 28 条，合计 37',
  catalog.sysml === 9 && catalog.uml === 28 && catalog.total === 37, JSON.stringify(catalog))

await page.evaluate(clickExt('ext-sysml'))
check('SysML 包下有「关系」子包', await waitFor(page, `!!document.querySelector('${extRow('ext-sysml-rel')}')`))
check('关系子包行文本为「关系」',
  /关系/.test(await page.evaluate(`document.querySelector('${extRow('ext-sysml-rel')}')?.textContent ?? ''`)))

console.log('[3] SysML 关系子包：9 条构造型关系')
await page.evaluate(clickExt('ext-sysml-rel'))
check('satisfy 出现在树里', await waitFor(page, `!!document.querySelector('${extRow('rel-satisfy')}')`))
const sysmlRel = await page.evaluate(`[...document.querySelectorAll('[data-tree-kind="extension-element"]')]
  .map(e=>e.getAttribute('data-element-id')).filter(id=>id&&id.startsWith('rel-'))`)
check('含 satisfy / verify / refine / deriveReqt',
  ['rel-satisfy', 'rel-verify', 'rel-refine', 'rel-deriveReqt'].every((id) => sysmlRel.includes(id)),
  sysmlRel.join(','))
check('含 copy / trace / allocate / itemFlow',
  ['rel-copy', 'rel-trace', 'rel-allocate', 'rel-itemFlow'].every((id) => sysmlRel.includes(id)),
  sysmlRel.join(','))

console.log('[4] 关系条目可选中，属性窗口显示规范元类')
await page.evaluate(clickExt('rel-satisfy'))
await sleep(700)
const propsText = await page.evaluate(`document.querySelector('.props-dock')?.textContent ?? ''`)
check('属性窗口显示 satisfy', /satisfy|满足/.test(propsText), propsText.slice(0, 120))
check('属性窗口显示其规范元类 Dependency', /Dependency/.test(propsText), propsText.slice(0, 200))
check('属性窗口标出「扩展的元类」', /扩展的元类|Extended metaclass/.test(propsText), propsText.slice(0, 240))
await page.evaluate(`(()=>{const e=document.querySelector('${extRow('rel-satisfy')}');
  if(e) e.scrollIntoView({block:'center'}); return 1})()`)
await sleep(300)
await page.screenshot('01-sysml-relationship-subpackage')

console.log('[5] UML 关系子包：28 条元类关系')
await page.evaluate(clickExt('ext-uml'))
check('UML 包下有「关系」子包', await waitFor(page, `!!document.querySelector('${extRow('ext-uml-rel')}')`))
await page.evaluate(clickExt('ext-uml-rel'))
check('association 出现在树里', await waitFor(page, `!!document.querySelector('${extRow('rel-association')}')`))
const visibleRel = await page.evaluate(`[...document.querySelectorAll('[data-tree-kind="extension-element"]')]
  .map(e=>e.getAttribute('data-element-id')).filter(id=>id&&id.startsWith('rel-'))`)
check('两个关系子包展开后共 37 条关系行', visibleRel.length === 37, String(visibleRel.length))
check('含 association / generalization / dependency / transition',
  ['rel-association', 'rel-generalization', 'rel-dependency', 'rel-transition']
    .every((id) => visibleRel.includes(id)), visibleRel.join(','))
await page.evaluate(clickExt('rel-association'))
await sleep(700)
const assocProps = await page.evaluate(`document.querySelector('.props-dock')?.textContent ?? ''`)
check('association 的元类是 Association', /Association/.test(assocProps), assocProps.slice(0, 200))
await page.evaluate(`(()=>{const e=document.querySelector('${extRow('rel-association')}');
  if(e) e.scrollIntoView({block:'center'}); return 1})()`)
await sleep(300)
await page.screenshot('02-uml-relationship-subpackage')

console.log('[6] 关系条目不与项目树混行')
check('项目树里没有 rel-* 的普通行', await page.evaluate(
  `!document.querySelector('.tree-row[data-tree-id^="rel-"]:not([data-tree-kind="extension-element"])')`))
check('扩展域条目全部走扩展包虚拟分组', await page.evaluate(
  `[...document.querySelectorAll('[data-element-id^="rel-"]')]
     .every(e=>e.getAttribute('data-tree-kind')==='extension-element')`))

console.log(`\n${passed} passed, ${failed} failed`)
page.close()
process.exit(failed === 0 ? 0 : 1)
