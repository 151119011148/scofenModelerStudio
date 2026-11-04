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
}

export interface DiagramSpec {
  code: string
  label: string
  layout: string
  elementTypes: number
  validationGroup: string
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
