export interface ModelElement {
  id: string
  type: string
  name: string
  stereotypes: string[]
  ownerId: string | null
  documentation: string
  taggedValues: Record<string, string>
  xmiId: string | null
}

export interface Diagram {
  id: string
  kind: string
  name: string
  ownerId: string | null
  elementIds: string[]
  relationshipIds: string[]
}

export interface Relationship {
  id: string
  type: string
  sourceId: string
  targetId: string
  ownerId: string | null
  taggedValues: Record<string, string>
}

export interface Notation {
  id: string
  diagramId: string
  elementId: string
  x: number
  y: number
  width: number
  height: number
  style: Record<string, string>
}

export interface ModelSnapshot {
  revision: number
  elements: ModelElement[]
  relationships: Relationship[]
  diagrams: Diagram[]
  notations: Notation[]
}

export interface Health {
  status: string
  product: string
  tagline: string
  revision: number
  diagramKinds: number
  onlineSessions: number
  persistence: string
  undoDepth?: number
  redoDepth?: number
}

export interface DiagramSpec {
  code: string
  label: string
  layout: string
  elementTypes: number
  allowedTypes: string[]
  /** 当前图允许放置的关系类型（服务端 MetamodelRegistry 下发）。 */
  allowedRelationships: string[]
  validationGroup: string
}

/** 关系类型目录项：工具箱「关系」分组与新建关系弹窗共用。 */
export interface RelationshipTypeInfo {
  code: string
  label: string
  stereotype: string
  family: string
}

export interface ElementTypeInfo {
  code: string
  uml: string
  label: string
  stereotype: string
}

export interface ContainmentRule {
  parent: string
  parentLabel: string
  children: ElementTypeInfo[]
}

export interface ContainmentSpec {
  rootTypes: string[]
  rules: ContainmentRule[]
  types: ElementTypeInfo[]
  canvas: { maxX: number; maxY: number; width: number; height: number }
  node: { width: number; height: number }
}

export interface Patch {
  seq: number
  revision: number
  affectedIds: string[]
  changes: unknown[]
  inverse: unknown
  validationDelta: string
  clientCmdId: string
}

export interface CommandRequest {
  type: string
  payload: Record<string, unknown>
  baseRevision: number
  clientCmdId: string
}
