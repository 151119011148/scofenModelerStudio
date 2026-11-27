import { useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { ContainmentSpec, ElementTypeInfo, ModelElement, Relationship, RelationshipTypeInfo, ValidationReport } from './types'
import type { MatrixLink, SavedView, ViewSettings } from './projectWorkflow'
import { svgUrl } from './iconAssets'
import { TypeIcon } from './icons'
import { pick, t } from './i18n'

export type TableViewId = 'requirement-table' | 'generic-table' | 'generic-matrix' | 'satisfy-matrix' | 'verify-matrix'

export const TABLE_VIEWS: { id: TableViewId; label: string; labelEn: string; icon: string }[] = [
  { id: 'requirement-table', label: '需求表', labelEn: 'Requirement Table', icon: 'RequirementTable' },
  { id: 'generic-table', label: '通用表', labelEn: 'Generic Table', icon: 'GenericTable' },
  { id: 'generic-matrix', label: '通用矩阵', labelEn: 'General Matrix', icon: 'DiagramMatrix' },
  { id: 'satisfy-matrix', label: '需求满足矩阵', labelEn: 'Satisfy Matrix', icon: 'DiagramMatrix' },
  { id: 'verify-matrix', label: '需求验证矩阵', labelEn: 'Verify Matrix', icon: 'DiagramMatrix' },
]

export const tableViewLabel = (id: TableViewId): string => {
  const found = TABLE_VIEWS.find(item => item.id === id)
  return found ? pick(found.label, found.labelEn) : id
}

export const tableViewIcon = (id: TableViewId): string =>
  TABLE_VIEWS.find(item => item.id === id)?.icon ?? 'GenericTable'

export interface TableViewProps {
  view: TableViewId
  elements: ModelElement[]
  relationships: Relationship[]
  relations: RelationshipTypeInfo[]
  containment: ContainmentSpec | null
  validation: ValidationReport | null
  projectRootId: string | null
  selectedId: string | null
  busy: boolean
  canEdit: boolean
  canImport: boolean
  canExport: boolean
  canDelete: boolean
  typeInfo: Map<string, ElementTypeInfo>
  savedViews: SavedView[]
  onSaveView: (view: SavedView) => Promise<SavedView>
  onDeleteView: (id: string) => Promise<unknown>
  onImport: () => void
  onSelectElement: (id: string) => void
  onSelectRelation: (id: string) => void
  onReferenceContextMenu: (event: ReactMouseEvent, kind: 'element' | 'relation', id: string) => void
  onRename: (id: string, name: string) => void
  onDocumentation: (id: string, doc: string) => void
  onProperty: (id: string, key: string, value: string) => void
  onOpenCreate: (ownerId: string) => void
  onCreateQuickElement: (kind: 'requirement' | 'generic', ownerId: string, typeCode?: string) => void
  onMatrix: (links: MatrixLink[]) => Promise<unknown>
}

const shortType = (type: string) => type.split('::').at(-1)?.trim() ?? type
const norm = (value: string) => shortType(value).toLowerCase().replace(/[-_\s]/g, '')
const isRequirement = (element: ModelElement) =>
  norm(element.type).includes('requirement') || element.stereotypes.some(stereotype => norm(stereotype).includes('requirement'))

const REQUIREMENT_COLUMNS = {
  id: '需求 ID', name: '名称', type: '类型', text: '需求正文', satisfy: '满足来源', verify: '验证来源', status: '需求状态', execution: '测试结果',
}
const STATUS_LABELS: Record<string, string> = { draft: '草稿', in_review: '评审中', approved: '已批准' }
const RESULT_LABELS = { pass: '通过', fail: '未通过', missing: '缺测试结果' }
const columnIds = Object.keys(REQUIREMENT_COLUMNS)
const cellId = (source: string, target: string) => JSON.stringify([source, target])

function defaultSettings(view: TableViewId): ViewSettings {
  const preset = view === 'satisfy-matrix' || view === 'verify-matrix'
  return { scopeId: '', query: '', mode: 'list', sort: 'name', columns: columnIds,
    rowType: preset ? 'Requirement' : '', columnType: view === 'verify-matrix' ? 'TestCase' : preset ? 'Block' : '',
    relationType: view === 'verify-matrix' ? 'verify' : 'satisfy', swapped: false, missing: '' }
}

function EditableCell({ value, onCommit, disabled, multiline }: {
  value: string; onCommit: (next: string) => void; disabled: boolean; multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) return <button type="button" className="tv-cell-edit" disabled={disabled} title={t('点击编辑')}
    onClick={() => { setDraft(value); setEditing(true) }}>{value || '—'}</button>
  const commit = () => { setEditing(false); if (draft !== value) onCommit(draft) }
  if (multiline) return <textarea className="tv-cell-input" aria-label="编辑需求正文" rows={3} autoFocus value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setEditing(false) }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commit()
    }} />
  return <input className="tv-cell-input" autoFocus value={draft} aria-label="编辑单元格"
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') commit()
      if (event.key === 'Escape') { event.stopPropagation(); setEditing(false) }
    }} />
}

function exportCsv(rows: string[][], filename: string) {
  const text = rows.map(row => row.map(value => {
    const literal = /^\s*[=+\-@\t\r]/.test(value) ? "'" + value : value
    return '"' + literal.replace(/"/g, '""') + '"'
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function TableView(props: TableViewProps) {
  const { view, elements, relationships, relations, containment, validation, projectRootId, selectedId, busy, canEdit,
    canExport, canImport, canDelete, typeInfo, savedViews, onSelectElement, onReferenceContextMenu, onRename, onDocumentation,
    onProperty, onOpenCreate, onCreateQuickElement, onMatrix } = props
  const [settings, setSettings] = useState(() => defaultSettings(view))
  const [savedId, setSavedId] = useState('')
  const [viewName, setViewName] = useState('')
  const [viewError, setViewError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedCells, setSelectedCells] = useState<{ source: string; target: string }[]>([])
  const [matrixBusy, setMatrixBusy] = useState(false)
  const [matrixPage, setMatrixPage] = useState({ row: 0, column: 0 })
  const set = (values: Partial<ViewSettings>) => {
    setSettings(previous => ({ ...previous, ...values }))
    setSelectedCells([])
    setMatrixPage({ row: 0, column: 0 })
  }
  const { query, mode, sort, scopeId, rowType, columnType, swapped, missing } = settings
  const byId = useMemo(() => new Map(elements.map(element => [element.id, element])), [elements])
  const coverage = useMemo(() => new Map(validation?.coverage.map(item => [item.id, item]) ?? []), [validation])
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    elements.forEach(element => {
      const code = typeInfo.get(shortType(element.type))?.code ?? shortType(element.type)
      counts.set(code, (counts.get(code) ?? 0) + 1)
    })
    return [...counts.entries()].map(([code, count]) => {
      const info = typeInfo.get(code)
      return { code, count, label: info ? pick(info.label, info.labelEn) : code }
    }).sort((a, b) => a.label.localeCompare(b.label))
  }, [elements, typeInfo])
  const relationLookup = useMemo(() => {
    const grouped = new Map<string, Relationship[]>()
    relationships.forEach(relation => {
      const key = cellId(relation.sourceId, relation.targetId)
      const group = grouped.get(key) ?? []
      group.push(relation)
      grouped.set(key, group)
    })
    return grouped
  }, [relationships])
  const relationSpecs = useMemo(() => new Map(relations.map(relation => [norm(relation.code), relation])), [relations])
  const ownerOf = (element: ModelElement) => byId.get(element.ownerId ?? '')
  const field = (element: ModelElement, key: string) => String(element.properties?.[key] ?? '')
  const businessId = (element: ModelElement) => field(element, 'id') || element.xmiId || element.id
  const statusOf = (element: ModelElement) => field(element, 'requirementStatus') || 'draft'
  const executionOf = (id: string) => validation?.results?.[id] ?? 'missing'
  const scopeElements = elements.filter(element => norm(element.type) === 'package')
  const inScope = (element: ModelElement) => {
    if (!scopeId) return true
    const seen = new Set<string>()
    for (let cursor: ModelElement | undefined = element; cursor && !seen.has(cursor.id); cursor = byId.get(cursor.ownerId ?? '')) {
      if (cursor.id === scopeId) return true
      seen.add(cursor.id)
    }
    return false
  }
  const match = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase())
  const sorted = (a: ModelElement, b: ModelElement) =>
    (sort === 'id' ? businessId(a).localeCompare(businessId(b), undefined, { numeric: true })
      : sort === 'status' ? statusOf(a).localeCompare(statusOf(b)) : a.name.localeCompare(b.name)) || a.name.localeCompare(b.name)
  const missingFilter = (id: string) => missing === 'satisfy' ? !coverage.get(id)?.satisfied
    : missing === 'verify' ? !coverage.get(id)?.verified : missing === 'evidence' ? executionOf(id) === 'missing' : true
  const matchPreset = (element: ModelElement, code: string) => norm(typeInfo.get(shortType(element.type))?.code ?? element.type) === norm(code)
  const choices = savedViews.filter(saved => saved.kind === view)
  const runViewAction = async (action: () => Promise<void>) => {
    setSaving(true)
    setViewError('')
    try { await action() } catch (reason) { setViewError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  const pickView = (id: string) => {
    const found = choices.find(saved => saved.id === id)
    setSavedId(id)
    setViewName(found?.name ?? '')
    set(found?.settings ?? defaultSettings(view))
  }
  const saveView = (existing: boolean) => runViewAction(async () => {
    const saved = await props.onSaveView({ kind: view, id: existing ? savedId : '', name: viewName, settings })
    setSavedId(saved.id)
    setViewName(saved.name)
  })
  const toolbar = (extra: ReactNode) => <div className="vt-toolbar project-view-actions">
    <strong>{tableViewLabel(view)}</strong>
    <input className="vt-search" aria-label="筛选模型对象" placeholder={t('搜索名称 / 类型…')} value={query} onChange={event => set({ query: event.target.value })} />
    <select value={scopeId} aria-label="包范围" onChange={event => set({ scopeId: event.target.value })}>
      <option value="">项目全部包</option>
      {scopeId && !scopeElements.some(element => element.id === scopeId) && <option value={scopeId}>原包已移除</option>}
      {scopeElements.map(element => <option key={element.id} value={element.id}>{element.name}</option>)}
    </select>
    <select value={sort} aria-label="排序" onChange={event => set({ sort: event.target.value })}>
      <option value="name">按名称排序</option><option value="id">按 ID 排序</option><option value="status">按状态排序</option>
    </select>
    <select aria-label="共享视图" value={savedId} onChange={event => pickView(event.target.value)}>
      <option value="">默认视图</option>
      {choices.map(saved => <option key={saved.id} value={saved.id}>{saved.name}</option>)}
    </select>
    {canEdit && <><input type="text" aria-label="共享视图名称" placeholder="视图名称" value={viewName} maxLength={120} onChange={event => setViewName(event.target.value)} />
      <button type="button" disabled={saving || !viewName.trim()} onClick={() => void saveView(false)}>保存新视图</button>
      {savedId && <><button type="button" disabled={saving || !viewName.trim()} onClick={() => void saveView(true)}>更新视图</button>
        <button type="button" disabled={saving} onClick={() => void runViewAction(async () => { await props.onDeleteView(savedId); pickView('') })}>移除视图</button></>}</>}
    {extra}
    {viewError && <span className="project-error" role="alert">{viewError}</span>}
  </div>

  const gapSelect = <select value={missing} aria-label="缺口筛选" onChange={event => set({ missing: event.target.value })}>
    <option value="">全部覆盖状态</option><option value="satisfy">缺满足关系</option><option value="verify">缺验证关系</option>
    <option value="evidence">缺测试结果</option>
  </select>
  const nameCell = (element: ModelElement, indent = 0) => <span className="tv-name" style={{ paddingLeft: indent * 14 }}>
    <TypeIcon code={shortType(element.type)} size={14} /><EditableCell value={element.name} disabled={!canEdit || busy}
      onCommit={name => onRename(element.id, name)} />
  </span>
  const changesFor = (links: MatrixLink[]) => {
    setMatrixBusy(true)
    void runViewAction(async () => { await onMatrix(links); setSelectedCells([]) }).finally(() => setMatrixBusy(false))
  }

  if (view === 'requirement-table') {
    const rows = elements.filter(isRequirement).filter(inScope).filter(element => missingFilter(element.id))
      .filter(element => match([element.name, businessId(element), element.type, field(element, 'text') || element.documentation].join(' '))).sort(sorted)
    const columns = columnIds.filter(key => settings.columns.includes(key)) as (keyof typeof REQUIREMENT_COLUMNS)[]
    const activeColumns = columns.length ? columns : ['name'] as const
    const depthOf = (element: ModelElement) => {
      let depth = 0
      for (let cursor = byId.get(element.ownerId ?? ''); cursor && depth < 8 && isRequirement(cursor); cursor = byId.get(cursor.ownerId ?? '')) depth++
      return depth
    }
    const cell = (element: ModelElement, key: keyof typeof REQUIREMENT_COLUMNS) => {
      const editable = !canEdit || busy || norm(element.type) !== 'requirement'
      const refs = coverage.get(element.id)
      switch (key) {
        case 'id': return <EditableCell value={field(element, 'id') || element.xmiId || ''} disabled={editable} onCommit={value => onProperty(element.id, 'id', value)} />
        case 'name': return nameCell(element, mode === 'tree' ? depthOf(element) : 0)
        case 'type': return shortType(element.type)
        case 'text': return <EditableCell value={element.properties?.text == null ? element.documentation : field(element, 'text')}
          disabled={editable} multiline onCommit={value => onProperty(element.id, 'text', value)} />
        case 'status': return <select aria-label="需求状态" value={statusOf(element)} disabled={editable} onChange={event => onProperty(element.id, 'requirementStatus', event.target.value)}>
          {Object.entries(STATUS_LABELS).map(([id, value]) => <option key={id} value={id}>{value}</option>)}</select>
        case 'satisfy':
        case 'verify': return ((key === 'satisfy' ? refs?.satisfiedBy : refs?.verifiedBy) ?? []).map(ref =>
          <button type="button" key={ref.id} onClick={() => onSelectElement(ref.id)}
            onContextMenu={event => onReferenceContextMenu(event, 'element', ref.id)}>{ref.name}</button>)
        case 'execution': return RESULT_LABELS[executionOf(element.id)]
      }
    }
    return <section className="table-view" data-table-view="requirement">
      {toolbar(<>{gapSelect}
        <details className="project-table-columns"><summary>显示列</summary><div>{columnIds.map(id => <label key={id}>
          <input type="checkbox" checked={settings.columns.includes(id)} onChange={event => set({
            columns: event.target.checked ? [...settings.columns, id] : settings.columns.filter(key => key !== id),
          })} />{REQUIREMENT_COLUMNS[id as keyof typeof REQUIREMENT_COLUMNS]}</label>)}</div></details>
        <button type="button" disabled={!canEdit || busy} onClick={() => onCreateQuickElement('requirement', scopeId || projectRootId || '', 'Requirement')}>{t('新建需求')}</button>
        {canImport && <button type="button" disabled={busy} onClick={props.onImport}>导入 Excel / CSV</button>}
        <button type="button" onClick={() => set({ mode: mode === 'tree' ? 'list' : 'tree' })}>{mode === 'tree' ? '层级显示' : '平铺显示'}</button>
        {canExport && <button type="button" disabled={!rows.length} onClick={() => exportCsv([
          ['需求 ID', '名称', '类型', '需求正文', '需求状态', '满足来源', '验证来源', '测试结果'],
          ...rows.map(element => [businessId(element), element.name, element.type, element.properties?.text == null ? element.documentation : field(element, 'text'), STATUS_LABELS[statusOf(element)],
            coverage.get(element.id)?.satisfiedBy.map(ref => ref.name).join('、') ?? '',
            coverage.get(element.id)?.verifiedBy.map(ref => ref.name).join('、') ?? '', RESULT_LABELS[executionOf(element.id)]]),
        ], 'requirement-table.csv')}>{t('导出 CSV')}</button>}
        <span className="vt-count">{rows.length} 条需求{validation && ' · rev ' + validation.revision}</span>
      </>)}
      <div className="tv-scroll"><table className="v-table"><thead><tr>{activeColumns.map(key => <th key={key}>{REQUIREMENT_COLUMNS[key]}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map(element => <tr key={element.id} data-requirement-id={element.id} onDoubleClick={() => onSelectElement(element.id)}>
          {activeColumns.map(key => <td key={key}>{cell(element, key)}</td>)}</tr>)
          : <tr><td colSpan={activeColumns.length} className="tv-empty">没有符合条件的需求。</td></tr>}</tbody></table></div>
    </section>
  }

  if (view === 'generic-table') {
    const scopeOwner = byId.get(selectedId ?? '')?.ownerId ?? projectRootId ?? ''
    const rows = elements.filter(inScope).filter(element => (!rowType || matchPreset(element, rowType))
      && (mode !== 'tree' || element.ownerId === scopeOwner) && match([element.name, element.type, element.documentation].join(' '))).sort(sorted)
    return <section className="table-view" data-table-view="generic">
      {toolbar(<><select value={rowType} onChange={event => set({ rowType: event.target.value })} aria-label="元素类型">
        <option value="">{t('全部类型')}</option>{typeOptions.map(option => <option key={option.code} value={option.code}>{option.label} ({option.count})</option>)}</select>
        <button type="button" onClick={() => set({ mode: mode === 'tree' ? 'list' : 'tree' })}>{mode === 'tree' ? '当前范围' : '全部范围'}</button>
        <button type="button" disabled={!canEdit || busy} onClick={() => onOpenCreate(scopeId || scopeOwner)}>{t('新建元素')}</button>
        {canExport && <button type="button" disabled={!rows.length} onClick={() => exportCsv([['名称', '类型', '构造型', '所有者', '文档', '标签数'],
          ...rows.map(element => [element.name, shortType(element.type), element.stereotypes.join(' '), ownerOf(element)?.name ?? '—',
            element.documentation, String(Object.keys(element.taggedValues ?? {}).length)])], 'generic-table.csv')}>{t('导出 CSV')}</button>}
        <span className="vt-count">{rows.length} 行</span></>)}
      <div className="tv-scroll"><table className="v-table"><thead><tr>{['名称', '类型', '构造型', '所有者', '文档', '标签数'].map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map(element => {
          const owner = ownerOf(element)
          return <tr key={element.id} data-element-id={element.id} onDoubleClick={() => onSelectElement(element.id)}>
            <td>{nameCell(element)}</td><td>{shortType(element.type)}</td><td>{element.stereotypes.join(' ') || '—'}</td>
            <td>{owner ? <span className="tv-reference" tabIndex={0} title={t('右键可树上高亮 / 画上高亮')}
              onContextMenu={event => onReferenceContextMenu(event, 'element', owner.id)}>{owner.name}</span> : '—'}</td>
            <td><EditableCell value={element.documentation} disabled={!canEdit || busy} onCommit={value => onDocumentation(element.id, value)} /></td>
            <td>{Object.keys(element.taggedValues ?? {}).length}</td></tr>
        }) : <tr><td colSpan={6} className="tv-empty">没有符合条件的元素。</td></tr>}</tbody></table></div>
    </section>
  }

  const preset = view !== 'generic-matrix'
  const initialRow = rowType || typeOptions.find(option => norm(option.code) === 'requirement')?.code || typeOptions[0]?.code || ''
  const initialCol = columnType || typeOptions.find(option => norm(option.code) === 'block')?.code || typeOptions[1]?.code || initialRow
  const relationType = view === 'verify-matrix' ? 'verify' : view === 'satisfy-matrix' ? 'satisfy' : settings.relationType || 'satisfy'
  const rowCandidates = elements.filter(element => preset ? isRequirement(element) : matchPreset(element, initialRow))
    .filter(inScope).filter(element => match(element.name + ' ' + businessId(element))).filter(element => !preset || missingFilter(element.id)).sort(sorted)
  const colCandidates = elements.filter(element => matchPreset(element, initialCol))
    .filter(element => preset || inScope(element)).filter(element => preset || match(element.name)).sort(sorted)
  const allRows = swapped ? colCandidates : rowCandidates
  const allColumns = swapped ? rowCandidates : colCandidates
  const matrixLimit = 80
  const rowPage = Math.min(matrixPage.row, Math.max(0, Math.ceil(allRows.length / matrixLimit) - 1))
  const colPage = Math.min(matrixPage.column, Math.max(0, Math.ceil(allColumns.length / matrixLimit) - 1))
  const rows = allRows.slice(rowPage * matrixLimit, (rowPage + 1) * matrixLimit)
  const columns = allColumns.slice(colPage * matrixLimit, (colPage + 1) * matrixLimit)
  const relationMatches = (relation: Relationship) => relationType === 'all' || norm(relation.type) === norm(relationType)
  const linksOf = (source: string, target: string) => {
    const direct = (relationLookup.get(cellId(source, target)) ?? []).filter(relationMatches)
    if (source === target) return direct
    const undirected = (relationLookup.get(cellId(target, source)) ?? [])
      .filter(relation => relationMatches(relation) && relationSpecs.get(norm(relation.type))?.directed === false)
    return direct.concat(undirected)
  }
  const inferred = (source: string, target: string) => {
    const ref = coverage.get(target)
    return preset && (view === 'verify-matrix' ? ref?.verifiedBy : ref?.satisfiedBy)?.some(item => item.id === source)
  }
  const pending = selectedCells.filter(item => item.source !== item.target && !linksOf(item.source, item.target).length && !inferred(item.source, item.target))
    .map(item => ({ ...item, sourceId: item.source, targetId: item.target, type: relationType === 'all' ? 'dependency' : relationType }))
  const renderedRelationIds = [...new Map(selectedCells.flatMap(item => linksOf(item.source, item.target)).map(item => [item.id, item])).values()]
  const latest = selectedCells.at(-1)
  return <section className="table-view" data-table-view="matrix">
    {toolbar(<>
      {!preset && <select value={initialRow} onChange={event => set({ rowType: event.target.value })} aria-label="行元素类型">
        {typeOptions.map(option => <option key={option.code} value={option.code}>行 · {option.label}</option>)}</select>}
      <select value={initialCol} onChange={event => set({ columnType: event.target.value })} aria-label="来源元素类型">
        {!typeOptions.some(option => norm(option.code) === norm(initialCol)) && <option value={initialCol}>{initialCol}</option>}
        {typeOptions.map(option => <option key={option.code} value={option.code}>来源 · {option.label}</option>)}</select>
      {!preset && <select value={relationType} onChange={event => set({ relationType: event.target.value })} aria-label="关系准则">
        <option value="all">所有关系</option>{relations.map(option => <option key={option.code} value={option.code}>{option.label} ({option.code})</option>)}</select>}
      {preset && gapSelect}<button type="button" onClick={() => set({ swapped: !swapped })}>行列互换</button>
      <span className="vt-count">{allRows.length} × {allColumns.length}</span>
      {allRows.length > matrixLimit && <><button type="button" disabled={rowPage === 0} onClick={() => setMatrixPage({ row: rowPage - 1, column: colPage })}>上一组行</button>
        <button type="button" disabled={(rowPage + 1) * matrixLimit >= allRows.length} onClick={() => setMatrixPage({ row: rowPage + 1, column: colPage })}>下一组行</button></>}
      {allColumns.length > matrixLimit && <><button type="button" disabled={colPage === 0} onClick={() => setMatrixPage({ row: rowPage, column: colPage - 1 })}>上一组列</button>
        <button type="button" disabled={(colPage + 1) * matrixLimit >= allColumns.length} onClick={() => setMatrixPage({ row: rowPage, column: colPage + 1 })}>下一组列</button></>}
    </>)}
    <div className="tv-scroll matrix-scroll"><table className="v-table matrix-table"><thead><tr>
      <th className="matrix-corner">行 \ 列</th>{columns.map(item => <th key={item.id} className="matrix-col">
        <button type="button" onClick={() => onSelectElement(item.id)}
          onContextMenu={event => onReferenceContextMenu(event, 'element', item.id)}>{item.name}</button></th>)}</tr></thead>
      <tbody>{!rows.length || !columns.length ? <tr><td colSpan={columns.length + 1} className="tv-empty">当前范围没有符合条件的行或列。</td></tr>
        : rows.map(row => <tr key={row.id}><th className="matrix-row"><button type="button" onClick={() => onSelectElement(row.id)}
          onContextMenu={event => onReferenceContextMenu(event, 'element', row.id)}>{row.name}</button></th>
          {columns.map(column => {
            const first = swapped ? column.id : row.id
            const second = swapped ? row.id : column.id
            const source = preset ? second : first
            const target = preset ? first : second
            const links = linksOf(source, target)
            const virtual = inferred(source, target)
            const selected = selectedCells.some(cell => cell.source === source && cell.target === target)
            return <td key={column.id} className="matrix-cell"><button type="button" aria-pressed={selected}
              className={(links.length || virtual ? 'filled' : '') + (selected ? ' matrix-selection' : '')}
              title={row.name + ' / ' + column.name + ' · ' + links.length + ' 个关系' + (virtual && !links.length ? ' · 属性引用' : '')}
              onClick={event => setSelectedCells(previous => event.shiftKey || event.ctrlKey || event.metaKey
                ? selected ? previous.filter(cell => cell.source !== source || cell.target !== target)
                  : previous.length < 500 ? [...previous, { source, target }] : previous
                : [{ source, target }])}>{links.length > 1 ? String(links.length) : links.length ? '●' : virtual ? '◇' : '·'}</button></td>
          })}</tr>)}</tbody></table></div>
    {latest ? <div className="matrix-details">
      <div><strong>{selectedCells.length} 个单元格</strong><span>{byId.get(latest.source)?.name} → {byId.get(latest.target)?.name}</span>
        {canEdit && <button type="button" disabled={busy || matrixBusy || !pending.length} onClick={() => changesFor(pending)}>建立所选空单元关系（{pending.length}）</button>}
        {canDelete && <button type="button" disabled={busy || matrixBusy || !renderedRelationIds.length || renderedRelationIds.length > 500}
          onClick={() => changesFor(renderedRelationIds.map(item => ({ removeId: item.id })))}>删除所选关系（{renderedRelationIds.length}）</button>}</div>
      <div>{renderedRelationIds.map(item => <span key={item.id}><button type="button" onClick={() => props.onSelectRelation(item.id)}
        onContextMenu={event => onReferenceContextMenu(event, 'relation', item.id)}>{item.name || item.type}</button>
        {canDelete && <button aria-label={'删除 ' + (item.name || item.type)} type="button" disabled={busy || matrixBusy}
          onClick={() => changesFor([{ removeId: item.id }])}>×</button>}</span>)}
        {inferred(latest.source, latest.target) && !linksOf(latest.source, latest.target).length && <span>通过模型属性引用覆盖。</span>}</div>
    </div> : <div className="vt-footnote">点击单元格查看关系。按住 Shift 或 Ctrl/⌘ 可多选后批量操作。</div>}
  </section>
}
