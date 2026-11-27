import type { Diagram, Relationship, StyleCatalog, StyleMap } from './types'

type ShapeVariant = 'layer' | 'container' | 'rectangle' | 'rounded' | 'database'
type ShapeOption = { value: ShapeVariant; label: string }

const SHAPE_VARIANTS = new Map<string, readonly ShapeOption[]>([
  ['package', [{ value: 'layer', label: '分层框' }, { value: 'container', label: '容器框' }]],
  ['component', [{ value: 'rectangle', label: '矩形' }, { value: 'rounded', label: '圆角矩形' }, { value: 'container', label: '容器框' }]],
  ['node', [{ value: 'database', label: '数据库' }, { value: 'rectangle', label: '矩形' }]],
])

export function shapeOptions(type: string): readonly ShapeOption[] | undefined {
  return SHAPE_VARIANTS.get(type.toLowerCase())
}

export function shapeVariantOf(type: string, style: StyleMap): ShapeVariant | '' {
  return shapeOptions(type)?.find(({ value }) => value === style.shapeVariant)?.value ?? ''
}

/**
 * 图形样式的前端公共层：节点（Notation.style）、连线（关系 properties 的
 * style:<diagramId>）、图框（Diagram.style）三处共用一套键与读数规则。
 * 键与取值合法性由服务端 /api/metamodel/styles 下发、写入时再由服务端复核；
 * 这里只负责「把字符串安全读成 SVG 属性」，不产生新的样式语义。
 */

export type StyleFieldKind = 'number' | 'color' | 'enum' | 'text'
export interface StyleField {
  key: string
  label: string
  kind: StyleFieldKind
  min?: number
  max?: number
  step?: number
  fallback?: number
  options?: Array<{ value: string; label: string }>
}

const DASH_OPTIONS = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
]

/** 节点：文字 / 填充 / 边框三组，键名与服务端 NotationStyle 白名单一致。 */
export const NODE_STYLE_GROUPS: Array<{ label: string; fields: StyleField[] }> = [
  {
    label: '文字',
    fields: [
      { key: 'fontSize', label: '字号', kind: 'number', min: 8, max: 48, step: 1, fallback: 13 },
      { key: 'fontColor', label: '文字颜色', kind: 'color' },
      {
        key: 'fontWeight', label: '字重', kind: 'enum',
        options: [{ value: 'normal', label: '常规' }, { value: 'bold', label: '加粗' }],
      },
      {
        key: 'textAlign', label: '对齐', kind: 'enum',
        options: [{ value: 'left', label: '左' }, { value: 'center', label: '居中' }, { value: 'right', label: '右' }],
      },
    ],
  },
  {
    label: '填充',
    fields: [
      { key: 'fill', label: '填充颜色', kind: 'color' },
      { key: 'fillOpacity', label: '不透明度', kind: 'number', min: 0, max: 1, step: 0.05, fallback: 1 },
    ],
  },
  {
    label: '边框',
    fields: [
      { key: 'stroke', label: '边框颜色', kind: 'color' },
      { key: 'strokeWidth', label: '边框粗细', kind: 'number', min: 0.5, max: 8, step: 0.5, fallback: 1 },
      { key: 'strokeDash', label: '边框线型', kind: 'enum', options: DASH_OPTIONS },
    ],
  },
]

/** 连线：颜色 / 粗细 / 线型 / 标签字号。 */
export const LINE_STYLE_GROUPS: Array<{ label: string; fields: StyleField[] }> = [
  {
    label: '连线',
    fields: [
      { key: 'lineColor', label: '连线颜色', kind: 'color' },
      { key: 'lineWidth', label: '连线粗细', kind: 'number', min: 0.5, max: 8, step: 0.5, fallback: 1.4 },
      { key: 'lineDash', label: '连线线型', kind: 'enum', options: DASH_OPTIONS },
      { key: 'labelFontSize', label: '标签字号', kind: 'number', min: 8, max: 24, step: 0.5, fallback: 10.5 },
    ],
  },
]

/** 图框：SysML 首页标签与边框。 */
export const FRAME_STYLE_GROUPS: Array<{ label: string; fields: StyleField[] }> = [
  {
    label: '图框',
    fields: [
      { key: 'frameBorder', label: '框线颜色', kind: 'color' },
      { key: 'frameBorderWidth', label: '框线粗细', kind: 'number', min: 0.5, max: 6, step: 0.5, fallback: 1 },
      { key: 'frameKindColor', label: '图种标签色', kind: 'color' },
      { key: 'frameText', label: '图名颜色', kind: 'color' },
      { key: 'frameFontSize', label: '标签字号', kind: 'number', min: 8, max: 24, step: 0.5, fallback: 12.5 },
      { key: 'frameTitle', label: '自定义标题', kind: 'text' },
    ],
  },
]

/** 常用色板：颜色输入旁边的一键色块，避免每次都开系统取色器。 */
export const SWATCHES = [
  '#1c2430', '#55616f', '#8a95a3', '#ffffff',
  '#1890ff', '#0f766e', '#b7791f', '#b23c3c',
  '#e9f0fc', '#e6f6f3', '#fff2cc', '#fde8e8',
]

export interface StylePreset {
  label: string
  style: StyleMap
}

/** 一键套用：整包替换目标样式，撤销一步即可回退。 */
export const NODE_PRESETS: StylePreset[] = [
  { label: '默认', style: {} },
  { label: '强调', style: { fill: '#fff2cc', stroke: '#b7791f', strokeWidth: '2', fontColor: '#7b4a12' } },
  { label: '关键', style: { fill: '#fde8e8', stroke: '#b23c3c', strokeWidth: '2', fontColor: '#8a2525' } },
  { label: '完成', style: { fill: '#e6f6f3', stroke: '#0f766e', fontColor: '#0b5c55' } },
  { label: '草稿', style: { fill: 'none', stroke: '#8a95a3', strokeDash: 'dashed', fontColor: '#55616f' } },
]

export const LINE_PRESETS: StylePreset[] = [
  { label: '默认', style: {} },
  { label: '主色', style: { lineColor: '#1890ff', lineWidth: '2.5' } },
  { label: '虚线', style: { lineColor: '#b7791f', lineDash: 'dashed' } },
  { label: '警示', style: { lineColor: '#b23c3c', lineWidth: '2' } },
]

/** 服务端字典给出的数值区间优先，目录未就绪时用字段声明的兜底区间。 */
export function numberRange(catalog: StyleCatalog | null, field: StyleField): [number, number] {
  const fromServer = catalog?.numbers?.[field.key]
  return Array.isArray(fromServer) && fromServer.length === 2
    ? [Number(fromServer[0]), Number(fromServer[1])]
    : [field.min ?? 0, field.max ?? 100]
}

export function numberValue(style: StyleMap, key: string, fallback: number): number {
  const raw = Number(style[key])
  return Number.isFinite(raw) && style[key] !== undefined && style[key] !== '' ? raw : fallback
}

/** 线型 → SVG strokeDasharray；solid / 未设置返回 undefined。 */
export function dashArray(style: StyleMap, key: string): string | undefined {
  switch (style[key]) {
    case 'dashed': return '5 4'
    case 'dotted': return '2 3'
    default: return undefined
  }
}

/** 文本对齐 → SVG textAnchor + 起始 x（相对节点框左上角）。 */
export function alignAnchor(style: StyleMap): 'start' | 'middle' | 'end' {
  return style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start'
}

export function alignX(style: StyleMap, bx: number, bw: number): number {
  return style.textAlign === 'center' ? bx + bw / 2 : style.textAlign === 'right' ? bx + bw - 12 : bx + 12
}

/** 关系按图保存的连线样式；旧数据里可能是任意形态，一律安全降级。 */
export function relationStyleOf(relation: Relationship | null | undefined, diagramId: string | null): StyleMap {
  if (!relation || !diagramId) return {}
  const raw = relation.properties?.[`style:${diagramId}`]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: StyleMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') {
      result[key] = String(value)
    }
  }
  return result
}

/** 稳定的空样式对象：避免每次渲染都造新引用，让 useMemo 依赖保持平稳。 */
const EMPTY_FRAME_STYLE: StyleMap = {}

export function frameStyleOf(diagram: Diagram | null | undefined): StyleMap {
  return diagram?.style ?? EMPTY_FRAME_STYLE
}

/** 图框是否显示：按图保存的开关优先，没设置时走本地默认。 */
export function frameEnabledOf(diagram: Diagram | null | undefined, defaultOpen: boolean): boolean {
  if (!diagram) return false
  const value = frameStyleOf(diagram).frame
  return value === undefined ? defaultOpen : value !== 'off'
}

/** 颜色值统一：空值 / none 交给调用方决定回退。 */
export function colorOr(style: StyleMap, key: string, fallback: string): string {
  const value = style[key]
  return value && value !== '' ? value : fallback
}

/** 把面板增量补丁里的删除标记（空串）保留下来，服务端 merge 会删掉对应键。 */
export function patchOf(key: string, value: string): StyleMap {
  return { [key]: value }
}
