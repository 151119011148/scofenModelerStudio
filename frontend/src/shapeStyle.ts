// 图形符号外观字典：形状的默认配色、线宽、字号与几何常量。
//
// 配色基准对齐华望 M-Design 画布节点（m-design-graph/examples/testData.ts）：
// 结构块米黄渐变 #DDCD9E→#FDF7DF + 赭石描边 #ad9d85，
// 需求淡粉渐变 #FCD4D9→#FDEBEE，用例淡黄渐变 #FEF9DB→#FEEF9E，
// 包浅蓝渐变 #D7DFFF→#FAFDFF；描边 1px、圆角 0、12px 黑字、隔间线取父描边色。
// 原文「MagicDraw 白底 + 深灰描边 + UML 语义色」的一套已整体让位给华望色板；
// 仅交互态（选中 / 连线源）继续沿用交互蓝，与华望的蓝色高亮一致。

/** 画布渐变定义，注入到画布 <svg> 的 <defs> 中。默认 objectBoundingBox 单位，一份定义全图复用。 */
export const CANVAS_GRADIENTS = [
  { id: 'hw-block', from: '#DDCD9E', to: '#FDF7DF', vertical: false },
  { id: 'hw-requirement', from: '#FCD4D9', to: '#FDEBEE', vertical: false },
  { id: 'hw-usecase', from: '#FEF9DB', to: '#FEEF9E', vertical: true },
  { id: 'hw-package', from: '#D7DFFF', to: '#FAFDFF', vertical: false },
] as const

export type CanvasGradientId = (typeof CANVAS_GRADIENTS)[number]['id']

/** 渐变引用（SVG fill 接受 url(#id)）。 */
const grad = (id: CanvasGradientId): string => `url(#${id})`

export interface ShapeAppearance {
  /** 填充色（可为 url(#gradient)）。 */
  fill: string
  /** 描边色。 */
  stroke: string
  /** 线宽（px）。 */
  strokeWidth: number
  /** 名称文字色。 */
  textColor: string
  /** 类型标签（«Block»）文字色。 */
  typeColor: string
  /** 隔间线 / 分栏线颜色。 */
  dividerColor: string
  /** 圆角半径（px）。 */
  radius: number
}

/** 华望描边：结构块赭石、需求/用例/参与者深灰、包蓝灰。 */
export const INK = '#4c4c4c'
export const INK_OCHRE = '#ad9d85'
export const INK_BLUEGRAY = '#6b7495'
export const INK_TEXT = '#000000'
export const INK_TYPE = '#4c4c4c'
export const INK_DIVIDER = '#ad9d85'

/** 语义色：仅用于少数需与结构块区分的记法（保留键名，色值取华望/SVG 图标同款）。 */
export const ACCENT = {
  /** 需求：淡粉系（与需求渐变同族）。 */
  requirement: '#4c4c4c',
  /** 用例：深灰（渐变已用淡黄区分）。 */
  usecase: '#4c4c4c',
  /** 端口 / 插口：深灰细描边。 */
  port: '#4c4c4c',
  /** 接口：赭石（与结构块同族）。 */
  interface: '#ad9d85',
  /** 注释：深灰虚线。 */
  comment: '#4c4c4c',
} as const

/** 交互态颜色（选中 / 连线源）优先级高于用户样式。华望选中即蓝色高亮。 */
export const INTERACTIVE = {
  selectedFill: '#dcebfd',
  selectedStroke: '#1890ff',
  linkSourceFill: '#e6f6f3',
  linkSourceStroke: '#0f766e',
  multiSelectStroke: '#1890ff',
} as const

/** 基础外观：绝大多数结构形状共用华望米黄渐变。 */
export const BASE_APPEARANCE: ShapeAppearance = {
  fill: grad('hw-block'),
  stroke: INK_OCHRE,
  strokeWidth: 1,
  textColor: INK_TEXT,
  typeColor: INK_TYPE,
  dividerColor: INK_DIVIDER,
  radius: 0,
}

/** 各类形状的外观变体。 */
export const APPEARANCE = {
  block: BASE_APPEARANCE,
  classifier: BASE_APPEARANCE,
  component: BASE_APPEARANCE,
  node: BASE_APPEARANCE,
  interface: { ...BASE_APPEARANCE, stroke: ACCENT.interface },
  enumeration: BASE_APPEARANCE,
  datatype: BASE_APPEARANCE,
  artifact: BASE_APPEARANCE,
  requirement: { ...BASE_APPEARANCE, fill: grad('hw-requirement'), stroke: ACCENT.requirement, dividerColor: '#A18565' },
  usecase: { ...BASE_APPEARANCE, fill: grad('hw-usecase'), stroke: ACCENT.usecase },
  state: BASE_APPEARANCE,
  pseudostate: BASE_APPEARANCE,
  action: BASE_APPEARANCE,
  control: BASE_APPEARANCE,
  object: BASE_APPEARANCE,
  actor: { ...BASE_APPEARANCE, fill: '#FFFFCC', stroke: INK },
  package: { ...BASE_APPEARANCE, fill: grad('hw-package'), stroke: INK_BLUEGRAY, dividerColor: INK_BLUEGRAY },
  port: { ...BASE_APPEARANCE, fill: '#ffffff', stroke: ACCENT.port },
  flowport: { ...BASE_APPEARANCE, fill: '#ffffff', stroke: ACCENT.port },
  comment: { ...BASE_APPEARANCE, fill: '#ffffff', stroke: ACCENT.comment },
  frame: BASE_APPEARANCE,
  swimlane: BASE_APPEARANCE,
  lifeline: BASE_APPEARANCE,
  default: BASE_APPEARANCE,
} as const

export type AppearanceKey = keyof typeof APPEARANCE

/** 取某个形状的外观。 */
export function appearanceOf(key: string): ShapeAppearance {
  return (APPEARANCE as Record<string, ShapeAppearance>)[key] ?? BASE_APPEARANCE
}

/**
 * 几何常量：形状的固定尺寸比例。
 *
 * <p>这些数字原先散在 renderNode 的各个分支里（package tab 18/34、requirement 折角 12、
 * state 圆角 10、actor 头半径 7、action 圆角 22 …），改成规范记法时需要在多处协调，
 * 因此集中到这里，并且按「相对尺寸」定义——图标侧缩小到 16×16 时比例不变。</p>
 */
export const METRICS = {
  /** 包：标签页高 / 标签页宽。 */
  packageTabH: 0.26,
  packageTabW: 0.28,
  /** 需求 / 注释：右上折角。 */
  fold: 14,
  /** 状态：外框圆角。 */
  stateRadius: 10,
  /** 参与者：头半径 / 臂展 / 腿展 / 线宽。 */
  actorHead: 9,
  actorArm: 15,
  actorLeg: 13,
  actorLine: 1.8,
  /** 动作：胶囊圆角（相对高度，取满即胶囊）。 */
  actionRadius: 0.42,
  /** 对象节点：圆角。 */
  objectRadius: 6,
  /** 组件：左侧两个小方块的边长 / 间距。 */
  componentNotch: 13,
  componentGap: 5,
  /** 部署节点：立方体进深。 */
  nodeDepth: 11,
  /** 端口：方口边长 / FlowPort 半圆半径。 */
  portSize: 24,
  /** 活动图：泳道表头高 / 分区标题高。 */
  swimlaneHeader: 32,
  /** 容器 frame：左上角凸起标签的宽 / 高。 */
  frameTabW: 54,
  frameTabH: 15,
  /** 类图三栏：名称栏高度 / 隔间内边距。 */
  classNameH: 46,
  classPadX: 10,
  classLineH: 17,
  /** 类三栏比例：名称栏占框高 / 有内容的属性栏 / 空属性栏。 */
  classNameHRatio: 0.4,
  classRowHRatio: 0.35,
  classEmptyHRatio: 0.18,
  /** 隔间线距顶距离（无类三栏时使用）。 */
  dividerOffset: 50,
  /** 包标签页：名字写进标签页，宽度按名字长度自适应。 */
  packageTabPadX: 6,
} as const

/** 文字基线相对顶边的偏移。 */
export const TEXT = {
  /** 类型标签基线。 */
  typeBaseline: 19,
  /** 名称基线。 */
  nameBaseline: 38,
  /** 小字行高。 */
  lineHeight: 15,
} as const
