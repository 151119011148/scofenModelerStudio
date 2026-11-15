import { useCallback, useEffect, useRef, useState } from 'react'
import { t, useLocale } from './i18n'
import {
  FRAME_STYLE_GROUPS,
  LINE_PRESETS,
  LINE_STYLE_GROUPS,
  NODE_PRESETS,
  NODE_STYLE_GROUPS,
  SWATCHES,
  numberRange,
  numberValue,
  patchOf,
} from './diagramStyle'
import type { StyleField } from './diagramStyle'
import type { Diagram, StyleCatalog, StyleMap } from './types'

type Scope = 'node' | 'line' | 'frame'

export interface StylePanelProps {
  catalog: StyleCatalog | null
  canEdit: boolean
  busy: boolean
  diagram: Diagram | null
  frameEnabled: boolean
  /** 序列图自带 sd 图框，「显示图框」开关对它没有意义，置灰并给出说明。 */
  frameToggleDisabled?: boolean
  /** 当前选中对象的说明（元素名 / 关系名 / 多选数量）。 */
  selectionLabel: string
  selectionCount: number
  /** 选中目标类别：决定「图形样式」还是「连线样式」可编辑。 */
  targetKind: 'elements' | 'relation' | 'none'
  nodeStyle: StyleMap
  lineStyle: StyleMap
  frameStyle: StyleMap
  onApplyNode: (patch: StyleMap, replace?: boolean) => void
  onApplyLine: (patch: StyleMap, replace?: boolean) => void
  onApplyFrame: (patch: StyleMap, replace?: boolean) => void
  onToggleFrame: (enabled: boolean) => void
}

const EMPTY: StyleMap = {}

/**
 * 工具箱「样式」页签：图形样式编辑器。
 *
 * 面板只产生「样式补丁」，写入一律走 App 里的命令通道（服务端权威、可撤销、
 * 随 WS Patch 广播）。连续拖滑块 / 取色按 220ms 合并成一次命令，避免把一次调整
 * 炸成几十个 revision。
 */
export function StylePanel(props: StylePanelProps) {
  const {
    catalog, canEdit, busy, diagram, frameEnabled, frameToggleDisabled = false,
    selectionLabel, selectionCount, targetKind,
    nodeStyle, lineStyle, frameStyle, onApplyNode, onApplyLine, onApplyFrame, onToggleFrame,
  } = props
  const locale = useLocale()
  void locale
  const disabled = !canEdit || busy
  const scopeDisabled = (scope: Scope): boolean => disabled
    || (scope === 'node' && targetKind !== 'elements')
    || (scope === 'line' && targetKind !== 'relation')
  const stylesByScope: Record<Scope, StyleMap> = { node: nodeStyle, line: lineStyle, frame: frameStyle }
  const applyByScope: Record<Scope, (patch: StyleMap, replace?: boolean) => void> = {
    node: onApplyNode, line: onApplyLine, frame: onApplyFrame,
  }

  const pending = useRef<Record<Scope, StyleMap>>({ node: {}, line: {}, frame: {} })
  const timer = useRef<number | null>(null)
  const [textDraft, setTextDraft] = useState(frameStyle.frameTitle ?? '')

  useEffect(() => {
    setTextDraft(frameStyle.frameTitle ?? '')
  }, [frameStyle.frameTitle, diagram?.id])

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const batch = pending.current
    pending.current = { node: {}, line: {}, frame: {} }
    for (const scope of ['node', 'line', 'frame'] as Scope[]) {
      const patch = batch[scope]
      if (Object.keys(patch).length > 0) {
        applyByScope[scope](patch, false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onApplyNode, onApplyLine, onApplyFrame])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const schedule = (scope: Scope, patch: StyleMap) => {
    if (scopeDisabled(scope)) return
    Object.assign(pending.current[scope], patch)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 220)
  }

  /** 预设 / 重置是整包替换：先冲掉待提交的增量，再发一条 replace 命令。 */
  const replaceAll = (scope: Scope, style: StyleMap) => {
    if (scopeDisabled(scope)) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    pending.current[scope] = {}
    applyByScope[scope](style, true)
  }

  const renderField = (scope: Scope, field: StyleField) => {
    const style = stylesByScope[scope] ?? EMPTY
    const current = style[field.key] ?? ''
    const fieldDisabled = scopeDisabled(scope)
    const keyId = `sp-${scope}-${field.key}`
    if (field.kind === 'number') {
      const [min, max] = numberRange(catalog, field)
      const value = numberValue(style, field.key, field.fallback ?? min)
      return (
        <div className="sp-row" key={field.key}>
          <label className="sp-label" htmlFor={keyId}>{t(field.label)}</label>
          <div className="sp-control">
            <input
              id={keyId}
              className="sp-range"
              type="range"
              min={min}
              max={max}
              step={field.step ?? 1}
              value={value}
              data-style-key={field.key}
              data-style-scope={scope}
              disabled={fieldDisabled}
              onChange={(event) => schedule(scope, patchOf(field.key, event.target.value))}
            />
            <output className="sp-value">{Number(value).toFixed(field.step && field.step < 1 ? 2 : 0)}</output>
            <button
              type="button"
              className="sp-clear"
              title={t('恢复默认')}
              disabled={fieldDisabled || current === ''}
              data-style-clear={field.key}
              onClick={() => schedule(scope, patchOf(field.key, ''))}
            >×</button>
          </div>
        </div>
      )
    }
    if (field.kind === 'color') {
      const hex = /^#[0-9a-fA-F]{6}$/.test(current) ? current : '#ffffff'
      return (
        <div className="sp-row" key={field.key}>
          <label className="sp-label" htmlFor={keyId}>{t(field.label)}</label>
          <div className="sp-control sp-color-control">
            <input
              id={keyId}
              className="sp-color"
              type="color"
              value={hex}
              data-style-key={field.key}
              data-style-scope={scope}
              disabled={fieldDisabled}
              onChange={(event) => schedule(scope, patchOf(field.key, event.target.value))}
            />
            <div className="sp-swatches">
              {SWATCHES.slice(0, 8).map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`sp-swatch${current === color ? ' active' : ''}`}
                  style={{ background: color }}
                  title={color}
                  data-style-swatch={color}
                  data-style-scope={scope}
                  disabled={fieldDisabled}
                  onClick={() => schedule(scope, patchOf(field.key, color))}
                />
              ))}
            </div>
            <button
              type="button"
              className="sp-clear"
              title={t('恢复默认')}
              disabled={fieldDisabled || current === ''}
              data-style-clear={field.key}
              onClick={() => schedule(scope, patchOf(field.key, ''))}
            >×</button>
          </div>
        </div>
      )
    }
    if (field.kind === 'enum') {
      return (
        <div className="sp-row" key={field.key}>
          <span className="sp-label">{t(field.label)}</span>
          <div className="sp-enum" role="group" aria-label={t(field.label)}>
            {(field.options ?? []).map((option) => (
              <button
                key={option.value}
                type="button"
                className={`sp-enum-btn${current === option.value ? ' active' : ''}`}
                data-style-value={option.value}
                data-style-key={field.key}
                data-style-scope={scope}
                disabled={fieldDisabled}
                onClick={() => schedule(scope, patchOf(field.key, option.value))}
              >{t(option.label)}</button>
            ))}
            {current !== '' && (
              <button
                type="button"
                className="sp-clear"
                title={t('恢复默认')}
                disabled={fieldDisabled}
                data-style-clear={field.key}
                onClick={() => schedule(scope, patchOf(field.key, ''))}
              >×</button>
            )}
          </div>
        </div>
      )
    }
    return (
      <div className="sp-row" key={field.key}>
        <label className="sp-label" htmlFor={keyId}>{t(field.label)}</label>
        <div className="sp-control">
          <input
            id={keyId}
            className="sp-text"
            type="text"
            value={textDraft}
            maxLength={catalog?.maxTitle ?? 160}
            placeholder={t('留空使用规范标签')}
            data-style-key={field.key}
            data-style-scope={scope}
            disabled={fieldDisabled}
            onChange={(event) => setTextDraft(event.target.value)}
            onBlur={() => schedule(scope, patchOf(field.key, textDraft))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
          <button
            type="button"
            className="sp-clear"
            title={t('恢复默认')}
            disabled={fieldDisabled || !(frameStyle.frameTitle ?? '')}
            data-style-clear={field.key}
            onClick={() => {
              setTextDraft('')
              schedule(scope, patchOf(field.key, ''))
            }}
          >×</button>
        </div>
      </div>
    )
  }

  const renderSection = (
    scope: Scope,
    title: string,
    groups: Array<{ label: string; fields: StyleField[] }>,
    presets: Array<{ label: string; style: StyleMap }>,
    note?: string,
  ) => (
    <section className={`sp-section sp-${scope}`} data-style-section={scope}>
      <div className="sp-section-head">
        <h3>{t(title)}</h3>
        <button
          type="button"
          className="sp-reset"
          data-style-reset={scope}
          disabled={scopeDisabled(scope) || Object.keys(stylesByScope[scope] ?? {}).length === 0}
          onClick={() => replaceAll(scope, {})}
        >{t('重置全部')}</button>
      </div>
      {scopeDisabled(scope) && !disabled && (
        <p className="sp-note">{scope === 'line' ? t('选中一条连线后可调整颜色、粗细与线型。') : t('选中图形后可调整字号与颜色。')}</p>
      )}
      {note && !scopeDisabled(scope) && <p className="sp-note">{t(note)}</p>}
      <div className="sp-presets">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="sp-preset"
            data-style-preset={preset.label}
            data-style-scope={scope}
            disabled={scopeDisabled(scope)}
            onClick={() => replaceAll(scope, preset.style)}
          >{t(preset.label)}</button>
        ))}
      </div>
      {groups.map((group) => (
        <div className="sp-group" key={group.label}>
          <div className="sp-group-title">{t(group.label)}</div>
          {group.fields.map((field) => renderField(scope, field))}
        </div>
      ))}
    </section>
  )

  return (
    <div className="style-panel" data-testid="style-panel">
      <div className="sp-target" data-style-target={selectionCount > 0 ? 'selection' : 'none'}>
        <strong>{selectionLabel || t('未选择对象')}</strong>
        {selectionCount > 1 && <span>{t('{count} 个对象', { count: selectionCount })}</span>}
      </div>

      {targetKind === 'elements' && renderSection('node', '图形样式', NODE_STYLE_GROUPS, NODE_PRESETS,
        '样式保存在服务端记法对象上，可撤销、随图导出。')}
      {targetKind === 'none' && (
        <p className="sp-hint">{t('在画布上选中一个图形或一条连线，即可调整字号、颜色与线型；图框样式始终可编辑。')}</p>
      )}

      {renderSection('line', '连线样式', LINE_STYLE_GROUPS, LINE_PRESETS,
        '连线样式按图挂在关系属性上，随模型一起保存。')}

      <section className="sp-section sp-frame" data-style-section="frame">
        <div className="sp-section-head">
          <h3>{t('SysML 图框')}</h3>
          <label className="sp-switch">
            <input
              type="checkbox"
              checked={frameToggleDisabled ? true : frameEnabled}
              data-style-toggle="frame"
              disabled={disabled || !diagram || frameToggleDisabled}
              onChange={(event) => onToggleFrame(event.target.checked)}
            />
            <span>{t('显示图框')}</span>
          </label>
        </div>
        <p className="sp-note">{t(frameToggleDisabled
          ? '序列图用自带的 sd 图框，这里只调它的框线与标签样式。'
          : '图框按每张图单独保存，标题默认按「图种 [宿主 [图名]]」生成。')}</p>
        {FRAME_STYLE_GROUPS.map((group) => (
          <div className="sp-group" key={group.label}>
            <div className="sp-group-title">{t(group.label)}</div>
            {group.fields.map((field) => renderField('frame', field))}
          </div>
        ))}
        <div className="sp-section-head sp-frame-foot">
          <button
            type="button"
            className="sp-reset"
            data-style-reset="frame"
            disabled={disabled || Object.keys(frameStyle).length === 0}
            onClick={() => replaceAll('frame', {})}
          >{t('重置全部')}</button>
        </div>
      </section>

      {!canEdit && <p className="sp-hint">{t('当前角色为只读，样式不可修改。')}</p>}
    </div>
  )
}
