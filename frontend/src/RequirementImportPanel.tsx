import { useState } from 'react'
import { projectApi } from './api'
import type { ModelElement } from './types'
import type { ImportInput, ImportPreview } from './projectWorkflow'

const FIELDS = [
  { key: 'externalId', label: '外部 ID', names: ['id', 'externalid', '需求id', '编号', '需求编号'] },
  { key: 'parentId', label: '父需求 ID', names: ['parentid', '父id', '父需求id', '上级id'] },
  { key: 'name', label: '需求名称', names: ['name', '名称', '需求名称', '标题'] },
  { key: 'text', label: '正文', names: ['text', 'description', '正文', '需求文本', '需求描述', '描述', '文档'] },
  { key: 'status', label: '状态', names: ['status', '状态', '需求状态'] },
] as const
const ACTIONS = { create: '新增', update: '更新', unchanged: '无变化', error: '错误' }

export function RequirementImportPanel({ project, revision, packages, rootId, onClose, onCommitted }: {
  project: string
  revision: number
  packages: ModelElement[]
  rootId: string
  onClose: () => void
  onCommitted: () => Promise<unknown>
}) {
  const [data, setData] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [source, setSource] = useState('需求清单')
  const [owner, setOwner] = useState(rootId)
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [plan, setPlan] = useState<{ input: ImportInput; result: ImportPreview } | null>(null)
  const [completed, setCompleted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const api = projectApi(project)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const invalidate = () => { setPlan(null); setCompleted(false) }

  const read = (file: File) => run(async () => {
    invalidate()
    setData(null)
    const parsed = await api.upload(file)
    const names = parsed.headers.map(cell => cell.toLowerCase().replace(/[\s_-]+/g, ''))
    setMapping(Object.fromEntries(FIELDS.map(field => [field.key, names.findIndex(name =>
      (field.names as readonly string[]).includes(name))])))
    setData(parsed)
  })

  const preview = () => run(async () => {
    if (!data) return
    const rows = data.rows.flatMap((cells, index) => {
      if (cells.every(value => !value.trim())) return []
      const readCell = (key: string) => cells[mapping[key] ?? -1] ?? ''
      const optional = (key: string) => (mapping[key] ?? -1) >= 0 ? readCell(key) : null
      return [{ line: index + 2, externalId: readCell('externalId'), parentId: optional('parentId'),
        name: readCell('name'), text: optional('text'), status: optional('status') }]
    })
    const input: ImportInput = { baseRevision: revision, source, ownerId: owner, rows }
    invalidate()
    setPlan({ input, result: await api.preview(input) })
  })

  const commit = () => run(async () => {
    if (!plan) return
    const result = await api.commit(plan.input)
    setPlan({ input: plan.input, result })
    setCompleted(!result.errors)
    if (!result.errors) await onCommitted()
  })

  return <div className="project-layer" onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose() }}>
    <section className="project-dialog" role="dialog" aria-modal="true" aria-label="导入需求">
      <header><h2>导入需求</h2><button type="button" disabled={busy} onClick={onClose} aria-label="关闭">关闭</button></header>
      <div className="project-contents">
        <p>选择 Excel 或 UTF-8 CSV。首行是表头，来源与外部 ID 用于匹配已有需求。</p>
        <div className="project-fields">
          <label>需求文件<input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file) void read(file)
          }} /></label>
          <label>来源<input value={source} maxLength={100} onChange={event => { setSource(event.target.value); invalidate() }} /></label>
          <label>目标包<select value={owner} onChange={event => { setOwner(event.target.value); invalidate() }}>
            {packages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
        </div>
        {data && <div className="project-fields">
          {FIELDS.map(field => <label key={field.key}>{field.label}
            <select value={mapping[field.key] ?? -1} onChange={event => {
              setMapping(previous => ({ ...previous, [field.key]: Number(event.target.value) })); invalidate()
            }}>
              <option value={-1}>未映射</option>
              {data.headers.map((name, index) => <option key={index} value={index}>{name || `列 ${index + 1}`}</option>)}
            </select></label>)}
          <button type="button" disabled={busy || !source.trim() || !owner || mapping.externalId < 0 || mapping.name < 0}
            onClick={() => void preview()}>预览导入</button>
        </div>}
        {error && <p role="alert" className="project-error">{error}</p>}
        {plan && <>
          <p role="status">{completed ? '导入完成 · ' : ''}新增 {plan.result.creates} · 更新 {plan.result.updates} · 无变化 {plan.result.unchanged} · 错误 {plan.result.errors}</p>
          {plan.input.baseRevision !== revision && !completed && <p className="project-error">模型版本已变化，请重新预览。</p>}
          <div className="project-grid-scroll"><table className="project-grid"><thead><tr><th>行</th><th>外部 ID</th><th>结果</th><th>详情</th></tr></thead>
            <tbody>{plan.result.rows.map((row, index) => <tr key={index}><td>{row.line}</td><td>{row.externalId}</td><td>{ACTIONS[row.action]}</td><td>{row.message}</td></tr>)}</tbody>
          </table></div>
        </>}
      </div>
      <footer><button type="button" disabled={busy} onClick={onClose}>{completed ? '完成' : '取消'}</button>
        {!completed && <button type="button" className="project-primary" disabled={busy || !plan || plan.result.errors > 0 ||
          plan.input.baseRevision !== revision || !plan.result.creates && !plan.result.updates} onClick={() => void commit()}>提交整批需求</button>}</footer>
    </section>
  </div>
}
