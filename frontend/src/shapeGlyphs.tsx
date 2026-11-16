import type { ReactNode } from 'react'
import { ACCENT, INK, METRICS } from './shapeStyle'

/**
 * 参数化的 UML / SysML 图形符号生成器。
 *
 * <p>所有形状都按「目标框 (x, y, w, h) + 配色」生成绝对坐标的 SVG，因此同一套代码
 * 既能画画布上的大尺寸符号（真实像素），也能画工具箱 / 模型树里的 16×16 小图标
 * （把 16×16 当成目标框即可）——两处不会再各画各的、越改越不像。</p>
 *
 * <p>记法对齐 UML 2.5 / SysML 1.6 规范：类三栏、组件双缺口、部署立方体、接口圆销、
 * 枚举圆角隔间、数据类型双斜线、参与者火柴人、端口方口 / 半圆。</p>
 */

export interface GlyphBox {
  x: number
  y: number
  w: number
  h: number
}

export interface GlyphStyle {
  fill: string
  stroke: string
  strokeWidth: number
  /** 分隔线颜色。 */
  divider?: string
  /** 虚线（注释、抽象类）。 */
  dash?: string
}

const DEFAULT_STYLE: GlyphStyle = { fill: '#ffffff', stroke: INK, strokeWidth: 1.2 }

/** 合并默认样式。 */
function st(style?: Partial<GlyphStyle>): GlyphStyle {
  return { ...DEFAULT_STYLE, ...style }
}

/* ───────────────────────── 基础矩形族 ───────────────────────── */

/** SysML 块：矩形（微圆角）。 */
export function blockGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  return (
    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={2}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/**
 * UML 类：三栏（名称 / 属性 / 操作）。
 *
 * <p>分隔线由外部传入行数决定，但**三栏结构恒在**：即使属性与操作都为空，
 * 名称栏下面也保留两条分隔线与名义栏高——对标 MagicDraw，空类同样显示
 * 「名称 / 属性 / 操作」三个隔间，而不是缩成光秃秃的一个矩形。</p>
 */
export function classifierGlyph(
  box: GlyphBox,
  style?: Partial<GlyphStyle>,
  rows?: { attributeCount: number; operationCount: number },
): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const nameH = Math.min(METRICS.classNameH, h * METRICS.classNameHRatio)
  const attrRows = rows?.attributeCount ?? 0
  const opRows = rows?.operationCount ?? 0
  // 有内容按行数给高度，没内容也留一条名义栏高，保证隔间可见。
  const attrH = attrRows > 0
    ? Math.min(METRICS.classLineH * attrRows, h * METRICS.classRowHRatio)
    : Math.min(METRICS.classLineH * 0.6, h * METRICS.classEmptyHRatio)
  const opH = opRows > 0
    ? Math.min(METRICS.classLineH * opRows, h * METRICS.classRowHRatio)
    : Math.min(METRICS.classLineH * 0.6, h * METRICS.classEmptyHRatio)
  const lines: ReactNode[] = []
  const cursor = y + nameH
  // 名称 / 属性分隔线：恒画。
  lines.push(<line key="d1" x1={x} y1={cursor} x2={x + w} y2={cursor}
    stroke={s.divider ?? s.stroke} strokeWidth={s.strokeWidth * 0.75} />)
  // 属性 / 操作分隔线：恒画（属性栏为空时落在名义栏高处）。
  lines.push(<line key="d2" x1={x} y1={cursor + attrH} x2={x + w} y2={cursor + attrH}
    stroke={s.divider ?? s.stroke} strokeWidth={s.strokeWidth * 0.75} />)
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      {lines}
    </g>
  )
}

/** UML 组件：矩形 + 左侧上下两个伸出边框的小方块。 */
export function componentGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const notch = Math.min(METRICS.componentNotch, h * 0.24)
  const gap = METRICS.componentGap
  const cy = y + h / 2
  const top = cy - notch - gap / 2
  const bottom = cy + gap / 2
  // UML 规范里两个小方块是「伸出」组件边框的，因此大部分落在边框左侧。
  const left = x - notch * 0.72
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      <rect x={left} y={top} width={notch} height={notch}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      <rect x={left} y={bottom} width={notch} height={notch}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    </g>
  )
}

/**
 * UML 部署节点：三维立方体。
 *
 * <p>前面是矩形，顶面与右面向右上后方偏移；偏移量按宽度比例取，
 * 保证小图标下仍是立方体而不是扁片。</p>
 */
export function nodeGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const d = Math.max(4, Math.min(METRICS.nodeDepth, w * 0.22))
  const skew = d * 0.62
  const frontW = w - d
  const frontH = h - d * 0.4
  return (
    <g>
      {/* 顶面 */}
      <path d={`M${x},${y} L${x + skew},${y - d} L${x + w},${y - d} L${x + frontW},${y} Z`}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round" />
      {/* 右侧面 */}
      <path d={`M${x + frontW},${y} L${x + w},${y - d} L${x + w},${y - d + frontH} L${x + frontW},${y + frontH} Z`}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round" />
      {/* 前面 */}
      <rect x={x} y={y} width={frontW} height={frontH}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    </g>
  )
}

/** UML 接口：圆形 + 右侧凸出的半圆插座。 */
export function interfaceGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const r = Math.min(w, h) / 2 - 1
  const cx = x + w / 2 - r * 0.35
  const cy = y + h / 2
  const socketR = r * 0.42
  const chord = cx + r * 0.86
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      <path d={`M${chord},${cy - socketR} A${socketR},${socketR} 0 0 1 ${chord},${cy + socketR} Z`}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    </g>
  )
}

/** UML 枚举：圆角矩形 + 底部隔间。 */
export function enumerationGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const div = y + h * 0.55
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      <line x1={x} y1={div} x2={x + w} y2={div}
        stroke={s.divider ?? s.stroke} strokeWidth={s.strokeWidth * 0.75} />
    </g>
  )
}

/** UML 数据类型：矩形 + 左右两条斜线（表示值类型）。 */
export function datatypeGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const d = Math.min(w, h) * 0.28
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      <path d={`M${x + d * 0.6},${y + h * 0.72} L${x + d * 0.6 + d},${y + h * 0.28}`}
        stroke={s.stroke} strokeWidth={s.strokeWidth} fill="none" />
      <path d={`M${x + w - d * 0.6 - d},${y + h * 0.72} L${x + w - d * 0.6},${y + h * 0.28}`}
        stroke={s.stroke} strokeWidth={s.strokeWidth} fill="none" />
    </g>
  )
}

/** UML 制品：文档形（右上折角）。 */
export function artifactGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const fold = Math.min(METRICS.fold, w * 0.28, h * 0.28)
  const d = `M${x},${y} h${w - fold} l${fold},${fold} v${h - fold} h-${w} z M${x + w - fold},${y} v${fold} h-${fold}`
  return (
    <path d={d} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
      strokeLinejoin="round" />
  )
}

/* ───────────────────────── 行为族 ───────────────────────── */

/** SysML 需求：折角纸片（右上角折起）。 */
export function requirementGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const fold = Math.min(METRICS.fold, w * 0.26, h * 0.26)
  const d = `M${x},${y} h${w - fold} l${fold},${fold} v${h - fold} h-${w} z M${x + w - fold},${y} v${fold} h-${fold}`
  return (
    <path d={d} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
      strokeLinejoin="round" />
  )
}

/** UML 注释：折角纸片 + 虚线边框。 */
export function commentGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st({ dash: '5 4', ...style })
  const { x, y, w, h } = box
  const fold = Math.min(METRICS.fold, w * 0.26, h * 0.26)
  const d = `M${x},${y} h${w - fold} l${fold},${fold} v${h - fold} h-${w} z M${x + w - fold},${y} v${fold} h-${fold}`
  return (
    <path d={d} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
      strokeDasharray={s.dash} strokeLinejoin="round" />
  )
}

/** UML 用例：椭圆。 */
export function usecaseGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  return (
    <ellipse cx={box.x + box.w / 2} cy={box.y + box.h / 2}
      rx={Math.max(2, box.w / 2 - 1)} ry={Math.max(2, box.h / 2 - 1)}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/** UML 状态：圆角矩形。 */
export function stateGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const r = Math.min(METRICS.stateRadius, box.h / 3)
  return (
    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={r}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/** UML 伪状态：实心小圆。 */
export function pseudostateGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const r = Math.max(3, Math.min(box.w, box.h) / 2 - 1)
  return (
    <circle cx={box.x + box.w / 2} cy={box.y + box.h / 2} r={r}
      fill={s.stroke} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/** 活动图动作：胶囊（圆角取满）。 */
export function actionGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const r = Math.min(box.h / 2, Math.max(box.h * METRICS.actionRadius, 6))
  return (
    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={r}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/** 活动图对象节点：圆角矩形。 */
export function objectGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  return (
    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={METRICS.objectRadius}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/**
 * UML 参与者：火柴人。
 *
 * <p>比例按规范走：头约占身高 1/8，手臂平举在腰部高度，两腿分开。
 * 此前画的是「圆头 + 竖线 + 横线 + 两条斜线」但比例失衡、线宽过细，
 * 在用例图里既不像人也不像图标——这是本轮重点修的记法。</p>
 */
export function actorGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const cx = x + w / 2
  const headR = Math.max(1.8, Math.min(h * 0.115, w * 0.22))
  const headCy = y + headR + 1
  const neckY = headCy + headR
  const hipY = y + h * 0.56
  const armY = y + h * 0.4
  const armHalf = Math.min(w * 0.34, h * 0.2)
  const legHalf = Math.min(w * 0.26, h * 0.15)
  const footY = y + h - 2
  const lineWidth = s.strokeWidth * 1.5
  return (
    <g fill="none" stroke={s.stroke} strokeWidth={lineWidth}
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx={cx} cy={headCy} r={headR} fill={s.fill} />
      <line x1={cx} y1={neckY} x2={cx} y2={hipY} />
      <line x1={cx - armHalf} y1={armY} x2={cx + armHalf} y2={armY} />
      <line x1={cx} y1={hipY} x2={cx - legHalf} y2={footY} />
      <line x1={cx} y1={hipY} x2={cx + legHalf} y2={footY} />
    </g>
  )
}

/**
 * UML 包：文件夹（标签页凸起）。
 *
 * <p>标签页宽度可传（{@code parts.tabWidth}）：包名按 UML 规范写在标签页里，
 * 宽度要跟着名字长度走，否则「«Package»」标签会溢出标签页。
 * 标签页高度也可传（{@code parts.tabHeight}）：样式面板里把字号调大时，
 * 标签页要跟着长高，否则名字顶出标签页。</p>
 */
export function packageGlyph(
  box: GlyphBox,
  style?: Partial<GlyphStyle>,
  parts?: { tabWidth?: number; tabHeight?: number },
): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const tabH = Math.max(6, parts?.tabHeight ?? h * METRICS.packageTabH)
  const tabW = Math.min(parts?.tabWidth ?? w * METRICS.packageTabW, w - 6)
  const d = `M${x},${y + tabH} L${x},${y} L${x + tabW},${y} L${x + tabW + 4},${y + tabH} L${x + w},${y + tabH} L${x + w},${y + h} L${x},${y + h} Z`
  return (
    <path d={d} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth}
      strokeLinejoin="round" />
  )
}

/** 包标签页高度（渲染与排布共用）。 */
export function packageTabHeight(h: number): number {
  return Math.max(6, h * METRICS.packageTabH)
}

/** SysML 端口：方口。 */
export function portGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const size = Math.min(box.w, box.h)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return (
    <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/** SysML 流端口：半圆（挂在边界上的小半圆）。 */
export function flowPortGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const size = Math.min(box.w, box.h)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const r = size / 2
  return (
    <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy} Z`}
      fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
  )
}

/** 容器（活动 / 状态机 / 交互）：矩形 + 左上角凸起标签。 */
export function frameGlyph(box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const tabW = Math.min(METRICS.frameTabW, w * 0.4)
  const tabH = METRICS.frameTabH
  return (
    <g>
      <rect x={x} y={y + tabH} width={w} height={Math.max(1, h - tabH)} rx={3}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      <path d={`M${x},${y + tabH} L${x},${y} L${x + tabW},${y} L${x + tabW},${y + tabH} Z`}
        fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round" />
    </g>
  )
}

/** 活动图泳道：主体 + 深色标题条。 */
export function swimlaneGlyph(
  box: GlyphBox,
  style?: Partial<GlyphStyle>,
  parts?: { headerFill: string; bodyFill: string; headerHeight: number },
): ReactNode {
  const s = st(style)
  const { x, y, w, h } = box
  const headerH = parts?.headerHeight ?? METRICS.swimlaneHeader
  return (
    <g>
      <rect x={x} y={y} width={w} height={h}
        fill={parts?.bodyFill ?? s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />
      <rect x={x} y={y} width={w} height={headerH}
        fill={parts?.headerFill ?? '#eef2f7'} stroke={s.stroke} strokeWidth={s.strokeWidth} />
    </g>
  )
}

/** 生命线表头（不含轴线，轴线由序列图布局单独画）。 */
export function lifelineHeaderGlyph(
  box: GlyphBox,
  style?: Partial<GlyphStyle>,
  parts?: { headerFill: string; stroke: string; strokeWidth: number },
): ReactNode {
  return (
    <rect x={box.x} y={box.y} width={box.w} height={box.h}
      fill={parts?.headerFill ?? '#f7f9fc'}
      stroke={parts?.stroke ?? INK} strokeWidth={parts?.strokeWidth ?? 1.2} />
  )
}

/** 按形状种类分发到具体记法。 */
export function glyphFor(kind: string, box: GlyphBox, style?: Partial<GlyphStyle>): ReactNode {
  switch (kind) {
    case 'classifier': return classifierGlyph(box, style)
    case 'component': return componentGlyph(box, style)
    case 'node': return nodeGlyph(box, style)
    case 'interface': return interfaceGlyph(box, style)
    case 'enumeration': return enumerationGlyph(box, style)
    case 'datatype': return datatypeGlyph(box, style)
    case 'artifact': return artifactGlyph(box, style)
    case 'requirement': return requirementGlyph(box, style)
    case 'comment': return commentGlyph(box, style)
    case 'usecase': return usecaseGlyph(box, style)
    case 'state': return stateGlyph(box, style)
    case 'pseudostate': return pseudostateGlyph(box, style)
    case 'action': return actionGlyph(box, style)
    case 'object': return objectGlyph(box, style)
    case 'actor': return actorGlyph(box, style)
    case 'package': return packageGlyph(box, style)
    case 'port': return portGlyph(box, style)
    case 'frame': return frameGlyph(box, style)
    default: return blockGlyph(box, style)
  }
}

/** 图标侧用的小尺寸记法（16×16 视口）。 */
export const ICON_BOX: GlyphBox = { x: 1, y: 1, w: 14, h: 14 }

/** 端口 / 流端口的语义色，供图标复用。 */
export const PORT_COLOR = ACCENT.port
