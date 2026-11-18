import { useMemo, useRef, useState } from 'react'
import type {
  ContainmentSpec, CustomizationCatalog, DiagramSpec, ElementTypeInfo,
  ModelElement, RelationshipTypeInfo,
} from './types'
import { pick, t } from './i18n'
import { isExtensionId } from './extensionIds'
import {
  CUSTOM_PREFIX, isDiagramType, isStereotype, isTagDefinition, listHasType, propList, propText,
} from './customTypes'

/**
 * 元模型定制面板（参照 MagicDraw / M-Design 的 Custom Diagram 与 Profile 定制）。
 *
 * <p>所有定制都落库为模型里的真实元素：自定义图类型是 DiagramType，构造型是 Stereotype，
 * 标签定义是挂在构造型下的 TagDefinition。这里只负责把它们呈现成可编辑的表单，
 * 写入一律走 runCommand（服务端权威 + 一步撤销），不在浏览器里保存任何定制状态。</p>
 */
export interface CustomizationPanelProps {
  customization: CustomizationCatalog | null
  elements: ModelElement[]
  specs: DiagramSpec[]
  containment: ContainmentSpec | null
  relations: RelationshipTypeInfo[]
  canEdit: boolean
  busy: boolean
  runCommand: (type: string, payload: Record<string, unknown>) => Promise<boolean>
  onNotice: (key: string, vars?: Record<string, unknown>) => void
  /** 新建的定制元素要挂到哪个父元素（项目根或选中的包）。 */
  ownerId: string
  onSelectElement: (id: string) => void
}

const PREFIX = CUSTOM_PREFIX

/**
 * 生成与画布元素同风格的前端 id。
 *
 * <p>前缀必须是 {@code e-} 家族：扩展域保留了 {@code ext- / mc- / st- / rel-} 等命名空间，
 * 播种器会按「落在扩展域但目录未定义」清理一次——用户元素若用了 {@code st-} 开头，
 * 下次打开项目就会被当成过期扩展内容删掉。</p>
 */
function newId(prefix: string) {
  return `e-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export default function CustomizationPanel({
  customization, elements, specs, containment, relations, canEdit, busy,
  runCommand, onNotice, ownerId, onSelectElement,
}: CustomizationPanelProps) {
  const [section, setSection] = useState<'diagrams' | 'stereotypes'>('diagrams')
  const [editing, setEditing] = useState<string | null>(null)

  /**
   * 预置扩展图库里的图类型定义（产品随附的模板）。
   *
   * <p>它们与用户手建的定义**完全同构**（同样是一等模型元素，同样可改名改白名单），
   * 区别只在归属：owner 是「扩展图库」包。分开计数是必须的——否则「新建图类型」
   * 会从 17 开始编号，用户自定义图类型也永远等不到空态。</p>
   */
  const presetTypes = useMemo(
    () => elements.filter((element) => isDiagramType(element)
      && element.ownerId === customization?.presetPackage?.id),
    [elements, customization],
  )
  /** 用户自建的图类型定义（不属于扩展域，也不属于预置图库）。 */
  const customTypes = useMemo(
    () => elements.filter((element) => isDiagramType(element) && !isExtensionId(element.id)
      && element.ownerId !== customization?.presetPackage?.id),
    [elements, customization],
  )
  /** 定制面板要列出的全部图类型定义：预置在前、自建在后。 */
  const diagramTypes = useMemo(
    () => [...presetTypes, ...customTypes],
    [presetTypes, customTypes],
  )
  const stereotypes = useMemo(
    // 扩展包里的规范构造型有几百条，面板只管用户自建的那些。
    () => elements.filter((element) => isStereotype(element) && !isExtensionId(element.id)),
    [elements],
  )
  const keyLabels = customization?.keyLabels ?? {}
  const tagTypes = customization?.tagTypes ?? ['STRING', 'BOOLEAN', 'INTEGER', 'REAL', 'ENUM']
  /** 预置扩展图模板：已落库的（installed）不再重复创建。 */
  const missingPresets = useMemo(
    () => (customization?.presets ?? []).filter((preset) => !preset.installed),
    [customization],
  )
  /** 预置定义所在的包是否已存在；不存在时载入时要一并建出来。 */
  const libraryInstalled = useMemo(
    () => elements.some((element) => element.id === customization?.presetPackage?.id),
    [elements, customization],
  )

  /**
   * 写一组定制属性。
   *
   * <p>必须串行：命令带乐观锁 baseRevision，两条并发命令会用同一个版本号，
   * 后到的必然 409。「并发写」在这里表现为「后两条属性静默丢失」，很难查。</p>
   */
  const writeProps = async (id: string, entries: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(entries)) {
      const ok = await runCommand('UPDATE_PROPERTY', { id, key, value })
      if (!ok) {
        return false
      }
    }
    return true
  }

  /**
   * 勾选白名单时的写入队列。
   *
   * <p>白名单有二十多项，用户连点几个复选框就是几条并发命令——后到的全被乐观锁挡掉，
   * 界面看着「勾上了」，服务端只留下一条。做法是：本地先改（勾选立刻可见），
   * 再把「期望值」记到队列里，命令串行执行时取当时最新的期望值，一次写整张表。</p>
   */
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const desiredRef = useRef<Record<string, { id: string; value: unknown }>>({})
  const [, setDraftLists] = useState<Record<string, string[]>>({})
  /** 勾选草稿的 ref 镜像：连点多个复选框时，后一次必须基于前一次的结果算，
   *  否则同一批里的每次点击都从同一份旧值起算，最后只剩最后一次的结果。 */
  const draftRef = useRef<Record<string, string[]>>({})

  const listKey = (id: string, key: string) => `${id}::${key}`
  const currentList = (definition: ModelElement, key: string) =>
    draftRef.current[listKey(definition.id, key)] ?? propList(definition, key)

  const enqueueWrite = (id: string, key: string, value: unknown) => {
    desiredRef.current[key] = { id, value }
    writeQueueRef.current = writeQueueRef.current
      .then(async () => {
        const pending = desiredRef.current[key]
        if (!pending || pending.id !== id) {
          return
        }
        delete desiredRef.current[key]
        await runCommand('UPDATE_PROPERTY', { id: pending.id, key, value: pending.value })
      })
      .catch(() => {})
  }

  /* ── 自定义图类型 ── */
  const createDiagramType = async () => {
    if (!canEdit) return
    const id = newId('dt')
    const ok = await runCommand('CREATE_ELEMENT', {
      id,
      type: 'DiagramType',
      name: t('自定义图 {count}', { count: customTypes.length + 1 }),
      ownerId,
    })
    if (ok) {
      await writeProps(id, {
        [`${PREFIX}baseKind`]: 'bdd',
        // 白名单用元素类型的枚举名（BLOCK / CLASS / COMMENT）：服务端下发与工具箱过滤
        // 都按这个形式比对，写成 UML 名（Block）会让勾选框全灭。
        [`${PREFIX}allowedTypes`]: ['BLOCK', 'CLASS', 'COMMENT'],
        [`${PREFIX}allowedRelationships`]: ['association', 'generalization'],
      })
      setEditing(id)
      onSelectElement(id)
    }
  }

  const removeElement = async (id: string) => {
    if (!canEdit) return
    await runCommand('DELETE_ELEMENT', { id })
    if (editing === id) setEditing(null)
  }

  /* ── 构造型与标签定义 ── */
  const createStereotype = async () => {
    if (!canEdit) return
    const id = newId('st')
    const ok = await runCommand('CREATE_ELEMENT', {
      id,
      type: 'Stereotype',
      name: t('自定义构造型 {count}', { count: stereotypes.length + 1 }),
      ownerId,
    })
    if (ok) {
      setEditing(id)
      onSelectElement(id)
    }
  }

  const createTag = async (stereotypeId: string) => {
    if (!canEdit) return
    const siblings = elements.filter((element) =>
      isTagDefinition(element) && element.ownerId === stereotypeId)
    const id = newId('tag')
    const ok = await runCommand('CREATE_ELEMENT', {
      id,
      type: 'TagDefinition',
      name: t('标签 {count}', { count: siblings.length + 1 }),
      ownerId: stereotypeId,
    })
    if (ok) {
      await writeProps(id, {
        [`${PREFIX}tagType`]: 'STRING',
        [`${PREFIX}defaultValue`]: '',
        [`${PREFIX}required`]: 'false',
      })
      // 保持在构造型卡片上展开：新标签就挂在它下面，切走等于把刚建的东西藏起来。
      setEditing(stereotypeId)
    }
  }

  const toggleList = (element: ModelElement, key: string, code: string) => {
    if (!canEdit) return
    const lk = listKey(element.id, key)
    const current = currentList(element, key)
    // 比对按归一形式（枚举名 / UML 名等价），移除时也要按同样口径去掉那一条，
    // 否则同一种类型会在列表里出现两条。
    const next = listHasType(current, code)
      ? current.filter((item) => !listHasType([item], code))
      : [...current, code]
    draftRef.current = { ...draftRef.current, [lk]: next }
    setDraftLists(draftRef.current)
    enqueueWrite(element.id, key, next)
  }

  /* ── 预置扩展图库 ── */
  /**
   * 载入预置扩展图模板。
   *
   * <p>预置模板与用户手建的扩展图完全同构——写进模型的是 DiagramType 元素，
   * 因此载入后可改名、可改白名单、可删除，也能随快照与 XMI 往返。
   * 整批走一条 CREATE_ELEMENTS：一个 revision、一步撤销。</p>
   */
  const loadPresets = async () => {
    if (!canEdit || missingPresets.length === 0) return
    const pack = customization?.presetPackage
    const rows: Record<string, unknown>[] = []
    if (pack && !libraryInstalled) {
      rows.push({ id: pack.id, type: 'Package', name: pack.name, ownerId, properties: {} })
    }
    for (const preset of missingPresets) {
      rows.push({
        id: preset.id,
        type: 'DiagramType',
        name: preset.name,
        ownerId: pack?.id ?? ownerId,
        documentation: preset.documentation,
        properties: {
          [`${PREFIX}baseKind`]: preset.baseKind,
          [`${PREFIX}allowedTypes`]: preset.allowedTypes,
          [`${PREFIX}allowedRelationships`]: preset.allowedRelationships,
          [`${PREFIX}frameTitle`]: preset.frameTitle,
          [`${PREFIX}labelEn`]: preset.labelEn,
        },
      })
    }
    const ok = await runCommand('CREATE_ELEMENTS', { elements: rows })
    if (ok) {
      onNotice('已载入预置扩展图')
    }
  }

  /**
   * 渲染一张图类型定义卡片（预置与自建共用）。
   *
   * <p>预置图库里的定义同样可改名、可改白名单——与用户手建的完全同构，
   * 只是头部多一个「预置」徽标，避免用户误以为是自己建的。</p>
   */
  const renderDiagramTypeCard = (definition: ModelElement) => {
    const base = propText(definition, `${PREFIX}baseKind`) || 'bdd'
    const allowed = currentList(definition, `${PREFIX}allowedTypes`)
    const allowedRel = currentList(definition, `${PREFIX}allowedRelationships`)
    const open = editing === definition.id
    const isPreset = definition.ownerId === customization?.presetPackage?.id
    return (
      <div className={`cust-card${open ? ' open' : ''}${isPreset ? ' preset' : ''}`} key={definition.id}>
        <button type="button" className="cust-card-head" onClick={() => {
          setEditing(open ? null : definition.id)
          onSelectElement(definition.id)
        }}>
          <span className="cust-name">{definition.name}</span>
          {isPreset && <span className="cust-badge preset">{t('预置')}</span>}
          <span className="cust-badge">{specs.find((spec) => spec.code === base)?.label ?? base}</span>
        </button>
        {open && (
          <div className="cust-card-body">
              <label className="cust-field">
                <span>{t('名称')}</span>
                <input
                  defaultValue={definition.name}
                  data-cust-field="name"
                  disabled={!canEdit}
                  onBlur={(event) => void runCommand('RENAME_ELEMENT', {
                    id: definition.id, name: event.target.value,
                  })}
                />
              </label>
              <label className="cust-field">
                <span>{t('英文名称')}</span>
                <input
                  defaultValue={propText(definition, `${PREFIX}labelEn`)}
                  data-cust-field="labelEn"
                  disabled={!canEdit}
                  onBlur={(event) => void runCommand('UPDATE_PROPERTY', {
                    id: definition.id, key: `${PREFIX}labelEn`, value: event.target.value,
                  })}
                />
              </label>
              <label className="cust-field">
                <span>{t('布局基底图')}</span>
                <select
                  value={base}
                  data-cust-field="baseKind"
                  disabled={!canEdit}
                  onChange={(event) => void runCommand('UPDATE_PROPERTY', {
                    id: definition.id, key: `${PREFIX}baseKind`, value: event.target.value,
                  })}
                >
                  {specs.map((spec) => (
                    <option key={spec.code} value={spec.code}>{pick(spec.label, spec.labelEn)}</option>
                  ))}
                </select>
              </label>
              <label className="cust-field">
                <span>{t('图框标题模板')}</span>
                <input
                  defaultValue={propText(definition, `${PREFIX}frameTitle`)}
                  data-cust-field="frameTitle"
                  disabled={!canEdit}
                  placeholder={t('如 {图种} · {图名}')}
                  onBlur={(event) => void runCommand('UPDATE_PROPERTY', {
                    id: definition.id, key: `${PREFIX}frameTitle`, value: event.target.value,
                  })}
                />
              </label>
              <div className="cust-pick">
                <span className="cust-pick-title">{keyLabels[`${PREFIX}allowedTypes`] ?? t('允许的元素类型')}</span>
                <div className="cust-pick-grid">
                  {(containment?.types ?? []).map((type: ElementTypeInfo) => (
                    <label key={type.code} className="cust-check">
                      <input type="checkbox" checked={listHasType(allowed, type.code)}
                        data-cust-check="allowedTypes" data-cust-code={type.code}
                        disabled={!canEdit}
                        onChange={() => void toggleList(definition, `${PREFIX}allowedTypes`, type.code)} />
                      {pick(type.label, type.labelEn)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="cust-pick">
                <span className="cust-pick-title">{keyLabels[`${PREFIX}allowedRelationships`] ?? t('允许的关系类型')}</span>
                <div className="cust-pick-grid">
                  {relations.map((relation) => (
                    <label key={relation.code} className="cust-check">
                      <input type="checkbox" checked={listHasType(allowedRel, relation.code)}
                        data-cust-check="allowedRelationships" data-cust-code={relation.code}
                        disabled={!canEdit}
                        onChange={() => void toggleList(definition, `${PREFIX}allowedRelationships`, relation.code)} />
                      {pick(relation.label, relation.labelEn)}
                    </label>
                  ))}
                </div>
              </div>
              <button type="button" className="cust-del" data-cust-action="delete-diagram-type"
                disabled={!canEdit || busy}
                onClick={() => void removeElement(definition.id)}>{t('删除图类型')}</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="cust-panel">
      <div className="cust-tabs">
        <button type="button" className={section === 'diagrams' ? 'active' : ''}
          onClick={() => { setSection('diagrams'); setEditing(null) }}>
          {t('定制图')}
        </button>
        <button type="button" className={section === 'stereotypes' ? 'active' : ''}
          onClick={() => { setSection('stereotypes'); setEditing(null) }}>
          {t('元模型')}
        </button>
      </div>

      {section === 'diagrams' ? (
        <div className="cust-body">
          <p className="cust-hint">{t('自定义图以规范图为底，限定可出现的元素与关系；定义随模型保存与交换。')}</p>
          <div className="cust-actions">
            <button type="button" className="cust-add" data-cust-action="add-diagram-type"
              disabled={!canEdit || busy} onClick={() => void createDiagramType()}>
              ＋ {t('新建图类型')}
            </button>
            {missingPresets.length > 0 && (
              <button type="button" className="cust-add subtle" data-cust-action="load-presets"
                disabled={!canEdit || busy} onClick={() => void loadPresets()}>
                {t('载入预置扩展图 ({count})', { count: missingPresets.length })}
              </button>
            )}
          </div>
          {presetTypes.length > 0 && (
            <p className="cust-section">{t('预置扩展图库（{count}）', { count: presetTypes.length })}</p>
          )}
          {presetTypes.map(renderDiagramTypeCard)}
          {customTypes.length === 0 && <p className="cust-empty">{t('尚无自定义图类型')}</p>}
          {customTypes.map(renderDiagramTypeCard)}
        </div>
      ) : (
        <div className="cust-body">
          <p className="cust-hint">{t('在剖面下定义构造型与标签，元素应用构造型后按标签类型填写值。')}</p>
          <button type="button" className="cust-add" data-cust-action="add-stereotype"
            disabled={!canEdit || busy} onClick={() => void createStereotype()}>
            ＋ {t('新建构造型')}
          </button>
          {stereotypes.length === 0 && <p className="cust-empty">{t('尚无自定义构造型')}</p>}
          {stereotypes.map((stereotype) => {
            const tags = elements.filter((element) =>
              isTagDefinition(element) && element.ownerId === stereotype.id)
            return (
              <div className="cust-card" key={stereotype.id}>
                <button type="button" className="cust-card-head" onClick={() => {
                  setEditing(editing === stereotype.id ? null : stereotype.id)
                  onSelectElement(stereotype.id)
                }}>
                  <span className="cust-name">«{stereotype.name}»</span>
                  <span className="cust-badge">{t('{count} 标签', { count: tags.length })}</span>
                </button>
                {editing === stereotype.id && (
                  <div className="cust-card-body">
                    <label className="cust-field">
                      <span>{t('名称')}</span>
                      <input
                        defaultValue={stereotype.name}
                        data-cust-field="stereotypeName"
                        disabled={!canEdit}
                        onBlur={(event) => void runCommand('RENAME_ELEMENT', {
                          id: stereotype.id, name: event.target.value,
                        })}
                      />
                    </label>
                    {tags.map((tag) => (
                      <div className="cust-tag-row" key={tag.id}>
                        <input defaultValue={tag.name} disabled={!canEdit}
                          data-cust-field="tagName"
                          onBlur={(event) => void runCommand('RENAME_ELEMENT', {
                            id: tag.id, name: event.target.value,
                          })} />
                        <select value={propText(tag, `${PREFIX}tagType`) || 'STRING'}
                          data-cust-field="tagType"
                          disabled={!canEdit}
                          onChange={(event) => void runCommand('UPDATE_PROPERTY', {
                            id: tag.id, key: `${PREFIX}tagType`, value: event.target.value,
                          })}>
                          {tagTypes.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                        </select>
                        <button type="button" className="cust-del tiny" disabled={!canEdit || busy}
                          data-cust-action="delete-tag"
                          onClick={() => void removeElement(tag.id)}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="cust-add subtle" data-cust-action="add-tag"
                      disabled={!canEdit || busy}
                      onClick={() => void createTag(stereotype.id)}>＋ {t('添加标签定义')}</button>
                    <button type="button" className="cust-del" data-cust-action="delete-stereotype"
                      disabled={!canEdit || busy}
                      onClick={() => void removeElement(stereotype.id)}>{t('删除构造型')}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
