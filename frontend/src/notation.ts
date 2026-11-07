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

/** 矩形（中心 cx,cy，尺寸 w×h）朝 (tx,ty) 方向的边框交点，用于连线贴边。 */
export function edgePoint(
  cx: number,
  cy: number,
  w: number,
  h: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) {
    return { x: cx + w / 2, y: cy }
  }
  const hw = w / 2
  const hh = h / 2
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh)
  return { x: cx + dx * scale, y: cy + dy * scale }
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
