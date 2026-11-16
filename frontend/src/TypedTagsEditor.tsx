import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelElement } from './types'
import { t } from './i18n'
import { CUSTOM_PREFIX, isStereotype, isTagDefinition, propList, propText } from './customTypes'

/**
 * 构造型驱动的标签值表单（Profile 定制的落点）。
 *
 * <p>通用扩展包里的构造型没有标签定义，标签值就是自由键值表；用户自建的构造型下挂了
 * 标签定义（TagDefinition）之后，这里按标签定义渲染成带类型的字段：BOOLEAN 出下拉、
 * INTEGER / REAL 出数字框、ENUM 出选项下拉、STRING 出文本框，并标注必填与默认值。</p>
 *
 * <p>字段键就是标签定义的名称，值写回 {@code taggedValues}（整张表一次提交、一步撤销），
 * 与 {@link TaggedValuesEditor} 共用同一份存储，不另起字段表。</p>
 */
export interface TypedTagField {
  /** 标签键（标签定义元素名）。 */
  key: string
  /** 所属构造型名，用于分组标题。 */
  stereotype: string
  type: string
  options: string[]
  required: boolean
  defaultValue: string
}

export interface TypedTagsEditorProps {
  targetId: string
  /** 已应用的构造型名（元素 / 关系的 stereotypes）。 */
  stereotypes: string[]
  /** 模型里的全部元素，用于找构造型与其下的标签定义。 */
  elements: ModelElement[]
  taggedValues: Record<string, string>
  canEdit: boolean
  readLatest: (id: string) => Record<string, string>
  onCommit: (id: string, next: Record<string, string>) => Promise<unknown>
  onNotice: (key: string, vars?: Record<string, unknown>) => void
}

const PREFIX = CUSTOM_PREFIX

/**
 * 从模型里解析出当前对象可用的标签定义字段。
 *
 * <p>构造型按名字匹配（{@code stereotypes} 存的是名字），标签定义取构造型下的子元素。
 * 标签定义缺失或类型不认识时跳过，不生成半截字段。</p>
 */
export function resolveTypedTagFields(
  stereotypes: string[],
  elements: ModelElement[],
): TypedTagField[] {
  const byName = new Map<string, ModelElement>()
  for (const element of elements) {
    if (isStereotype(element)) {
      byName.set(element.name, element)
    }
  }
  const tags = elements.filter(isTagDefinition)
  const fields: TypedTagField[] = []
  for (const stereotype of stereotypes) {
    const owner = byName.get(stereotype)
    if (!owner) {
      continue
    }
    for (const tag of tags) {
      if (tag.ownerId !== owner.id) {
        continue
      }
      const type = (propText(tag, `${PREFIX}tagType`) || 'STRING').toUpperCase()
      fields.push({
        key: tag.name,
        stereotype,
        type,
        options: propList(tag, `${PREFIX}options`),
        required: propText(tag, `${PREFIX}required`) === 'true',
        defaultValue: propText(tag, `${PREFIX}defaultValue`),
      })
    }
  }
  return fields
}

export default function TypedTagsEditor({
  targetId, stereotypes, elements, taggedValues, canEdit, readLatest, onCommit, onNotice,
}: TypedTagsEditorProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const focusedRef = useRef<string | null>(null)
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

  const fields = useMemo(
    () => resolveTypedTagFields(stereotypes, elements),
    [stereotypes, elements],
  )

  useEffect(() => {
    setDrafts({})
    focusedRef.current = null
  }, [targetId])

  useEffect(() => {
    const focused = focusedRef.current
    setDrafts((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) => focused === key),
    ))
  }, [taggedValues])

  if (fields.length === 0) {
    return null
  }

  /** 与通用标签编辑器同一条提交链：后一次等前一次落库后再取最新快照。 */
  const enqueue = (mutate: (latest: Record<string, string>) => Record<string, string> | null) => {
    const id = targetId
    chainRef.current = chainRef.current
      .then(async () => {
        const next = mutate(readLatest(id))
        if (next === null) return
        await onCommit(id, next)
      })
      .catch(() => {})
  }

  const commit = (key: string, value: string) => {
    enqueue((latest) => {
      if ((latest[key] ?? '') === value) return null
      return { ...latest, [key]: value }
    })
  }

  const valueOf = (field: TypedTagField) => {
    const current = taggedValues?.[field.key]
    if (current !== undefined) {
      return current
    }
    return field.defaultValue
  }

  const missingRequired = fields.some(
    (field) => field.required && !String(valueOf(field) ?? '').trim(),
  )

  return (
    <div className="tt-editor" data-tt-editor="true">
      <div className="tt-head">
        <span className="tt-title">{t('剖面标签')}</span>
        <span className="tt-count">{t('{count} 项', { count: fields.length })}</span>
      </div>
      <div className="tt-rows">
        {fields.map((field) => {
          const value = drafts[field.key] ?? valueOf(field)
          const label = (
            <span className="tt-label">
              {field.key}
              {field.required && <em className="tt-req">*</em>}
              <span className="tt-meta">{field.stereotype} · {field.type}</span>
            </span>
          )
          return (
            <label className="tt-row" key={`${field.stereotype}:${field.key}`} data-tt-field={field.key}>
              {label}
              {field.type === 'BOOLEAN' ? (
                <select
                  value={value ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))
                    commit(field.key, event.target.value)
                  }}
                >
                  <option value="">{t('未设置')}</option>
                  <option value="true">{t('是')}</option>
                  <option value="false">{t('否')}</option>
                </select>
              ) : field.type === 'ENUM' ? (
                <select
                  value={value ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))
                    commit(field.key, event.target.value)
                  }}
                >
                  <option value="">{t('未设置')}</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === 'INTEGER' || field.type === 'REAL' ? (
                <input
                  type="number"
                  step={field.type === 'INTEGER' ? 1 : 'any'}
                  value={value ?? ''}
                  disabled={!canEdit}
                  onFocus={() => { focusedRef.current = field.key }}
                  onChange={(event) => setDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  onBlur={(event) => {
                    focusedRef.current = null
                    const next = event.target.value
                    if (next !== '' && Number.isNaN(Number(next))) {
                      onNotice('标签「{key}」需要数值', { key: field.key })
                      return
                    }
                    commit(field.key, next)
                  }}
                />
              ) : (
                <input
                  type="text"
                  value={value ?? ''}
                  disabled={!canEdit}
                  onFocus={() => { focusedRef.current = field.key }}
                  onChange={(event) => setDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  onBlur={(event) => {
                    focusedRef.current = null
                    commit(field.key, event.target.value)
                  }}
                />
              )}
            </label>
          )
        })}
      </div>
      {missingRequired && (
        <p className="tt-warn">{t('有必填标签尚未填写。')}</p>
      )}
      <p className="tt-hint">
        {canEdit
          ? t('字段来自构造型下的标签定义；值失焦即保存，整张表一步撤销。')
          : t('当前角色为只读，无法编辑标签值。')}
      </p>
    </div>
  )
}
