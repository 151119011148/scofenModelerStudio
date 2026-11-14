// 九图记法层：关系连线样式、元素形状分类、边框相交几何。
// 渲染器禁止按图类型硬编码，形状/样式集中在此，新增图类型只改这里。

export type ShapeKind =
  | 'block'
  | 'requirement'
  | 'usecase'
  | 'state'
  | 'pseudostate'
  | 'action'
  | 'control'
  | 'object'
  | 'actor'
  | 'package'
  | 'port'
  | 'comment'
  | 'frame'
  | 'swimlane'
  | 'lifeline'
  | 'default'

export interface RelStyle {
  color: string
  dashed: boolean
  arrow: 'filled' | 'hollow' | 'open' | 'none'
  label: string
  width?: number
}

// 关系类型 → 记法样式。键统一小写，匹配时忽略大小写与连字符。
const RELATIONSHIP_STYLES: Record<string, RelStyle> = {
  satisfy: { color: '#2b6cb0', dashed: false, arrow: 'filled', label: 'satisfy' },
  verify: { color: '#2c7a7b', dashed: false, arrow: 'filled', label: 'verify' },
  refine: { color: '#6b46c1', dashed: true, arrow: 'open', label: 'refine' },
  derive: { color: '#6b46c1', dashed: true, arrow: 'open', label: 'derive' },
  devereq: { color: '#6b46c1', dashed: true, arrow: 'open', label: 'derive' },
  derivereqt: { color: '#6b46c1', dashed: true, arrow: 'open', label: 'deriveReqt' },
  allocate: { color: '#805ad5', dashed: true, arrow: 'open', label: 'allocate' },
  constraintparameter: { color: '#805ad5', dashed: true, arrow: 'open', label: 'constraintParameter' },
  trace: { color: '#718096', dashed: true, arrow: 'open', label: 'trace' },
  copy: { color: '#718096', dashed: true, arrow: 'open', label: 'copy' },
  association: { color: '#2d3748', dashed: false, arrow: 'open', label: '' },
  generalization: { color: '#2d3748', dashed: false, arrow: 'hollow', label: '' },
  dependency: { color: '#a0522d', dashed: true, arrow: 'open', label: 'depend' },
  include: { color: '#2f855a', dashed: true, arrow: 'open', label: 'include' },
  extend: { color: '#c05621', dashed: true, arrow: 'open', label: 'extend' },
  flow: { color: '#3182ce', dashed: false, arrow: 'filled', label: '' },
  itemflow: { color: '#3182ce', dashed: false, arrow: 'filled', label: 'item' },
  objectflow: { color: '#3182ce', dashed: true, arrow: 'filled', label: '' },
  controlflow: { color: '#dd6b20', dashed: false, arrow: 'filled', label: '' },
  connector: { color: '#4a5568', dashed: false, arrow: 'filled', label: '' },
  delegation: { color: '#4a5568', dashed: true, arrow: 'filled', label: 'delegate' },
  binding: { color: '#805ad5', dashed: false, arrow: 'filled', label: 'binding' },
  containment: { color: '#a0aec0', dashed: false, arrow: 'none', label: '' },
  import: { color: '#a0aec0', dashed: false, arrow: 'none', label: '' },
  access: { color: '#a0aec0', dashed: false, arrow: 'none', label: '' },
  transition: { color: '#dd6b20', dashed: false, arrow: 'open', label: '' },
  guard: { color: '#dd6b20', dashed: true, arrow: 'open', label: '' },
  region: { color: '#dd6b20', dashed: false, arrow: 'open', label: '' },
  orderedfragment: { color: '#dd6b20', dashed: true, arrow: 'open', label: '' },
  partition: { color: '#dd6b20', dashed: true, arrow: 'open', label: '' },
  message: { color: '#3182ce', dashed: false, arrow: 'filled', label: '' },
  // 依赖家族的扩充：抽象 / 实现 / 接口实现 / 替换 / 使用 / 包合并 / 剖面应用 / 信息流 / 体现
  abstraction: { color: '#a0522d', dashed: true, arrow: 'open', label: 'abstract' },
  realization: { color: '#a0522d', dashed: true, arrow: 'hollow', label: 'realize' },
  interfacerealization: { color: '#2b6cb0', dashed: true, arrow: 'hollow', label: 'implement' },
  substitution: { color: '#a0522d', dashed: true, arrow: 'hollow', label: 'substitute' },
  usage: { color: '#a0522d', dashed: true, arrow: 'open', label: 'use' },
  packagemerge: { color: '#a0aec0', dashed: true, arrow: 'hollow', label: 'merge' },
  profileapplication: { color: '#a16207', dashed: true, arrow: 'open', label: 'apply' },
  informationflow: { color: '#3182ce', dashed: false, arrow: 'open', label: 'info' },
  manifestation: { color: '#4a5568', dashed: true, arrow: 'hollow', label: 'manifest' },
}

export function normalizeRelKey(type: string): string {
  return type.toLowerCase().replace(/[^a-z]/g, '')
}

export function relationshipStyle(type: string): RelStyle {
  const base = RELATIONSHIP_STYLES[normalizeRelKey(type)]
  if (base) {
    return { ...base, width: base.width ?? 1.4 }
  }
  return { color: '#8a95a3', dashed: false, arrow: 'open', label: '', width: 1.4 }
}

// 元素类型（uml 名或枚举 code，忽略大小写） → 形状
const SHAPE_MAP: Record<string, ShapeKind> = {
  block: 'block',
  partproperty: 'block',
  valueType: 'block',
  constraintblock: 'block',
  constraintproperty: 'block',
  interaction: 'frame',
  activity: 'frame',
  statemachine: 'frame',
  package: 'package',
  modellibrary: 'package',
  model: 'package',
  profile: 'package',
  requirement: 'requirement',
  testcase: 'requirement',
  usecase: 'usecase',
  actor: 'actor',
  lifeline: 'lifeline',
  state: 'state',
  pseudostate: 'pseudostate',
  transition: 'pseudostate',
  action: 'action',
  controlnode: 'control',
  objectnode: 'object',
  port: 'port',
  flowport: 'port',
  connector: 'port',
  comment: 'comment',

  // 扩充类型：分类器 / 特征 / 部署
  class: 'block',
  interface: 'block',
  signal: 'block',
  datatype: 'block',
  primitivetype: 'block',
  enumeration: 'block',
  associationclass: 'block',
  component: 'block',
  collaboration: 'block',
  informationitem: 'block',
  instancespecification: 'block',
  operation: 'default',
  parameter: 'default',
  reception: 'default',
  node: 'block',
  device: 'block',
  executionenvironment: 'block',
  artifact: 'block',
  deploymentspecification: 'block',
  valueproperty: 'block',
  referenceproperty: 'block',
  flowproperty: 'block',
  flowspecification: 'block',
  view: 'package',
  viewpoint: 'package',
  rationale: 'comment',
  problem: 'comment',

  // 扩充类型：活动控制节点与结构化节点
  initialnode: 'control',
  activityfinalnode: 'control',
  flowfinalnode: 'control',
  decisionnode: 'control',
  mergenode: 'control',
  forknode: 'control',
  joinnode: 'control',
  datastorenode: 'object',
  centralbuffernode: 'object',
  activityparameternode: 'object',
  structuredactivitynode: 'frame',
  expansionregion: 'frame',
  interruptibleactivityregion: 'frame',
  activitypartition: 'swimlane',
  allocateactivitypartition: 'swimlane',
  valuepin: 'default',
  actioninputpin: 'default',

  // 扩充类型：交互片段与状态机细节
  interactionuse: 'frame',
  stateinvariant: 'frame',
  continuation: 'frame',
  gate: 'default',
  considerignorefragment: 'frame',
  actionexecutionspecification: 'default',
  behaviorexecutionspecification: 'default',
  destructionoccurrencespecification: 'default',
  protocolstatemachine: 'frame',
  finalstate: 'state',
  connectionpointreference: 'pseudostate',

  // 扩充类型：§7 模板 / §8 值规格与观察 / §13 事件 / §15-§17 细节
  templatesignature: 'default',
  redefinabletemplatesignature: 'default',
  templateparameter: 'default',
  classifiertemplateparameter: 'default',
  templatebinding: 'default',
  templateparametersubstitution: 'default',
  opaqueexpression: 'default',
  instancevalue: 'default',
  durationobservation: 'default',
  timeobservation: 'default',
  durationinterval: 'default',
  timeinterval: 'default',
  intervalconstraint: 'frame',
  durationconstraint: 'frame',
  timeconstraint: 'frame',
  opaqueaction: 'action',
  outputpin: 'default',
  variable: 'object',
  exceptionhandler: 'control',
  property: 'block',
  slot: 'default',
  messageoccurrencespecification: 'default',
  executionoccurrencespecification: 'default',
  interactionoperand: 'frame',
  partdecomposition: 'frame',
  interactionconstraint: 'frame',
  generalordering: 'default',
  region: 'frame',
  trigger: 'default',
  signalevent: 'default',
  callevent: 'default',
  timeevent: 'default',
  changeevent: 'default',
  anyreceiveevent: 'default',
}

export function normalizeTypeKey(type: string): string {
  return type.toLowerCase().replace(/[^a-z]/g, '')
}

export function shapeOf(type: string): ShapeKind {
  return SHAPE_MAP[normalizeTypeKey(type)] ?? 'default'
}

/** 泳道顶部标题栏高度：渲染与自动排布共用，保证动作不会压进标题栏。 */
export const SWIMLANE_HEADER = 34

/** 是否活动分区（泳道）：含 SysML 的分配活动分区。 */
export function isPartitionType(type: string): boolean {
  const key = normalizeTypeKey(type)
  return key === 'activitypartition' || key === 'allocateactivitypartition'
}

/** 活动图里分区归属以「动作落在泳道内」表达，不画连线；其它图种保留虚线记法。 */
export function isLaneMembershipRelation(type: string, diagramKind: string): boolean {
  return diagramKind === 'act' && normalizeRelKey(type) === 'partition'
}

/** UML 活动控制节点的标准图形种类；普通 controlnode 返回 null 仍画圆角框。 */
export type ControlGlyph = 'initial' | 'final' | 'flowfinal' | 'decision' | 'merge' | 'fork' | 'join'

const CONTROL_GLYPHS: Record<string, ControlGlyph> = {
  initialnode: 'initial',
  activityfinalnode: 'final',
  flowfinalnode: 'flowfinal',
  decisionnode: 'decision',
  mergenode: 'merge',
  forknode: 'fork',
  joinnode: 'join',
}

export function controlGlyph(type: string): ControlGlyph | null {
  return CONTROL_GLYPHS[normalizeTypeKey(type)] ?? null
}

/** 控制节点图形的规范尺寸：连线贴到图形边界而非旧的大方框，记法宽高也按它落库。 */
export const CONTROL_SIZE: Record<ControlGlyph, { w: number; h: number }> = {
  initial: { w: 24, h: 24 },
  final: { w: 30, h: 30 },
  flowfinal: { w: 28, h: 28 },
  decision: { w: 88, h: 56 },
  merge: { w: 88, h: 56 },
  fork: { w: 88, h: 10 },
  join: { w: 88, h: 10 },
}

export function controlSizeOf(type: string): { w: number; h: number } | undefined {
  const glyph = controlGlyph(type)
  return glyph ? CONTROL_SIZE[glyph] : undefined
}

const clampNum = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 读取按图持久化的手动走线（关系 properties 的 route:<diagramId>），非法数据退回自动路由。 */
export function readRoute(
  properties: Record<string, unknown> | undefined,
  diagramId: string,
): RoutePoint[] | null {
  const raw = properties?.[`route:${diagramId}`]
  if (!Array.isArray(raw) || raw.length < 2) {
    return null
  }
  const points: RoutePoint[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const x = (item as Record<string, unknown>).x
    const y = (item as Record<string, unknown>).y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }
    points.push({ x, y })
  }
  return points
}

/** 去掉重合点与共线中间点，拖拽后不留零长度段。 */
export function simplifyRoute(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - point.x) < 0.5 && Math.abs(last.y - point.y) < 0.5) continue
    out.push(point)
  }
  for (let i = 1; i < out.length - 1; i++) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const collinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5)
      || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)
    if (collinear) {
      out.splice(i, 1)
      i--
    }
  }
  return out
}

/** 端点重挂：节点被移动后把首尾段重新贴到图形边界，必要时补一个直角肘。 */
function anchorEnd(rect: RouteRect, neighbor: RoutePoint): RoutePoint[] {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  if (Math.abs(neighbor.x - cx) >= Math.abs(neighbor.y - cy)) {
    const sideX = neighbor.x >= cx ? rect.x + rect.w : rect.x
    const y = clampNum(neighbor.y, rect.y, rect.y + rect.h)
    const edge = { x: sideX, y }
    return Math.abs(y - neighbor.y) < 0.5 ? [edge] : [edge, { x: sideX, y: neighbor.y }]
  }
  const sideY = neighbor.y >= cy ? rect.y + rect.h : rect.y
  const x = clampNum(neighbor.x, rect.x, rect.x + rect.w)
  const edge = { x, y: sideY }
  return Math.abs(x - neighbor.x) < 0.5 ? [edge] : [edge, { x: neighbor.x, y: sideY }]
}

export function reattachRoute(points: RoutePoint[], source: RouteRect, target: RouteRect): RoutePoint[] {
  if (points.length < 3) {
    return points
  }
  const head = anchorEnd(source, points[1])
  const tail = anchorEnd(target, points[points.length - 2]).reverse()
  return simplifyRoute([...head, ...points.slice(1, -1), ...tail])
}

/** 拖拽第 index 段：沿该段垂直方向平移两个端点，直角折线整体保持正交。 */
export function moveRouteSegment(points: RoutePoint[], index: number, dx: number, dy: number): RoutePoint[] {
  const a = points[index]
  const b = points[index + 1]
  if (!a || !b) return points
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
  // 直连两点线没有可平移的中间段：拖拽时折成 Z 形（两端仍贴在节点边界），否则会整条脱离节点。
  if (points.length === 2) {
    return horizontal
      ? [a, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy }, b]
      : [a, { x: a.x + dx, y: a.y }, { x: b.x + dx, y: b.y }, b]
  }
  const next = points.map((point) => ({ ...point }))
  const delta = horizontal ? { x: 0, y: dy } : { x: dx, y: 0 }
  next[index] = { x: a.x + delta.x, y: a.y + delta.y }
  next[index + 1] = { x: b.x + delta.x, y: b.y + delta.y }
  return next
}

/** 估算文本像素宽：CJK 全角按字号计，拉丁/数字按 0.62 倍，供换行与截断使用。 */
export function textWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text) {
    width += (ch.codePointAt(0) ?? 0) > 0x2e7f ? fontSize : fontSize * 0.62
  }
  return width
}

/** 把标签贪心折行到 maxWidth 内，最多 maxLines 行，超出末行加省略号，保证不溢出节点框。 */
export function wrapLabel(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    if (current && textWidth(current + ch, fontSize) > maxWidth) {
      lines.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  if (current) lines.push(current)
  if (lines.length === 0) lines.push('')
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    let last = kept[maxLines - 1]
    while (last && textWidth(last + '…', fontSize) > maxWidth) last = last.slice(0, -1)
    kept[maxLines - 1] = last + '…'
    return kept
  }
  return lines
}

/**
 * 是否「垫底」形状：自带不透明底，必须比同图其它元素先画，否则后画的元素会被它盖住。
 * 泳道如此，序列图的生命线表头 + 竖线也如此（消息线要压在虚线之上）。
 */
export function isBackdropShape(shape: ShapeKind): boolean {
  return shape === 'swimlane' || shape === 'lifeline'
}

/** 计算箭头多边形（filled / hollow）或 V 形（open）的路径点。 */
export function arrowGeometry(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  size = 9,
): { points: string; v1: string; v2: string } {
  const angle = Math.atan2(ty - sy, tx - sx)
  const spread = Math.PI / 7
  const a1 = { x: tx - size * Math.cos(angle - spread), y: ty - size * Math.sin(angle - spread) }
  const a2 = { x: tx - size * Math.cos(angle + spread), y: ty - size * Math.sin(angle + spread) }
  return {
    points: `${tx},${ty} ${a1.x},${a1.y} ${a2.x},${a2.y}`,
    v1: `${a1.x},${a1.y}`,
    v2: `${a2.x},${a2.y}`,
  }
}

export interface RoutePoint {
  x: number
  y: number
}

export interface RouteRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 直角折线（曼哈顿）路由：锚点取边框中点，拐段只走水平/垂直，参照标准 UML 泳道图画法。
 * 竖直跨度重叠 → 从左右边中点出入（同高直连，否则在中缝走竖直拐段）；
 * 水平跨度重叠 → 从上下边中点出入（同列直连，否则在中缝走水平拐段）；
 * 完全错开时目标在上方走左右出入的 Z 形、在下方走底边出→目标行高→对边入的 L 形。
 */
export function orthogonalRoute(s: RouteRect, t: RouteRect): RoutePoint[] {
  const scx = s.x + s.w / 2
  const scy = s.y + s.h / 2
  const tcx = t.x + t.w / 2
  const tcy = t.y + t.h / 2
  const yOverlap = s.y < t.y + t.h && t.y < s.y + s.h
  const xOverlap = s.x < t.x + t.w && t.x < s.x + s.w

  const horizontal = (): RoutePoint[] => {
    const right = tcx >= scx
    const a = { x: right ? s.x + s.w : s.x, y: scy }
    const b = { x: right ? t.x : t.x + t.w, y: tcy }
    if (a.y === b.y) {
      return [a, b]
    }
    const midX = (a.x + b.x) / 2
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b]
  }
  const vertical = (): RoutePoint[] => {
    const down = tcy >= scy
    const a = { x: scx, y: down ? s.y + s.h : s.y }
    const b = { x: tcx, y: down ? t.y : t.y + t.h }
    if (a.x === b.x) {
      return [a, b]
    }
    const midY = (a.y + b.y) / 2
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b]
  }

  let route: RoutePoint[]
  if (yOverlap && !xOverlap) {
    route = horizontal()
  } else if (xOverlap && !yOverlap) {
    route = vertical()
  } else if (yOverlap && xOverlap) {
    route = Math.abs(tcx - scx) >= Math.abs(tcy - scy) ? horizontal() : vertical()
  } else if (tcy < scy) {
    route = horizontal()
  } else {
    const a = { x: scx, y: s.y + s.h }
    const b = { x: tcx >= scx ? t.x : t.x + t.w, y: tcy }
    route = [a, { x: scx, y: tcy }, b]
  }

  const dedup: RoutePoint[] = []
  for (const point of route) {
    const last = dedup[dedup.length - 1]
    if (!last || last.x !== point.x || last.y !== point.y) {
      dedup.push(point)
    }
  }
  return dedup.filter((point, i) => {
    if (i === 0 || i === dedup.length - 1) {
      return true
    }
    const prev = dedup[i - 1]
    const next = dedup[i + 1]
    return !((prev.x === point.x && point.x === next.x) || (prev.y === point.y && point.y === next.y))
  })
}

/** 折线按弧长取中点，供关系标签贴线居中。 */
export function routeMidpoint(route: RoutePoint[]): RoutePoint {
  let total = 0
  for (let i = 1; i < route.length; i++) {
    total += Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y)
  }
  let walk = total / 2
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (walk <= len && len > 0) {
      const k = walk / len
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
    walk -= len
  }
  return route[route.length - 1] ?? { x: 0, y: 0 }
}
