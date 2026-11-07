/**
 * 属性栏三件套的浏览器级实测：
 *   1) 标准 / 专家 / 全部 收进属性栏右上角下拉；
 *   2) 可编辑属性行尾「⋯」打开弹框，按值类型分流（字符 / 数组 / 模型引用 / 枚举）；
 *   3) 按属性 key 搜索与升序 / 降序排序。
 *
 * 走真实 UI（headless Chrome + CDP），修改过的属性末尾都用撤销栈恢复。
 * 运行方式见 tools/verify/README.md：Chrome 必须与本脚本在同一次 Bash 调用内启动。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:18080/'
const PORT = Number(process.env.CDP_PORT ?? 9446)
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SHOTS = '/tmp/scofen-prop-shots'

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

/** React 受控输入：必须用原生 value setter 再派发 input 事件。 */
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

/** 页面内取当前项目快照：相对路径，兼容子路径部署。 */
const authHeaders = `{'Authorization':'Bearer '+localStorage.getItem('scofen.modeler.token')}`
const snapshotExpr = `(async()=>{const r=await fetch('api/model',{headers:${authHeaders}});return await r.json()})()`
const catalogExpr = `(async()=>{const r=await fetch('api/metamodel/properties',{headers:${authHeaders}});return await r.json()})()`
const undoExpr = `(async()=>{const r=await fetch('api/commands/undo',{method:'POST',headers:{...${authHeaders},'X-Scofen-Session':'web-ui'}});return r.status})()`

const clickText = (scope, text) => `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope + ' button')})]
  .find(x=>x.textContent.trim()===${JSON.stringify(text)}); if(!b) return 0; b.click(); return 1})()`

const openSearch = async (page, keyword) => {
  if (!await page.evaluate(`!!document.querySelector('.prop-search-row input')`)) {
    await page.evaluate(`document.querySelectorAll('.prop-tool')[0].click()`)
    await waitFor(page, `!!document.querySelector('.prop-search-row input')`)
  }
  await page.evaluate(setInputExpr('.prop-search-row input', keyword))
  await sleep(280)
}

const page = await connect()
await page.goto(APP_URL)

console.log('[1] 登录并选中一个模型元素')
await waitFor(page, `!!document.querySelector('input[name="scofen-admin-username"]')`)
await page.evaluate(`(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
 set(document.querySelector('input[name="scofen-admin-username"]'),'scofen');
 set(document.querySelector('input[name="scofen-admin-password"]'),${JSON.stringify(PASSWORD)});
 [...document.querySelectorAll('button')].find(b=>/登录/.test(b.textContent)).click();return 1})()`)
check('登录成功进入工作台', await waitFor(page, `!!document.querySelector('.props-dock')`, 120, 250))
await sleep(1800)
const pickedId = await page.evaluate(`(()=>{const rows=[...document.querySelectorAll('.tree-row[data-tree-id]')];
  const row=rows.find(r=>!r.classList.contains('root-node')&&!r.classList.contains('relation')) ?? rows[0];
  if(!row) return null; row.click(); return row.getAttribute('data-tree-id')})()`)
check('选中模型树元素', !!pickedId, String(pickedId))
check('属性工具栏随选中对象出现', await waitFor(page, `!!document.querySelector('.props-dock .prop-toolbar')`, 60, 250))
check('属性行渲染出来', await waitFor(page, `document.querySelectorAll('.prop-row').length > 0`, 60, 250))

console.log('[2] 工具栏与右上角档位下拉')
check('属性栏工具栏存在', await page.evaluate(`!!document.querySelector('.props-dock .prop-toolbar')`))
check('档位下拉位于工具栏右侧', await page.evaluate(`(()=>{const bar=document.querySelector('.prop-toolbar'),sel=document.querySelector('.prop-view-select');
  if(!bar||!sel) return false; const b=bar.getBoundingClientRect(),s=sel.getBoundingClientRect();
  return s.left > b.left + b.width/2 && Math.abs(s.top-b.top) < 30})()`))
check('下拉含标准 / 专家 / 全部三档', await page.evaluate(
  `[...document.querySelectorAll('.prop-view-select option')].map(o=>o.value).join(',') === 'STANDARD,EXPERT,ALL'`))
const countStandard = await page.evaluate(`document.querySelectorAll('.prop-row').length`)
await page.evaluate(setSelectExpr('.prop-view-select', 'EXPERT'))
await sleep(260)
const countExpert = await page.evaluate(`document.querySelectorAll('.prop-row').length`)
await page.evaluate(setSelectExpr('.prop-view-select', 'ALL'))
await sleep(260)
const countAll = await page.evaluate(`document.querySelectorAll('.prop-row').length`)
check('专家档不少于标准档', countExpert >= countStandard, `${countStandard} → ${countExpert}`)
check('全部档多于标准档', countAll > countStandard, `${countStandard} → ${countAll}`)
check('全部档含只读行且只读行没有三点按钮', await page.evaluate(
  `document.querySelectorAll('.prop-row.readonly').length > 0 && !document.querySelector('.prop-row.readonly .prop-more')`))
await page.screenshot('01-toolbar-all')
await page.evaluate(setSelectExpr('.prop-view-select', 'STANDARD'))
await sleep(260)

console.log('[3] 按属性 key 搜索')
await openSearch(page, 'name')
const nameKeys = await page.evaluate(`[...document.querySelectorAll('.prop-row')].map(r=>r.dataset.propKey)`)
check('搜索 name 命中 name 属性', nameKeys.includes('name'), JSON.stringify(nameKeys))
check('搜索结果都被收敛', nameKeys.length > 0 && nameKeys.length < countAll,
  `命中 ${nameKeys.length} / 全部 ${countAll}`)
check('匹配计数显示', await page.evaluate(`!!document.querySelector('.prop-search-count')`))
await openSearch(page, 'zzzz-no-such-key')
check('无结果显示空态提示', await page.evaluate(
  `[...document.querySelectorAll('.prop-list .hint')].some(h=>h.textContent.includes('没有匹配'))`))
await openSearch(page, '')
await page.evaluate(`document.querySelector('.prop-search-close')?.click()`)
check('搜索框可关闭', await page.evaluate(`!document.querySelector('.prop-search-row')`))

console.log('[4] 按属性 key 排序')
await page.evaluate(`document.querySelector('.prop-sort-tool').click()`)
await sleep(280)
const asc = await page.evaluate(`[...document.querySelectorAll('.prop-row')].map(r=>r.dataset.propKey)`)
check('升序：全局按 key 排列', asc.length > 1 && asc.every((k, i) => i === 0 || asc[i - 1].localeCompare(k, 'en') <= 0),
  asc.slice(0, 6).join(','))
check('升序：分组标题说明排序方式', await page.evaluate(
  `[...document.querySelectorAll('.prop-group-head')].some(h=>h.textContent.includes('按属性 key 升序'))`))
await page.screenshot('02-sorted-asc')
await page.evaluate(`document.querySelector('.prop-sort-tool').click()`)
await sleep(280)
const desc = await page.evaluate(`[...document.querySelectorAll('.prop-row')].map(r=>r.dataset.propKey)`)
check('降序：全局按 key 倒排', desc.length > 1 && desc.every((k, i) => i === 0 || desc[i - 1].localeCompare(k, 'en') >= 0),
  desc.slice(0, 6).join(','))
await page.evaluate(`document.querySelector('.prop-sort-tool').click()`)
await sleep(280)
check('第三击恢复规范顺序分组', await page.evaluate(
  `![...document.querySelectorAll('.prop-group-head')].some(h=>h.textContent.includes('按属性 key'))`))

console.log('[5] 「⋯」弹框：字符型属性编辑 + 撤销恢复')
const snap0 = await page.evaluate(snapshotExpr, true)
const beforeName = snap0.elements.find((e) => e.id === pickedId)?.name ?? ''
check('快照里能找到选中元素', !!beforeName, pickedId)
check('可编辑行有三点按钮', await page.evaluate(`!!document.querySelector('.prop-row[data-prop-key="name"] .prop-more')`))
await page.evaluate(`document.querySelector('.prop-row[data-prop-key="name"] .prop-more').click()`)
check('弹框打开', await waitFor(page, `!!document.querySelector('.prop-dialog')`))
check('弹框标题与属性 key', await page.evaluate(`(()=>{const d=document.querySelector('.prop-dialog');
  return !!d && d.textContent.includes('编辑属性') && d.querySelector('.prop-dlg-meta code')?.textContent === 'name'})()`))
await page.evaluate(setInputExpr('.prop-dialog .prop-dlg-field input', `${beforeName}-E2E`))
await page.evaluate(clickText('.prop-dialog .modal-actions', '应用'))
check('应用后行内值更新', await waitFor(page,
  `document.querySelector('.prop-row[data-prop-key="name"] .prop-static-value')?.textContent?.includes('-E2E')`, 40, 250))
await sleep(500)
const snap1 = await page.evaluate(snapshotExpr, true)
const afterName = snap1.elements.find((e) => e.id === pickedId)?.name ?? ''
check('服务端快照已写入新名称', afterName === `${beforeName}-E2E`, `${beforeName} → ${afterName}`)
await page.screenshot('03-dialog-name')
const undo1 = await page.evaluate(undoExpr, true)
check('撤销命令成功', undo1 === 200, String(undo1))
await sleep(700)
const snap2 = await page.evaluate(snapshotExpr, true)
check('撤销后名称恢复', snap2.elements.find((e) => e.id === pickedId)?.name === beforeName)

console.log('[6] 「⋯」弹框：数组型属性（构造型）')
await openSearch(page, 'stereotypes')
check('搜索到 stereotypes 行', await page.evaluate(`!!document.querySelector('.prop-row[data-prop-key="stereotypes"]')`))
await page.evaluate(`document.querySelector('.prop-row[data-prop-key="stereotypes"] .prop-more')?.click()`)
check('数组编辑器出现', await waitFor(page, `!!document.querySelector('.prop-dialog .prop-list-editor')`))
check('数组弹框底部是「完成」而非「应用」', await page.evaluate(`(()=>{const d=document.querySelector('.prop-dialog');
  return [...d.querySelectorAll('.modal-actions button')].some(b=>b.textContent.trim()==='完成')
    && ![...d.querySelectorAll('.modal-actions button')].some(b=>b.textContent.trim()==='应用')})()`))
await page.evaluate(setInputExpr('.prop-dialog .prop-inline-add input', 'E2E_Stereotype'))
await page.evaluate(clickText('.prop-dialog .prop-inline-add', '添加'))
check('新值以 chip 呈现', await waitFor(page,
  `document.querySelector('.prop-dialog .prop-chips')?.textContent?.includes('E2E_Stereotype')`, 40, 250))
await sleep(500)
const snap3 = await page.evaluate(snapshotExpr, true)
check('服务端快照写入构造型数组', (snap3.elements.find((e) => e.id === pickedId)?.stereotypes ?? []).includes('E2E_Stereotype'))
await page.screenshot('04-dialog-list')
const undo2 = await page.evaluate(undoExpr, true)
check('撤销命令成功', undo2 === 200, String(undo2))
await page.evaluate(clickText('.prop-dialog .modal-actions', '完成'))
await sleep(600)
const snap4 = await page.evaluate(snapshotExpr, true)
check('撤销后构造型恢复', !(snap4.elements.find((e) => e.id === pickedId)?.stereotypes ?? []).includes('E2E_Stereotype'))
await page.evaluate(`document.querySelector('.prop-search-close')?.click()`)

console.log('[7] 「⋯」弹框：模型引用 / 枚举等其它类型')
const catalog = await page.evaluate(catalogExpr, true)
const allSpecs = Object.values(catalog.types ?? {}).flatMap((entry) => entry.properties ?? [])
const refKey = allSpecs.find((s) => s.editable && s.kind === 'REFERENCE' && s.referencesElement !== false)?.key
const enumKey = allSpecs.find((s) => s.editable && (s.kind === 'ENUM' || s.kind === 'BOOLEAN'))?.key
await page.evaluate(setSelectExpr('.prop-view-select', 'ALL'))
await sleep(260)
if (refKey) {
  await openSearch(page, refKey)
  const hasRow = await page.evaluate(`(k=>!!document.querySelector('.prop-row[data-prop-key="'+k+'"]'))(${JSON.stringify(refKey)})`)
  check(`引用型属性 ${refKey} 可见`, hasRow)
  if (hasRow) {
    await page.evaluate(`(k=>document.querySelector('.prop-row[data-prop-key="'+k+'"] .prop-more')?.click())(${JSON.stringify(refKey)})`)
    check('引用弹框列出模型元素候选', await waitFor(page,
      `document.querySelectorAll('.prop-dialog .prop-ref-option').length > 0`, 40, 250))
    await page.screenshot('05-dialog-reference')
    await page.evaluate(clickText('.prop-dialog .prop-ref-picker-wrap', '取消'))
  }
} else {
  check('存在可编辑的引用型属性', false, '元属性目录里没有该类型')
}
if (enumKey) {
  await openSearch(page, enumKey)
  const hasRow = await page.evaluate(`(k=>!!document.querySelector('.prop-row[data-prop-key="'+k+'"]'))(${JSON.stringify(enumKey)})`)
  check(`枚举 / 布尔属性 ${enumKey} 可见`, hasRow)
  if (hasRow) {
    await page.evaluate(`(k=>document.querySelector('.prop-row[data-prop-key="'+k+'"] .prop-more')?.click())(${JSON.stringify(enumKey)})`)
    check('枚举 / 布尔弹框用下拉选择', await waitFor(page, `!!document.querySelector('.prop-dialog .prop-dlg-field select')`))
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    check('Esc 关闭弹框', await waitFor(page, `!document.querySelector('.prop-dialog')`, 30, 200))
  }
}
await page.evaluate(`document.querySelector('.prop-search-close')?.click()`)
await page.evaluate(setSelectExpr('.prop-view-select', 'STANDARD'))
await sleep(260)

console.log('[8] 收尾：数据无残留')
const snapEnd = await page.evaluate(snapshotExpr, true)
const endElement = snapEnd.elements.find((e) => e.id === pickedId)
check('元素名称恢复为原始值', endElement?.name === beforeName, String(endElement?.name))
check('构造型无 E2E 残留', !(endElement?.stereotypes ?? []).includes('E2E_Stereotype'))
await page.screenshot('06-final')

console.log(`\n结果：${passed} 通过 / ${failed} 失败；截图目录 ${SHOTS}`)
page.close()
process.exit(failed === 0 ? 0 : 1)
