import type { ReactNode } from 'react'
import { normalizeRelKey, relationshipStyle } from './notation'

/**
 * 元模型 / 九大图 / 关系图标系统。
 *
 * 设计原则：元素颜色按「语义族」区分，字形按「元模型类型」区分；
 * 九大图各有独立字形与颜色；关系图标直接复用画布记法的颜色与虚实线，
 * 使工具箱里的关系组件与画布上画出来的连线一一对应。
 */

export interface IconSpec {
  glyph: string
  color: string
}

export interface FamilyInfo {
  key: string
  label: string
  color: string
}

export const FAMILIES: FamilyInfo[] = [
  { key: 'namespace', label: '命名空间 / 剖面', color: '#a16207' },
  { key: 'requirement', label: '需求', color: '#0f766e' },
  { key: 'structure', label: '结构 / 约束', color: '#1d4ed8' },
  { key: 'activity', label: '活动', color: '#c2410c' },
  { key: 'interaction', label: '交互', color: '#7c3aed' },
  { key: 'state', label: '状态机', color: '#be123c' },
  { key: 'usecase', label: '用例', color: '#15803d' },
  { key: 'annotation', label: '注释', color: '#64748b' },
]

const TYPE_META: Record<string, { family: string; glyph: string }> = {
  PACKAGE: { family: 'namespace', glyph: 'folder' },
  MODEL: { family: 'namespace', glyph: 'model' },
  MODEL_LIBRARY: { family: 'namespace', glyph: 'library' },
  PROFILE: { family: 'namespace', glyph: 'profile' },
  STEREOTYPE: { family: 'namespace', glyph: 'guillemet' },
  REQUIREMENT: { family: 'requirement', glyph: 'requirement' },
  TEST_CASE: { family: 'requirement', glyph: 'testcase' },
  BLOCK: { family: 'structure', glyph: 'block' },
  VALUE_TYPE: { family: 'structure', glyph: 'valuetype' },
  PART: { family: 'structure', glyph: 'part' },
  PORT: { family: 'structure', glyph: 'port' },
  FLOW_PORT: { family: 'structure', glyph: 'flowport' },
  CONNECTOR: { family: 'structure', glyph: 'connector' },
  CONSTRAINT_BLOCK: { family: 'structure', glyph: 'constraint' },
  CONSTRAINT_PROPERTY: { family: 'structure', glyph: 'constraintProp' },
  CONSTRAINT_PARAMETER: { family: 'structure', glyph: 'constraintParam' },
  ACTIVITY: { family: 'activity', glyph: 'activity' },
  ACTION: { family: 'activity', glyph: 'action' },
  CONTROL_NODE: { family: 'activity', glyph: 'control' },
  OBJECT_NODE: { family: 'activity', glyph: 'object' },
  ACTIVITY_PARTITION: { family: 'activity', glyph: 'partition' },
  INTERACTION: { family: 'interaction', glyph: 'interaction' },
  LIFELINE: { family: 'interaction', glyph: 'lifeline' },
  MESSAGE: { family: 'interaction', glyph: 'message' },
  COMBINED_FRAGMENT: { family: 'interaction', glyph: 'fragment' },
  STATE_MACHINE: { family: 'state', glyph: 'stateMachine' },
  STATE: { family: 'state', glyph: 'state' },
  TRANSITION: { family: 'state', glyph: 'transition' },
  PSEUDOSTATE: { family: 'state', glyph: 'pseudostate' },
  USE_CASE: { family: 'usecase', glyph: 'usecase' },
  ACTOR: { family: 'usecase', glyph: 'actor' },
  COMMENT: { family: 'annotation', glyph: 'comment' },
}

/** 九大图各有独立字形与独立颜色，页签、模型树、工具箱组标题共用。 */
export const DIAGRAM_ICONS: Record<string, IconSpec> = {
  pkg: { glyph: 'd-pkg', color: '#b45309' },
  req: { glyph: 'd-req', color: '#0f766e' },
  bdd: { glyph: 'd-bdd', color: '#1d4ed8' },
  ibd: { glyph: 'd-ibd', color: '#0891b2' },
  par: { glyph: 'd-par', color: '#7c3aed' },
  act: { glyph: 'd-act', color: '#ea580c' },
  seq: { glyph: 'd-seq', color: '#c026d3' },
  stm: { glyph: 'd-stm', color: '#be123c' },
  uc: { glyph: 'd-uc', color: '#15803d' },
}

export function familyOfType(code: string): string {
  return TYPE_META[code]?.family ?? 'annotation'
}

export function typeIcon(code: string): IconSpec {
  const meta = TYPE_META[code]
  const family = FAMILIES.find((item) => item.key === meta?.family)
  return {
    glyph: meta?.glyph ?? 'default',
    color: family?.color ?? '#64748b',
  }
}

export function diagramIcon(code: string): IconSpec {
  return DIAGRAM_ICONS[code] ?? { glyph: 'default', color: '#64748b' }
}

/**
 * 关系组件图标：字形按记法（实线/虚线、实心/空心/无箭头、菱形、双线）区分，
 * 颜色与 notation.ts 的画布连线样式一致——工具箱所见即画布所得。
 * 键为 normalizeRelKey 后的形式，兼容 deriveReqt / controlFlow 等 camelCase。
 */
const RELATION_GLYPHS: Record<string, string> = {
  containment: 'rel-diamond',
  import: 'rel-none',
  access: 'rel-none',
  generalization: 'rel-solid-hollow',
  association: 'rel-solid-open',
  dependency: 'rel-dashed-open',
  satisfy: 'rel-solid-fill',
  verify: 'rel-solid-fill',
  refine: 'rel-dashed-open',
  derivereqt: 'rel-dashed-open',
  copy: 'rel-dashed-open',
  trace: 'rel-dashed-open',
  allocate: 'rel-dashed-fill',
  connector: 'rel-solid-fill',
  itemflow: 'rel-solid-fill',
  binding: 'rel-double',
  delegation: 'rel-dashed-open',
  constraintparameter: 'rel-double',
  controlflow: 'rel-solid-fill',
  objectflow: 'rel-dashed-open',
  partition: 'rel-dashed-open',
  message: 'rel-solid-fill',
  orderedfragment: 'rel-dashed-open',
  guard: 'rel-dashed-open',
  transition: 'rel-solid-open',
  region: 'rel-dashed-open',
  include: 'rel-dashed-open',
  extend: 'rel-dashed-open',
}

export function relationshipIcon(code: string): IconSpec {
  return {
    glyph: RELATION_GLYPHS[normalizeRelKey(code)] ?? 'rel-solid-open',
    color: relationshipStyle(code).color,
  }
}

function Glyph({ name }: { name: string }): ReactNode {
  const s = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.35,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }
  switch (name) {
    case 'folder':
      return <path d="M2 5.2h4l1.4-2.2h6.6v10H2z" {...s} />
    case 'model':
      return (
        <>
          <path d="M8 2.2l6 3.3v5l-6 3.3-6-3.3v-5z" {...s} />
          <path d="M2 5.5l6 3.3 6-3.3M8 8.8v5" {...s} />
        </>
      )
    case 'library':
      return (
        <>
          <path d="M2.4 3h4.8v10H2.4zM8.8 3h4.8v10H8.8z" {...s} />
          <path d="M2.4 6h4.8M8.8 6h4.8" {...s} />
        </>
      )
    case 'profile':
      return <path d="M8 2.2l5.4 3.1v5.4L8 13.8l-5.4-3.1V5.3z" {...s} />
    case 'guillemet':
      return <path d="M6.8 4.4L3.6 8l3.2 3.6M9.2 4.4L12.4 8 9.2 11.6" {...s} />
    case 'requirement':
      return (
        <>
          <path d="M2.6 2.3h7.2l3.6 3.4v8H2.6z" {...s} />
          <path d="M9.8 2.3v3.4h3.6M5 8.4h6.2M5 10.8h4.4" {...s} />
        </>
      )
    case 'testcase':
      return (
        <>
          <path d="M2.6 2.3h7.2l3.6 3.4v8H2.6z" {...s} />
          <path d="M9.8 2.3v3.4h3.6M4.8 9.2l1.8 1.8 3.8-3.8" {...s} />
        </>
      )
    case 'block':
      return (
        <>
          <path d="M2.4 3h11.2v10H2.4zM2.4 6.1h11.2" {...s} />
          <path d="M4.8 4.4h4.2" {...s} />
        </>
      )
    case 'valuetype':
      return (
        <>
          <path d="M2.4 3h11.2v10H2.4z" {...s} />
          <path d="M4.8 8.4h6.4M4.8 10.6h6.4" {...s} />
        </>
      )
    case 'part':
      return <path d="M2.4 3h11.2v10H2.4z" {...s} strokeDasharray="2.6 1.8" />
    case 'port':
      return (
        <>
          <path d="M3.4 3.6h9.2v8.8H3.4z" {...s} />
          <path d="M1.6 6.8h3.6v2.4H1.6zM10.8 6.8h3.6v2.4h-3.6z" {...s} />
        </>
      )
    case 'flowport':
      return (
        <>
          <path d="M2.4 3h11.2v10H2.4z" {...s} />
          <path d="M4.4 8c1-1.8 2 1.8 3.2 0s2.2-1.8 3.4 0" {...s} />
        </>
      )
    case 'connector':
      return (
        <>
          <path d="M2.6 8h10.8" {...s} />
          <circle cx="2.6" cy="8" r="1.35" fill="currentColor" />
          <circle cx="13.4" cy="8" r="1.35" fill="currentColor" />
        </>
      )
    case 'constraint':
      return (
        <>
          <path d="M2.4 3h11.2v10H2.4z" {...s} />
          <path d="M5.4 5.8h5.2L8 8.2l2.6 2.3H5.4" {...s} />
        </>
      )
    case 'constraintProp':
      return (
        <>
          <path d="M2.4 3h11.2v10H2.4z" {...s} />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" />
        </>
      )
    case 'constraintParam':
      return (
        <>
          <path d="M8 2.4a5.6 5.6 0 100 11.2A5.6 5.6 0 008 2.4z" {...s} />
          <path d="M5.6 6.2h4.8L8 8.2l2.4 2H5.6" {...s} />
        </>
      )
    case 'activity':
      return (
        <>
          <path d="M2.4 4.2h11.2v8.6H2.4zM2.4 4.2V2.6h5.2v1.6" {...s} />
          <path d="M4.6 8.4h5.4M8.4 6.6l2 1.8-2 1.8" {...s} />
        </>
      )
    case 'action':
      return <path d="M4.4 4.4h7.2a3.6 3.6 0 010 7.2H4.4a3.6 3.6 0 010-7.2z" {...s} />
    case 'control':
      return <path d="M8 2.4L13.6 8 8 13.6 2.4 8z" {...s} />
    case 'object':
      return (
        <>
          <path d="M2.4 3.4h11.2v9.2H2.4zM2.4 6.4h11.2" {...s} />
          <path d="M5.2 9.4h5.6" {...s} />
        </>
      )
    case 'partition':
      return (
        <>
          <path d="M2.4 3h11.2v10H2.4zM6.1 3v10M9.9 3v10" {...s} />
        </>
      )
    case 'interaction':
      return (
        <>
          <path d="M2.4 4.2h11.2v8.6H2.4zM2.4 4.2V2.6h5.2v1.6" {...s} />
          <path d="M5.6 7v4.2M10.4 7v4.2" {...s} strokeDasharray="1.8 1.4" />
        </>
      )
    case 'lifeline':
      return (
        <>
          <path d="M4.6 2.4h6.8v3H4.6z" {...s} />
          <path d="M8 5.4v8" {...s} strokeDasharray="2 1.6" />
        </>
      )
    case 'message':
      return <path d="M2.4 8h10.6M10.6 5.4L13.4 8l-2.8 2.6" {...s} />
    case 'fragment':
      return (
        <>
          <path d="M2.4 4h11.2v9H2.4zM2.4 4V2.4h5l1.4 1.6H2.4" {...s} />
          <path d="M5 9h6" {...s} />
        </>
      )
    case 'stateMachine':
      return (
        <>
          <path d="M2.4 3.6h11.2v8.8H2.4z" {...s} />
          <circle cx="8" cy="8" r="2.3" {...s} />
        </>
      )
    case 'state':
      return <path d="M4 3.6h8a1.8 1.8 0 011.8 1.8v5.2A1.8 1.8 0 0112 12.4H4a1.8 1.8 0 01-1.8-1.8V5.4A1.8 1.8 0 014 3.6z" {...s} />
    case 'transition':
      return <path d="M2.6 10.4c2.8-6 7.4-6 10.4-1.2M10.8 6.8l2.4 2.6-2.6 1.8" {...s} />
    case 'pseudostate':
      return <circle cx="8" cy="8" r="4.2" fill="currentColor" />
    case 'usecase':
      return <ellipse cx="8" cy="8" rx="6" ry="4.2" {...s} />
    case 'actor':
      return (
        <>
          <circle cx="8" cy="4.4" r="2" {...s} />
          <path d="M8 6.4v5.2M4.2 13.6l3.8-3.2 3.8 3.2M4.8 8.8h6.4" {...s} />
        </>
      )
    case 'comment':
      return (
        <>
          <path d="M2.4 2.6h8.2l3 3v7.8H2.4z" {...s} strokeDasharray="2.4 1.6" />
          <path d="M10.6 2.6v3h3" {...s} />
        </>
      )
    case 'd-pkg':
      return (
        <>
          <path d="M2.2 5.4h3.6l1.2-2h6.8v9.6H2.2z" {...s} />
          <path d="M5.2 8.4h5.4" {...s} />
        </>
      )
    case 'd-req':
      return (
        <>
          <path d="M2.6 2.4h7l3.8 3.4v7.8H2.6z" {...s} />
          <path d="M9.6 2.4v3.4h3.8M4.8 8h6.6M4.8 10.4h4.6" {...s} />
        </>
      )
    case 'd-bdd':
      return (
        <>
          <path d="M2.4 2.6h5v4.8h-5zM8.6 2.6h5v4.8h-5zM2.4 8.6h5v4.8h-5zM8.6 8.6h5v4.8h-5z" {...s} />
        </>
      )
    case 'd-ibd':
      return (
        <>
          <path d="M3.6 4h8.8v8H3.6z" {...s} />
          <path d="M1.8 6.4h3.2v2.4H1.8zM11 6.4h3.2v2.4H11z" {...s} />
          <path d="M5 7.6h6" {...s} strokeDasharray="1.6 1.2" />
        </>
      )
    case 'd-par':
      return (
        <>
          <circle cx="3.2" cy="4.2" r="1.5" {...s} />
          <circle cx="12.8" cy="4.2" r="1.5" {...s} />
          <circle cx="8" cy="12" r="1.9" {...s} />
          <path d="M4.4 5.2L7 10.4M11.6 5.2L9 10.4" {...s} />
          <path d="M6.6 12h2.8" {...s} />
        </>
      )
    case 'd-act':
      return (
        <>
          <path d="M2.4 3.2h4.6L10 8l-3 4.8H2.4z" {...s} />
          <path d="M10 8h3.6M11.8 6.2L13.8 8l-2 1.8" {...s} />
        </>
      )
    case 'd-seq':
      return (
        <>
          <path d="M2.8 2.4h3.4v2.2H2.8zM6.8 2.4h3.4v2.2H6.8zM10.8 2.4h3.4v2.2h-3.4z" {...s} />
          <path d="M4.5 4.6v8.8M8.5 4.6v8.8M12.5 4.6v8.8" {...s} strokeDasharray="1.8 1.4" />
          <path d="M4.5 7.6h8" {...s} />
        </>
      )
    case 'd-stm':
      return (
        <>
          <circle cx="4" cy="4" r="2" fill="currentColor" />
          <path d="M4 6v3.2a2.8 2.8 0 002.8 2.8h4" {...s} />
          <path d="M9 10L11 12l-2 2" {...s} />
          <path d="M6.2 4h6.4a2 2 0 012 2v6a2 2 0 01-2 2H8" {...s} />
        </>
      )
    case 'd-uc':
      return (
        <>
          <ellipse cx="9.6" cy="8" rx="4.4" ry="3.2" {...s} />
          <circle cx="3.2" cy="4.2" r="1.5" {...s} />
          <path d="M3.2 5.7v4M1.6 12.6l1.6-2.3 1.6 2.3M2 8.4h2.4" {...s} />
          <path d="M5.4 8h.8" {...s} />
        </>
      )
    // ── 关系记法：线型 + 箭头形态，与画布连线一致 ──
    case 'rel-solid-fill':
      return (
        <>
          <path d="M1.8 8h9.2" {...s} />
          <path d="M10.2 5.2L14.2 8l-4 2.8z" fill="currentColor" stroke="none" />
        </>
      )
    case 'rel-dashed-fill':
      return (
        <>
          <path d="M1.8 8h9.2" {...s} strokeDasharray="2.6 1.8" />
          <path d="M10.2 5.2L14.2 8l-4 2.8z" fill="currentColor" stroke="none" />
        </>
      )
    case 'rel-dashed-open':
      return (
        <>
          <path d="M1.8 8h9.2" {...s} strokeDasharray="2.6 1.8" />
          <path d="M10.4 5.2L14 8l-3.6 2.8" {...s} />
        </>
      )
    case 'rel-solid-open':
      return (
        <>
          <path d="M1.8 8h9.2" {...s} />
          <path d="M10.4 5.2L14 8l-3.6 2.8" {...s} />
        </>
      )
    case 'rel-solid-hollow':
      return (
        <>
          <path d="M1.8 8h8.6" {...s} />
          <path d="M10 4.9L14.2 8 10 11.1z" {...s} fill="#ffffff" />
        </>
      )
    case 'rel-none':
      return <path d="M1.8 6.2h12.4M1.8 9.8h12.4" {...s} />
    case 'rel-diamond':
      return (
        <>
          <path d="M1.8 8h3M10 8h4.2" {...s} />
          <path d="M5 8l2.5-2.6L10 8 7.5 10.6z" fill="currentColor" stroke="none" />
        </>
      )
    case 'rel-double':
      return (
        <>
          <path d="M1.8 6.3h9.4M1.8 9.7h9.4" {...s} />
          <path d="M10.2 5.2L14.2 8l-4 2.8z" fill="currentColor" stroke="none" />
        </>
      )
    default:
      return <rect x="2.6" y="3" width="10.8" height="10" rx="1.6" {...s} />
  }
}

interface IconProps {
  code: string
  size?: number
  className?: string
  title?: string
}

function Tile({ spec, size, className, title }: { spec: IconSpec } & Omit<IconProps, 'code'>) {
  return (
    <span
      className={`icon-tile ${className ?? ''}`}
      title={title}
      style={{ width: size, height: size, color: spec.color, background: `${spec.color}16` }}
      aria-hidden={!title}
      role={title ? 'img' : undefined}
    >
      <svg viewBox="0 0 16 16" width={size} height={size}>
        <Glyph name={spec.glyph} />
      </svg>
    </span>
  )
}

/** 元模型元素类型图标：34 种类型按「族色 + 专用字形」两两可辨。 */
export function TypeIcon({ code, size = 16, className, title }: IconProps) {
  return <Tile spec={typeIcon(code.toUpperCase())} size={size} className={className} title={title} />
}

/** 九大图图标：9 种图各有独立字形与颜色。 */
export function DiagramIcon({ code, size = 16, className, title }: IconProps) {
  return <Tile spec={diagramIcon(code.toLowerCase())} size={size} className={className} title={title} />
}

/** 关系组件图标：线型与颜色与画布连线一致。 */
export function RelationIcon({ code, size = 16, className, title }: IconProps) {
  return <Tile spec={relationshipIcon(code)} size={size} className={className} title={title} />
}
