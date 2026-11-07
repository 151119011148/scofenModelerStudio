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
  /** 英文显示名，由规范原名派生；缺失时前端回退到 label。 */
  labelEn?: string
  metaclass: string
  metaclassName: string
  metaclassLabel: string
  metaclassLabelEn?: string
  spec: string
  kind: PropertyValueKind
  /**
   * 引用型属性是否指向模型里的元素。服务端据此校验目标存在，
   * 界面据此决定渲染「缩略图 + 名称」卡片还是普通文本输入。
   */
  referencesElement?: boolean
  /**
   * 引用型属性期望的目标元素类型（如 METACLASS / STEREOTYPE）。
   * 界面据此把「选择引用」的候选列表收敛到正确类型。
   */
  referenceTarget?: string
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
  labelEn?: string
  spec: string
  parents: string[]
  propertyCount: number
}

export interface PropertyViewLevel {
  code: PropertyView
  label: string
  labelEn?: string
  description: string
  descriptionEn?: string
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
  /** 关系类型（按 code 索引）的属性表：关系与元素共用同一套属性窗口。 */
  relationships?: Record<string, PropertyCatalogType>
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

/** 关系也是模型对象：与元素同构地带名称、文档、构造型与规范元属性。 */
export interface Relationship {
  id: string
  type: string
  sourceId: string
  targetId: string
  name: string
  documentation: string
  stereotypes: string[]
  ownerId: string | null
  taggedValues: Record<string, string>
  /** 规范元属性：键为 UML/SysML 原名，值为已编辑过的属性。 */
  properties?: Record<string, unknown>
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
  labelEn?: string
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
  labelEn?: string
  stereotype: string
  family: string
  /**
   * true = 单向（模型树只挂到源端元素的「关系」虚拟节点）；
   * false = 双向 / 无向（两端元素都挂）。由服务端元模型目录权威下发。
   */
  directed?: boolean
}

export interface ElementTypeInfo {
  code: string
  uml: string
  label: string
  labelEn?: string
  stereotype: string
}

/** 通用扩展包：SysML / UML 的元类与构造型随每个项目提供。 */
export interface ExtensionPackageInfo {
  id: string
  /** 所属扩展包（子包时为父 id，顶层扩展包为空）。 */
  parentId?: string
  /** PROFILE（扩展包）或 PACKAGE（元类 / 构造型子包）。 */
  kind?: string
  name: string
  label: string
  labelEn?: string
  metaclassCount: number
  stereotypeCount: number
}

export interface ExtensionCatalog {
  packages: ExtensionPackageInfo[]
  /** 元模型层下发的只读定义（与项目快照隔离），用于模型树内嵌的扩展包虚拟分组。 */
  elements?: ModelElement[]
}

export interface ContainmentRule {
  parent: string
  parentLabel: string
  parentLabelEn?: string
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
  /** 是否允许删除；主示例项目是目录回退目标，服务端标记为不可删。 */
  deletable?: boolean
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
  /** 角色码，如 admin / editor / viewer。 */
  roles?: string[]
  /** 展开后的权限码，如 model.view / model.edit / user.manage。 */
  permissions?: string[]
}

export interface Session {
  token: string
  user: AuthUser
}

/** 用户管理：用户行（口令不返回，只有哈希在服务端）。 */
export interface AdminUser {
  username: string
  displayName: string
  enabled: boolean
  builtin: boolean
  roles: string[]
}

/** 用户管理：角色行。 */
export interface AdminRole {
  code: string
  name: string
  description: string
  builtin: boolean
  permissions: string[]
}
