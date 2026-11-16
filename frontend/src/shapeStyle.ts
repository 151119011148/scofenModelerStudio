// 图形符号外观字典：形状的默认配色、线宽、字号与几何常量。
//
// 参照 MagicDraw / Cameo 的记法风格重做：白底 + 中性深灰描边 + 深色文字，
// 语义色只保留 UML 规范上确有识别意义的少数几种（需求 / 用例 / 端口）。
// 此前 renderNode 里散落着二十多处硬编码色值与尺寸（描边 #cbd3dd 浅到几乎看不见、
// 隔间线 #d4dae3、泳道 #e8edf4 …），改配色要同时改十几个地方——这里收成一处。
//
// 颜色语义：所有形状共用 INK（描边）与 INK_TEXT（文字），
// 变体只在「识别色」上区分，避免九张图各说各话。

export interface ShapeAppearance {
  /** 填充色。 */
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

/** 中性主色：白底深灰描边，接近 MagicDraw 默认的「黑框」观感但更柔和。 */
export const INK = '#3f4a5a'
export const INK_TEXT = '#16202e'
export const INK_TYPE = '#5d6b7e'
export const INK_DIVIDER = '#c5cfdc'

/** 语义色：仅用于 UML 规范上确有识别意义的几类形状。 */
export const ACCENT = {
  /** 需求：SysML 惯例用青绿。 */
  requirement: '#0f766e',
  /** 用例：UML 惯例用绿。 */
  usecase: '#15803d',
  /** 端口 / 插口：实心小方块用琥珀色区分。 */
  port: '#b7791f',
  /** 接口：圆形记法用紫。 */
  interface: '#6b46c1',
  /** 注释：中性灰。 */
  comment: '#64748b',
} as const

/** 交互态颜色（选中 / 连线源）优先级高于用户样式。 */
export const INTERACTIVE = {
  selectedFill: '#e9f0fc',
  selectedStroke: '#2b5cb8',
  linkSourceFill: '#e6f6f3',
  linkSourceStroke: '#0f766e',
  multiSelectStroke: '#2b5cb8',
} as const

/** 基础外观：绝大多数形状共用。 */
export const BASE_APPEARANCE: ShapeAppearance = {
  fill: '#ffffff',
  stroke: INK,
  strokeWidth: 1.2,
  textColor: INK_TEXT,
  typeColor: INK_TYPE,
  dividerColor: INK_DIVIDER,
  radius: 2,
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
  requirement: { ...BASE_APPEARANCE, stroke: ACCENT.requirement },
  usecase: { ...BASE_APPEARANCE, stroke: ACCENT.usecase },
  state: BASE_APPEARANCE,
  pseudostate: BASE_APPEARANCE,
  action: BASE_APPEARANCE,
  control: BASE_APPEARANCE,
  object: { ...BASE_APPEARANCE, fill: '#f7f9fc' },
  actor: BASE_APPEARANCE,
  package: BASE_APPEARANCE,
  port: { ...BASE_APPEARANCE, fill: '#ffffff', stroke: ACCENT.port },
  comment: { ...BASE_APPEARANCE, stroke: ACCENT.comment },
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
