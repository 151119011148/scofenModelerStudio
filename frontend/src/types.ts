export interface ModelElement {
  id: string
  type: string
  name: string
  stereotypes: string[]
  ownerId: string | null
  documentation: string
  taggedValues: Record<string, string>
  xmiId: string | null
  /** 规范元属性：键为 UML/SysML 原名，值为已编辑过的属性。 */
  properties?: Record<string, unknown>
}

/** 属性档位：标准 / 专家 / 全部（全部含计算与派生只读属性）。 */
export type PropertyView = 'STANDARD' | 'EXPERT' | 'ALL'

export type PropertyValueKind =
  | 'STRING'
  | 'TEXT'
  | 'BOOLEAN'
  | 'INTEGER'
  | 'REAL'
  | 'UNLIMITED_NATURAL'
  | 'ENUM'
  | 'REFERENCE'
  | 'REFERENCE_LIST'
  | 'STRING_LIST'

/** 单条元属性定义，全部由服务端 /api/metamodel/properties 下发。 */
export interface PropertySpec {
  key: string
  umlName: string
  label: string
  metaclass: string
  metaclassName: string
  metaclassLabel: string
  spec: string
  kind: PropertyValueKind
  level: 'STANDARD' | 'EXPERT' | 'DERIVED'
  computed: boolean
  editable: boolean
  options: string[]
  defaultValue: string | null
}

export interface PropertyMetaclass {
  code: string
  name: string
  label: string
  spec: string
  parents: string[]
  propertyCount: number
}

export interface PropertyViewLevel {
  code: PropertyView
  label: string
  description: string
}

export interface PropertyCatalogType {
  metaclasses: string[]
  properties: PropertySpec[]
  counts: Record<PropertyView, number>
}

export interface PropertyCatalogInfo {
  levels: PropertyViewLevel[]
  metaclasses: PropertyMetaclass[]
  types: Record<string, PropertyCatalogType>
  totalDefinitions: number
  specification: string
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

/** 空间下的项目目录项；当前项目的统计由服务端模型快照实时填充。 */
export interface WorkspaceProject {
  id: string
  name: string
  description: string
  owner: string
  updatedAt: string
  status: string
  current: boolean
  editable: boolean
  /** 是否已在服务端建立内存态模型运行时。 */
  opened: boolean
  spaceCode: string
  diagramCount: number
  elementCount: number
  relationshipCount: number
  revision: number
}

export interface WorkspaceSpace {
  code: string
  label: string
  kind: string
  owner: string
  memberCount: number
  projectCount: number
  projects: WorkspaceProject[]
}

export interface WorkspaceDirectoryInfo {
  currentProjectId: string
  currentProjectName: string
  spaces: WorkspaceSpace[]
  note: string
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

/** 登录态：仿 scofenDoc，JWT 与用户资料存 localStorage。 */
export interface AuthUser {
  username: string
  displayName: string
  admin: boolean
}

export interface Session {
  token: string
  user: AuthUser
}
