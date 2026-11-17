import type {
  ModelElement,
  ModelSnapshot,
  Relationship,
  ValidationReport,
} from './types'
import { getLocale } from './i18n'

/**
 * 模型交付报告生成器（B4）。
 *
 * <p>纯客户端装配：数据源是当前模型快照 + 服务端权威校验 / 覆盖接口
 * （{@code /api/validation}），不在前端重算任何校验或覆盖规则。产物是一份
 * 自包含、可打印的 HTML 文档——预览用 iframe srcDoc 渲染，导出即同一份字符串，
 * 脱离应用也能打开。所有来自模型的文本一律转义后再插入，杜绝注入。</p>
 */

export interface ReportLabels {
  type: (code: string) => string
  diagram: (kind: string) => string
  relation: (code: string) => string
}

export interface ReportInput {
  projectName: string
  model: ModelSnapshot
  /** 项目元素（已剔除随项目下发的扩展库元类 / 构造型）。 */
  elements: ModelElement[]
  validation: ValidationReport | null
  labels: ReportLabels
  generatedAt: Date
  persistence?: string
}

/** HTML 文本转义：模型里的名称 / 文档 / 标签值都是用户数据，插入前必须转义。 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const TRACE_CODES = new Set(['satisfy', 'verify', 'derivereqt', 'refine', 'trace', 'copy', 'allocate'])

function traceCode(type: string): string | null {
  const normalized = type.toLowerCase().replace(/[^a-z]/g, '')
  return TRACE_CODES.has(normalized) ? normalized : null
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function formatTime(date: Date, zh: boolean): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return zh ? stamp : `${stamp} (local)`
}

/** 标签值渲染成 key=value 小 chip 串（转义后）。 */
function taggedChips(tagged: Record<string, string> | undefined): string {
  const entries = Object.entries(tagged ?? {})
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => `<span class="tag"><b>${esc(key)}</b>=${esc(truncate(value, 60))}</span>`)
    .join(' ')
}

function stereotypeText(stereotypes: string[] | undefined): string {
  const list = (stereotypes ?? []).filter((item) => item.trim() !== '')
  return list.length ? list.map((item) => `«${esc(item)}»`).join(' ') : ''
}

const CSS = `
:root{
  --ink:#1c2430; --ink-2:#46536a; --ink-3:#7a8699;
  --brand:#1890ff; --brand-deep:#096dd9; --brand-soft:#e6f4ff;
  --line:#d7dee8; --line-2:#e7ecf3; --paper:#ffffff; --wash:#f4f7fb;
  --ok:#1f8a4c; --ok-soft:#e4f4ea; --info:#2b6cb0; --info-soft:#e6f0fa;
  --warn:#b7791f; --warn-soft:#fbf0db; --bad:#c0392b; --bad-soft:#fbe7e4;
  --accent:#7048c6;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; color:var(--ink); background:var(--wash);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:13px; line-height:1.6;
}
.sheet{max-width:1080px; margin:0 auto; padding:0 0 64px; background:var(--paper);
  box-shadow:0 1px 40px rgba(28,36,48,.08);}
.cover{position:relative; overflow:hidden; padding:40px 48px 32px;
  background:linear-gradient(135deg,var(--brand-deep) 0%,var(--brand) 52%,#3f74d6 100%); color:#fff;}
.cover::after{content:""; position:absolute; right:-80px; top:-80px; width:320px; height:320px;
  border-radius:50%; background:radial-gradient(circle at center,rgba(255,255,255,.18),transparent 70%);}
.cover .brand{display:flex; align-items:center; gap:10px; font-size:12px; letter-spacing:.16em;
  text-transform:uppercase; opacity:.92; font-weight:600;}
.cover .brand .dot{width:9px; height:9px; border-radius:2px; background:#9fc0ff; box-shadow:0 0 0 4px rgba(159,192,255,.25);}
.cover h1{margin:18px 0 6px; font-size:30px; font-weight:800; letter-spacing:.01em;}
.cover .project{font-size:17px; font-weight:600; opacity:.96;}
.cover .meta{margin-top:18px; display:flex; flex-wrap:wrap; gap:8px 22px; font-size:12px; opacity:.9;}
.cover .meta b{font-weight:700;}
.toc{display:flex; flex-wrap:wrap; gap:8px; padding:18px 48px; background:var(--brand-soft);
  border-bottom:1px solid var(--line);}
.toc a{font-size:12px; font-weight:600; color:var(--brand-deep); text-decoration:none;
  padding:5px 12px; border-radius:999px; background:#fff; border:1px solid var(--line);}
.toc a:hover{border-color:var(--brand); color:var(--brand);}
section{padding:30px 48px 8px;}
.sec-head{display:flex; align-items:baseline; gap:12px; margin:0 0 16px;
  padding-bottom:10px; border-bottom:2px solid var(--brand);}
.sec-head .no{font-size:12px; font-weight:800; color:#fff; background:var(--brand);
  width:24px; height:24px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; flex:none;}
.sec-head h2{margin:0; font-size:19px; font-weight:800; color:var(--ink);}
.sec-head .sub{font-size:12px; color:var(--ink-3); margin-left:auto;}
.cards{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px;}
.card{border:1px solid var(--line); border-top:3px solid var(--brand); border-radius:10px;
  padding:14px 16px; background:linear-gradient(180deg,#fff,var(--wash));}
.card .k{font-size:11px; color:var(--ink-3); font-weight:600; letter-spacing:.04em;}
.card .v{font-size:26px; font-weight:800; color:var(--ink); line-height:1.2; margin-top:2px;}
.card .d{font-size:11px; color:var(--ink-2); margin-top:2px;}
.card.ok{border-top-color:var(--ok)} .card.ok .v{color:var(--ok)}
.card.warn{border-top-color:var(--warn)} .card.warn .v{color:var(--warn)}
.card.bad{border-top-color:var(--bad)} .card.bad .v{color:var(--bad)}
.card.info{border-top-color:var(--info)} .card.info .v{color:var(--info)}
.card.accent{border-top-color:var(--accent)} .card.accent .v{color:var(--accent)}
.grid-2{display:grid; grid-template-columns:1fr 1fr; gap:24px;}
@media(max-width:760px){.grid-2{grid-template-columns:1fr}}
h3.block{font-size:13px; font-weight:700; color:var(--ink-2); margin:18px 0 8px;
  display:flex; align-items:center; gap:8px;}
h3.block::before{content:""; width:4px; height:14px; border-radius:2px; background:var(--brand);}
table{width:100%; border-collapse:collapse; font-size:12px; margin:6px 0 14px;}
thead th{text-align:left; font-weight:700; color:var(--ink-2); background:var(--wash);
  border-bottom:2px solid var(--line); padding:7px 10px; white-space:nowrap;}
tbody td{border-bottom:1px solid var(--line-2); padding:6px 10px; vertical-align:top;}
tbody tr:nth-child(even){background:#fafcfe;}
tbody tr:hover{background:var(--brand-soft);}
td.num,th.num{text-align:right; font-variant-numeric:tabular-nums;}
.name{font-weight:600; color:var(--ink);}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; color:var(--ink-3);}
.muted{color:var(--ink-3);}
.badge{display:inline-block; padding:1px 9px; border-radius:999px; font-size:11px; font-weight:700; white-space:nowrap;}
.badge.ok{background:var(--ok-soft); color:var(--ok);}
.badge.no{background:var(--bad-soft); color:var(--bad);}
.badge.part{background:var(--warn-soft); color:var(--warn);}
.badge.info{background:var(--info-soft); color:var(--info);}
.badge.err{background:var(--bad-soft); color:var(--bad);}
.badge.warn{background:var(--warn-soft); color:var(--warn);}
.tag{display:inline-block; padding:1px 7px; margin:1px 2px 1px 0; border-radius:5px;
  background:var(--wash); border:1px solid var(--line); font-size:11px; color:var(--ink-2);}
.tag b{color:var(--brand-deep); font-weight:700;}
.st{color:var(--accent); font-weight:600; font-size:11px;}
.refs{display:flex; flex-wrap:wrap; gap:3px;}
.ref{display:inline-block; padding:1px 8px; border-radius:5px; font-size:11px; font-weight:600;}
.ref.sat{background:var(--ok-soft); color:var(--ok);}
.ref.ver{background:var(--info-soft); color:var(--info);}
.bar{height:8px; border-radius:999px; background:var(--line-2); overflow:hidden; margin-top:6px;}
.bar > i{display:block; height:100%; background:linear-gradient(90deg,var(--ok),#37b56a);}
.note{font-size:11px; color:var(--ink-3); margin:4px 0 14px;}
.empty{padding:18px; text-align:center; color:var(--ink-3); background:var(--wash);
  border:1px dashed var(--line); border-radius:8px; font-size:12px;}
.legend{display:flex; flex-wrap:wrap; gap:14px; font-size:11px; color:var(--ink-2); margin:4px 0 12px;}
.legend span{display:inline-flex; align-items:center; gap:5px;}
.swatch{width:11px; height:11px; border-radius:3px; display:inline-block;}
footer{margin-top:30px; padding:20px 48px; border-top:1px solid var(--line);
  font-size:11px; color:var(--ink-3); display:flex; flex-wrap:wrap; gap:6px 18px; justify-content:space-between;}
a.anchor{color:inherit; text-decoration:none;}
@media print{
  body{background:#fff; font-size:11px;}
  .sheet{max-width:none; box-shadow:none;}
  .toc{display:none;}
  section{padding:16px 24px 4px; break-inside:auto;}
  .cover{padding:24px; -webkit-print-color-adjust:exact; print-color-adjust:exact;}
  .card,.badge,.ref,.tag,thead th,.cover{-webkit-print-color-adjust:exact; print-color-adjust:exact;}
  tbody tr:hover{background:inherit;}
  table{break-inside:auto;} tr{break-inside:avoid;}
  .sec-head{break-after:avoid;} h3.block{break-after:avoid;}
  @page{margin:14mm;}
}
`

function statCard(kind: string, key: string, value: string | number, detail: string): string {
  return `<div class="card ${kind}"><div class="k">${esc(key)}</div><div class="v">${esc(value)}</div><div class="d">${esc(detail)}</div></div>`
}

function severityBadge(severity: string, zh: boolean): string {
  const label = severity === 'error' ? (zh ? '错误' : 'Error')
    : severity === 'warning' ? (zh ? '警告' : 'Warning')
      : (zh ? '提示' : 'Info')
  const cls = severity === 'error' ? 'err' : severity === 'warning' ? 'warn' : 'info'
  return `<span class="badge ${cls}">${esc(label)}</span>`
}

export function buildModelReportHtml(input: ReportInput): string {
  const zh = getLocale() === 'zh'
  const L = (zhText: string, enText: string) => (zh ? zhText : enText)
  const { model, elements, validation, labels, projectName, generatedAt } = input

  const nameById = new Map<string, string>()
  for (const element of elements) nameById.set(element.id, element.name)
  const nameOf = (id: string) => nameById.get(id) ?? id

  const requirements = elements.filter(
    (element) => element.type.toLowerCase().replace(/[^a-z]/g, '') === 'requirement',
  )
  const coverage = validation?.coverage ?? []
  const summary = validation?.coverageSummary ?? { total: 0, satisfied: 0, verified: 0, fullyCovered: 0 }
  const counts = validation?.counts ?? { error: 0, warning: 0, info: 0 }
  const issues = validation?.issues ?? []

  // 类型分布（项目元素）。
  const byType = new Map<string, number>()
  for (const element of elements) byType.set(element.type, (byType.get(element.type) ?? 0) + 1)
  const typeRows = [...byType.entries()].sort((a, b) => b[1] - a[1])

  // 图类型分布。
  const byKind = new Map<string, number>()
  for (const diagram of model.diagrams) byKind.set(diagram.kind, (byKind.get(diagram.kind) ?? 0) + 1)
  const kindRows = [...byKind.entries()].sort((a, b) => b[1] - a[1])

  // 关系类型分布。
  const relByType = new Map<string, number>()
  for (const relation of model.relationships) relByType.set(relation.type, (relByType.get(relation.type) ?? 0) + 1)
  const relTypeRows = [...relByType.entries()].sort((a, b) => b[1] - a[1])

  const traceRels = model.relationships.filter((relation) => traceCode(relation.type) !== null)

  const title = L('模型交付报告', 'Model Delivery Report')
  const sections: { id: string; no: string; zh: string; en: string }[] = [
    { id: 'overview', no: '1', zh: '概览', en: 'Overview' },
    { id: 'validation', no: '2', zh: '校验摘要', en: 'Validation' },
    { id: 'coverage', no: '3', zh: '需求覆盖矩阵', en: 'Requirement Coverage' },
    { id: 'trace', no: '4', zh: '追溯关系', en: 'Traceability' },
    { id: 'catalog', no: '5', zh: '元素目录', en: 'Element Catalog' },
    { id: 'diagrams', no: '6', zh: '图清单', en: 'Diagrams' },
  ]

  const toc = sections.map((s) => `<a href="#${s.id}">${s.no}. ${esc(L(s.zh, s.en))}</a>`).join('')

  const secHead = (id: string, no: string, zhText: string, enText: string, sub: string) =>
    `<div class="sec-head" id="${id}"><span class="no">${no}</span><h2>${esc(L(zhText, enText))}</h2><span class="sub">${esc(sub)}</span></div>`

  // ── 1 概览 ──
  const overviewCards = [
    statCard('', L('模型元素', 'Elements'), elements.length, L('项目语义对象', 'project semantic objects')),
    statCard('accent', L('关系', 'Relationships'), model.relationships.length, L('含追溯连线', 'incl. traceability links')),
    statCard('info', L('图', 'Diagrams'), model.diagrams.length, L(`${byKind.size} 种图类型`, `${byKind.size} diagram kinds`)),
    statCard('ok', L('需求', 'Requirements'), summary.total || requirements.length, L('覆盖矩阵口径', 'coverage matrix scope')),
    statCard(counts.error > 0 ? 'bad' : 'ok', L('校验错误', 'Errors'), counts.error, L('结构 / 命名 / 悬空引用', 'structural / naming / dangling')),
    statCard(counts.warning > 0 ? 'warn' : 'ok', L('校验警告', 'Warnings'), counts.warning, L('追溯缺口等', 'traceability gaps, etc.')),
    statCard('ok', L('需求全覆盖', 'Fully covered'), `${summary.fullyCovered}/${summary.total}`, L(`满足 ${summary.satisfied} · 验证 ${summary.verified}`, `satisfied ${summary.satisfied} · verified ${summary.verified}`)),
    statCard('info', L('模型版本', 'Revision'), `rev ${model.revision}`, L(input.persistence ? `持久化：${input.persistence}` : '当前快照', input.persistence ? `persistence: ${input.persistence}` : 'current snapshot')),
  ].join('')

  const typeTable = typeRows.length === 0
    ? `<div class="empty">${esc(L('暂无项目元素', 'No project elements'))}</div>`
    : `<table><thead><tr><th>${esc(L('元素类型', 'Element type'))}</th><th class="num">${esc(L('数量', 'Count'))}</th><th class="num">${esc(L('占比', 'Share'))}</th></tr></thead><tbody>${
      typeRows.map(([type, count]) => `<tr><td class="name">${esc(labels.type(type))} <span class="mono">${esc(type)}</span></td><td class="num">${count}</td><td class="num muted">${pct(count, elements.length)}</td></tr>`).join('')
    }</tbody></table>`

  const kindTable = kindRows.length === 0
    ? `<div class="empty">${esc(L('暂无图', 'No diagrams'))}</div>`
    : `<table><thead><tr><th>${esc(L('图类型', 'Diagram kind'))}</th><th class="num">${esc(L('数量', 'Count'))}</th></tr></thead><tbody>${
      kindRows.map(([kind, count]) => `<tr><td class="name">${esc(labels.diagram(kind))} <span class="mono">${esc(kind)}</span></td><td class="num">${count}</td></tr>`).join('')
    }</tbody></table>`

  const overview = `<section>${secHead('overview', '1', '概览', 'Overview', L(`生成于 ${formatTime(generatedAt, true)}`, `generated ${formatTime(generatedAt, false)}`))}
    <div class="cards">${overviewCards}</div>
    <div class="grid-2">
      <div><h3 class="block">${esc(L('元素类型分布', 'Element type distribution'))}</h3>${typeTable}</div>
      <div><h3 class="block">${esc(L('图类型分布', 'Diagram kind distribution'))}</h3>${kindTable}</div>
    </div>
  </section>`

  // ── 2 校验摘要 ──
  const issueCap = 300
  const issueGroup = (severity: 'error' | 'warning' | 'info') => {
    const rows = issues.filter((issue) => issue.severity === severity)
    if (rows.length === 0) return ''
    const shown = rows.slice(0, issueCap)
    const body = shown.map((issue) => `<tr>
      <td>${severityBadge(issue.severity, zh)}</td>
      <td class="mono">${esc(issue.code)}</td>
      <td>${esc(issue.message)}</td>
      <td class="name">${esc(issue.targetName)} <span class="mono">${esc(issue.targetId)}</span></td>
    </tr>`).join('')
    const more = rows.length > issueCap ? `<p class="note">${esc(L(`另有 ${rows.length - issueCap} 条未列出（完整数据见服务端 /api/validation）。`, `${rows.length - issueCap} more not listed (full data at /api/validation).`))}</p>` : ''
    return `<h3 class="block">${esc(L(severity === 'error' ? '错误' : severity === 'warning' ? '警告' : '提示', severity === 'error' ? 'Errors' : severity === 'warning' ? 'Warnings' : 'Info'))} · ${rows.length}</h3>
      <table><thead><tr><th>${esc(L('严重度', 'Severity'))}</th><th>${esc(L('代码', 'Code'))}</th><th>${esc(L('说明', 'Message'))}</th><th>${esc(L('对象', 'Target'))}</th></tr></thead><tbody>${body}</tbody></table>${more}`
  }
  const validationBody = issues.length === 0
    ? `<div class="empty">${esc(validation ? L('校验通过：未发现结构问题或追溯缺口。', 'Validation passed: no structural issues or traceability gaps.') : L('校验数据尚未加载。', 'Validation data not loaded yet.'))}</div>`
    : `${issueGroup('error')}${issueGroup('warning')}${issueGroup('info')}`
  const validationSection = `<section>${secHead('validation', '2', '校验摘要', 'Validation', L(`错误 ${counts.error} · 警告 ${counts.warning} · 提示 ${counts.info}`, `${counts.error} errors · ${counts.warning} warnings · ${counts.info} info`))}
    ${validationBody}
  </section>`

  // ── 3 需求覆盖矩阵 ──
  const coverageRows = coverage.map((row) => {
    const status = row.satisfied && row.verified
      ? `<span class="badge ok">${esc(L('全覆盖', 'Full'))}</span>`
      : row.satisfied || row.verified
        ? `<span class="badge part">${esc(L('部分', 'Partial'))}</span>`
        : `<span class="badge no">${esc(L('缺口', 'Gap'))}</span>`
    const satRefs = row.satisfiedBy.length
      ? `<div class="refs">${row.satisfiedBy.map((ref) => `<span class="ref sat">${esc(ref.name)}</span>`).join('')}</div>`
      : `<span class="muted">—</span>`
    const verRefs = row.verifiedBy.length
      ? `<div class="refs">${row.verifiedBy.map((ref) => `<span class="ref ver">${esc(ref.name)}</span>`).join('')}</div>`
      : `<span class="muted">—</span>`
    return `<tr>
      <td class="name">${esc(row.name)} <span class="mono">${esc(row.id)}</span></td>
      <td>${row.satisfied ? `<span class="badge ok">${esc(L('是', 'Yes'))}</span>` : `<span class="badge no">${esc(L('否', 'No'))}</span>`}</td>
      <td>${row.verified ? `<span class="badge ok">${esc(L('是', 'Yes'))}</span>` : `<span class="badge no">${esc(L('否', 'No'))}</span>`}</td>
      <td>${satRefs}</td>
      <td>${verRefs}</td>
      <td>${status}</td>
    </tr>`
  }).join('')
  const coverageSection = `<section>${secHead('coverage', '3', '需求覆盖矩阵', 'Requirement Coverage', L(`共 ${summary.total} 条需求`, `${summary.total} requirements`))}
    <div class="cards">
      ${statCard('ok', L('已满足', 'Satisfied'), `${summary.satisfied}/${summary.total}`, pct(summary.satisfied, summary.total))}
      ${statCard('info', L('已验证', 'Verified'), `${summary.verified}/${summary.total}`, pct(summary.verified, summary.total))}
      ${statCard('accent', L('全覆盖', 'Fully covered'), `${summary.fullyCovered}/${summary.total}`, pct(summary.fullyCovered, summary.total))}
    </div>
    <div class="bar"><i style="width:${pct(summary.fullyCovered, summary.total)}"></i></div>
    <div class="legend">
      <span><i class="swatch" style="background:var(--ok)"></i>${esc(L('满足来源（satisfy / satisfiedBy）', 'satisfy sources'))}</span>
      <span><i class="swatch" style="background:var(--info)"></i>${esc(L('验证来源（verify / verifiedBy / TestCase）', 'verify sources'))}</span>
    </div>
    ${coverage.length === 0
      ? `<div class="empty">${esc(L('模型中没有需求元素。', 'No requirement elements in the model.'))}</div>`
      : `<table><thead><tr><th>${esc(L('需求', 'Requirement'))}</th><th>${esc(L('满足', 'Satisfied'))}</th><th>${esc(L('验证', 'Verified'))}</th><th>${esc(L('满足来源', 'Satisfied by'))}</th><th>${esc(L('验证来源', 'Verified by'))}</th><th>${esc(L('状态', 'Status'))}</th></tr></thead><tbody>${coverageRows}</tbody></table>`}
  </section>`

  // ── 4 追溯关系 ──
  const traceCap = 1000
  const traceShown = traceRels.slice(0, traceCap)
  const traceRows = traceShown.map((relation) => `<tr>
    <td><span class="badge info">${esc(labels.relation(relation.type))}</span> <span class="mono">${esc(relation.type)}</span></td>
    <td class="name">${esc(nameOf(relation.sourceId))}</td>
    <td class="name">${esc(nameOf(relation.targetId))}</td>
    <td>${stereotypeText(relation.stereotypes) || '<span class="muted">—</span>'}</td>
  </tr>`).join('')
  const relInventory = relTypeRows.length === 0
    ? `<div class="empty">${esc(L('暂无关系', 'No relationships'))}</div>`
    : `<table><thead><tr><th>${esc(L('关系类型', 'Relationship type'))}</th><th class="num">${esc(L('数量', 'Count'))}</th></tr></thead><tbody>${
      relTypeRows.map(([type, count]) => `<tr><td class="name">${esc(labels.relation(type))} <span class="mono">${esc(type)}</span></td><td class="num">${count}</td></tr>`).join('')
    }</tbody></table>`
  const traceSection = `<section>${secHead('trace', '4', '追溯关系', 'Traceability', L(`追溯连线 ${traceRels.length} · 关系总计 ${model.relationships.length}`, `${traceRels.length} trace links · ${model.relationships.length} relationships total`))}
    <h3 class="block">${esc(L('需求追溯连线（satisfy / verify / derive / refine / trace / copy / allocate）', 'Requirement trace links'))}</h3>
    ${traceRels.length === 0
      ? `<div class="empty">${esc(L('尚未建立需求追溯连线。', 'No requirement trace links yet.'))}</div>`
      : `<table><thead><tr><th>${esc(L('类型', 'Type'))}</th><th>${esc(L('源', 'Source'))}</th><th>${esc(L('目标', 'Target'))}</th><th>${esc(L('构造型', 'Stereotypes'))}</th></tr></thead><tbody>${traceRows}</tbody></table>
        ${traceRels.length > traceCap ? `<p class="note">${esc(L(`另有 ${traceRels.length - traceCap} 条未列出。`, `${traceRels.length - traceCap} more not listed.`))}</p>` : ''}`}
    <h3 class="block">${esc(L('关系类型清单', 'Relationship inventory'))}</h3>
    ${relInventory}
  </section>`

  // ── 5 元素目录 ──
  const catalogCap = 400
  const catalogGroups = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => {
    const rows = elements.filter((element) => element.type === type)
    const shown = rows.slice(0, catalogCap)
    const body = shown.map((element) => `<tr>
      <td class="name">${esc(element.name)} <span class="mono">${esc(element.id)}</span></td>
      <td>${stereotypeText(element.stereotypes) || '<span class="muted">—</span>'}</td>
      <td>${taggedChips(element.taggedValues) || '<span class="muted">—</span>'}</td>
      <td class="muted">${element.documentation ? esc(truncate(element.documentation, 160)) : '—'}</td>
    </tr>`).join('')
    const more = rows.length > catalogCap ? `<p class="note">${esc(L(`另有 ${rows.length - catalogCap} 个未列出（完整数据见 XMI 导出）。`, `${rows.length - catalogCap} more not listed (see XMI export).`))}</p>` : ''
    return `<h3 class="block">${esc(labels.type(type))} <span class="mono">${esc(type)}</span> · ${rows.length}</h3>
      <table><thead><tr><th>${esc(L('名称', 'Name'))}</th><th>${esc(L('构造型', 'Stereotypes'))}</th><th>${esc(L('标签值', 'Tagged values'))}</th><th>${esc(L('文档', 'Documentation'))}</th></tr></thead><tbody>${body}</tbody></table>${more}`
  }).join('')
  const catalogSection = `<section>${secHead('catalog', '5', '元素目录', 'Element Catalog', L(`${elements.length} 个元素 · 按类型分组`, `${elements.length} elements · grouped by type`))}
    ${elements.length === 0 ? `<div class="empty">${esc(L('暂无项目元素', 'No project elements'))}</div>` : catalogGroups}
  </section>`

  // ── 6 图清单 ──
  const diagramRows = [...model.diagrams].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map((diagram) => `<tr>
    <td class="name">${esc(diagram.name)} <span class="mono">${esc(diagram.id)}</span></td>
    <td>${esc(labels.diagram(diagram.kind))} <span class="mono">${esc(diagram.kind)}</span></td>
    <td class="num">${diagram.elementIds.length}</td>
    <td class="num">${diagram.relationshipIds.length}</td>
    <td class="muted">${esc(diagram.ownerId ? nameOf(diagram.ownerId) : L('项目根', 'project root'))}</td>
  </tr>`).join('')
  const diagramSection = `<section>${secHead('diagrams', '6', '图清单', 'Diagrams', L(`${model.diagrams.length} 张图`, `${model.diagrams.length} diagrams`))}
    ${model.diagrams.length === 0
      ? `<div class="empty">${esc(L('暂无图', 'No diagrams'))}</div>`
      : `<table><thead><tr><th>${esc(L('图名', 'Diagram'))}</th><th>${esc(L('类型', 'Kind'))}</th><th class="num">${esc(L('元素数', 'Elements'))}</th><th class="num">${esc(L('关系数', 'Relationships'))}</th><th>${esc(L('所有者', 'Owner'))}</th></tr></thead><tbody>${diagramRows}</tbody></table>`}
  </section>`

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(projectName)} · ${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="sheet">
  <div class="cover">
    <div class="brand"><span class="dot"></span>Scofen Modeler Studio</div>
    <h1>${esc(title)}</h1>
    <div class="project">${esc(projectName)}</div>
    <div class="meta">
      <span><b>${esc(L('生成时间', 'Generated'))}：</b>${esc(formatTime(generatedAt, zh))}</span>
      <span><b>${esc(L('模型版本', 'Revision'))}：</b>rev ${esc(model.revision)}</span>
      <span><b>${esc(L('元素', 'Elements'))}：</b>${elements.length}</span>
      <span><b>${esc(L('关系', 'Relationships'))}：</b>${model.relationships.length}</span>
      <span><b>${esc(L('图', 'Diagrams'))}：</b>${model.diagrams.length}</span>
    </div>
  </div>
  <nav class="toc">${toc}</nav>
  ${overview}
  ${validationSection}
  ${coverageSection}
  ${traceSection}
  ${catalogSection}
  ${diagramSection}
  <footer>
    <span>${esc(L('本报告由模型快照实时生成；校验与覆盖数据来自服务端权威接口 /api/validation。', 'Generated live from the model snapshot; validation & coverage from the authoritative /api/validation endpoint.'))}</span>
    <span>Scofen Modeler Studio · rev ${esc(model.revision)} · ${esc(formatTime(generatedAt, zh))}</span>
  </footer>
</div>
</body>
</html>`
}