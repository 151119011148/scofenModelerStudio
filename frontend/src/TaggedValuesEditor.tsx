import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'

/**
 * Profile 标签值（taggedValues）键值编辑器（B4）。
 *
 * <p>把原来的只读列表 / 原始 JSON 升级为可直接增改删的键值表：每行键、值两个输入框，
 * 失焦即把整张表通过 {@code UPDATE_PROPERTY key=taggedValues} 落库（一次命令一步撤销）。</p>
 *
 * <p>输入框受控于本地草稿，草稿随服务端权威值同步：{@code taggedValues} 引用一变就丢弃
 * 非聚焦字段的草稿、回落到权威值。这样命令失败（如快速连续编辑触发版本冲突后 refresh）
 * 时，输入框不会停留在被拒绝的旧输入上而与模型分叉；正在敲打的聚焦字段则保留草稿不被打断。</p>
 *
 * <p>所有提交串成一条 Promise 链（{@link chainRef}）：后一次提交等前一次 {@code onCommit}
 * 落库后才执行，且在那一刻用 {@link readLatest} 取最新快照构造下一张表。否则快速「失焦改值
 * →点删除」会让两条命令共用同一 baseRevision，第二条 409 被丢弃，且其载荷基于过期快照
 * 会把前一次编辑覆盖回去。链式串行同时消除这两种分叉。</p>
 */
export interface TaggedValuesEditorProps {
  targetId: string
  taggedValues: Record<string, string>
  canEdit: boolean
  /** 从最新快照读取该对象的标签值（消除事件闭包里的过期数据）。 */
  readLatest: (id: string) => Record<string, string>
  /** 落库整张表；返回命令 Promise，编辑器据此把连续编辑串行化。 */
  onCommit: (id: string, next: Record<string, string>) => Promise<unknown>
  onNotice: (key: string, vars?: Record<string, unknown>) => void
}

export default function TaggedValuesEditor({
  targetId, taggedValues, canEdit, readLatest, onCommit, onNotice,
}: TaggedValuesEditorProps) {
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  /** 值草稿（按当前键）与键草稿（按渲染时的原键）：未编辑的字段直接显示权威值。 */
  const [valDrafts, setValDrafts] = useState<Record<string, string>>({})
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  /** 当前聚焦字段标记 `${key}|val` / `${key}|key`：同步时保留它的草稿。 */
  const focusedRef = useRef<string | null>(null)
  /** 提交链：每次提交挂到链尾，串行执行，确保后一次读到前一次落库后的最新快照与版本。 */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

  // 切换对象时清空待添加行与草稿，避免把上一个对象的输入带过来。
  useEffect(() => {
    setNewKey('')
    setNewValue('')
    setValDrafts({})
    setKeyDrafts({})
    focusedRef.current = null
  }, [targetId])

  // 权威值一变（命令成功 / 失败后 refresh）就丢弃非聚焦草稿，输入框回落到服务端真值。
  useEffect(() => {
    const focused = focusedRef.current
    setValDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => focused === `${key}|val`)))
    setKeyDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => focused === `${key}|key`)))
  }, [taggedValues])

  const entries = Object.entries(taggedValues ?? {})

  /**
   * 把一次变更挂到提交链尾：轮到它时才用 {@link readLatest} 取最新快照、应用 mutate、落库。
   * mutate 返回 null 表示无变更或校验未过（已 onNotice），跳过提交。命令失败由 runCommand
   * 自身 say + refresh 兜底，这里 catch 住只为不让链中断、后续编辑仍能继续。
   */
  const enqueue = (id: string, mutate: (latest: Record<string, string>) => Record<string, string> | null) => {
    chainRef.current = chainRef.current
      .then(async () => {
        const next = mutate(readLatest(id))
        if (next === null) return
        await onCommit(id, next)
      })
      .catch(() => {})
  }

  const commitValue = (key: string, value: string) => {
    const id = targetId
    enqueue(id, (latest) => {
      if ((latest[key] ?? '') === value) return null
      return { ...latest, [key]: value }
    })
  }

  const commitKey = (oldKey: string, rawKey: string) => {
    const nextKey = rawKey.trim()
    if (nextKey === oldKey) return
    const id = targetId
    enqueue(id, (latest) => {
      if (nextKey === '') {
        onNotice('标签键不能为空')
        return null
      }
      // 旧键可能已被前一次提交改名 / 删除：不存在就放弃这次改名。
      if (!Object.prototype.hasOwnProperty.call(latest, oldKey)) return null
      if (Object.prototype.hasOwnProperty.call(latest, nextKey)) {
        onNotice('标签键「{key}」已存在', { key: nextKey })
        return null
      }
      // 保留原有顺序：逐键重建，遇到旧键换成新键。
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(latest)) {
        if (key === oldKey) next[nextKey] = value
        else next[key] = value
      }
      return next
    })
  }

  const removeKey = (key: string) => {
    const id = targetId
    enqueue(id, (latest) => {
      if (!Object.prototype.hasOwnProperty.call(latest, key)) return null
      const next: Record<string, string> = {}
      for (const [entryKey, value] of Object.entries(latest)) {
        if (entryKey !== key) next[entryKey] = value
      }
      return next
    })
  }

  const addTag = () => {
    const key = newKey.trim()
    const value = newValue
    if (key === '') {
      onNotice('标签键不能为空')
      return
    }
    const id = targetId
    // 即时反馈：当前快照里已存在就不清空输入、直接提示。
    if (Object.prototype.hasOwnProperty.call(readLatest(id), key)) {
      onNotice('标签键「{key}」已存在', { key })
      return
    }
    setNewKey('')
    setNewValue('')
    enqueue(id, (latest) => {
      // 排队期间前一次提交可能已加入同名键：执行时再校验一次。
      if (Object.prototype.hasOwnProperty.call(latest, key)) {
        onNotice('标签键「{key}」已存在', { key })
        return null
      }
      return { ...latest, [key]: value }
    })
  }

  return (
    <div className="tv-editor">
      <div className="tv-head">
        <span className="tv-title">{t('标签值')}</span>
        <span className="tv-count">{t('{count} 项', { count: entries.length })}</span>
      </div>
      {entries.length === 0 ? (
        <div className="tv-empty">{t('暂无标签值')}</div>
      ) : (
        <div className="tv-rows">
          {entries.map(([key, value]) => (
            <div className="tv-row" key={`${targetId}:${key}`}>
              <input
                className="tv-key"
                value={keyDrafts[key] ?? key}
                disabled={!canEdit}
                spellCheck={false}
                aria-label={t('标签键')}
                title={t('标签键')}
                onFocus={() => { focusedRef.current = `${key}|key` }}
                onChange={(event) => setKeyDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                onBlur={(event) => { focusedRef.current = null; commitKey(key, event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              />
              <input
                value={valDrafts[key] ?? value}
                disabled={!canEdit}
                spellCheck={false}
                aria-label={t('标签值')}
                title={t('标签值')}
                onFocus={() => { focusedRef.current = `${key}|val` }}
                onChange={(event) => setValDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                onBlur={(event) => { focusedRef.current = null; commitValue(key, event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              />
              <button
                type="button"
                className="tv-del"
                disabled={!canEdit}
                aria-label={t('删除标签')}
                title={t('删除标签')}
                onClick={() => removeKey(key)}
              >✕</button>
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="tv-add">
          <input
            value={newKey}
            spellCheck={false}
            placeholder={t('新键，如 owner')}
            aria-label={t('新标签键')}
            onChange={(event) => setNewKey(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }}
          />
          <input
            value={newValue}
            spellCheck={false}
            placeholder={t('值，如 张三')}
            aria-label={t('新标签值')}
            onChange={(event) => setNewValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }}
          />
          <button type="button" className="tv-add-btn" onClick={addTag}>{t('添加')}</button>
        </div>
      )}
      <p className="tv-hint">
        {canEdit
          ? t('键或值失焦即保存；整张表一步撤销。')
          : t('当前角色为只读，无法编辑标签值。')}
      </p>
    </div>
  )
}