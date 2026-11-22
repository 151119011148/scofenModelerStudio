/**
 * 表格 / 矩阵视图（仿 M-Design 的「新建图表 → 需求表 / 通用表 / 通用矩阵」）。
 *
 * <p>这些视图不引入新的 DiagramKind：它们是模型数据的另一种呈现，模型内容仍由
 * CREATE_ELEMENT / RENAME_ELEMENT / UPDATE_DOCUMENTATION / CREATE_RELATIONSHIP 等
 * 既有命令写入，服务端保持权威。视图自身的筛选条件属于交互状态，不落库。</p>
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ContainmentSpec, ElementTypeInfo, ModelElement, Relationship } from './types'
import { svgUrl } from './iconAssets'
import { TypeIcon } from './icons'
import { pick, t } from './i18n'

export type TableViewId = 'requirement-table' | 'generic-table' | 'generic-matrix'

export const TABLE_VIEWS: { id: TableViewId; label: string; labelEn: string; icon: string }[] = [
  { id: 'requirement-table', label: '需求表', labelEn: 'Requirement Table', icon: 'RequirementTable' },
  { id: 'generic-table', label: '通用表', labelEn: 'Generic Table', icon: 'GenericTable' },
  { id: 'generic-matrix', label: '通用矩阵', labelEn: 'General Matrix', icon: 'DiagramMatrix' },
]

export const tableViewLabel = (id: TableViewId): string => {
  const found = TABLE_VIEWS.find((item) => item.id === id)
  return found ? pick(found.label, found.labelEn) : id
}

export const tableViewIcon = (id: TableViewId): string => {
  return TABLE_VIEWS.find((item) => item.id === id)?.icon ?? 'GenericTable'
}

export interface TableViewProps {
  view: TableViewId
  elements: ModelElement[]
  relationships: Relationship[]
  containment: ContainmentSpec | null
  projectRootId: string | null
  /** 当前选中元素：通用表的「当前包」范围取它的命名空间宿主。 */
  selectedId: string | null
  activeDiagramId: string
  busy: boolean
  canEdit: boolean
  typeInfo: Map<string, ElementTypeInfo>
  onSelectElement: (id: string) => void
  onRename: (id: string, name: string) => void
  onDocumentation: (id: string, doc: string) => void
  onOpenCreate: (ownerId: string) => void
  onCreateQuickElement: (kind: 'requirement' | 'generic', ownerId: string, typeCode?: string) => void
  onCreateRelation: (type: string, sourceId: string, targetId: string) => void
  onDeleteRelation: (id: string) => void
}

const shortType = (type: string): string => {
  const tail = type.split('::').pop() ?? type
  return tail.trim()
}

const norm = (value: string): string => value.toLowerCase().replace(/[-_\s]/g, '')

const isRequirement = (element: ModelElement): boolean => {
  return norm(shortType(element.type)).includes('requirement')
    || element.stereotypes.some((stereotype) => norm(stereotype).includes('requirement'))
}

const RELATION_OPTIONS = [
  { code: 'satisfy', label: '满足' },
  { code: 'verify', label: '验证' },
  { code: 'deriveReqt', label: '派生' },
  { code: 'refine', label: '精化' },
  { code: 'trace', label: '追踪' },
  { code: 'allocate', label: '分配' },
  { code: 'dependency', label: '依赖' },
  { code: 'association', label: '关联' },
]

const relationLabel = (type: string): string => {
  const code = norm(type)
  return RELATION_OPTIONS.find((item) => norm(item.code) === code)?.label ?? shortType(type)
}

function EditableCell({ value, onCommit, disabled }: { value: string; onCommit: (next: string) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) {
    return (
      <button
        type="button"
        className="tv-cell-edit"
        disabled={disabled}
        title={t('点击编辑')}
        onClick={() => { setDraft(value); setEditing(true) }}
      >{value || '—'}</button>
    )
  }
  const commit = () => {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      className="tv-cell-input"
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setEditing(false)
      }}
    />
  )
}

export default function TableView(props: TableViewProps) {
  const {
    view, elements, relationships, containment, projectRootId, selectedId,
    busy, canEdit, typeInfo, onSelectElement, onRename, onDocumentation,
    onOpenCreate, onCreateQuickElement, onCreateRelation, onDeleteRelation,
  } = props

  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'list' | 'tree'>('list')
  const [typeFilter, setTypeFilter] = useState('')
  const [rowType, setRowType] = useState('')
  const [columnType, setColumnType] = useState('')
  const [relationType, setRelationType] = useState('satisfy')
  const [swapped, setSwapped] = useState(false)

  const byId = useMemo(() => new Map(elements.map((element) => [element.id, element])), [elements])

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    elements.forEach((element) => {
      const code = typeInfo.get(shortType(element.type))?.code ?? shortType(element.type)
      counts.set(code, (counts.get(code) ?? 0) + 1)
    })
    return [...counts.entries()]
      .map(([code, count]) => {
        const info = typeInfo.get(code)
        return { code, count, label: info ? pick(info.label, info.labelEn) : code }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [elements, typeInfo])

  const requirementType = useMemo(() => {
    const candidates = (containment?.types ?? []).filter((item) => norm(item.code).includes('requirement'))
    return candidates.find((item) => norm(item.code) === 'requirement')?.code
      ?? candidates[0]?.code
      ?? ''
  }, [containment])

  const ownerOf = (element: ModelElement): string => {
    const owner = element.ownerId ? byId.get(element.ownerId) : null
    return owner?.name ?? (projectRootId && element.ownerId === projectRootId ? t('项目根') : '—')
  }

  const depthOf = (element: ModelElement): number => {
    let depth = 0
    let cursor: ModelElement | undefined = element
    const seen = new Set<string>()
    while (cursor?.ownerId && depth < 6 && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      cursor = byId.get(cursor.ownerId)
      if (cursor) depth += 1
    }
    return depth
  }

  const relationIndex = useMemo(() => {
    const map = new Map<string, Relationship>()
    relationships.forEach((relation) => {
      map.set(`${relation.sourceId}->${relation.targetId}:${norm(relation.type)}`, relation)
    })
    return map
  }, [relationships])

  const findRelation = (sourceId: string, targetId: string, type: string): Relationship | undefined => {
    if (norm(type) === 'all') {
      return relationships.find((relation) => relation.sourceId === sourceId && relation.targetId === targetId)
    }
    return relationIndex.get(`${sourceId}->${targetId}:${norm(type)}`)
  }

  const relationRefs = (targetId: string, kind: 'satisfy' | 'verify'): string[] => {
    return relationships
      .filter((relation) => relation.targetId === targetId && norm(relation.type).includes(kind))
      .map((relation) => byId.get(relation.sourceId)?.name ?? relation.sourceId)
  }

  const exportCsv = (rows: string[][], filename: string) => {
    const content = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const toolbar = (extra: ReactNode) => (
    <div className="v-table-toolbar">
      <span className="vt-title">{t('表格与矩阵')}</span>
      <span className="vt-sep" />
      <input
        className="vt-search"
        placeholder={t('搜索名称 / 类型…')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {extra}
    </div>
  )

  if (view === 'requirement-table') {
    const rows = elements
      .filter(isRequirement)
      .filter((element) => !query || `${element.name} ${element.type}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
    return (
      <section className="table-view" data-table-view="requirement">
        {toolbar(<>
          <button type="button" disabled={!canEdit || busy || !requirementType}
            onClick={() => onCreateQuickElement('requirement', projectRootId ?? '', requirementType)}>
            {t('新建需求')}
          </button>
          <button type="button" className={mode === 'tree' ? 'active' : ''}
            onClick={() => setMode(mode === 'tree' ? 'list' : 'tree')}>
            {t(mode === 'tree' ? '层级显示' : '平铺显示')}
          </button>
          <button type="button" disabled={rows.length === 0}
            onClick={() => exportCsv([
              ['ID', '名称', '类型', '文档', '满足来源', '验证来源', '状态'],
              ...rows.map((element) => {
                const satisfied = relationRefs(element.id, 'satisfy')
                const verified = relationRefs(element.id, 'verify')
                return [element.xmiId ?? element.id, element.name, shortType(element.type), element.documentation,
                  satisfied.join('; '), verified.join('; '),
                  satisfied.length && verified.length ? '已覆盖' : '有缺口']
              }),
            ], 'requirement-table.csv')}>
            {t('导出 CSV')}
          </button>
          <span className="vt-count">{rows.length} {t('条需求')}</span>
        </>)}
        <div className="tv-scroll">
          <table className="v-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>{t('ID')}</th>
                <th style={{ width: 260 }}>{t('名称')}</th>
                <th style={{ width: 130 }}>{t('类型')}</th>
                <th>{t('文档 / 需求描述')}</th>
                <th style={{ width: 180 }}>{t('满足来源')}</th>
                <th style={{ width: 180 }}>{t('验证来源')}</th>
                <th style={{ width: 90 }}>{t('状态')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="tv-empty">{t('当前项目没有需求元素；可用「新建需求」创建，或在模型树中导入。')}</td></tr>
              )}
              {rows.map((element) => {
                const satisfied = relationRefs(element.id, 'satisfy')
                const verified = relationRefs(element.id, 'verify')
                const indent = mode === 'tree' ? depthOf(element) : 0
                return (
                  <tr key={element.id} data-requirement-id={element.id}
                    onDoubleClick={() => onSelectElement(element.id)}>
                    <td className="tv-mono">{element.xmiId ?? element.id}</td>
                    <td>
                      <span className="tv-name" style={{ paddingLeft: indent * 14 }}>
                        {indent > 0 && <span className="tv-indent">└</span>}
                        <TypeIcon code={shortType(element.type)} size={14} />
                        <EditableCell value={element.name} disabled={!canEdit || busy}
                          onCommit={(name) => onRename(element.id, name)} />
                      </span>
                    </td>
                    <td>{shortType(element.type)}</td>
                    <td>
                      <EditableCell value={element.documentation} disabled={!canEdit || busy}
                        onCommit={(doc) => onDocumentation(element.id, doc)} />
                    </td>
                    <td>{satisfied.length ? satisfied.join('、') : '—'}</td>
                    <td>{verified.length ? verified.join('、') : '—'}</td>
                    <td>
                      <span className={`tv-status ${satisfied.length && verified.length ? 'ok' : 'gap'}`}>
                        {satisfied.length && verified.length ? t('已覆盖') : t('有缺口')}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  if (view === 'generic-table') {
    const selected = selectedId ? byId.get(selectedId) : null
    const scopeOwner = selected?.ownerId ?? projectRootId ?? ''
    const rows = elements
      .filter((element) => {
        if (typeFilter && (typeInfo.get(shortType(element.type))?.code ?? shortType(element.type)) !== typeFilter) return false
        if (mode === 'tree' && element.ownerId !== scopeOwner) return false
        return !query || `${element.name} ${element.type} ${element.documentation}`.toLowerCase().includes(query.toLowerCase())
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return (
      <section className="table-view" data-table-view="generic">
        {toolbar(<>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} title={t('元素类型')}>
            <option value="">{t('全部类型')}</option>
            {typeOptions.map((option) => (
              <option key={option.code} value={option.code}>{option.label} ({option.count})</option>
            ))}
          </select>
          <button type="button" className={mode === 'tree' ? 'active' : ''}
            onClick={() => setMode(mode === 'tree' ? 'list' : 'tree')}>
            {t(mode === 'tree' ? '当前范围' : '全部范围')}
          </button>
          <button type="button" disabled={!canEdit || busy}
            onClick={() => onOpenCreate(scopeOwner)}>{t('新建元素')}</button>
          <button type="button" disabled={rows.length === 0}
            onClick={() => exportCsv([
              ['名称', '类型', '构造型', '所有者', '文档', '标签数'],
              ...rows.map((element) => [element.name, shortType(element.type), element.stereotypes.join(' '),
                ownerOf(element), element.documentation, String(Object.keys(element.taggedValues ?? {}).length)]),
            ], 'generic-table.csv')}>
            {t('导出 CSV')}
          </button>
          <span className="vt-count">{rows.length} {t('行')}</span>
        </>)}
        <div className="tv-scroll">
          <table className="v-table">
            <thead>
              <tr>
                <th style={{ width: 300 }}>{t('名称')}</th>
                <th style={{ width: 140 }}>{t('类型')}</th>
                <th style={{ width: 180 }}>{t('构造型')}</th>
                <th style={{ width: 180 }}>{t('所有者')}</th>
                <th>{t('文档')}</th>
                <th style={{ width: 80 }}>{t('标签')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="tv-empty">{t('没有符合条件的元素。')}</td></tr>
              )}
              {rows.map((element) => (
                <tr key={element.id} data-element-id={element.id}
                  onDoubleClick={() => onSelectElement(element.id)}>
                  <td>
                    <span className="tv-name">
                      <TypeIcon code={shortType(element.type)} size={14} />
                      <EditableCell value={element.name} disabled={!canEdit || busy}
                        onCommit={(name) => onRename(element.id, name)} />
                    </span>
                  </td>
                  <td>{shortType(element.type)}</td>
                  <td>{element.stereotypes.length ? element.stereotypes.map((item) => `«${item}»`).join(' ') : '—'}</td>
                  <td>{ownerOf(element)}</td>
                  <td>
                    <EditableCell value={element.documentation} disabled={!canEdit || busy}
                      onCommit={(doc) => onDocumentation(element.id, doc)} />
                  </td>
                  <td className="tv-mono">{Object.keys(element.taggedValues ?? {}).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  // 通用矩阵：行列元素类型可配置，单元格显示关系，点击即创建 / 删除。
  const initialRow = rowType || typeOptions.find((item) => norm(item.label).includes('需求'))?.code || typeOptions[0]?.code || ''
  const initialCol = columnType || typeOptions.find((item) => norm(item.label).includes('模块') || norm(item.label).includes('block'))?.code || typeOptions[1]?.code || initialRow
  const codeOfElement = (element: ModelElement): string => typeInfo.get(shortType(element.type))?.code ?? shortType(element.type)
  const filtered = (code: string): ModelElement[] => elements
    .filter((element) => codeOfElement(element) === code)
    .filter((element) => !query || element.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  const rowCandidates = filtered(initialRow)
  const colCandidates = filtered(initialCol)
  const rows = swapped ? colCandidates : rowCandidates
  const columns = swapped ? rowCandidates : colCandidates

  return (
    <section className="table-view" data-table-view="matrix">
      {toolbar(<>
        <select value={rowType || initialRow} onChange={(event) => setRowType(event.target.value)} title={t('行元素类型')}>
          {typeOptions.map((option) => <option key={option.code} value={option.code}>{t('行')} · {option.label}</option>)}
        </select>
        <select value={columnType || initialCol} onChange={(event) => setColumnType(event.target.value)} title={t('列元素类型')}>
          {typeOptions.map((option) => <option key={option.code} value={option.code}>{t('列')} · {option.label}</option>)}
        </select>
        <select value={relationType} onChange={(event) => setRelationType(event.target.value)} title={t('关系准则')}>
          <option value="all">{t('所有关系')}</option>
          {RELATION_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>{option.label} ({option.code})</option>
          ))}
        </select>
        <button type="button" onClick={() => setSwapped(!swapped)}>{t('行列互换')}</button>
      </>)}
      <div className="tv-scroll matrix-scroll">
        <table className="v-table matrix-table">
          <thead>
            <tr>
              <th className="matrix-corner">{t('行 \\ 列')} <span className="vt-count">{rows.length}×{columns.length}</span></th>
              {columns.map((element) => (
                <th key={element.id} className="matrix-col" title={element.type}>
                  <button type="button" onClick={() => onSelectElement(element.id)}>
                    <TypeIcon code={shortType(element.type)} size={13} /> {element.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 || columns.length === 0 && (
              <tr><td className="tv-empty" colSpan={columns.length + 1}>
                {t('当前类型组合下没有元素，请调整行 / 列元素类型。')}
              </td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <th className="matrix-row" title={row.type}>
                  <button type="button" onClick={() => onSelectElement(row.id)}>
                    <TypeIcon code={shortType(row.type)} size={13} /> {row.name}
                  </button>
                </th>
                {columns.map((column) => {
                  const source = swapped ? column : row
                  const target = swapped ? row : column
                  const relation = findRelation(source.id, target.id, relationType)
                  return (
                    <td key={column.id} className="matrix-cell">
                      <button
                        type="button"
                        disabled={!canEdit || busy}
                        className={relation ? 'filled' : ''}
                        title={relation
                          ? `${t('删除关系')}：${relation.type}`
                          : `${t('新建关系')}：${relationType === 'all' ? 'dependency' : relationType}`}
                        onClick={() => {
                          if (relation) onDeleteRelation(relation.id)
                          else onCreateRelation(relationType === 'all' ? 'dependency' : relationType, source.id, target.id)
                        }}
                      >{relation ? '●' : '·'}</button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="vt-footnote">
        {t('点击空白单元格创建关系，点击已有关系单元格删除；行列表头可树上高亮。关系类型：{type}', {
          type: relationLabel(relationType === 'all' ? 'dependency' : relationType),
        })}
      </div>
    </section>
  )
}
