import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, UIEvent as ReactUIEvent } from 'react'
import {
  clearSession,
  createProject,
  deleteProject,
  exportNative,
  exportSidecar,
  exportXmi,
  getContainment,
  getCustomization,
  getDiagrams,
  getExtensionPackages,
  getHealth,
  getModel,
  getProjectId,
  getProperties,
  getRelationships,
  getStyleCatalog,
  getValidation,
  getWorkspaces,
  importXmi,
  loadSession,
  logout,
  patchSocketUrl,
  postCommand,
  projectApi,
  redo,
  setProjectId,
  setUnauthorizedHandler,
  undo,
} from './api'
import type {
  ContainmentSpec,
  CustomizationCatalog,
  CustomDiagramType,
  Diagram,
  DiagramSpec,
  ElementTypeInfo,
  ExtensionPackageInfo,
  Health,
  ModelElement,
  ModelSnapshot,
  Patch,
  PropertyCatalogInfo,
  PropertySpec,
  PropertyView,
  Relationship,
  RelationshipTypeInfo,
  RequirementCoverage,
  Session,
  StyleCatalog,
  StyleMap,
  ValidationIssue,
  ValidationReport,
  WorkspaceDirectoryInfo,
  WorkspaceProject,
} from './types'
import { arrowGeometry, controlGlyph, controlSizeOf, isBackdropShape, isLaneMembershipRelation, isPartitionType, moveRouteSegment, orthogonalRoute, readRoute, reattachRoute, relationshipStyle, routeMidpoint, shapeOf, simplifyRoute, SWIMLANE_HEADER, textWidth, wrapLabel, type RoutePoint } from './notation'
// 图形符号：外观字典（配色 / 几何常量）与参数化记法生成器。
import { appearanceOf, CANVAS_GRADIENTS, INTERACTIVE, INK, METRICS, TEXT } from './shapeStyle'
import { classifierGlyph, databaseGlyph, glyphFor, packageGlyph, packageTabHeight, swimlaneGlyph } from './shapeGlyphs'
import {
  layoutSequence, messageSortStyle, nextMessageOrder, reorderMessages, reorderMessagesTo,
  SEQ_MESSAGE_TOOLS, seqMessageToolOf, SEQ_ROW_PITCH, SEQ_SELF_BUMP, SEQ_SELF_HEIGHT,
} from './sequenceLayout'
import type { SeqActivation, SeqFragment, SeqMessage, SeqMessageToolDef } from './sequenceLayout'
import { autoLayout, isLayoutImmutable } from './layout'
import type { LayoutDirection, LayoutNameOrder } from './layout'
import type { LayoutChoice } from './layout'
import { DiagramIcon, FAMILIES, RelationIcon, TypeIcon, familyOfType } from './icons'
import { svgUrl } from './iconAssets'
import { pick, setLocale, t, useLocale } from './i18n'
import LocaleSwitch from './LocaleSwitch'
import LoginView from './LoginView'
import AdminPanel from './AdminPanel'
import { buildModelReportHtml } from './report'
import TableView from './TableView'
import { TABLE_VIEWS, tableViewIcon, tableViewLabel } from './TableView'
import type { TableViewId } from './TableView'
import { ProjectPanel, type ProjectSection } from './ProjectPanel'
import { RequirementImportPanel } from './RequirementImportPanel'
import { readObjectLink } from './projectWorkflow'
import type { ObjectLink, ObjectTarget, ProjectOverview } from './projectWorkflow'
import './projectWorkflow.css'
import TaggedValuesEditor from './TaggedValuesEditor'
import TypedTagsEditor from './TypedTagsEditor'
import CustomizationPanel from './CustomizationPanel'
import { StylePanel } from './StylePanel'
import { isExtensionId } from './extensionIds'
import { isDiagramType, isTagDefinition } from './customTypes'
import {
  alignAnchor, alignX, colorOr, dashArray, frameEnabledOf, frameStyleOf,
  numberValue, relationStyleOf, shapeOptions, shapeVariantOf,
} from './diagramStyle'

const EMPTY_MODEL: ModelSnapshot = {
  revision: 0,
  elements: [],
  relationships: [],
  diagrams: [],
  notations: [],
}

const FALLBACK_CANVAS = { maxX: 10000, maxY: 10000, width: 640, height: 420 }
const FALLBACK_NODE = { width: 168, height: 84 }
const ROOT_KEY = '__root__'

/** SysML 图框首页标签的图种色：九种图各取一个可辨识色相，边框统一中性色，避免满屏彩虹。 */
const FRAME_KIND_COLORS: Record<string, string> = {
  pkg: '#6b46c1', req: '#2b6cb0', bdd: '#2c7a7b', ibd: '#2f855a', par: '#805ad5',
  act: '#b7791f', seq: '#3182ce', stm: '#c05621', uc: '#b23c3c',
}
/**
 * 可以作为图宿主（ownerId）的类型：包、模型、剖面与各类可拥有图的分类器。
 *
 * <p>构造型、元类、属性、标签定义这类叶子/成员元素不能拥有图——否则「选中构造型
 * 新建图」会把图挂到构造型下，随后在图上创建的元素也跟着挂过去，看起来就像
 * 自定义元模型被重复建到了新建图里。</p>
 */
const NAMESPACE_HOST_CODES = new Set([
  'PACKAGE', 'MODEL', 'MODEL_LIBRARY', 'PROFILE', 'CLASS', 'BLOCK', 'INTERFACE',
  'COMPONENT', 'CONSTRAINT_BLOCK', 'COLLABORATION', 'NODE', 'DEVICE',
  'EXECUTION_ENVIRONMENT', 'INTERACTION', 'ACTIVITY', 'STATE_MACHINE',
  'PROTOCOL_STATE_MACHINE', 'USE_CASE', 'REQUIREMENT', 'TEST_CASE', 'ACTOR',
])
const DEPENDENCY_METACLASSES = new Set([
  'DEPENDENCY', 'ABSTRACTION', 'REALIZATION', 'INTERFACE_REALIZATION', 'SUBSTITUTION', 'USAGE', 'MANIFESTATION',
])
/** 名称的模糊归一化：忽略大小写、空白与常见分隔符，便于「订单 查询」命中「订单查询…」。 */
function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[\s·\-_/\\()[\]（）【】「」:：,，.。]+/g, '')
}
/** 名称模糊匹配：归一化后按包含关系命中（搜索框只按名称检索）。 */
function nameMatches(name: string, needle: string): boolean {
  if (!needle) {
    return false
  }
  return normalizeName(name).includes(normalizeName(needle))
}
/** 估算单行文本宽度：CJK / 全角字符按整字号，其余按 0.58 字号，用于图框首页标签自适应宽度。 */
function estimateTextWidth(text: string, size: number): number {
  let width = 0
  for (const ch of text) {
    width += /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? size : size * 0.58
  }
  return width
}
/** SysML 图框几何：内容四周外扩边距、首页标签高度与切角，渲染与「适应窗口 / 平移夹紧」共用同一套数。 */
const FRAME_MARGIN = 28
const FRAME_HEADER_H = 40
const FRAME_NOTCH = 16
type FrameBox = { left: number; top: number; right: number; bottom: number }
/**
 * 没有打开任何图时，画布把整个模型铺开成一张总览。一个元素约 6 个 SVG 节点，
 * 5159 个（含标准库）就是 2.8 万节点，左侧任意一次折叠/选中都要为它重排一轮布局
 * （实测单次交互 440ms，去掉这块画布后 30ms）。超过上限只留提示不再铺开；
 * 上限取 1200 是为了让他手工建的参照案例（482 元素 + 标准库）总览照旧显示。
 */
const CANVAS_OVERVIEW_MAX = 1200
/** 模型树首次进入时的自动展开上限：不超过这个元素数就照旧一次铺满，超过只铺到「章 / 包」一级。 */
const TREE_FULL_EXPAND_MAX = 800
/** 画布缩放边界：下限要低到能把整张自动排布后的图收进视口，上限只为对位。 */
/** 属性面板排序：规范目录顺序 / 按属性 key 升序 / 降序。 */
type PropertySort = 'CATALOG' | 'KEY_ASC' | 'KEY_DESC'

/** 属性编辑弹框的交互方式：由元属性声明的值类型决定。 */
type PropEditorMode = 'text' | 'textarea' | 'boolean' | 'enum' | 'reference' | 'list' | 'json'

/** 自动排布的范围：当前打开的图，或项目里所有可排的图。 */
type LayoutScope = 'diagram' | 'all'

const ZOOM_MIN = 0.12
const ZOOM_MAX = 2.5
/** 平移时始终留在视口里的画布余量，防止一路推出去后满屏空白找不到图。 */
const PAN_KEEP = 60
/** 适应窗口时内容四周留出的模型单位空白，免得节点贴着视口边缘。 */
const FIT_PADDING = 40
/**
 * 一条 SET_NOTATIONS 携带的记法条数上限。服务端封顶 5000（再多整条命令被拒），
 * 留点余量按图切批：宁可多一次撤销步，也不要大项目一次排布直接失败。
 */
const LAYOUT_BATCH_MAX = 4000

/**
 * 模型树虚拟化：行数超过阈值才启用窗口渲染。行高在虚拟模式下由 CSS 强制统一，
 * 上下用占位 div 撑出总高度，滚动只渲染视口附近几十行——几千行的树折叠 / 定位
 * 不再整树挂载。阈值以下保持原样，小树的 scrollIntoView 等行为完全不变。
 */
const TREE_VIRTUAL_THRESHOLD = 400
const TREE_ROW_H = 28
/** 全局搜索：输入防抖与结果上限，避免大项目每敲一个字全量打分渲染上百行。 */
const SEARCH_DEBOUNCE_MS = 120
const SEARCH_MAX_RESULTS = 50

/** 服务端 Patch.changes 的一条明细（before/after 与快照条目同构）。 */
interface PatchChange {
  op: 'add' | 'update' | 'remove'
  objectType: 'element' | 'relationship' | 'diagram' | 'notation'
  id: string
  before: unknown
  after: unknown
}

/** 全局搜索的一条命中：元素 / 图 / 关系，sub 是类型或端点摘要。 */
interface SearchResult {
  kind: 'element' | 'diagram' | 'relation'
  id: string
  name: string
  sub: string
  score: number
}

/**
 * 把命令返回的变更明细就地应用到快照，省掉一次全量 GET /api/model。
 *
 * <p>服务端按操作顺序逐条发出 add/update/remove，Map 的插入序与仓库一致，
 * 应用后的排列与下一次全量刷新相同。任何一条明细形状不符（未知类型、update
 * 找不到原对象、after 缺失）都返回 null，调用方退回全量刷新——增量是优化，
 * 正确性永远由权威快照兜底。</p>
 */
function applyPatchChanges(base: ModelSnapshot, raw: unknown[]): ModelSnapshot | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null
  }
  const tables: Record<PatchChange['objectType'], Map<string, unknown>> = {
    element: new Map(base.elements.map((item) => [item.id, item])),
    relationship: new Map(base.relationships.map((item) => [item.id, item])),
    diagram: new Map(base.diagrams.map((item) => [item.id, item])),
    notation: new Map(base.notations.map((item) => [item.id, item])),
  }
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return null
    }
    const change = item as Partial<PatchChange>
    if (typeof change.id !== 'string' || !change.objectType || !(change.objectType in tables)) {
      return null
    }
    const table = tables[change.objectType]
    if (change.op === 'remove') {
      table.delete(change.id)
      continue
    }
    if (change.op !== 'add' && change.op !== 'update') {
      return null
    }
    const value = change.after
    if (!value || typeof value !== 'object' || (value as { id?: unknown }).id !== change.id) {
      return null
    }
    if (change.op === 'update' && !table.has(change.id)) {
      return null
    }
    table.set(change.id, value)
  }
  return {
    revision: base.revision,
    elements: [...tables.element.values()] as ModelSnapshot['elements'],
    relationships: [...tables.relationship.values()] as ModelSnapshot['relationships'],
    diagrams: [...tables.diagram.values()] as ModelSnapshot['diagrams'],
    notations: [...tables.notation.values()] as ModelSnapshot['notations'],
  }
}

/** 两栏拖拽宽度的边界：太窄放不下属性表，太宽会把画布挤没。 */
const DOCK_LEFT_MIN = 200
const DOCK_LEFT_MAX = 460
const DOCK_TOOL_MIN = 140
const DOCK_TOOL_MAX = 360
/** 工具箱收起时的图标条宽度（与 `.workspace.toolbox-collapsed` 保持一致）。 */
const DOCK_TOOL_COLLAPSED = 46

/**
 * 属性面板上下拖拽的高度边界：低于这个高度连「属性 / 标签」页签都放不下，
 * 高于上限则模型树只剩一两行、失去导航意义。
 */
const PROPS_MIN = 180
const PROPS_FALLBACK = 320

/**
 * 扩展域保留 id 前缀（与服务端 {@code ExtensionLibrary.ownsId} 同一套约定）。
 *
 * <p>项目树的数据源是快照，而扩展内容的数据源是元模型目录；两者版本不一致时
 * （旧快照里残留了已被删除的构造型），只按「目录里有没有这个 id」过滤会把残留
 * 当成项目元素、又因为它的父包被隔离而变成孤儿挂到根上。前缀判据是兜底：
 * 用户元素的 id 形如 {@code e-xxx}，不会误伤。</p>
 *
 * <p>前缀表与判定函数在 {@code ./extensionIds}，与服务端常量一一对应。</p>
 */

/**
 * 模型树的折叠三角：飞书文档那种蓝色实心三角，展开时顺时针转 90°。
 *
 * <p>不用 ▸/▾ 文本字符：不同字体下大小与基线都不一致，行高会跟着抖；
 * 纯 CSS 三角则与文字基线无关，还能做过渡动画。</p>
 */
function TreeTwisty({
  open,
  leaf,
  label,
  onToggle,
}: {
  open: boolean
  leaf?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`twisty${leaf ? ' leaf' : ''}${!leaf && open ? ' open' : ''}`}
      aria-label={label}
      aria-expanded={leaf ? undefined : open}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation()
        if (!leaf) {
          onToggle()
        }
      }}
    >
      <span className="tri" aria-hidden="true" />
    </button>
  )
}

/**
 * 模型树的共享只读数据。
 *
 * <p>身份只在模型快照 / 目录变化时才更换：行组件靠它取名称与类型，
 * 折叠、选中这类交互不换它的身份，memo 才有机会把无关行全部拦住。</p>
 */
interface TreeData {
  elementById: Map<string, ModelElement>
  diagramById: Map<string, Diagram>
  relationById: Map<string, Relationship>
  extensionElementById: Map<string, ModelElement>
  codeOf: (type: string) => string
  typeLabel: (type: string) => string
  diagramLabel: (kind: string) => string
  relationLabel: (code: string) => string
  rootId: string | null
  extensionRootIds: Set<string>
  canEdit: boolean
}

/** 模型树行的动作：对象身份固定，内部转调当次渲染的最新实现。 */
interface TreeActions {
  toggleExpanded: (id: string) => void
  toggleRelationGroup: (id: string) => void
  selectElement: (id: string) => void
  selectExtensionElement: (id: string) => void
  selectRelation: (id: string) => void
  activateDiagram: (id: string, withTab: boolean) => void
  /** 双击「图类型」节点：用该类型建一张图并打开（已有同类型的图则直接打开）。 */
  openDiagramOfType: (id: string) => void
  addElementToDiagram: (diagramId: string, elementId: string) => void
  setDropTarget: (id: string | null) => void
  openMenu: (event: ReactMouseEvent, target: MenuTarget) => void
}

const TreeDataContext = createContext<TreeData | null>(null)
const TreeActionsContext = createContext<TreeActions | null>(null)

/** {@link TreeRow} 的 props：全部是可浅比较的原语，显示文案交给行组件自己现取。 */
interface TreeRowProps {
  kind: 'element' | 'diagram' | 'extensionGroup' | 'extensionElement' | 'relationGroup' | 'relation'
  id: string
  depth: number
  childCount: number
  isOpen: boolean
  isSelected: boolean
  isDropTarget: boolean
  /** 关系行专属：挂载点元素 id、方向与对端元素 id。 */
  ownerId?: string
  direction?: 'in' | 'out' | 'both'
  peerId?: string
}

/**
 * 模型树的一行。
 *
 * <p>整棵树是一个扁平数组（见 {@code visibleRows}），行与行之间不再是嵌套 DOM，
 * 所以缩进继续用 paddingLeft 表达。行组件必须只依赖自己的 props：
 * 一次折叠只让变化的那几行重渲染，其余几千行直接跳过。</p>
 */
const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const { kind, id, depth, childCount, isOpen, isSelected, isDropTarget } = props
  const data = useContext(TreeDataContext)!
  const actions = useContext(TreeActionsContext)!
  const indent: CSSProperties = { paddingLeft: 6 + depth * 15 }
  const hasChildren = childCount > 0

  if (kind === 'extensionGroup') {
    return (
      <div
        className="tree-row virtual-group extension-group"
        data-tree-kind="extension-group"
        style={indent}
        role="button"
        tabIndex={0}
        title={t('UML / SysML 扩展包与项目模型隔离，由系统内嵌提供，仅用于浏览与引用定位')}
        onClick={() => actions.toggleExpanded(EXTENSION_GROUP_ID)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            actions.toggleExpanded(EXTENSION_GROUP_ID)
          }
        }}
      >
        <TreeTwisty
          open={isOpen}
          label={isOpen ? t('折叠') : t('展开')}
          onToggle={() => actions.toggleExpanded(EXTENSION_GROUP_ID)}
        />
        <TypeIcon code="PROFILE" size={16} title={t('扩展包')} />
        <span className="tree-label">{t('扩展包')}</span>
        <span className="virtual-tag" title={t('系统内容，不计入项目元素数，也不参与项目命令')}>{t('系统 · 隔离')}</span>
        <span className="child-count">{childCount}</span>
      </div>
    )
  }

  if (kind === 'extensionElement') {
    const element = data.extensionElementById.get(id)
    if (!element) {
      return null
    }
    // 扩展包元素是只读定义，但可以作为「引用」拖入图：扩展图里把元类摆上画布、
    // 再让构造型画泛化指过去，是 Profile 建模的常规用法。元素已在项目快照里物化，
    // ADD_TO_DIAGRAM 只建记法，不会复制或改写扩展内容。
    const draggable = data.canEdit
    return (
      <div
        className="tree-row virtual-group extension-element"
        data-tree-kind="extension-element"
        data-element-id={element.id}
        style={indent}
        role="button"
        tabIndex={0}
        draggable={draggable}
        title={t('{name} · 扩展包只读定义（与项目模型隔离）· 可拖入图引用', { name: element.name })}
        onClick={() => {
          actions.selectExtensionElement(element.id)
          if (hasChildren) {
            actions.toggleExpanded(element.id)
          }
        }}
        onDragStart={(event) => {
          if (!draggable) {
            event.preventDefault()
            return
          }
          event.dataTransfer.setData('text/scofen-element', element.id)
          event.dataTransfer.effectAllowed = 'link'
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            actions.selectExtensionElement(element.id)
          }
        }}
      >
        <TreeTwisty
          open={isOpen}
          leaf={!hasChildren}
          label={isOpen ? t('折叠') : t('展开')}
          onToggle={() => actions.toggleExpanded(element.id)}
        />
        <TypeIcon code={data.codeOf(element.type)} size={16} title={data.typeLabel(element.type)} />
        <span className="tree-label">{element.name}</span>
        <span className="tree-type">{data.typeLabel(element.type)}</span>
      </div>
    )
  }

  if (kind === 'relationGroup') {
    const groupId = relationGroupId(props.ownerId ?? '')
    return (
      <div
        className="tree-row virtual-group relation-group"
        data-tree-kind="relation-group"
        data-owner-id={props.ownerId}
        style={indent}
        role="button"
        tabIndex={0}
        title={t('单向关系只挂到源端一方，双向关系同时挂到两端元素')}
        onClick={() => actions.toggleRelationGroup(groupId)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            actions.toggleRelationGroup(groupId)
          }
        }}
      >
        <TreeTwisty open={isOpen} label={isOpen ? t('折叠') : t('展开')} onToggle={() => actions.toggleRelationGroup(groupId)} />
        <RelationIcon code="trace" size={15} />
        <span className="tree-label">{t('关系')}</span>
        <span className="child-count">{childCount}</span>
      </div>
    )
  }

  if (kind === 'relation') {
    const relation = data.relationById.get(id)
    if (!relation) {
      return null
    }
    const source = data.elementById.get(relation.sourceId)
    const target = data.elementById.get(relation.targetId)
    const peer = data.elementById.get(props.peerId ?? '') ?? data.extensionElementById.get(props.peerId ?? '')
    const arrow = props.direction === 'both' ? '⇄' : props.direction === 'in' ? '←' : '→'
    return (
      <div
        className={`tree-row relation virtual-group${isSelected ? ' selected' : ''}`}
        data-tree-kind="relation"
        data-relation-id={relation.id}
        data-owner-id={props.ownerId}
        data-direction={props.direction}
        style={indent}
        role="button"
        tabIndex={0}
        title={t('{relation}：{source} → {target}｜点击查看 / 编辑关系属性', {
          relation: data.relationLabel(relation.type),
          source: source?.name ?? relation.sourceId,
          target: target?.name ?? relation.targetId,
        })}
        onClick={() => actions.selectRelation(relation.id)}
        onContextMenu={(event) => actions.openMenu(event, { kind: 'relation', id: relation.id })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            actions.selectRelation(relation.id)
          }
        }}
      >
        <TreeTwisty open={false} leaf label={t('关系')} onToggle={() => undefined} />
        <RelationIcon code={relation.type} size={15} />
        <span className="tree-label">{relation.name?.trim() || data.relationLabel(relation.type)}</span>
        <span className="tree-type" title={t('关系另一端')}>
          <span className="rel-direction" title={t('单向关系只挂到源端一方，双向关系同时挂到两端元素')}>{arrow}</span>
          <span className="peer-name">{peer?.name ?? props.peerId}</span>
        </span>
      </div>
    )
  }

  if (kind === 'diagram') {
    const diagram = data.diagramById.get(id)
    if (!diagram) {
      return null
    }
    return (
      <div
        className={`tree-row diagram${isSelected ? ' selected' : ''}${isDropTarget ? ' drop-target' : ''}`}
        data-tree-id={diagram.id}
        style={indent}
        title={t('图 · 点击切换 · 可接收拖入的元素')}
        onClick={() => actions.activateDiagram(diagram.id, true)}
        onContextMenu={(event) => actions.openMenu(event, { kind: 'diagram', id: diagram.id })}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            actions.activateDiagram(diagram.id, false)
          }
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('text/scofen-element')) {
            return
          }
          event.preventDefault()
          event.dataTransfer.dropEffect = 'link'
          if (isDropTarget !== true) {
            actions.setDropTarget(diagram.id)
          }
        }}
        onDragLeave={() => {
          if (isDropTarget) {
            actions.setDropTarget(null)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          actions.setDropTarget(null)
          const droppedId = event.dataTransfer.getData('text/scofen-element')
          if (droppedId) {
            void actions.addElementToDiagram(diagram.id, droppedId)
          }
        }}
      >
        <TreeTwisty
          open={isOpen}
          leaf={!hasChildren}
          label={isOpen ? t('折叠') : t('展开')}
          onToggle={() => actions.toggleExpanded(diagram.id)}
        />
        <DiagramIcon code={diagram.kind} size={16}
          title={data.diagramLabel(diagram.customTypeId ?? diagram.kind)} />
        <span className="tree-label">{diagram.name}</span>
        <span className="child-count">{diagram.elementIds.length}</span>
      </div>
    )
  }

  const element = data.elementById.get(id)
  if (!element) {
    return null
  }
  const isRoot = id === data.rootId
  const draggable = data.canEdit && !isRoot
  const info = data.typeLabel(element.type)
  /**
   * 图类型（扩展图库的 16 个模板、用户自建的图种类）是**定义**不是图，光选中它看不到任何东西。
   * 双击直接落成一张该类型的图并打开——这是「扩展图库里的图点不开」的根因补丁。
   */
  const diagramTypeDefinition = isDiagramType(element)
  return (
    <div
      className={`tree-row element${isSelected ? ' selected' : ''}${isRoot ? ' root-node' : ''}`}
      data-tree-id={element.id}
      style={indent}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) {
          event.preventDefault()
          return
        }
        event.dataTransfer.setData('text/scofen-element', element.id)
        event.dataTransfer.effectAllowed = 'link'
      }}
      title={diagramTypeDefinition
        ? t('{label} · 双击新建一张该类型的图', { label: info })
        : t('{label} · 可拖入画布或图节点', { label: info })}
      onClick={() => actions.selectElement(element.id)}
      onDoubleClick={() => {
        if (diagramTypeDefinition) {
          actions.openDiagramOfType(element.id)
        }
      }}
      onContextMenu={(event) => actions.openMenu(event, { kind: 'element', id: element.id })}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          actions.selectElement(element.id)
        }
      }}
    >
      <TreeTwisty
        open={isOpen}
        leaf={!hasChildren}
        label={isOpen ? t('折叠') : t('展开')}
        onToggle={() => actions.toggleExpanded(element.id)}
      />
      <TypeIcon code={isRoot ? 'Model' : data.codeOf(element.type)} size={16} title={info} />
      <span className="tree-label">{element.name}</span>
      {isRoot ? (
        // 华望成品：根节点与子层 Package 同一套组件渲染，行末只留细小的类型名。
        // 文案保留供无障碍与脚本识别，视觉上不再用醒目的黄底徽章。
        <span className="root-tag" title={t('项目根节点，不可删除')}>{t('项目根')}</span>
      ) : data.extensionRootIds.has(element.id) ? (
        <span
          className="root-tag extension-tag"
          title={t('通用扩展包：SysML / UML 的元类与构造型随项目提供')}
        >
          {t('通用')}
        </span>
      ) : (
        <span className="tree-type">{info}</span>
      )}
    </div>
  )
})

type RevealKind = 'element' | 'diagram' | 'relation'
type ModelReference = { kind: RevealKind; id: string }
type ReferenceRemoval = { targetId: string; key: string; index: number; value: string }

type MenuTarget =
  | { kind: 'element'; id: string }
  | { kind: 'diagram'; id: string }
  /** 关系也是模型对象：树上高亮后在关系行显示持久选中态。 */
  | { kind: 'relation'; id: string }
  | { kind: 'root'; id: null }
  | { kind: 'reference'; id: string; objectKind: RevealKind; removal?: ReferenceRemoval }

interface ContextMenuState {
  x: number
  y: number
  target: MenuTarget
}

interface CreateDialogState {
  ownerId: string | null
  ownerName: string
}

interface DeleteDialogState {
  elementId: string
  name: string
  count: number
  /** 批量删除的根 id 列表（多选时）；缺省按单元素删除。 */
  ids?: string[]
}

interface DiagramDialogState {
  ownerId: string | null
  ownerName: string
  /** 规范图为 code（bdd…），自定义图为定义元素 id；以 allSpecs.code 统一索引。 */
  kind: string
  name: string
  editId: string | null
}

interface RelationshipDialogState {
  sourceId: string
  targetId: string
  type: string
}

interface DragState {
  elementId: string
  originX: number
  originY: number
  startX: number
  startY: number
  x: number
  y: number
  moved: boolean
  /** 多选整体拖动：其余选中图形的起手坐标，随主图形同一增量平移，落库一条 SET_NOTATIONS。 */
  group?: { id: string; originX: number; originY: number }[]
}

/** Shift+空白拖拽的框选矩形（模型坐标）。 */
interface MarqueeState {
  startX: number
  startY: number
  x: number
  y: number
}

/** 画布剪贴板：复制时冻结元素 / 批内关系 / 记法，粘贴时整体重建为新 id 的副本。 */
interface ClipboardSnapshot {
  diagramId: string
  elements: ModelElement[]
  relationships: Relationship[]
  notations: { elementId: string; x: number; y: number; w: number; h: number }[]
}

type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV' | 'distH' | 'distV'

/** 连线走线拖拽：按住某一段沿垂直方向平移，orig 保留起手路由供增量计算。 */
interface EdgeDragState {
  relationId: string
  segment: number
  startX: number
  startY: number
  orig: RoutePoint[]
  points: RoutePoint[]
  moved: boolean
  sourceRect: { x: number; y: number; w: number; h: number }
  targetRect: { x: number; y: number; w: number; h: number }
}

/** 状态栏消息：存词条与变量，渲染时翻译，切换语言后历史消息同步重译。 */
interface MessageState {
  key: string
  vars?: Record<string, unknown>
}

/**
 * 导入对话框状态。
 *
 * <p>语义文件必选（.xmi），布局侧车可选（.di.json）。侧车缺省时服务端按元素的主图归属
 * 重排九图，语义完整但布局不保真。</p>
 */
interface ImportDialogState {
  semantic: string
  semanticName: string
  sidecar: string
  sidecarName: string
}

/**
 * 画布上方的文档标签：一张图或一个对象各占一个标签页，对齐桌面建模器的多文档交互。
 * 图标签切换画布内容；对象标签只切换属性窗口的编辑对象，画布保持当前图。
 */
interface DocTab {
  /** view = 需求表 / 通用表 / 通用矩阵等模型数据表视图（不占 DiagramKind）。 */
  kind: 'diagram' | 'element' | 'view'
  id: string
}

/** 顶部菜单栏里的一条命令；`separator` 渲染为分隔线。 */
interface MenuEntry {
  label: string
  run?: () => void
  disabled?: boolean
  /** 单选状态（当前图类型、属性档位、左栏视图）。 */
  checked?: boolean
  danger?: boolean
  hint?: string
}

interface MenuDef {
  label: string
  entries: (MenuEntry | 'separator')[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ownerKey(id: string | null): string {
  return !id || id.trim() === '' ? ROOT_KEY : id
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 视口左上角的合法范围：无论怎么平移或缩放，视口与内容包围盒的可见重叠
 * 至少留 K（PAN_KEEP；内容比它还窄时按内容算）。少了这一层，图被推到几百
 * 单位外就是满屏空白，只能刷新页面找回来。
 */
function clampPanTo(
  x: number,
  y: number,
  box: { left: number; top: number; right: number; bottom: number },
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number } {
  const keepX = Math.min(PAN_KEEP, Math.max(box.right - box.left, 1))
  const keepY = Math.min(PAN_KEEP, Math.max(box.bottom - box.top, 1))
  return {
    x: clamp(x, box.left + keepX - viewWidth, box.right - keepX),
    y: clamp(y, box.top + keepY - viewHeight, box.bottom - keepY),
  }
}

/** 关系在「关系」虚拟节点下的一个挂载项：direction 决定它出现在哪一端。 */
type TreeRelationItem = {
  relation: Relationship
  /** out = 从本端发出；in = 指向本端（源端不在项目里时）；both = 双向，两端都挂。 */
  direction: 'out' | 'in' | 'both'
  /** 另一端的元素 id，用于在树行上显示对端名称。 */
  peerId: string
}

/** 虚拟分组 id 前缀：与真实元素 id（UUID / ext-*）不冲突。 */
const EXTENSION_GROUP_ID = ':extensions:'
const relationGroupId = (ownerId: string) => `:relations:${ownerId}`
/** 两端都不在项目树里的孤立关系，统一挂到这个顶层虚拟分组。 */
const ORPHAN_RELATION_OWNER = '__orphan_relations__'

type TreeNode =
  | { type: 'element'; ref: ModelElement }
  | { type: 'diagram'; ref: Diagram }
  /** 扩展包虚拟分组：与项目隔离的系统内容，内嵌在项目树里，可显示/隐藏。 */
  | { type: 'extensionGroup'; ref: { id: string } }
  /** 扩展包元素：数据来自元模型目录（只读），不来自项目快照。 */
  | { type: 'extensionElement'; ref: ModelElement }
  /** 「关系」虚拟节点：父 id 是关系端点的元素 id。 */
  | { type: 'relationGroup'; ref: { id: string }; ownerId: string }
  | { type: 'relation'; ref: Relationship; ownerId: string; direction: TreeRelationItem['direction']; peerId: string }

/**
 * 关系族名：组件工具箱「关系」分组内的小节标题。
 * 存中文原文，渲染时经 t() 翻译，因此可以跟随语言切换。
 */
const RELATION_FAMILY_LABELS: Record<string, string> = {
  requirement: '需求追溯',
  namespace: '命名空间',
  structure: '结构 / 流',
  constraint: '参数 / 约束',
  activity: '活动',
  interaction: '交互',
  state: '状态机',
  usecase: '用例',
}

/** 元模型目录接口不可用时的最小兜底，正常路径全部由服务端下发。 */
const FALLBACK_RELATIONS: RelationshipTypeInfo[] = [
  { code: 'trace', label: '追溯', labelEn: 'Trace', stereotype: 'trace', family: 'requirement', directed: true },
  { code: 'satisfy', label: '满足', labelEn: 'Satisfy', stereotype: 'satisfy', family: 'requirement', directed: true },
  { code: 'generalization', label: '泛化', labelEn: 'Generalization', stereotype: 'generalization', family: 'structure', directed: true },
  { code: 'association', label: '关联', labelEn: 'Association', stereotype: 'association', family: 'structure', directed: false },
]

/** 会话门卫：未登录只渲染登录页；任何接口返回 401 都会统一回到这里。 */
export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession()
      setSession(null)
    })
    return () => setUnauthorizedHandler(() => {})
  }, [])

  if (!session) {
    return <LoginView onSuccess={setSession} />
  }
  return (
    <StudioApp
      session={session}
      onLogout={() => {
        void logout().catch(() => {})
        clearSession()
        setSession(null)
      }}
    />
  )
}

function StudioApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  // 订阅语言变化：切换后整棵组件树重渲染，所有 t()/pick() 立刻使用新语言。
  // locale 同时进入依赖了翻译结果的 useMemo，保证缓存也跟着刷新。
  const locale = useLocale()
  // 权限：与服务端同一套权限码。界面按权限收敛入口，服务端另有门控兜底——
  // 两边都读令牌里的 perms 声明，不会出现「界面藏了但接口还能调」。
  const permissions = new Set(session.user.permissions ?? [])
  const canCreateProject = permissions.has('project.create')
  const canManageUsers = permissions.has('user.manage')
  const [health, setHealth] = useState<Health | null>(null)
  const [model, setModel] = useState<ModelSnapshot>(EMPTY_MODEL)
  const [specs, setSpecs] = useState<DiagramSpec[]>([])
  /** 用户定制目录：自定义图类型 + 属性字典；按项目实时解析。 */
  const [customization, setCustomization] = useState<CustomizationCatalog | null>(null)
  const [containment, setContainment] = useState<ContainmentSpec | null>(null)
  const [activeDiagramId, setActiveDiagramId] = useState('')
  /** 当前打开的需求表 / 通用表 / 通用矩阵视图；与 activeDiagramId 并存，切回图标签即恢复画布。 */
  const [activeViewId, setActiveViewId] = useState<TableViewId | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null)
  // 关系是独立模型对象：选中连线后在属性窗口按关系类型的元类链编辑属性。
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null)
  // 画布多选：selectedId 仍是主选中（属性窗口 / 树定位的对象），selectedIds 是完整选择集。
  // Shift/Ctrl+点选切换成员，Shift+空白拖拽框选；主选中变化且不在集合内时集合收敛为单选。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardSnapshot | null>(null)
  // 方向键微调：先本地偏移实时预览，停顿 350ms 后一条 SET_NOTATIONS 落库（一次 bursts 一步撤销）。
  const [nudge, setNudge] = useState<{ dx: number; dy: number } | null>(null)
  const nudgeTimer = useRef<number | null>(null)
  // 状态栏消息只存「词条 + 变量」，渲染时才翻译：切换语言后历史消息会跟着重译。
  const [message, setMessage] = useState<MessageState>({ key: '正在连接服务端…' })
  const say = useCallback((key: string, vars?: Record<string, unknown>) => {
    setMessage({ key, vars })
  }, [])
  // 初始化请求失败后自动退避重试。此前一次失败会让页面永远停在「空模型 + 无候选」，
  // 用户只能靠手动刷新整个页面恢复，而且界面不会告诉他发生了什么。
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  /** 元模型目录与项目无关，成功加载一次即可，失败则要跟着重试。 */
  const catalogsReady = useRef(false)
  /**
   * 全局写队列：所有写操作（命令 / 撤销 / 重做）在这里串行执行。
   *
   * <p>为什么需要：命令带乐观锁 {@code baseRevision}，两条命令若用同一个版本号并发发出，
   * 后到的必然 409。服务端 {@code CommandExecutor.execute} 本身是 synchronized 串行的，
   * 所以冲突只发生在客户端——连续调整（改完字号马上改字色再改线型）就会各拿同一份
   * revisionRef 发出去。队列在「出队那一刻」才读 revisionRef.current，因此后一条命令用的
   * 必然是前一条落地后的最新版本号，不会 409，也不会出现「后写覆盖先写」的静默丢失。</p>
   *
   * <p>撤销 / 重做也必须进同一条队列：它们走的是另一个端点，若插在命令中间到达服务端，
   * 撤销的就不是用户以为的那一步。</p>
   */
  const commandQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  /**
   * 忙计数：&gt;0 表示有写操作在飞行或排队中。
   *
   * <p>用计数而不是布尔：队列里排着两条命令时，第一条落地不能把 busy 提前清掉，
   * 否则第二条还在飞、界面却已经显示空闲。</p>
   */
  const busyCountRef = useRef(0)
  const [busy, setBusy] = useState(false)
  const beginBusy = useCallback(() => {
    busyCountRef.current += 1
    setBusy(true)
  }, [])
  const endBusy = useCallback(() => {
    busyCountRef.current = Math.max(0, busyCountRef.current - 1)
    if (busyCountRef.current === 0) {
      setBusy(false)
    }
  }, [])
  // 用户与角色管理抽屉：仅 user.manage 权限可见。
  const [adminOpen, setAdminOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // 模型树拖放：元素拖到图节点上时高亮可接收的图。
  const [treeDropTarget, setTreeDropTarget] = useState<string | null>(null)
  const [paletteShapes, setPaletteShapes] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)
  const [diagramDialog, setDiagramDialog] = useState<DiagramDialogState | null>(null)
  // 新建图卡片墙（华望 NewGraph）：分组标签 + 搜索；与下方 select 共用 diagramDialog.kind。
  const [newGraphGroup, setNewGraphGroup] = useState('all')
  const [newGraphQuery, setNewGraphQuery] = useState('')
  const [relationDialog, setRelationDialog] = useState<RelationshipDialogState | null>(null)
  // 自动排布：打开时记住范围，策略单独存（关窗重开不必再选一遍）。
  const [layoutDialog, setLayoutDialog] = useState<LayoutScope | null>(null)
  const [layoutStrategy, setLayoutStrategy] = useState<LayoutChoice>('auto')
  // 华望「类图布局」的方向与名称次序选项；auto/none 保持原有打分选向与重心排序。
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('auto')
  const [layoutNameOrder, setLayoutNameOrder] = useState<LayoutNameOrder>('none')
  const [createType, setCreateType] = useState('')
  /** 华望式「新建元素」弹窗的关键字过滤（中文名 / 英文名 / code）。 */
  const [createQuery, setCreateQuery] = useState('')
  const [createName, setCreateName] = useState('')
  const [createStereotype, setCreateStereotype] = useState('')
  const [joinDiagram, setJoinDiagram] = useState(true)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [edgeDrag, setEdgeDrag] = useState<EdgeDragState | null>(null)
  /**
   * 序列图消息拖动改序：按下消息线即进入候选拖动，移动超过 4px 才算拖，
   * 松手落到的时间槽下标由 seqLayout 换算。没拖动就还是「点选消息」。
   */
  const [seqDrag, setSeqDrag] = useState<{
    relationId: string
    startY: number
    fromIndex: number
    targetIndex: number
    moved: boolean
  } | null>(null)
  // 右侧垂直工具箱：组件内容只跟当前图相关（元素 + 关系 + 通用），参考 EA / StarUML。
  const [toolboxTab, setToolboxTab] = useState<'components' | 'styles' | 'custom'>('components')
  const [openToolGroups, setOpenToolGroups] = useState<Set<string>>(
    () => new Set(['elements', 'relations', 'generic', 'seqMessages']),
  )
  const [relationCatalog, setRelationCatalog] = useState<RelationshipTypeInfo[]>([])
  // 连线工具：选中关系组件后在画布上依次点击起点、终点创建关系。
  const [relationTool, setRelationTool] = useState<string | null>(null)
  const [relationSource, setRelationSource] = useState<string | null>(null)
  /** 图形右上角「+」浮层：child=华望式添加子元素；relation=以该图形为起点建关系（右键入口）。 */
  const [quickMenu, setQuickMenu] = useState<{ x: number; y: number; targetId: string; mode: 'child' | 'relation' } | null>(null)
  /** 连线创建防重入：一次点击到命令落地之间，快速双击会建出多条同源同目标的关系。 */
  const relationCreatingRef = useRef(false)
  /** 工具箱建元素防重入：快速双击会在第一条命令落地前再发一条，树里就多出重复元素。 */
  const elementCreatingRef = useRef(false)
  /**
   * 序列图的「消息种类」工具：relationTool 仍是 'message'（服务端只认这个关系类型），
   * 这里额外记住选的是同步 / 异步 / 信号 / 返回 / 创建 / 销毁 / 自消息，
   * 建关系时把种类写进 properties.messageSort，图面才有对应的线型与语义。
   */
  const [seqMessageTool, setSeqMessageTool] = useState<string | null>(null)
  // 退出连线或切到别的关系组件时，消息种类不能残留到下一次连线。
  useEffect(() => {
    if (relationTool !== 'message') {
      setSeqMessageTool(null)
    }
  }, [relationTool])
  const [propsTab, setPropsTab] = useState<'attrs' | 'tags' | 'relations' | 'whereused' | 'notation'>('attrs')
  // 属性窗口：UML 2.5.1 / SysML 1.6 元属性目录由服务端下发，三档只影响展示数量。
  const [propCatalog, setPropCatalog] = useState<PropertyCatalogInfo | null>(null)
  const [propView, setPropView] = useState<PropertyView>('STANDARD')
  const [collapsedPropGroups, setCollapsedPropGroups] = useState<Set<string>>(() => new Set())
  /** 属性栏工具栏：按属性 key 搜索、按 key 排序、搜索框展开状态。 */
  const [propQuery, setPropQuery] = useState('')
  const [propSort, setPropSort] = useState<PropertySort>('CATALOG')
  const [propSearchOpen, setPropSearchOpen] = useState(false)
  /** 当前选中的属性行：仿桌面建模器，选中行的标签列深蓝底白字。 */
  const [propActiveKey, setPropActiveKey] = useState<string | null>(null)
  /**
   * 属性编辑弹框：可编辑属性行尾的「⋯」打开，按属性类型分流编辑控件。
   * 记录打开时的对象 id，切换对象时弹框自动失效，避免改错对象。
   */
  const [propDialog, setPropDialog] = useState<{ targetId: string; key: string } | null>(null)
  /** 弹框内标量属性的草稿值。 */
  const [propDraft, setPropDraft] = useState('')
  // 引用选择器：当前打开的属性（key）与其在数组中的位置（-1 表示单值引用）。
  const [refPicker, setRefPicker] = useState<{ key: string; index: number } | null>(null)
  // 引用 / 构造型选择器的名称过滤：扩展包里有上百个元类，需要能按名字收敛。
  const [refSearch, setRefSearch] = useState('')
  // 列表型属性的待提交草稿：键为「属性 key」。
  const [listDraft, setListDraft] = useState<Record<string, string>>({})
  // 空间 / 项目导航：列表收进顶栏项目选择器，完整面板按需展开为左侧抽屉。
  const [workspace, setWorkspace] = useState<WorkspaceDirectoryInfo | null>(null)
  // 通用扩展包清单：SysML / UML 的元类与构造型由元模型层提供，与项目快照隔离。
  const [extensionPackages, setExtensionPackages] = useState<ExtensionPackageInfo[]>([])
  const [extensionElements, setExtensionElements] = useState<ModelElement[]>([])
  const [extensionCatalogReady, setExtensionCatalogReady] = useState(false)
  /** 扩展包显示开关：默认隐藏，避免上百个元类淹没用户模型。偏好存本地。 */
  const [showExtensions, setShowExtensions] = useState(() => {
    try {
      return window.localStorage.getItem('scofen.modeler.tree.extensions') === '1'
    } catch {
      return false
    }
  })
  const [openSpaces, setOpenSpaces] = useState<Set<string>>(() => new Set(['personal', 'team']))
  const [activeProjectId, setActiveProjectId] = useState(() => getProjectId())
  const [pendingObjectLink, setPendingObjectLink] = useState<ObjectLink | null>(() => readObjectLink() ?? null)
  const [projectPanel, setProjectPanel] = useState<{ section: ProjectSection; link?: ObjectLink } | null>(null)
  const [requirementImportOpen, setRequirementImportOpen] = useState(false)
  const [projectOverview, setProjectOverview] = useState<{ project: string; value: ProjectOverview } | null>(null)
  const overview = projectOverview?.project === activeProjectId ? projectOverview.value : null
  const activeGrant = overview?.grant ?? workspace?.spaces.flatMap(space => space.projects).find(project => project.id === activeProjectId)?.grant
  const noAccessibleProjects = workspace?.currentProjectId === ''
  const canEdit = activeGrant?.canEdit === true
  const canExport = activeGrant?.canExport === true
  const canImport = activeGrant?.canImport === true
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [spaceDrawerOpen, setSpaceDrawerOpen] = useState(false)
  const [newProjectDialog, setNewProjectDialog] = useState(false)
  const [newProjectSpace, setNewProjectSpace] = useState('personal')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  // 导入对话框：语义文件必选，布局侧车可选。导入语义是「整包替换当前项目」。
  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(null)
  // ── 桌面建模器式外壳：菜单栏 / 文档标签 / 左栏三视图 / 缩放状态栏 ──
  /** 已打开的文档标签（图 + 对象），顺序即标签顺序。 */
  const [tabs, setTabs] = useState<DocTab[]>([])
  /** 左栏视图：项目（包树）/ 图表（按图类型）/ 模型库（扩展包与元类构造型）。 */
  const [leftTab, setLeftTab] = useState<'project' | 'charts' | 'tables' | 'library'>('project')
  /** 图表页按图类型分组后，被折叠的类型集合：偏好落 localStorage，刷新后保持。 */
  const [collapsedChartKinds, setCollapsedChartKinds] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem('scofen.modeler.collapsedChartKinds')
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? new Set(parsed.filter((k): k is string => typeof k === 'string')) : new Set()
    } catch {
      return new Set()
    }
  })
  const [treeFilter, setTreeFilter] = useState('')
  /** 被手动折叠的「关系」虚拟分组：默认全部展开，便于一眼看到端点挂载。 */
  const [collapsedRelationGroups, setCollapsedRelationGroups] = useState<Set<string>>(() => new Set())
  /** 工具箱是否收成图标条：窄屏下把宽度还给画布。 */
  const [toolboxCollapsed, setToolboxCollapsed] = useState(false)
  /** 左栏（模型树 / 属性）与工具箱的宽度：可拖拽，落 localStorage。 */
  const [dockWidths, setDockWidths] = useState<{ left: number; tool: number }>(() => {
    const clamp = (raw: string | null, fallback: number, min: number, max: number) => {
      const parsed = Number.parseFloat(raw ?? '')
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
    }
    try {
      return {
        // 华望 InitSiderWidth=244：首次进入的左栏默认宽度；拖拽过的用户仍走 localStorage。
        left: clamp(localStorage.getItem('scofen.modeler.dock.left'), 244, DOCK_LEFT_MIN, DOCK_LEFT_MAX),
        tool: clamp(localStorage.getItem('scofen.modeler.dock.tool'), 198, DOCK_TOOL_MIN, DOCK_TOOL_MAX),
      }
    } catch {
      return { left: 244, tool: 198 }
    }
  })
  /** 正在拖拽的分隔条（null 表示未拖拽）。 */
  const [dockDrag, setDockDrag] = useState<'left' | 'tool' | 'props' | null>(null)
  /**
   * 属性面板高度（px）。null 表示未自定义，走样式表默认（高度上限 52%）。
   * 拖拽上下分隔条后固定为像素值，刷新后恢复。
   */
  const [propsHeight, setPropsHeight] = useState<number | null>(() => {
    try {
      const parsed = Number.parseFloat(localStorage.getItem('scofen.modeler.dock.props') ?? '')
      return Number.isFinite(parsed) ? Math.max(PROPS_MIN, parsed) : null
    } catch {
      return null
    }
  })
  /** 待删除项目：确认后调用删除接口。 */
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<WorkspaceProject | null>(null)
  /** 当前展开的顶级菜单名（null 表示全部收起）。 */
  const [menubarOpen, setMenubarOpen] = useState<string | null>(null)
  /** 画布缩放与平移：viewBox 只取其中一块视口，pointer 坐标由 getScreenCTM 自动换算。 */
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null)
  const [panDrag, setPanDrag] = useState<{
    startX: number
    startY: number
    panX: number
    panY: number
    /** 起手落在空白画布上：没拖动的话按「取消选择」处理，拖了才算平移。 */
    onBackground: boolean
    moved: boolean
  } | null>(null)

  // ── B2 导航与性能：全局搜索 / 小地图 / 模型树虚拟化 ──
  /** Ctrl/⌘+K 全局搜索面板：输入防抖后按名称 / 文档 / 标签 / 属性值打分。 */
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchNeedle, setSearchNeedle] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  /** 小地图开关：默认打开，偏好落 localStorage。 */
  const [minimapOpen, setMinimapOpen] = useState(() => {
    try {
      return window.localStorage.getItem('scofen.modeler.minimap') !== '0'
    } catch {
      return true
    }
  })
  /** 底部校验坞：问题面板 / 需求覆盖矩阵。开关持久化，默认收起以免挤占画布。 */
  const [bottomDockOpen, setBottomDockOpen] = useState(() => {
    try {
      return window.localStorage.getItem('scofen.modeler.bottomDock') === '1'
    } catch {
      return false
    }
  })
  const [bottomDockTab, setBottomDockTab] = useState<'problems' | 'coverage'>('problems')
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null)
  const [validationLoading, setValidationLoading] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [problemFilter, setProblemFilter] = useState<'all' | 'error' | 'warning'>('all')
  const [coverageFilter, setCoverageFilter] = useState<'all' | 'unsatisfied' | 'unverified' | 'uncovered'>('all')
  /**
   * SysML 标准图框的「新图默认开关」。每张图自己的开关由服务端 Diagram.style.frame
   * 权威保存（SET_DIAGRAM_STYLE），这里只决定从未设置过的图默认显示与否。
   */
  const [frameDefaultOpen, setFrameDefaultOpen] = useState(() => {
    try {
      return window.localStorage.getItem('scofen.modeler.diagramFrame') !== '0'
    } catch {
      return true
    }
  })
  /** 样式字典：服务端下发键与取值区间，样式面板与写入校验同源。 */
  const [styleCatalog, setStyleCatalog] = useState<StyleCatalog | null>(null)
  /** 模型树滚动视口（虚拟化窗口取行用）：高度由 ResizeObserver 实测。 */
  const [treeViewport, setTreeViewport] = useState({ top: 0, height: 600 })

  // ── B4 版本与交付：模型报告预览 / 导出 ──
  /** 报告 overlay 开关；reportHtml 为空表示正在装配（拉权威校验 + 生成）。 */
  const [reportOpen, setReportOpen] = useState(false)
  const [reportHtml, setReportHtml] = useState('')
  const [reportError, setReportError] = useState<string | null>(null)
  const reportFrameRef = useRef<HTMLIFrameElement | null>(null)

  const openSearch = useCallback(() => {
    setSearchQuery('')
    setSearchNeedle('')
    setSearchIndex(0)
    setSearchOpen(true)
  }, [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  // 所有 /api 请求都带当前项目头；在渲染期同步，避免切换项目时首帧请求串到旧项目。
  setProjectId(activeProjectId)

  const svgRef = useRef<SVGSVGElement | null>(null)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = ({ width, height }: { width: number; height: number }) => {
      if (width <= 0 || height <= 0) return
      setViewportSize(previous => previous?.width === width && previous.height === height ? previous : { width, height })
    }
    measure(svg.getBoundingClientRect())
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect))
    observer.observe(svg)
    return () => observer.disconnect()
  }, [activeViewId])
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  /** 左栏容器：属性面板上下拖拽时以它为高度基准（底边固定）。 */
  const leftDockRef = useRef<HTMLDivElement | null>(null)
  const menubarRef = useRef<HTMLElement | null>(null)
  // 命令的 baseRevision 必须取「最新已知 revision」而非渲染闭包里的 model.revision：
  // 同一次事件里连续发两条命令时，state 尚未更新，旧值会触发 409 乐观锁冲突。
  const revisionRef = useRef(0)
  /** 最新快照的同步镜像：增量应用要在 setState 生效前就能读到上一次的结果。 */
  const modelRef = useRef(model)
  modelRef.current = model
  /** 当前界面上的模型属于哪个项目：revision 只在同一个项目内可比，
   *  跨项目比大小会把新项目的模型当「过期快照」丢掉（切项目后界面停在上一项目）。 */
  const modelProjectRef = useRef(getProjectId())
  /** 定制目录的签名：定义元素集合变了才重新拉 /api/metamodel/customization。 */
  const customSigRef = useRef('')
  /** WS Patch 合并窗口：远端连续命令只触发一次全量刷新。 */
  const patchTimer = useRef(0)
  /** 合并窗口里待刷新的最高 revision：自己的命令回声先于 HTTP 响应到达时会排一次
   *  全量刷新，增量应用追上这个 revision 后该刷新就是多余的，取消掉。 */
  const pendingRefreshRevision = useRef(0)
  /** 模型树滚动容器与虚拟化取行：定位大行号时直接算 scrollTop，不依赖行已挂载。 */
  const browserRef = useRef<HTMLDivElement | null>(null)
  const treeScrollRaf = useRef(0)
  const visibleRowsRef = useRef<TreeRowProps[]>([])
  /** 小地图：点击 / 拖动把视口中心移到落点。 */
  const minimapRef = useRef<SVGSVGElement | null>(null)
  const minimapDragRef = useRef(false)

  /** 拉取当前项目的权威快照；失败返回 false，由 bootstrap 统一调度重试。 */
  const refresh = useCallback(async (): Promise<boolean> => {
    // 记下发起时的项目：请求在飞行途中用户可能已经切项目（或删掉了当前项目），
    // 那次失败属于旧项目，不该把「连接失败」横幅挂到新项目头上。
    const projectAtStart = getProjectId()
    try {
      // 空间目录不认项目头，先单独取：模型接口 404 时（本地重启后记住的项目 id 已失效）
      // 它也得落到 state，否则选择器是空的，用户连「换一个项目」这条路都走不通。
      const nextWorkspace = await getWorkspaces().catch(() => null)
      if (getProjectId() !== projectAtStart) return false
      if (nextWorkspace) {
        setWorkspace(nextWorkspace)
        if (nextWorkspace.currentProjectId !== projectAtStart) {
          setModel(EMPTY_MODEL)
          setProjectOverview(null)
          setProjectPanel(null)
          setRequirementImportOpen(false)
          setPendingObjectLink(null)
          if (!nextWorkspace.currentProjectId) {
            setHealth(null)
            setConnectionError(null)
            say('暂无可访问的项目，请联系项目负责人添加成员')
            return true
          }
          setProjectId(nextWorkspace.currentProjectId)
          setActiveProjectId(nextWorkspace.currentProjectId)
          say('原项目不可访问，已切换到有权限的项目')
          return false
        }
      }
      const [nextHealth, nextModel] = await Promise.all([
        getHealth(),
        getModel(),
      ])
      // 请求在飞行途中用户切了项目：这份快照属于旧项目，落到界面上会把上一个项目的
      // 模型显示成当前项目的。丢掉它，让切项目触发的那次 bootstrap 重来。
      if (getProjectId() !== projectAtStart) {
        return false
      }
      // 全量快照可能比本地已落地的增量更旧：WS 广播触发的 refresh 与命令回声的
      // applyLocalPatch 会并行跑，先发的那次 GET 可能带着命令落地前的数据回来。
      // 直接 setModel 会把刚应用的样式覆盖回旧值（画布上「改了没反应」）。
      // 这里丢弃过期快照——本地模型已经更新，重拉一次只会更旧。
      //
      // 「过期」只在同一个项目内成立：切到另一个项目时，新快照的 revision 可能比上一个
      // 项目小得多（新建项目的起点远低于跑了很久的项目），那不是旧数据，是另一个世界
      // 的模型——按过期丢掉，界面就会永远停在上一个项目。
      if (modelProjectRef.current === projectAtStart && nextModel.revision < modelRef.current.revision) {
        return true
      }
      modelProjectRef.current = projectAtStart
      revisionRef.current = nextModel.revision
      setHealth(nextHealth)
      setModel(nextModel)
      // 成功即自愈：否则一次瞬时失败留下的红色横幅会一直挂着，直到用户手动重试。
      setConnectionError(null)
      setMessage((current) => (current.key === '正在连接服务端…' ? { key: '已同步至服务端' } : current))
      return true
    } catch (error) {
      if (getProjectId() !== projectAtStart) {
        return false
      }
      const detail = errorMessage(error)
      setConnectionError(detail)
      say('连接失败：{error}', { error: detail })
      return false
    }
  }, [])

  const refreshProjectOverview = useCallback(async () => {
    const project = getProjectId()
    const data = await projectApi(project).overview().catch(() => null)
    if (getProjectId() === project) setProjectOverview(data ? { project, value: data } : null)
  }, [])

  useEffect(() => {
    void refreshProjectOverview()
  }, [activeProjectId, refreshProjectOverview])

  /** 轻量刷新请求序号：丢弃过期响应，避免旧健康信息覆盖新值。 */
  const lightReqRef = useRef(0)
  /** 轻量刷新：只取健康与空间目录（撤销深度 / 项目计数），不拉全量模型。 */
  const refreshLight = useCallback(async () => {
    const token = ++lightReqRef.current
    const [nextHealth, nextWorkspace] = await Promise.all([
      getHealth().catch(() => null),
      getWorkspaces().catch(() => null),
    ])
    if (token !== lightReqRef.current) {
      return
    }
    if (nextHealth) {
      setHealth(nextHealth)
    }
    if (nextWorkspace) {
      setWorkspace(nextWorkspace)
    }
  }, [])

  /** 校验报告请求序号：丢弃过期响应，避免快速切项目 / 连续命令时旧结果覆盖新结果。 */
  const validationReqRef = useRef(0)
  /** 拉取服务端权威校验报告（结构问题 + 需求覆盖）。状态栏计数与底部坞共用这一份。 */
  const loadValidation = useCallback(async (): Promise<void> => {
    const token = ++validationReqRef.current
    const projectAtStart = getProjectId()
    setValidationLoading(true)
    try {
      const report = await getValidation()
      if (token !== validationReqRef.current || getProjectId() !== projectAtStart) {
        return
      }
      setValidationReport(report)
      setValidationError(null)
    } catch (error) {
      if (token !== validationReqRef.current || getProjectId() !== projectAtStart) {
        return
      }
      setValidationError(errorMessage(error))
    } finally {
      if (token === validationReqRef.current) {
        setValidationLoading(false)
      }
    }
  }, [])

  /**
   * 命令成功后的增量落地：revision 恰好 +1 且明细完整时就地应用，省掉全量
   * GET /api/model（大项目几 MB）；否则退回权威快照。健康信息（撤销 / 重做深度）
   * 与空间计数仍要刷新，但它们是轻量接口。
   */
  const applyLocalPatch = useCallback(async (patch: Patch, baseRevision: number): Promise<void> => {
    const base = modelRef.current
    const next = patch.revision === baseRevision + 1 && base.revision === baseRevision
      ? applyPatchChanges(base, patch.changes)
      : null
    if (next) {
      next.revision = patch.revision
      modelRef.current = next
      setModel(next)
      // 自己的命令回声可能已排了一次全量刷新；本地增量已追平该 revision，取消它。
      // 只取消「不高于本次」的待刷新：更高的 revision 属于别的会话，仍要拉权威快照。
      if (patchTimer.current !== 0 && pendingRefreshRevision.current <= patch.revision) {
        window.clearTimeout(patchTimer.current)
        patchTimer.current = 0
        pendingRefreshRevision.current = 0
      }
      // 健康信息（撤销深度 / 在线数）与空间计数不参与命令的正确性，
      // 不能占住命令链：这里多等两个 HTTP 往返，样式面板就会多灰两个往返的时间。
      // 改为不阻塞地刷新——写队列因此可以立刻放行下一条命令。
      void refreshLight()
    } else {
      await refresh()
    }
  }, [refresh, refreshLight])

  /**
   * 元模型目录与项目无关，但失败必须能重试：containment 为 null 时「新建元素」
   * 对话框会退化成「该父类型不允许再包含子元素」这种误导性的空状态。
   */
  useEffect(() => {
    try {
      window.localStorage.setItem('scofen.modeler.tree.extensions', showExtensions ? '1' : '0')
    } catch {
      // 隐私模式 / 禁用存储时忽略，功能本身不受影响。
    }
  }, [showExtensions])

  // 校验报告随 revision 变化 debounce 刷新：一连串拖拽 / 微调只触发一次全量校验，
  // 状态栏计数与底部坞都读这一份服务端权威结果，不在浏览器里重算规则。
  useEffect(() => {
    const handle = window.setTimeout(() => { void loadValidation() }, 350)
    return () => window.clearTimeout(handle)
  }, [activeProjectId, model.revision, loadValidation])

  useEffect(() => {
    try {
      window.localStorage.setItem('scofen.modeler.bottomDock', bottomDockOpen ? '1' : '0')
    } catch {
      // 忽略存储失败，开关本身仍可用。
    }
  }, [bottomDockOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem('scofen.modeler.diagramFrame', frameDefaultOpen ? '1' : '0')
    } catch {
      // 忽略存储失败。
    }
  }, [frameDefaultOpen])

  /** 图表分组的折叠状态落 localStorage：刷新后保持上次展开/折叠的类型。 */
  useEffect(() => {
    try {
      window.localStorage.setItem('scofen.modeler.collapsedChartKinds', JSON.stringify([...collapsedChartKinds]))
    } catch {
      // 隐私模式 / 禁用存储时忽略。
    }
  }, [collapsedChartKinds])

  /** 左栏宽度落 localStorage：刷新后保持上次拖到的位置。 */
  useEffect(() => {
    try {
      window.localStorage.setItem('scofen.modeler.dock.left', String(Math.round(dockWidths.left)))
      window.localStorage.setItem('scofen.modeler.dock.tool', String(Math.round(dockWidths.tool)))
    } catch {
      // 隐私模式 / 禁用存储时忽略。
    }
  }, [dockWidths])

  /** 属性面板高度同样落 localStorage；恢复默认（null）时清掉键。 */
  useEffect(() => {
    try {
      if (propsHeight == null) {
        window.localStorage.removeItem('scofen.modeler.dock.props')
      } else {
        window.localStorage.setItem('scofen.modeler.dock.props', String(Math.round(propsHeight)))
      }
    } catch {
      // 隐私模式 / 禁用存储时忽略。
    }
  }, [propsHeight])

  /** 搜索输入防抖：停顿后才全量打分，连续敲键不触发中间态渲染。 */
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchNeedle(searchQuery.trim().toLowerCase()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  /** 小地图开关偏好落 localStorage。 */
  useEffect(() => {
    try {
      window.localStorage.setItem('scofen.modeler.minimap', minimapOpen ? '1' : '0')
    } catch {
      // 隐私模式 / 禁用存储时忽略。
    }
  }, [minimapOpen])

  /** 模型树视口实测：左栏拖拽 / 窗口缩放都会改变可视高度，虚拟化窗口随之取行。 */
  useEffect(() => {
    const node = browserRef.current
    if (!node || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      setTreeViewport((current) => (
        current.height === node.clientHeight ? current : { top: node.scrollTop, height: node.clientHeight }
      ))
    })
    observer.observe(node)
    setTreeViewport({ top: node.scrollTop, height: node.clientHeight })
    return () => observer.disconnect()
  }, [leftTab])

  /**
   * 窗口变矮时把自定义高度收进可用范围：否则模型树会被挤到 0 高，
   * 用户看到的是「树没了」，而不是「面板太高」。
   */
  const propsHeightFixed = propsHeight != null
  useEffect(() => {
    if (!propsHeightFixed) {
      return
    }
    const onResize = () => {
      const rect = leftDockRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      const max = Math.max(PROPS_MIN, rect.height - 132)
      setPropsHeight((current) => (current == null
        ? null
        : Math.min(max, Math.max(PROPS_MIN, current))))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [propsHeightFixed])

  /**
   * 拖拽分隔条调整列宽 / 属性面板高度。
   *
   * <p>用 window 级 pointermove / pointerup 而不是给手柄加 pointer capture：
   * 指针一旦移出手柄（7px 宽）就会丢失事件，拖拽会卡住。</p>
   *
   * <p>纵向吸附与横向不同：属性面板高度 = 容器底边到指针的垂直距离，
   * 这样按下瞬间不会因为「指针不在手柄正中」而跳一下。上限给模型树留 132px，
   * 保证树至少还能显示几行。</p>
   */
  useEffect(() => {
    if (!dockDrag) {
      return
    }
    const vertical = dockDrag === 'props'
    document.body.classList.add(vertical ? 'row-resizing' : 'col-resizing')
    const onMove = (event: PointerEvent) => {
      if (vertical) {
        const rect = leftDockRef.current?.getBoundingClientRect()
        if (!rect) {
          return
        }
        const max = Math.max(PROPS_MIN, rect.height - 132)
        setPropsHeight(Math.min(max, Math.max(PROPS_MIN, rect.bottom - event.clientY)))
        return
      }
      const originX = workspaceRef.current?.getBoundingClientRect().left ?? 0
      const pointer = event.clientX - originX
      if (dockDrag === 'left') {
        setDockWidths((previous) => ({
          ...previous,
          left: Math.min(DOCK_LEFT_MAX, Math.max(DOCK_LEFT_MIN, pointer)),
        }))
        return
      }
      // 工具箱的左边界 = 左栏宽 + 1px 分隔线，宽度取指针到该边界的距离。
      setDockWidths((previous) => ({
        ...previous,
        tool: Math.min(DOCK_TOOL_MAX, Math.max(DOCK_TOOL_MIN, pointer - previous.left - 1)),
      }))
    }
    const onUp = () => setDockDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      document.body.classList.remove('row-resizing', 'col-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dockDrag])

  const loadCatalogs = useCallback(async (): Promise<boolean> => {
    const results = await Promise.allSettled([
      getDiagrams().then(setSpecs),
      // 用户定制目录依赖项目快照，加载失败只降级为空（无自定义图），不让应用连不上。
      getCustomization().then(setCustomization).catch(() => setCustomization(null)),
      getRelationships().then(setRelationCatalog),
      getContainment().then(setContainment),
      getProperties().then(setPropCatalog),
      getExtensionPackages().then((catalog) => {
        setExtensionPackages(catalog.packages ?? [])
        // 与项目快照隔离的只读定义：扩展包虚拟树只认这份数据。
        setExtensionElements(catalog.elements ?? [])
      }),
      // 样式字典是增强项：旧服务端没有这个端点时降级到面板内置范围，不让整个应用连不上。
      getStyleCatalog().then(setStyleCatalog).catch(() => setStyleCatalog(null)),
    ])
    setExtensionCatalogReady(true)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed && failed.status === 'rejected') {
      say('元模型目录加载失败：{error}', { error: errorMessage(failed.reason) })
      return false
    }
    catalogsReady.current = true
    return true
  }, [])

  /** 模型快照与元模型目录都就绪，界面才算可用；否则挂上错误横幅并继续重试。 */
  const bootstrap = useCallback(async (): Promise<boolean> => {
    const [modelOk, catalogOk] = await Promise.all([
      refresh(),
      catalogsReady.current ? Promise.resolve(true) : loadCatalogs(),
    ])
    if (modelOk && catalogOk) {
      setConnectionError(null)
      setRetryCount(0)
      return true
    }
    setConnectionError((current) => current ?? t('服务端或元模型目录尚未就绪'))
    return false
  }, [refresh, loadCatalogs])

  // 首次进入与每次「打开项目」都重新拉取该项目的权威快照。
  useEffect(() => {
    void bootstrap()
  }, [bootstrap, activeProjectId])

  // 初始化失败自动退避重试（1s → 2s → 4s … 上限 30s），直到成功；
  // 用户也可以点顶部横幅的「立即重试」立刻再试一次。
  useEffect(() => {
    if (!connectionError) {
      return
    }
    const delay = Math.min(1000 * 2 ** Math.min(retryCount, 5), 30_000)
    const timer = window.setTimeout(() => {
      setRetryCount((count) => count + 1)
      void bootstrap()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [connectionError, retryCount, bootstrap])

  useEffect(() => {
    if (noAccessibleProjects) return
    let socket: WebSocket | null = null
    let timer = 0
    let stopped = false
    let attempt = 0
    const open = () => {
      if (stopped) {
        return
      }
      socket = new WebSocket(patchSocketUrl())
      socket.onopen = () => { attempt = 0 }
      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string; revision?: number }
          if (stopped || getProjectId() !== activeProjectId) return
          if (payload.type === 'connected') {
            void refresh()
            void refreshProjectOverview()
          }
          if (payload.type === 'project-records') {
            void refreshProjectOverview()
            void refreshLight()
            void loadValidation()
          }
          if (payload.type === 'patch') {
            // 自己命令的回声：增量应用已把 revision 推进到位，再拉一次全量纯属浪费。
            const revision = typeof payload.revision === 'number' ? payload.revision : 0
            if (revision > 0 && revision <= revisionRef.current) {
              return
            }
            // 远端连续命令合并成一次刷新：广播只带 id 不带明细，权威快照仍是兜底。
            if (revision > pendingRefreshRevision.current) {
              pendingRefreshRevision.current = revision
            }
            if (patchTimer.current !== 0) {
              window.clearTimeout(patchTimer.current)
            }
            patchTimer.current = window.setTimeout(() => {
              patchTimer.current = 0
              pendingRefreshRevision.current = 0
              void refresh()
            }, 120)
          }
        } catch {
          // 忽略非 JSON 心跳帧
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = (event) => {
        if (stopped) {
          return
        }
        if (event.code === 1008) void refresh()
        // 断线不会自愈：只有重连后才收得到别的会话广播的 Patch。
        timer = window.setTimeout(open, Math.min(1000 * 2 ** attempt++, 15_000))
      }
    }
    open()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      if (patchTimer.current !== 0) {
        window.clearTimeout(patchTimer.current)
        patchTimer.current = 0
        pendingRefreshRevision.current = 0
      }
      socket?.close()
    }
  }, [refresh, refreshProjectOverview, refreshLight, loadValidation, activeProjectId, session.token, noAccessibleProjects])

  useEffect(() => {
    if (!menu) {
      return
    }
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  // 画布「+」快捷菜单：点击菜单之外任意位置即收起（菜单自身阻止冒泡）。
  useEffect(() => {
    if (!quickMenu) {
      return
    }
    const close = () => setQuickMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [quickMenu])

  // 项目选择器：点击面板之外关闭；面板自身阻止冒泡，内部按钮可正常点击。
  useEffect(() => {
    if (!projectPickerOpen) {
      return
    }
    const close = () => setProjectPickerOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [projectPickerOpen])

  const typeInfo = useMemo(
    () => new Map((containment?.types ?? []).map((item) => [item.code, item])),
    [containment],
  )
  const canvas = containment?.canvas ?? FALLBACK_CANVAS
  const viewportWidth = viewportSize?.width ?? canvas.width
  const viewportHeight = viewportSize?.height ?? canvas.height
  const nodeSize = containment?.node ?? FALLBACK_NODE

  const activeDiagramObj = useMemo(
    () => model.diagrams.find((item) => item.id === activeDiagramId) ?? null,
    [model.diagrams, activeDiagramId],
  )
  const activeDiagramKind = activeDiagramObj?.kind ?? ''
  /** 规范九图 + 用户自定义图类型，统一成 spec 列表供工具箱 / 新建图对话框消费。 */
  const allSpecs = useMemo<DiagramSpec[]>(
    () => [...specs, ...(customization?.diagramTypes ?? [])],
    [specs, customization],
  )
  /** 自定义图的有效规范由服务端下发（allowedTypes 已求交），与校验完全同源。 */
  const activeSpec = useMemo(() => {
    if (activeDiagramObj?.customTypeId) {
      const custom = customization?.diagramTypes.find((item) => item.id === activeDiagramObj.customTypeId)
      if (custom) {
        return custom as DiagramSpec
      }
    }
    return allSpecs.find((spec) => spec.code === activeDiagramKind) ?? null
  }, [allSpecs, activeDiagramKind, activeDiagramObj, customization])
  /** 图框按每张图单独开关：服务端 Diagram.style.frame 优先，未设置时走本地默认。 */
  const frameEnabled = frameEnabledOf(activeDiagramObj, frameDefaultOpen)
  const frameStyle = frameStyleOf(activeDiagramObj)

  // 模型装载完成后默认激活第一张图
  useEffect(() => {
    if (activeDiagramId === '' && model.diagrams.length > 0) {
      setActiveDiagramId(model.diagrams[0].id)
    }
  }, [activeDiagramId, model.diagrams])

  // 从模型树 / 图表视图直接切图时，同样要退出表格视图，避免画布被数据表遮住。
  useEffect(() => {
    setActiveViewId('')
  }, [activeDiagramId])

  // 当前图必须有对应标签：从模型树、图表视图或菜单切图时自动补一个标签页。
  useEffect(() => {
    if (!activeDiagramId) {
      return
    }
    setTabs((previous) => (
      previous.some((tab) => tab.kind === 'diagram' && tab.id === activeDiagramId)
        ? previous
        : [...previous, { kind: 'diagram', id: activeDiagramId }]
    ))
  }, [activeDiagramId])

  // 标签自愈：切项目、删图、删元素后，悬空的标签自动消失（内容不变时保持原数组，避免多余重渲染）。
  useEffect(() => {
    setTabs((previous) => {
      const kept = previous.filter((tab) => (
        tab.kind === 'view'
          ? TABLE_VIEWS.some((item) => item.id === tab.id)
          : tab.kind === 'diagram'
            ? model.diagrams.some((diagram) => diagram.id === tab.id)
            : model.elements.some((element) => element.id === tab.id)
      ))
      return kept.length === previous.length ? previous : kept
    })
  }, [model.diagrams, model.elements])

  // 切项目后视口回到 100%：两个项目的画布尺寸可能不同，沿用旧缩放会落在空白处。
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [activeProjectId])

  // 菜单栏点击外部收起：用 ref 判断是否点在菜单区域内部，避免下拉项 click 前被卸载。
  useEffect(() => {
    if (!menubarOpen) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (menubarRef.current?.contains(event.target as Node)) {
        return
      }
      setMenubarOpen(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menubarOpen])

  // 切换图：组件内容随图联动，展开元素/关系分组，并清掉新图不允许的连线工具与起点。
  useEffect(() => {
    setOpenToolGroups(new Set(['elements', 'relations', 'generic', 'seqMessages']))
    setRelationSource(null)
    setRelationTool((current) =>
      current && (activeSpec?.allowedRelationships ?? []).includes(current) ? current : null,
    )
  }, [activeDiagramKind, activeSpec])


  // 激活图被删除后回退到第一张
  useEffect(() => {
    if (activeDiagramId !== '' && !model.diagrams.some((d) => d.id === activeDiagramId)) {
      setActiveDiagramId(model.diagrams[0]?.id ?? '')
      setSelectedDiagramId(null)
    }
  }, [activeDiagramId, model.diagrams])

  // 元素 / 图与关系是互斥选择：选中元素或图时自动放开关系，避免属性窗口停留在已取消的对象上。
  useEffect(() => {
    if (selectedId || selectedDiagramId) {
      setSelectedRelationId(null)
    }
  }, [selectedId, selectedDiagramId])

  const setActiveByKind = useCallback(
    (kind: string) => {
      const found = model.diagrams.find((item) => item.kind === kind)
      if (found) {
        setActiveDiagramId(found.id)
      }
    },
    [model.diagrams],
  )

  /**
   * 类型码索引：`code` 与 `uml` 的小写形式都映到规范 code。
   *
   * <p>这里必须是查表而不是 {@code types.find(...)}：模型树每行都要取类型码，
   * 几千行的树上一次折叠会调上万次，线性扫描 157 个类型 + 每次两次 toLowerCase
   * 就是实测里那几百毫秒 JS 的主要来源。</p>
   */
  const typeCodeIndex = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of containment?.types ?? []) {
      const codeKey = item.code.toLowerCase()
      if (!map.has(codeKey)) {
        map.set(codeKey, item.code)
      }
      const umlKey = item.uml?.toLowerCase()
      if (umlKey && !map.has(umlKey)) {
        map.set(umlKey, item.code)
      }
    }
    return map
  }, [containment])

  const codeOf = useCallback(
    (type: string) => typeCodeIndex.get(type.toLowerCase()) ?? type,
    [typeCodeIndex],
  )

  /** 元模型目录的双语显示名：服务端同时下发 label（中文）与 labelEn（英文），按当前语言取。 */
  const typeLabel = useCallback(
    (type: string) => {
      const info = typeInfo.get(codeOf(type))
      return info ? pick(info.label, info.labelEn) : type
    },
    [typeInfo, codeOf],
  )

  /** 图类型的双语显示名。 */
  const diagramLabel = useCallback(
    (kind: string) => {
      const spec = specs.find((item) => item.code === kind)
      if (spec) {
        return pick(spec.label, spec.labelEn)
      }
      // 自定义图类型的 code 是定义元素 id：名字取定制目录，取不到再退回 id。
      const custom = customization?.diagramTypes.find((item) => item.id === kind)
      return custom ? pick(custom.label, custom.labelEn) : kind
    },
    [specs, customization],
  )

  /**
   * 扩展包与项目是「隔离 + 内嵌」的关系：扩展包元素的数据源是元模型目录下发的
   * 只读定义（不读项目快照、不参与 revision / 筛选 / 命令），项目树只认
   * projectElements；需要查规范时再以内嵌虚拟分组展开扩展包树。
   */
  const extensionElementIds = useMemo(
    () => new Set(extensionElements.map((item) => item.id)),
    [extensionElements],
  )
  const projectElements = useMemo(
    () => model.elements.filter(
      (element) => !extensionElementIds.has(element.id) && !isExtensionId(element.id),
    ),
    [model.elements, extensionElementIds],
  )
  const extensionElementById = useMemo(
    () => new Map(extensionElements.map((element) => [element.id, element])),
    [extensionElements],
  )
  const extensionChildrenByOwner = useMemo(() => {
    const map = new Map<string, ModelElement[]>()
    for (const element of extensionElements) {
      const key = ownerKey(element.ownerId)
      const list = map.get(key) ?? []
      list.push(element)
      map.set(key, list)
    }
    return map
  }, [extensionElements])
  const extensionRoots = useMemo(() => {
    // 顶层扩展包与本标准库（原始类型 / 值类型 / 单位量纲 / 标准构造型）都是公共内容；
    // 按「有没有父包」判断，不再只认 PROFILE——模型库同样是顶层节点。
    const rootIds = new Set(
      extensionPackages
        .filter((item) => !item.parentId)
        .map((item) => item.id),
    )
    return extensionElements.filter((element) => rootIds.has(element.id))
  }, [extensionElements, extensionPackages])

  /** 项目树的父子关系：扩展包元素不进入项目树。 */
  const childrenByOwner = useMemo(() => {
    const map = new Map<string, ModelElement[]>()
    for (const element of projectElements) {
      const key = ownerKey(element.ownerId)
      const list = map.get(key) ?? []
      list.push(element)
      map.set(key, list)
    }
    return map
  }, [projectElements])

  const diagramsByOwner = useMemo(() => {
    const map = new Map<string, Diagram[]>()
    for (const diagram of model.diagrams) {
      const key = ownerKey(diagram.ownerId)
      const list = map.get(key) ?? []
      list.push(diagram)
      map.set(key, list)
    }
    return map
  }, [model.diagrams])

  const rootElements = useMemo(() => {
    const ids = new Set(projectElements.map((element) => element.id))
    const orphans = projectElements.filter(
      (element) => element.ownerId && !ids.has(element.ownerId),
    )
    return [...(childrenByOwner.get(ROOT_KEY) ?? []), ...orphans]
  }, [childrenByOwner, projectElements])

  const rootNodes = useMemo<TreeNode[]>(() => {
    const nodes: TreeNode[] = rootElements.map((ref) => ({ type: 'element', ref }))
    for (const ref of diagramsByOwner.get(ROOT_KEY) ?? []) {
      nodes.push({ type: 'diagram', ref })
    }
    return nodes
  }, [rootElements, diagramsByOwner])

  // 项目根：id 固定为 model-root 的顶层元素，类型是 Package。按位置 + id 判定，
  // 不按类型，这样存量项目里曾作为根的 Model 也能正确识别；兜底取第一个顶层元素，
  // 兼容外部 XMI 带来的多个顶层包。所有「新建」入口默认落到它下面。
  const projectRoot = useMemo(
    () => rootElements.find((element) => !element.ownerId && element.id === 'model-root')
      ?? rootElements.find((element) => !element.ownerId)
      ?? null,
    [rootElements],
  )
  const projectRootId = projectRoot?.id ?? null
  /** 首次落图的节点尺寸：扩展图按服务端下发的类型表取值，其他图沿用全局默认。 */
  const nodeSizeFor = useCallback(
    (typeCode: string) => {
      const sizes = containment?.nodeSizes
      const key = `${activeDiagramKind}:${codeOf(typeCode)}`
      return sizes?.[key] ?? nodeSize
    },
    [containment, activeDiagramKind, codeOf, nodeSize],
  )
  /** 把任意候选宿主收敛成合法的命名空间/分类器；不能拥有图的元素回退到项目根。 */
  const namespaceHostId = useCallback(
    (candidate: string | null | undefined) => {
      if (!candidate) {
        return projectRootId
      }
      const element = model.elements.find((item) => item.id === candidate)
      if (!element) {
        return projectRootId
      }
      return NAMESPACE_HOST_CODES.has(codeOf(element.type)) ? candidate : projectRootId
    },
    [model.elements, projectRootId, codeOf],
  )
  const isProjectRoot = useCallback(
    (element: ModelElement | null) =>
      !!element && !element.ownerId && element.id === 'model-root',
    [],
  )

  /** 关系方向表：服务端元模型目录权威下发，目录未就绪时按单向兜底。 */
  const relationDirected = useMemo(
    () => new Map(
      (relationCatalog.length > 0 ? relationCatalog : FALLBACK_RELATIONS)
        .map((item) => [item.code, item.directed ?? true]),
    ),
    [relationCatalog],
  )

  /**
   * 关系 → 挂载点：单向关系只挂源端一方，双向 / 无向关系同时挂两端。
   * 端点若不在项目树里（已删除、或指向隔离的扩展包），退到项目根；两端都不可挂载时
   * 进顶层「未归属关系」虚拟分组，保证任何关系都能在树上找到。
   */
  const relationsByOwner = useMemo(() => {
    const map = new Map<string, TreeRelationItem[]>()
    const projectIds = new Set(projectElements.map((item) => item.id))
    const fallback = projectRootId && projectIds.has(projectRootId)
      ? projectRootId
      : ORPHAN_RELATION_OWNER
    const add = (ownerId: string, item: TreeRelationItem) => {
      const list = map.get(ownerId) ?? []
      list.push(item)
      map.set(ownerId, list)
    }
    for (const relation of model.relationships) {
      const directed = relationDirected.get(relation.type) ?? true
      const sourceOk = projectIds.has(relation.sourceId)
      const targetOk = projectIds.has(relation.targetId)
      if (directed) {
        // 单向：只挂一方。源端可用则挂源端；否则挂目标端；都不在则兜底。
        if (sourceOk) {
          add(relation.sourceId, { relation, direction: 'out', peerId: relation.targetId })
        } else if (targetOk) {
          add(relation.targetId, { relation, direction: 'in', peerId: relation.sourceId })
        } else {
          add(fallback, { relation, direction: 'out', peerId: relation.targetId })
        }
      } else {
        // 双向：两端各挂一次（自环只挂一次，避免同一行重复）。
        if (sourceOk) {
          add(relation.sourceId, { relation, direction: 'both', peerId: relation.targetId })
        } else if (!targetOk) {
          add(fallback, { relation, direction: 'both', peerId: relation.targetId })
        }
        if (targetOk && relation.targetId !== relation.sourceId) {
          add(relation.targetId, { relation, direction: 'both', peerId: relation.sourceId })
        }
      }
    }
    return map
  }, [model.relationships, projectElements, projectRootId, relationDirected])

  // 顶层扩展包（SysML / UML 扩展包）本身：在树上标「通用」以便与用户模型区分。
  const extensionRootIds = useMemo(
    () =>
      new Set(
        extensionPackages
          .filter((item) => (item.kind ?? 'PROFILE') === 'PROFILE')
          .map((item) => item.id),
      ),
    [extensionPackages],
  )

  /**
   * 首次进入项目时播种展开状态：小模型一次铺满，大模型只铺到「章 / 包」一级。
   *
   * <p>用 ref 记「已播种」而不是判断 {@code previous.size > 0}：项目根现在也遵守折叠状态，
   * 用户把根连同下面全部收起后 size 会回到 0，靠 size 判断会立刻被重新展开。</p>
   */
  const expandedSeeded = useRef(false)
  useEffect(() => {
    // 元模型目录未就绪前不做自动展开：否则扩展包目录加载前后的树形态会跳变。
    // 快照也没落地时同样不能播种：两个请求并发返回，目录先到就会把「空模型」当成
    // 已播种，之后再也无人展开——树只剩项目根一行，且刷新前不会自己恢复。
    if (!extensionCatalogReady || expandedSeeded.current || model.elements.length === 0) {
      return
    }
    expandedSeeded.current = true
    const next = new Set<string>()
    /** 可展开 = 有子元素 / 有本节点下的图 / 挂了「关系」虚拟分组，否则折叠态看不到关系。 */
    const openIfExpandable = (id: string) => {
      if ((childrenByOwner.get(id) ?? []).length > 0
        || (diagramsByOwner.get(id) ?? []).length > 0
        || relationsByOwner.has(id)) {
        next.add(id)
      }
    }
    if (projectElements.length <= TREE_FULL_EXPAND_MAX) {
      for (const element of projectElements) {
        openIfExpandable(element.id)
      }
    } else {
      // 只展开到「章 / 包」一级（顶层元素的下一层）。
      //
      // <p>知识库级模型（几千元素）一次铺满会把整棵树塞进 DOM，之后每次折叠都要重画全部行；
      // 深层内容靠手动展开、「在模型树中定位」和筛选框进入。</p>
      for (const top of rootElements) {
        openIfExpandable(top.id)
        for (const child of childrenByOwner.get(top.id) ?? []) {
          openIfExpandable(child.id)
        }
      }
    }
    setExpanded(next)
  }, [childrenByOwner, diagramsByOwner, model.elements, projectElements, rootElements, relationsByOwner, extensionCatalogReady])

  /**
   * 新出现的关系挂载点自动展开：否则给一个原本折叠的元素新建关系后，
   * 它下面新生成的「关系」虚拟节点会被父节点的折叠状态藏起来。
   * 只处理「新增」的挂载点，不覆盖用户之后手动折叠的选择。
   * 本 effect 必须排在自动展开 effect 之后：否则它会先把 expanded 填满，
   * 让自动展开的 `size > 0` 短路，反而把其它包都折叠了。
   */
  const knownRelationOwners = useRef<Set<string>>(new Set())
  const relationMountsSeeded = useRef(false)
  useEffect(() => {
    // 与自动展开共用门卫：目录或快照未就绪时不要抢先填 expanded，
    // 也不要把「快照后到的全部关系」当成新增挂载点批量展开。
    if (!extensionCatalogReady || model.elements.length === 0) {
      return
    }
    const next = new Set(relationsByOwner.keys())
    if (!relationMountsSeeded.current) {
      // 首次加载只登记挂载点、不批量展开：大模型的关系端点可能有几百个，
      // 全部展开正是把树撑重的来源之一。
      relationMountsSeeded.current = true
      knownRelationOwners.current = next
      return
    }
    const added = [...next].filter((id) => !knownRelationOwners.current.has(id))
    knownRelationOwners.current = next
    if (added.length === 0) {
      return
    }
    setExpanded((previous) => {
      const result = new Set(previous)
      for (const id of added) {
        result.add(id)
      }
      return result
    })
  }, [relationsByOwner, model.elements, extensionCatalogReady])

  const descendants = useCallback(
    (id: string): string[] => {
      const result: string[] = []
      const stack = [id]
      while (stack.length > 0) {
        const current = stack.pop() as string
        for (const child of childrenByOwner.get(current) ?? []) {
          result.push(child.id)
          stack.push(child.id)
        }
      }
      return result
    },
    [childrenByOwner],
  )

  const selected = useMemo(
    () => model.elements.find((element) => element.id === selectedId) ?? null,
    [model.elements, selectedId],
  )

  /** 画布操作使用的选择集：多选状态为空时退回主选中，保证单选路径行为不变。 */
  const selectionSet = useMemo(() => {
    if (selectedIds.size > 0) {
      return selectedIds
    }
    return selectedId ? new Set([selectedId]) : new Set<string>()
  }, [selectedIds, selectedId])

  // 主选中切换到集合外的对象（树点选 / 新建 / 定位）时，多选收敛为单选；
  // Shift+点选先把新主选中写进集合再改 selectedId，这里看到 has=true 就保留整组。
  useEffect(() => {
    setSelectedIds((previous) => {
      if (!selectedId) {
        return previous.size === 0 ? previous : new Set()
      }
      if (previous.has(selectedId)) {
        return previous
      }
      return new Set([selectedId])
    })
  }, [selectedId])

  /** 元素 id → 元素：引用型属性据此把 id 还原成「缩略图 + 名称」。 */
  const elementById = useMemo(
    () => new Map(model.elements.map((element) => [element.id, element])),
    [model.elements],
  )

  /** 树行的按 id 取数表：行组件只拿 id，名称与端点在行内现取，未命中的行不做任何拼接。 */
  const diagramById = useMemo(
    () => new Map(model.diagrams.map((diagram) => [diagram.id, diagram])),
    [model.diagrams],
  )
  const relationById = useMemo(
    () => new Map(model.relationships.map((relation) => [relation.id, relation])),
    [model.relationships],
  )

  /**
   * 图 → 画布成员元素。
   *
   * <p>旧实现是 `projectElements.filter(e => diagram.elementIds.includes(e.id))`，
   * 每次渲染每个图节点都要扫一遍全部元素，元素数 × 图内元素数；这里一次建索引。</p>
   */
  const diagramMembersByDiagram = useMemo(() => {
    const map = new Map<string, ModelElement[]>()
    for (const diagram of model.diagrams) {
      const list: ModelElement[] = []
      for (const elementId of diagram.elementIds) {
        const element = elementById.get(elementId)
        if (element && !extensionElementIds.has(elementId)) {
          list.push(element)
        }
      }
      map.set(diagram.id, list)
    }
    return map
  }, [model.diagrams, elementById, extensionElementIds])

  /**
   * 构造型名 → 构造型元素：通用扩展包把 SysML / UML 的构造型物化成模型元素，
   * 元素的构造型属性存的仍是构造型名，因此按名解析即可还原成可定位的引用。
   */
  const stereotypeByName = useMemo(() => {
    const map = new Map<string, ModelElement>()
    for (const element of model.elements) {
      if (codeOf(element.type) === 'STEREOTYPE') {
        map.set(element.name.trim().toLowerCase(), element)
      }
    }
    return map
  }, [model.elements, codeOf])

  /** 模型树筛选：按名称模糊命中，命中项 + 其祖先链，保证命中行所在的路径可见。 */
  const treeFilterHits = useMemo(() => {
    const needle = treeFilter.trim()
    if (!needle) {
      return null
    }
    const hits = new Set<string>()
    // 隔离内容不参与项目模型筛选：扩展包只在自己的虚拟分组里浏览。
    for (const element of projectElements) {
      if (nameMatches(element.name, needle)) {
        hits.add(element.id)
      }
    }
    for (const diagram of model.diagrams) {
      if (nameMatches(diagram.name, needle)) {
        hits.add(diagram.id)
      }
    }
    // 扩展包（SysML / UML 元模型）与项目元素一样按名称命中：
    // 用户搜 Block 时，SysML 元模型里的 Block 元类必须能被筛出来。
    for (const element of extensionElements) {
      if (nameMatches(element.name, needle)) {
        hits.add(element.id)
      }
    }
    // 祖先链：只留命中项会导致父节点被过滤、子树根本渲染不出来。
    // 项目元素与扩展元素各有一套 parent 关系，按 id 逐级向上补齐。
    for (const id of [...hits]) {
      let cursor = elementById.get(id)?.ownerId ?? extensionElementById.get(id)?.ownerId ?? null
      while (cursor) {
        hits.add(cursor)
        cursor = elementById.get(cursor)?.ownerId ?? extensionElementById.get(cursor)?.ownerId ?? null
      }
    }
    if (extensionElements.some((element) => hits.has(element.id))) {
      hits.add(EXTENSION_GROUP_ID)
    }
    return hits
  }, [treeFilter, projectElements, model.diagrams, elementById, extensionElements, extensionElementById])

  /** 图表视图：按图类型分组，和工具箱的九图语义一致。 */
  const diagramsByKind = useMemo(() => {
    const map = new Map<string, Diagram[]>()
    for (const diagram of model.diagrams) {
      // 自定义图（扩展图库的 16 张模板、用户自建图种类）按自己的类型分组：
      // 挂到基底 kind 下会被埋进「模块定义图 / 包图」里，等于在图表视图里消失。
      const key = diagram.customTypeId ?? diagram.kind
      const list = map.get(key)
      if (list) {
        list.push(diagram)
      } else {
        map.set(key, [diagram])
      }
    }
    return [...map.entries()]
  }, [model.diagrams])

  /** 模型库视图：通用扩展包（SysML / UML）及其元类、构造型、关系数量。 */
  const libraryPackages = useMemo(() => {
    const roots = extensionPackages.filter((item) => (item.kind ?? 'PROFILE') === 'PROFILE')
    return roots.map((pkg) => {
      let metaclasses = 0
      let stereotypes = 0
      let relationships = 0
      for (const element of extensionElements) {
        let cursor: ModelElement | undefined = element
        let inside = false
        while (cursor) {
          if (cursor.id === pkg.id) {
            inside = true
            break
          }
          cursor = cursor.ownerId ? extensionElementById.get(cursor.ownerId) : undefined
        }
        if (!inside) {
          continue
        }
        // 关系子包里的条目本身也是 METACLASS / STEREOTYPE，先按扩展域 id 分出关系，
        // 否则同一批元素会被元类、构造型、关系三处重复计数。
        if (element.id.startsWith('rel-')) {
          relationships += 1
          continue
        }
        const code = codeOf(element.type)
        if (code === 'METACLASS') {
          metaclasses += 1
        } else if (code === 'STEREOTYPE') {
          stereotypes += 1
        }
      }
      return { pkg, metaclasses, stereotypes, relationships }
    })
  }, [extensionPackages, extensionElements, extensionElementById, codeOf])

  const selectedDiagram = useMemo(
    () => model.diagrams.find((diagram) => diagram.id === selectedDiagramId) ?? null,
    [model.diagrams, selectedDiagramId],
  )

  /** 关系同样可选择：属性窗口按关系类型（如 satisfy）取服务端下发的属性表。 */
  const selectedRelation = useMemo(
    () => model.relationships.find((relation) => relation.id === selectedRelationId) ?? null,
    [model.relationships, selectedRelationId],
  )

  /**
   * 属性窗口按当前对象（元素或关系）的完整元类继承链分组：清单来自服务端
   * /api/metamodel/properties，前端只按 STANDARD / EXPERT / ALL 三档过滤，不硬编码任何属性名。
   */
  const selectedTypeCode = selected ? codeOf(selected.type) : null
  const propEntry = selectedRelation
    ? propCatalog?.relationships?.[selectedRelation.type] ?? null
    : selectedTypeCode
      ? propCatalog?.types[selectedTypeCode] ?? null
      : null
  /** 属性提交的目标 id：元素与关系共用同一个 UPDATE_PROPERTY 通道。 */
  const propTargetId = selectedRelation?.id ?? selected?.id ?? ''
  const propGroups = useMemo(() => {
    if (!propEntry) {
      return [] as { code: string; label: string; specs: PropertySpec[] }[]
    }
    const inView = propEntry.properties.filter((spec) =>
      propView === 'ALL'
        ? true
        : propView === 'EXPERT'
          ? spec.level !== 'DERIVED'
          : spec.level === 'STANDARD')
    // 搜索以属性 key / 规范原名为准，同时兼容中文与英文显示名、元类名。
    const keyword = propQuery.trim().toLowerCase()
    const matched = keyword
      ? inView.filter((spec) => [
        spec.key, spec.umlName, spec.label, spec.labelEn, spec.metaclass,
      ].some((field) => field?.toLowerCase().includes(keyword)))
      : inView
    // 按 key 排序时取消元类分组：只有全局有序才符合「按属性 key 排序」的语义。
    if (propSort !== 'CATALOG') {
      const sorted = [...matched].sort((a, b) => a.key.localeCompare(b.key, 'en'))
      if (propSort === 'KEY_DESC') {
        sorted.reverse()
      }
      return [{
        code: '__sorted__',
        label: propSort === 'KEY_ASC' ? t('按属性 key 升序') : t('按属性 key 降序'),
        specs: sorted,
      }]
    }
    const groups = new Map<string, PropertySpec[]>()
    for (const spec of matched) {
      const list = groups.get(spec.metaclass)
      if (list) {
        list.push(spec)
      } else {
        groups.set(spec.metaclass, [spec])
      }
    }
    return [...groups.entries()].map(([code, specs]) => ({
      code,
      label: (() => {
        const meta = propCatalog?.metaclasses.find((item) => item.code === code)
        return meta ? pick(meta.label, meta.labelEn) : code
      })(),
      specs,
    }))
  }, [propEntry, propCatalog, propView, propQuery, propSort, locale])
  const propViewCount = (view: PropertyView): number => propEntry?.counts?.[view] ?? 0
  /** 当前档位下实际渲染的属性条数：属性面板底部统计条用它，与「共 N 项」一致。 */
  const propVisibleCount = useMemo(
    () => propGroups.reduce((sum, group) => sum + group.specs.length, 0),
    [propGroups],
  )

  /** 选中元素的出边 / 入边：属性面板「关系」页签据此列连线，点一行即选中该关系。 */
  const selectionRelations = useMemo(() => {
    if (!selected) {
      return { outgoing: [] as Relationship[], incoming: [] as Relationship[] }
    }
    return {
      outgoing: model.relationships.filter((relation) => relation.sourceId === selected.id),
      incoming: model.relationships.filter((relation) => relation.targetId === selected.id),
    }
  }, [selected, model.relationships])

  /** 选中元素在当前图里的记法（坐标 / 尺寸）；不在图内时为 null。 */
  const selectionNotation = useMemo(
    () => (selectedId
      ? model.notations.find((notation) => notation.diagramId === activeDiagramId && notation.elementId === selectedId) ?? null
      : null),
    [model.notations, activeDiagramId, selectedId],
  )

  /**
   * Where-used：选中对象被哪些图、关系、属性引用。与「关系」页签的出 / 入边不同，
   * 这里回答的是「谁依赖我」——所在图、指向我的关系、引用型属性指到我的对象、所有者。
   * 关系的引用面是两端元素与同时包含两端的图。属性扫描只在选中对象变化时跑一次。
   */
  const whereUsed = useMemo(() => {
    const target = selected ?? selectedRelation
    if (!target) {
      return null
    }
    const targetId = target.id
    const diagrams = selected
      ? model.diagrams.filter((diagram) => diagram.elementIds.includes(targetId))
      : model.diagrams.filter((diagram) =>
        diagram.elementIds.includes(selectedRelation!.sourceId) && diagram.elementIds.includes(selectedRelation!.targetId))
    const incoming = selected ? model.relationships.filter((relation) => relation.targetId === targetId) : []
    const referrers: { id: string; name: string; kind: 'element' | 'relation'; key: string }[] = []
    const scan = (object: ModelElement | Relationship, kind: 'element' | 'relation') => {
      if (object.id === targetId) {
        return
      }
      for (const [key, value] of Object.entries(object.properties ?? {})) {
        const values = Array.isArray(value) ? value : [value]
        if (values.some((item) => item === targetId)) {
          referrers.push({ id: object.id, name: object.name, kind, key })
        }
      }
    }
    for (const element of model.elements) {
      scan(element, 'element')
    }
    for (const relation of model.relationships) {
      scan(relation, 'relation')
    }
    const owner = selected?.ownerId ? elementById.get(selected.ownerId) ?? null : null
    const endpoints = selectedRelation
      ? [elementById.get(selectedRelation.sourceId), elementById.get(selectedRelation.targetId)]
        .filter((item): item is ModelElement => item !== undefined)
      : []
    const total = diagrams.length + incoming.length + referrers.length + (owner ? 1 : 0) + endpoints.length
    return { diagrams, incoming, referrers, owner, endpoints, total }
  }, [selected, selectedRelation, model.diagrams, model.relationships, model.elements, elementById])

  const renderRelationLink = (relation: Relationship, direction: 'out' | 'in') => {
    const otherId = direction === 'out' ? relation.targetId : relation.sourceId
    const other = elementById.get(otherId)
    return (
      <button
        type="button"
        key={`${direction}-${relation.id}`}
        className="rel-link-row"
        title={t('{relation}：{source} → {target}', {
          relation: relationLabel(relation.type),
          source: elementById.get(relation.sourceId)?.name ?? relation.sourceId,
          target: elementById.get(relation.targetId)?.name ?? relation.targetId,
        })}
        onContextMenu={(event) => openReferenceMenu(event, { kind: 'relation', id: relation.id })}
        onClick={() => {
          setSelectedRelationId(relation.id)
          setSelectedId(null)
          setSelectedDiagramId(null)
        }}
      >
        <RelationIcon code={relation.type} size={14} />
        <span className="rel-link-type">{relationLabel(relation.type)}</span>
        <span className="rel-link-other">{other?.name ?? otherId}</span>
      </button>
    )
  }

  // ── 文档标签：图标签切画布，对象标签只切属性窗口的编辑对象 ──
  const activeTabKey = activeViewId
    ? `view:${activeViewId}`
    : selectedId && tabs.some((tab) => tab.kind === 'element' && tab.id === selectedId)
      ? `element:${selectedId}`
      : activeDiagramId
        ? `diagram:${activeDiagramId}`
        : ''

  const openTab = useCallback((tab: DocTab) => {
    setTabs((previous) => (
      previous.some((item) => item.kind === tab.kind && item.id === tab.id) ? previous : [...previous, tab]
    ))
  }, [])

  const activateTab = useCallback((tab: DocTab) => {
    if (tab.kind === 'view') {
      setActiveViewId(tab.id as TableViewId)
      return
    }
    setActiveViewId('')
    if (tab.kind === 'diagram') {
      setActiveDiagramId(tab.id)
      setSelectedDiagramId(tab.id)
      setSelectedId(null)
    } else {
      setSelectedId(tab.id)
      setSelectedDiagramId(null)
      setSelectedRelationId(null)
    }
  }, [])

  /** 打开（或复用）一张表格 / 矩阵视图；与图标签并列，切走再切回保留筛选状态。 */
  const openTableView = useCallback((id: TableViewId) => {
    const tab: DocTab = { kind: 'view', id }
    setTabs((previous) => (
      previous.some((item) => item.kind === 'view' && item.id === id) ? previous : [...previous, tab]
    ))
    setActiveViewId(id)
    setMenu(null)
  }, [])

  /**
   * 关闭标签：关掉当前标签时按「右邻 → 左邻 → 任一图标签」回退，避免画布突然空白；
   * 对象标签关闭只需放开属性窗口的选择，画布不动。
   */
  const closeTab = (target: DocTab) => {
    const index = tabs.findIndex((tab) => tab.kind === target.kind && tab.id === target.id)
    if (index < 0) {
      return
    }
    const next = tabs.filter((_, position) => position !== index)
    setTabs(next)
    const wasActive = target.kind === 'diagram' ? target.id === activeDiagramId
      : target.kind === 'view' ? target.id === activeViewId
        : target.id === selectedId
    if (!wasActive) {
      return
    }
    if (target.kind === 'element') {
      setSelectedId(null)
      return
    }
    if (target.kind === 'view') {
      setActiveViewId('')
    }
    const fallback = next[index] ?? next[index - 1]
      ?? next.find((tab) => tab.kind === 'view')
      ?? next.find((tab) => tab.kind === 'diagram') ?? null
    if (fallback) {
      activateTab(fallback)
    } else if (target.kind !== 'view') {
      setSelectedDiagramId(null)
    }
  }

  const closeOtherTabs = (keep: DocTab) => {
    setTabs([keep])
    activateTab(keep)
  }

  /** 属性原始值（未经文本化）：引用型属性在这里拿到的是元素 id 或 id 数组。 */
  const propertyRaw = (spec: PropertySpec): unknown => {
    const target: ModelElement | Relationship | null = selectedRelation ?? selected
    if (!target) {
      return undefined
    }
    return target.properties?.[spec.key]
  }

  const propertyItems = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item)).filter((item) => item.trim() !== '')
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
      return [raw.trim()]
    }
    return []
  }

  const referenceIds = (spec: PropertySpec): string[] => propertyItems(propertyRaw(spec))

  /** 字符串列表属性的值：元素名等纯文本数组。 */
  const stringList = (spec: PropertySpec): string[] => {
    const target: ModelElement | Relationship | null = selectedRelation ?? selected
    if (!target) {
      return []
    }
    // stereotypes 是核心成员字段，不在 properties 包里，要单独取。
    if (spec.key === 'stereotypes') {
      return (target.stereotypes ?? []).map((item) => String(item)).filter((item) => item.trim() !== '')
    }
    return propertyItems(propertyRaw(spec))
  }

  /** 属性当前值的文本形式：元素与关系共用，核心字段走各自成员，其余读 properties 包。 */
  const propertyText = (spec: PropertySpec): string => {
    const target: ModelElement | Relationship | null = selectedRelation ?? selected
    if (!target) {
      return ''
    }
    switch (spec.key) {
      case 'name': return target.name ?? ''
      case 'documentation': return target.documentation ?? ''
      case 'stereotypes': return (target.stereotypes ?? []).join(', ')
      case 'xmiId': return selected?.xmiId ?? ''
      case 'taggedValues': return JSON.stringify(target.taggedValues ?? {})
      default: break
    }
    const raw = target.properties?.[spec.key]
    if (raw === undefined || raw === null) {
      return ''
    }
    if (Array.isArray(raw)) {
      return raw.join(', ')
    }
    if (typeof raw === 'object') {
      return JSON.stringify(raw)
    }
    return String(raw)
  }

  /** 派生引用保留对象标识，属性表无需从显示名称反查目标。 */
  const derivedReferences = (key: string): ModelReference[] | undefined => {
    const elements = (...ids: (string | null | undefined)[]): ModelReference[] =>
      ids.flatMap((id) => id ? [{ kind: 'element', id }] : [])
    if (selectedRelation) {
      switch (key) {
        case 'source':
        case 'sourceId': return elements(selectedRelation.sourceId)
        case 'target':
        case 'targetId': return elements(selectedRelation.targetId)
        case 'relatedElement': return elements(...new Set([selectedRelation.sourceId, selectedRelation.targetId]))
        case 'owner':
        case 'ownerId':
        case 'namespace': return elements(selectedRelation.ownerId ?? projectRootId)
        default: return undefined
      }
    }
    if (!selected) return undefined
    const children = childrenByOwner.get(selected.id) ?? extensionChildrenByOwner.get(selected.id) ?? []
    const childrenOfType = (...types: string[]) =>
      elements(...children.filter((child) => types.includes(codeOf(child.type))).map((child) => child.id))
    const owner = selected.ownerId ? elementById.get(selected.ownerId) : undefined
    switch (key) {
      case 'owner':
      case 'ownerId':
      case 'namespace': return elements(selected.ownerId)
      case 'ownedElement':
      case 'ownedMember': return elements(...children.map((child) => child.id))
      case 'ownedPart': return childrenOfType('PART')
      case 'ownedReference': return childrenOfType('REFERENCE_PROPERTY')
      case 'ownedValue': return childrenOfType('VALUE_PROPERTY')
      case 'ownedPort': return childrenOfType('PORT', 'FLOW_PORT')
      case 'ownedConnector': return childrenOfType('CONNECTOR')
      case 'ownedConstraint': return childrenOfType('CONSTRAINT_PROPERTY')
      case 'ownedParameter': return childrenOfType('CONSTRAINT_PARAMETER')
      case 'package': {
        let ancestor = owner
        const visited = new Set([selected.id])
        while (ancestor && !visited.has(ancestor.id)) {
          if (['PACKAGE', 'MODEL', 'MODEL_LIBRARY', 'PROFILE'].includes(codeOf(ancestor.type))) return elements(ancestor.id)
          visited.add(ancestor.id)
          ancestor = ancestor.ownerId ? elementById.get(ancestor.ownerId) : undefined
        }
        return []
      }
      case 'clientDependency':
        return selectionRelations.outgoing
          .filter((relation) => relation.type === 'dependency'
            || DEPENDENCY_METACLASSES.has(relationInfo.get(relation.type)?.metaclass ?? ''))
          .map((relation) => ({ kind: 'relation', id: relation.id }))
      case 'superClass':
        return elements(...selectionRelations.outgoing.filter((relation) => relation.type === 'generalization')
          .map((relation) => relation.targetId)
          .filter((id) => {
            const code = codeOf(elementById.get(id)?.type ?? '')
            return code === 'CLASS' || propCatalog?.types[code]?.metaclasses.includes('CLASS')
          }))
      case 'allocationTarget':
        return elements(...selectionRelations.outgoing.filter((relation) => relation.type === 'allocate').map((relation) => relation.targetId))
      default: return undefined
    }
  }

  /** 计算 / 派生属性在客户端按当前快照实时求值，不落库、不可写。 */
  const derivedText = (key: string): string => {
    if (selectedRelation) {
      const source = model.elements.find((element) => element.id === selectedRelation.sourceId)
      const target = model.elements.find((element) => element.id === selectedRelation.targetId)
      switch (key) {
        case 'id': return selectedRelation.id
        case 'relationshipType': return selectedRelation.type
        case 'qualifiedName':
          return `${source?.name ?? '?'} ⇒ ${target?.name ?? '?'}`
        case 'xmiId': return '—'
        case 'revision': return String(health?.revision ?? model.revision)
        default: return '—'
      }
    }
    if (!selected) {
      return '—'
    }
    switch (key) {
      case 'id': return selected.id
      case 'elementType': return selectedTypeCode ?? selected.type
      case 'xmiId': return selected.xmiId || '—'
      case 'revision': return String(health?.revision ?? model.revision)
      case 'qualifiedName': {
        const names: string[] = []
        let cursor: ModelElement | undefined = selected
        while (cursor) {
          names.unshift(cursor.name)
          const ownerId: string | null = cursor.ownerId
          cursor = ownerId ? model.elements.find((element) => element.id === ownerId) : undefined
        }
        return names.join('::')
      }
      case 'ownedElementCount': return String((childrenByOwner.get(selected.id) ?? []).length)
      case 'descendantCount': return String(descendants(selected.id).length)
      case 'diagramRefCount':
        return String(model.diagrams.filter((diagram) => diagram.elementIds.includes(selected.id)).length)
      case 'relationshipCount':
        return String(model.relationships.filter(
          (relation) => relation.sourceId === selected.id || relation.targetId === selected.id,
        ).length)
      case 'isProjectRoot': return isProjectRoot(selected) ? t('是') : t('否')
      default: return '—'
    }
  }

  /**
   * 属性提交：按注册表声明的值类型转换后走 UPDATE_PROPERTY，
   * 由服务端做规范校验、乐观锁与撤销栈；派生 / 计算属性不会走到这里。
   */
  /**
   * 属性提交：按注册表声明的值类型转换后走 UPDATE_PROPERTY，
   * 由服务端做规范校验、乐观锁与撤销栈；派生 / 计算属性不会走到这里。
   * 返回是否可结束编辑：值未变或已提交为 true，本地校验失败为 false（弹框保持打开）。
   */
  const commitProperty = (spec: PropertySpec, rawInput: string): boolean => {
    if (!propTargetId || !spec.editable) {
      return false
    }
    const raw = rawInput.trim()
    if (raw === propertyText(spec).trim()) {
      return true
    }
    if (raw === '') {
      if (spec.key === 'name') {
        say('名称不能为空')
        return false
      }
      void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, remove: true })
      return true
    }
    // 标记值是 JSON 对象，单独解析，避免把字符串当成对象提交。
    if (spec.key === 'taggedValues') {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object')
        }
        void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, value: parsed })
      } catch {
        say('「标记值」需要 JSON 对象，例如 {"owner":"张三"}')
        return false
      }
      return true
    }
    let value: unknown = raw
    switch (spec.kind) {
      case 'BOOLEAN':
        value = raw === 'true'
        break
      case 'INTEGER':
      case 'REAL': {
        const parsed = spec.kind === 'INTEGER' ? Number.parseInt(raw, 10) : Number.parseFloat(raw)
        if (Number.isNaN(parsed)) {
          say('「{label}」需要数字，已忽略本次输入', { label: pick(spec.label, spec.labelEn) })
          return false
        }
        value = parsed
        break
      }
      case 'UNLIMITED_NATURAL': {
        if (raw === '*') {
          value = raw
          break
        }
        const parsed = Number.parseInt(raw, 10)
        if (Number.isNaN(parsed)) {
          say('「{label}」需要自然数或 *，已忽略本次输入', { label: pick(spec.label, spec.labelEn) })
          return false
        }
        value = parsed
        break
      }
      case 'ENUM':
        if (!spec.options.includes(raw)) {
          say('「{label}」只能取：{options}', { label: pick(spec.label, spec.labelEn), options: spec.options.join(' / ') })
          return false
        }
        break
      // 少数 REFERENCE_LIST 指向元模型 / 表达式文本，用逗号分隔的文本框编辑；
      // 服务端对列表型属性一律要求数组，这里先拆再提交。
      case 'REFERENCE_LIST':
      case 'STRING_LIST':
        value = raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
        break
      default:
        break
    }
    void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, value })
    return true
  }

  const referenceDetails = ({ kind, id }: ModelReference, size: number) => {
    if (kind === 'diagram') {
      const diagram = diagramById.get(id)
      return diagram && { name: diagram.name, label: diagramLabel(diagram.kind), icon: <DiagramIcon code={diagram.kind} size={size} /> }
    }
    if (kind === 'relation') {
      const relation = relationById.get(id)
      if (!relation) return undefined
      const label = relationLabel(relation.type)
      return { name: relation.name?.trim() || label, label, icon: <RelationIcon code={relation.type} size={size} /> }
    }
    const element = elementById.get(id)
    return element && { name: element.name, label: typeLabel(element.type), icon: <TypeIcon code={codeOf(element.type)} size={size} /> }
  }

  const openReferenceMenu = (event: ReactMouseEvent, reference: ModelReference, removal?: ReferenceRemoval) => {
    if (referenceDetails(reference, 14)) {
      openMenu(event, { kind: 'reference', objectKind: reference.kind, id: reference.id, removal })
    }
  }

  const renderModelReference = (reference: ModelReference, key: string | number, removal?: ReferenceRemoval): ReactNode => {
    const details = referenceDetails(reference, 14)
    if (!details) {
      return (
        <span className="prop-ref-card missing" key={key} title={reference.id}>
          <span className="prop-ref-missing">{t('未引用的元素')}</span>
          <code className="prop-ref-id">{reference.id}</code>
        </span>
      )
    }
    return (
      <span
        className="prop-ref-card"
        key={key}
        tabIndex={0}
        data-reference-id={reference.id}
        title={`${details.name}（${reference.id}）· ${details.label}｜${t('右键可树上高亮 / 画上高亮')}`}
        onContextMenu={(event) => openReferenceMenu(event, reference, removal)}
      >
        {details.icon}
        <span className="prop-ref-name">{details.name}</span>
        <code className="prop-ref-id">{reference.id}</code>
      </span>
    )
  }

  const renderReferenceCard = (spec: PropertySpec, id: string, index: number, value = id): ReactNode =>
    renderModelReference({ kind: elementById.has(id) ? 'element' : relationById.has(id) ? 'relation'
      : diagramById.has(id) ? 'diagram' : 'element', id }, index,
      canEdit && spec.editable ? { targetId: propTargetId, key: spec.key, index, value } : undefined)

  /**
   * 构造型 chip：构造型属性存的是构造型名，按名解析到通用扩展包里的构造型元素，
   * 于是它同样能以「缩略图 + 名称 + id」呈现，右键即可在模型树上定位。
   * 解析不到（用户自造的构造型名）时退回普通文本。
   */
  const renderStereotypeChip = (
    stereotypeName: string,
    index: number,
    spec?: PropertySpec,
  ): ReactNode => {
    const target = stereotypeByName.get(stereotypeName.trim().toLowerCase())
    if (!target) {
      return <span className="prop-chip-text" key={index}>{stereotypeName}</span>
    }
    return spec ? renderReferenceCard(spec, target.id, index, stereotypeName)
      : renderModelReference({ kind: 'element', id: target.id }, index)
  }

  /**
   * 构造型选择器：列出通用扩展包提供的 SysML / UML 构造型，点击即加入构造型列表。
   *
   * <p>构造型属性的值仍是构造型名（与 XMI 导出保持一致），
   * 但名字背后对应扩展包里的一个真实构造型元素。</p>
   */
  const renderStereotypePicker = (
    onPick: (stereotypeName: string) => void,
    onCancel: () => void = () => setRefPicker(null),
  ): ReactNode => {
    const keyword = refSearch.trim().toLowerCase()
    const candidates = Array.from(stereotypeByName.values())
      .filter((element) => !keyword || element.name.toLowerCase().includes(keyword))
      .sort((a, b) => a.name.localeCompare(b.name))
    return (
      <div className="prop-ref-picker-wrap">
        <div className="prop-ref-search">
          <input
            value={refSearch}
            placeholder={t('按名称过滤')}
            onChange={(event) => setRefSearch(event.target.value)}
          />
          <span className="prop-ref-scope">{t('构造型')}</span>
        </div>
        <div className="prop-ref-picker">
          {candidates.length === 0
            ? <p className="hint">{t('没有匹配的构造型')}</p>
            : candidates.map((element) => (
              <button
                key={element.id}
                type="button"
                className="prop-ref-option"
                onClick={() => onPick(element.name)}
                  onContextMenu={(event) => openReferenceMenu(event, { kind: 'element', id: element.id })}
              >
                <TypeIcon code={codeOf(element.type)} size={14} />
                <span className="prop-ref-name">{element.name}</span>
                <span className="prop-ref-type">{typeLabel(element.type)}</span>
              </button>
            ))}
        </div>
        <button type="button" className="prop-link" onClick={onCancel}>{t('取消')}</button>
      </div>
    )
  }

  /**
   * 引用选择器：列出可被引用的模型元素（缩略图 + 名称 + 类型），点击即选中。
   *
   * <p>可选元素按全模型列出（与当前图无关），排除自己避免自引用；
   * 若服务端声明了 {@code referenceTarget}（元类引用只列元类、构造型引用只列构造型），
   * 候选就收敛到该类型；顶部保留「直接输入 id」入口——部分规范属性引用的是
   * 模型中尚未建模的实例。</p>
   */
  const renderReferencePicker = (
    spec: PropertySpec,
    onPick: (elementId: string) => void,
    onCancel: () => void = () => setRefPicker(null),
  ): ReactNode => {
    const keyword = refSearch.trim().toLowerCase()
    const candidates = model.elements
      .filter((element) => element.id !== propTargetId)
      .filter((element) => !spec.referenceTarget || codeOf(element.type) === spec.referenceTarget)
      .filter((element) => !keyword || element.name.toLowerCase().includes(keyword))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
    const manualKey = `${propTargetId}:${spec.key}:manual`
    const manual = listDraft[manualKey] ?? ''
    return (
      <div className="prop-ref-picker-wrap">
        <div className="prop-ref-search">
          <input
            value={refSearch}
            placeholder={t('按名称过滤')}
            onChange={(event) => setRefSearch(event.target.value)}
          />
          {spec.referenceTarget && (
            <span className="prop-ref-scope">{typeLabel(spec.referenceTarget)}</span>
          )}
        </div>
        <div className="prop-ref-manual">
          <input
            value={manual}
            placeholder={t('或直接输入元素 id')}
            onChange={(event) => setListDraft((previous) => ({ ...previous, [manualKey]: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                const text = manual.trim()
                if (text) {
                  onPick(text)
                  setListDraft((previous) => ({ ...previous, [manualKey]: '' }))
                }
              }
            }}
          />
          <button
            type="button"
            className="prop-link"
            disabled={!manual.trim()}
            onClick={() => {
              const text = manual.trim()
              if (text) {
                onPick(text)
                setListDraft((previous) => ({ ...previous, [manualKey]: '' }))
              }
            }}
          >{t('添加')}</button>
        </div>
        <div className="prop-ref-picker">
          {candidates.length === 0
            ? <p className="hint">{t('没有可引用的元素')}</p>
            : candidates.map((element) => (
              <button
                key={element.id}
                type="button"
                className="prop-ref-option"
                onClick={() => onPick(element.id)}
                onContextMenu={(event) => openReferenceMenu(event, { kind: 'element', id: element.id })}
              >
                <TypeIcon code={codeOf(element.type)} size={14} />
                <span className="prop-ref-name">{element.name}</span>
                <span className="prop-ref-type">{typeLabel(element.type)}</span>
              </button>
            ))}
        </div>
        <button type="button" className="prop-link" onClick={onCancel}>{t('取消')}</button>
      </div>
    )
  }

  /**
   * 数组型属性的编辑：chip 标签 + 增删。
   *
   * <p>REFERENCE_LIST 的 chip 显示「缩略图 + 名称」；STRING_LIST 的 chip 显示文本。
   * 每次增删都提交完整的数组值，走同一条 UPDATE_PROPERTY 通道。</p>
   */
  const renderListEditor = (spec: PropertySpec): ReactNode => {
    const isReference = spec.kind === 'REFERENCE_LIST' && spec.referencesElement !== false
    const values = isReference ? referenceIds(spec) : stringList(spec)
    const draftKey = `${propTargetId}:${spec.key}`
    const draft = listDraft[draftKey] ?? ''
    const commitList = (next: string[]) => {
      if (next.length === 0) {
        void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, remove: true })
      } else {
        void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, value: next })
      }
    }
    // 内联输入：直接录入一个值（回车或点「添加」生效）。构造型属性另有选择器，
    // 这里保留输入框是为了录入扩展包之外的自定义构造型名。
    const inlineAdd = (
      <div className="prop-inline-add">
        <input
          value={draft}
          placeholder={t('输入后回车添加')}
          onChange={(event) => setListDraft((previous) => ({ ...previous, [draftKey]: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const text = draft.trim()
              if (!text) {
                return
              }
              commitList([...values, text])
              setListDraft((previous) => ({ ...previous, [draftKey]: '' }))
            }
          }}
        />
        <button
          type="button"
          className="prop-link"
          disabled={!draft.trim()}
          onClick={() => {
            const text = draft.trim()
            if (!text) {
              return
            }
            commitList([...values, text])
            setListDraft((previous) => ({ ...previous, [draftKey]: '' }))
          }}
        >{t('添加')}</button>
      </div>
    )
    return (
      <div className="prop-list-editor">
        <div className="prop-chips">
          {values.map((value, index) => (
            <span className="prop-chip" key={`${value}:${index}`}>
              {isReference
                ? renderReferenceCard(spec, value, index)
                : spec.key === 'stereotypes'
                  ? renderStereotypeChip(value, index, spec)
                  : <span className="prop-chip-text">{value}</span>}
              <button
                type="button"
                className="prop-chip-x"
                title={t('移除')}
                onClick={() => commitList(values.filter((_, position) => position !== index))}
              >×</button>
            </span>
          ))}
          {values.length === 0 && <span className="prop-chips-empty">{t('空列表')}</span>}
        </div>
          {isReference ? (
            refPicker?.key === spec.key ? (
              renderReferencePicker(spec, (elementId) => {
                commitList([...values, elementId])
                setRefPicker(null)
              })
            ) : (
              <button
                type="button"
                className="prop-link"
                onClick={() => { setRefSearch(''); setRefPicker({ key: spec.key, index: -1 }) }}
              >{t('添加引用')}</button>
            )
          ) : spec.key === 'stereotypes' ? (
            // 构造型：从通用扩展包里挑，输入框仍保留给自造构造型名。
            refPicker?.key === spec.key ? (
              renderStereotypePicker((stereotypeName) => {
                if (!values.includes(stereotypeName)) {
                  commitList([...values, stereotypeName])
                }
                setRefPicker(null)
              })
            ) : (
              <div className="prop-add-row">
                <button
                  type="button"
                  className="prop-link"
                  onClick={() => { setRefSearch(''); setRefPicker({ key: spec.key, index: -1 }) }}
                >{t('选择构造型')}</button>
                {inlineAdd}
              </div>
            )
          ) : (
            inlineAdd
          )}
      </div>
    )
  }

  /** 编辑弹框当前对应的属性定义：切换对象 / 档位后自动失效，避免改错对象。 */
  const propDialogSpec = propDialog && propDialog.targetId === propTargetId
    ? propEntry?.properties.find((item) => item.key === propDialog.key) ?? null
    : null

  // 切换对象 / 档位后，旧弹框对应的属性可能已不在目录里：直接收起，避免改错对象。
  useEffect(() => {
    if (propDialog && !propDialogSpec) {
      setPropDialog(null)
    }
  }, [propDialog, propDialogSpec])

  /** 值类型 → 编辑交互：字符 / 长文本 / 布尔 / 枚举 / 模型引用 / 数组 / JSON。 */
  const propEditorMode = (spec: PropertySpec): PropEditorMode => {
    if (spec.key === 'taggedValues') return 'json'
    switch (spec.kind) {
      case 'BOOLEAN': return 'boolean'
      case 'ENUM': return 'enum'
      case 'TEXT': return 'textarea'
      case 'REFERENCE_LIST': return spec.referencesElement === false ? 'text' : 'list'
      case 'STRING_LIST': return 'list'
      case 'REFERENCE': return spec.referencesElement === false ? 'text' : 'reference'
      default: return 'text'
    }
  }

  /** 弹框是否为「即时提交」型：数组与模型引用的每次增删直接落库，底部只有「完成」。 */
  const propDialogLive = (spec: PropertySpec): boolean =>
    propEditorMode(spec) === 'list' || propEditorMode(spec) === 'reference'

  const closePropDialog = () => {
    setPropDialog(null)
    setRefPicker(null)
    setRefSearch('')
  }

  /** 行尾「⋯」：选中该行并按属性类型准备草稿，再打开编辑弹框。 */
  const openPropDialog = (spec: PropertySpec) => {
    setPropActiveKey(spec.key)
    setPropDraft(propertyText(spec))
    setRefSearch('')
    setRefPicker(null)
    setPropDialog({ targetId: propTargetId, key: spec.key })
  }

  /** F2 / 右键「重命名」：行内输入框已取消，改为直接打开 name 属性弹框。 */
  const openNameDialog = () => {
    setPropsTab('attrs')
    const spec = propEntry?.properties.find((item) => item.key === 'name')
    if (spec && canEdit) {
      openPropDialog(spec)
    } else if (!canEdit) {
      say('当前角色为只读，无法编辑模型')
    }
  }
  // 右键菜单先切选中对象、下一帧才能拿到它的属性目录，故用 ref 读取最新闭包。
  const openNameDialogRef = useRef(openNameDialog)
  openNameDialogRef.current = openNameDialog

  const applyPropDraft = (spec: PropertySpec) => {
    if (commitProperty(spec, propDraft)) {
      closePropDialog()
    }
  }

  /** 清除值：名称是模型对象的必填字段，不允许清空（服务端会把 name 置为空串）。 */
  const clearPropValue = (spec: PropertySpec) => {
    if (spec.key === 'name') {
      say('名称不能为空')
      return
    }
    void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, remove: true })
    closePropDialog()
  }

  /** 弹框内按类型分流的编辑控件。 */
  const renderPropDialogEditor = (spec: PropertySpec): ReactNode => {
    const mode = propEditorMode(spec)
    if (mode === 'textarea' || mode === 'json') {
      return (
        <label className="field prop-dlg-field">
          <span>{mode === 'json' ? t('JSON 对象') : t('属性值')}</span>
          <textarea
            autoFocus
            rows={mode === 'json' ? 5 : 7}
            spellCheck={false}
            value={propDraft}
            onChange={(event) => setPropDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                applyPropDraft(spec)
              }
            }}
          />
          <span className="prop-dlg-hint">
            {mode === 'json'
              ? t('形如 {"owner":"张三","phase":"M0"}；留空表示清除。Ctrl/⌘ + Enter 应用')
              : t('Ctrl/⌘ + Enter 应用，Esc 取消')}
          </span>
        </label>
      )
    }
    if (mode === 'boolean' || mode === 'enum') {
      const options = mode === 'boolean' ? ['true', 'false'] : spec.options
      return (
        <label className="field prop-dlg-field">
          <span>{t('属性值')}</span>
          <select
            autoFocus
            value={propDraft}
            onChange={(event) => setPropDraft(event.target.value)}
          >
            <option value="">{t('未设置')}</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          {mode === 'enum' && spec.options.length > 0 && (
            <span className="prop-dlg-hint">{t('规范允许的取值：{options}', { options: spec.options.join(' / ') })}</span>
          )}
        </label>
      )
    }
    if (mode === 'reference') {
      const current = referenceIds(spec)[0] ?? ''
      return (
        <div className="prop-dlg-reference">
          <div className="prop-dlg-current">
            <span className="prop-dlg-caption">{t('当前值')}</span>
            {current
              ? renderReferenceCard(spec, current, 0)
              : <span className="prop-empty">{t('未设置')}</span>}
          </div>
          {renderReferencePicker(spec, (elementId) => {
            void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, value: elementId })
            closePropDialog()
          }, closePropDialog)}
        </div>
      )
    }
    if (mode === 'list') {
      return (
        <div className="prop-dlg-list">
          <p className="prop-dlg-hint">{t('增删立即写入模型，可在撤销栈中回退；点「完成」关闭。')}</p>
          {renderListEditor(spec)}
        </div>
      )
    }
    return (
      <label className="field prop-dlg-field">
        <span>{t('属性值')}</span>
        <input
          autoFocus
          value={propDraft}
          placeholder={t('留空表示清除')}
          spellCheck={false}
          onChange={(event) => setPropDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              applyPropDraft(spec)
            }
          }}
        />
        <span className="prop-dlg-hint">
          {t('值类型 {kind} · 属性 key {key}', { kind: spec.kind, key: spec.key })}
          {spec.defaultValue ? t(' · 默认值 {value}', { value: spec.defaultValue }) : ''}
        </span>
      </label>
    )
  }

  /**
   * 属性行的值：只读展示，不再提供行内输入框。
   * 引用型显示元素卡片（右键可树上高亮），数组型显示 chip，其余显示文本。
   */
  const renderPropertyValue = (spec: PropertySpec): ReactNode => {
    const computed = spec.computed || spec.level === 'DERIVED'
    const isReference = (spec.kind === 'REFERENCE' || spec.kind === 'REFERENCE_LIST')
      && spec.referencesElement !== false
    if (isReference) {
      const derived = computed ? derivedReferences(spec.key) : undefined
      const cards = derived
        ? derived.map((reference, index) => renderModelReference(reference, index))
        : referenceIds(spec).map((elementId, index) => renderReferenceCard(spec, elementId, index))
      return cards.length === 0
        ? <span className="prop-empty">—</span>
        : <div className="prop-value-cards">{cards}</div>
    }
    if (computed) return <code className="prop-static">{derivedText(spec.key)}</code>
    if (spec.kind === 'STRING_LIST' || spec.kind === 'REFERENCE_LIST') {
      const values = spec.kind === 'STRING_LIST' ? stringList(spec) : referenceIds(spec)
      return values.length === 0
        ? <span className="prop-empty">—</span>
        : (
          <div className="prop-value-chips">
            {values.map((value, index) => (
              <span className="prop-chip" key={`${value}:${index}`}>
                {spec.key === 'stereotypes'
                  ? renderStereotypeChip(value, index, spec)
                  : <span className="prop-chip-text">{value}</span>}
              </span>
            ))}
          </div>
        )
    }
    const text = propertyText(spec)
    return text.trim()
      ? <span className="prop-static-value" title={text}>{text}</span>
      : <span className="prop-empty">—</span>
  }

  /** 属性行：仿桌面建模器的两列表格，行尾「⋯」是唯一编辑入口。 */
  const renderPropertyRow = (spec: PropertySpec): ReactNode => {
    if (!propTargetId) {
      return null
    }
    // 派生属性本就只读；无编辑权限时全部属性降级为只读。
    const readOnly = !spec.editable || !canEdit
    const readOnlyNote = !spec.editable ? t(' · 只读') : (canEdit ? '' : t(' · 当前角色只读'))
    const title = t('{metaclass} · {umlName} · {spec}{readOnly}', {
      metaclass: pick(spec.metaclassLabel, spec.metaclassLabelEn),
      umlName: spec.umlName, spec: spec.spec, readOnly: readOnlyNote,
    })
    const label = pick(spec.label, spec.labelEn)
    return (
      <div
        className={`prop-row${readOnly ? ' readonly' : ''}${propActiveKey === spec.key ? ' active' : ''}`}
        key={spec.key}
        data-prop-key={spec.key}
        data-prop-kind={spec.kind}
        title={title}
        onClick={() => setPropActiveKey(spec.key)}
        onDoubleClick={() => { if (!readOnly) openPropDialog(spec) }}
      >
        <span className="prop-label">
          {label}
          {readOnly && <em>{t('只读')}</em>}
        </span>
        <div className="prop-value">{renderPropertyValue(spec)}</div>
        {readOnly
          ? <span className="prop-more-slot" aria-hidden="true" />
          : (
            <button
              type="button"
              className="prop-more"
              title={t('编辑「{label}」…', { label })}
              aria-label={t('编辑「{label}」…', { label })}
              onClick={(event) => { event.stopPropagation(); openPropDialog(spec) }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <circle cx="3" cy="7" r="1.25" fill="currentColor" />
                <circle cx="7" cy="7" r="1.25" fill="currentColor" />
                <circle cx="11" cy="7" r="1.25" fill="currentColor" />
              </svg>
            </button>
          )}
      </div>
    )
  }

  const visibleElements = useMemo(() => {
    if (!activeDiagramObj) {
      return model.elements.length <= CANVAS_OVERVIEW_MAX ? model.elements : []
    }
    const ids = new Set(activeDiagramObj.elementIds)
    return model.elements.filter((element) => ids.has(element.id))
  }, [model.elements, activeDiagramObj])

  const positions = useMemo(() => {
    const paintOrder = (element: ModelElement, style: StyleMap) => {
      const variant = shapeVariantOf(element.type, style)
      if (variant === 'layer' || isBackdropShape(shapeOf(element.type))) return 0
      return variant === 'container' ? 1 : 2
    }
    const byElement = new Map(
      model.notations
        .filter((notation) => notation.diagramId === activeDiagramId)
        .map((notation) => [notation.elementId, notation]),
    )
    return visibleElements.map((element, index) => {
      const notation = byElement.get(element.id)
      const glyph = controlSizeOf(element.type)
      const oldW = notation?.width ?? nodeSize.width
      const oldH = notation?.height ?? nodeSize.height
      // 控制节点图形用规范尺寸；旧的大框记法按中心居中收缩，图形不会漂到旧框角落。
      const baseX = (notation?.x ?? 36 + (index % 3) * 196) + (glyph && notation ? (oldW - glyph.w) / 2 : 0)
      const baseY = (notation?.y ?? 36 + Math.floor(index / 3) * 128) + (glyph && notation ? (oldH - glyph.h) / 2 : 0)
      const active = drag?.elementId === element.id ? drag : null
      const groupMember = !active && drag?.group ? drag.group.find((member) => member.id === element.id) : undefined
      let px = active?.x ?? baseX
      let py = active?.y ?? baseY
      if (groupMember && drag) {
        px = clamp(groupMember.originX + (drag.x - drag.originX), 0, canvas.maxX)
        py = clamp(groupMember.originY + (drag.y - drag.originY), 0, canvas.maxY)
      }
      if (nudge && selectionSet.has(element.id)) {
        px += nudge.dx
        py += nudge.dy
      }
      return {
        element,
        x: px,
        y: py,
        w: glyph?.w ?? oldW,
        h: glyph?.h ?? oldH,
        // 记法样式（字号 / 颜色 / 线型）由服务端保存，渲染时逐节点取出。
        style: notation?.style ?? {},
      }
    // 垫底形状（泳道、生命线）先画：SVG 后画的盖在先画的上面，不透明底必须垫在动作/消息之下。
    }).sort((a, b) => paintOrder(a.element, a.style) - paintOrder(b.element, b.style))
  }, [visibleElements, model.notations, activeDiagramId, drag, nodeSize.width, nodeSize.height, selectionSet, nudge, canvas.maxX, canvas.maxY])

  /**
   * 序列图的图面计算：生命线列、消息时间槽、激活条与内容盒。
   * 记法坐标（含未落库的拖动实时值）是唯一输入，缩放/平移/适应窗口都据它取范围。
   */
  const seqLayout = useMemo(
    () => (activeDiagramKind === 'seq'
      ? layoutSequence(positions, model.relationships, {
          elements: model.elements,
          interactionId: activeDiagramObj?.ownerId ?? null,
        })
      : null),
    [activeDiagramKind, positions, model.relationships, model.elements, activeDiagramObj?.ownerId],
  )

  /** 已在图面上按时间槽铺开、不再走通用「对角连线」渲染的消息。 */
  const seqMessageIds = useMemo(
    () => new Set((seqLayout?.messages ?? []).map((message) => message.relation.id)),
    [seqLayout],
  )

  /** 组合片段已画成 UML 片段框，节点层不要再画一个普通方块。 */
  const seqFragmentIds = useMemo(
    () => new Set((seqLayout?.fragments ?? []).map((fragment) => fragment.element.id)),
    [seqLayout],
  )

  /** 生命线表头几何（对齐后的行、统一底边）：renderNode 据此画框与竖线。 */
  const seqLifelineById = useMemo(
    () => new Map((seqLayout?.lifelines ?? []).map((lifeline) => [lifeline.element.id, lifeline])),
    [seqLayout],
  )

  /** 当前图的内容包围盒；序列图要含推导出来的消息行与生命线末端。 */
  const contentBox = useMemo(() => {
    if (seqLayout) {
      return seqLayout.box
    }
    if (positions.length === 0) {
      return null
    }
    return {
      left: Math.min(...positions.map((item) => item.x)),
      top: Math.min(...positions.map((item) => item.y)),
      right: Math.max(...positions.map((item) => item.x + item.w)),
      bottom: Math.max(...positions.map((item) => item.y + item.h)),
    }
  }, [positions, seqLayout])

  /**
   * SysML 标准图框几何：矩形边框包住内容包围盒，左上角首页标签（home plate）按
   * 「图种 [宿主 [图名]]」显示（与 Cameo / M-Design 一致），可在样式面板改标题、
   * 边框色、标签色与字号。空图退回名义画布内的默认框，随 SVG 一起导出。
   */
  const diagramFrame = useMemo(() => {
    // 序列图的 sd 图框本身就是图框（UML 只画一层），再套一层通用框会变成双层嵌套。
    if (!frameEnabled || !activeDiagramObj || seqLayout?.frame) {
      return null
    }
    const margin = FRAME_MARGIN
    const headerH = FRAME_HEADER_H
    const notch = FRAME_NOTCH
    // 空图也留出与内容图一致的四周留白：回退盒本身再内缩一个 margin，
    // 展开成图框后才是 (margin, margin, canvas - 2*margin)，否则图框会正好铺满
    // 整个视口、底边压在画布边缘被裁掉。
    const nominal = {
      left: margin * 2, top: margin * 2 + headerH,
      right: canvas.width - margin * 2, bottom: canvas.height - margin * 2,
    }
    // 画布货架不应缩水：往空图里拖入第一个图形时，内容包围盒会比初始画布小得多，
    // 若直接用 contentBox，图框会瞬间从整张画布缩成一个小框（华望的 ViewModel
    // 边界只会增长）。这里与初始画布取并集，保证图框至少保持初始尺寸，只增不减。
    const box = contentBox
      ? {
        left: Math.min(contentBox.left, nominal.left),
        top: Math.min(contentBox.top, nominal.top),
        right: Math.max(contentBox.right, nominal.right),
        bottom: Math.max(contentBox.bottom, nominal.bottom),
      }
      : nominal
    const x = Math.round(box.left - margin)
    const y = Math.round(box.top - margin - headerH)
    const w = Math.round(box.right - box.left + margin * 2)
    const h = Math.round(box.bottom - box.top + margin * 2 + headerH)
    const kindColor = colorOr(frameStyle, 'frameKindColor', FRAME_KIND_COLORS[activeDiagramKind] ?? '#1890ff')
    const border = colorOr(frameStyle, 'frameBorder', '#1c2430')
    const borderW = numberValue(frameStyle, 'frameBorderWidth', 1)
    const titleColor = colorOr(frameStyle, 'frameText', '#1c2430')
    const nameSize = Math.min(18, numberValue(frameStyle, 'frameFontSize', 12.5))
    const kindSize = Math.max(8, nameSize - 2)
    const kindLabel = activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : activeDiagramKind
    const kindLine = `${activeDiagramKind}  ${kindLabel}`
    const host = activeDiagramObj.ownerId && activeDiagramObj.ownerId !== 'model-root'
      ? model.elements.find((element) => element.id === activeDiagramObj.ownerId)?.name
      : null
    const defaultTitle = host
      ? `${kindLabel} [${host} [${activeDiagramObj.name}]]`
      : `${kindLabel} [${activeDiagramObj.name}]`
    // 自定义图类型可以给图框标题模板（{图种} / {宿主} / {图名}），优先于规范三段式，
    // 但仍低于样式面板里手改的标题（图框样式是最后一公里）。
    const customTemplate = activeDiagramObj.customTypeId
      ? customization?.diagramTypes.find((item) => item.id === activeDiagramObj.customTypeId)?.frameTitle?.trim()
      : ''
    const templated = customTemplate
      ? customTemplate
        .replace(/\{图种\}/g, kindLabel)
        .replace(/\{宿主\}/g, host ?? '')
        .replace(/\{图名\}/g, activeDiagramObj.name)
      : ''
    const name = frameStyle.frameTitle?.trim()
      ? frameStyle.frameTitle
      : templated || defaultTitle
    const headerW = Math.round(Math.max(
      160,
      estimateTextWidth(kindLine, kindSize) + 24 + notch,
      estimateTextWidth(name, nameSize) + 24 + notch,
    ))
    return { x, y, w: Math.max(w, headerW), h, headerH, headerW, notch, kindColor, kindLine, name, border, borderW, titleColor, kindSize, nameSize }
  }, [frameEnabled, activeDiagramObj, activeDiagramKind, activeSpec, contentBox, canvas.width, canvas.height, frameStyle, model.elements, locale, seqLayout, customization])

  const drawingBounds: FrameBox | null = useMemo(() => diagramFrame ? {
    left: diagramFrame.x, top: diagramFrame.y,
    right: diagramFrame.x + diagramFrame.w, bottom: diagramFrame.y + diagramFrame.h,
  } : contentBox, [diagramFrame, contentBox])

  /**
   * 适应窗口：把当前图的内容包围盒整体缩进视口。
   * 原来只是「回到 100% 并归零平移」，自动排布把图铺到几千单位宽之后那样等于什么都没做。
   */
  const fitCanvas = useCallback(() => {
    if (!drawingBounds) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }
    const box = drawingBounds
    const left = box.left
    const top = box.top
    const width = box.right - left + FIT_PADDING * 2
    const height = box.bottom - top + FIT_PADDING * 2
    const next = Number(clamp(Math.min(viewportWidth / width, viewportHeight / height), ZOOM_MIN, 1).toFixed(3))
    setZoom(next)
    setPan({
      x: left - FIT_PADDING - (viewportWidth / next - width) / 2,
      y: top - FIT_PADDING - (viewportHeight / next - height) / 2,
    })
  }, [drawingBounds, viewportWidth, viewportHeight])

  // 排布写完坐标才缩放：模型是异步刷回来的，先立个牌子，等新记法渲染出来再适应窗口。
  const fitAfterLayout = useRef(false)
  useEffect(() => {
    if (!fitAfterLayout.current) {
      return
    }
    fitAfterLayout.current = false
    fitCanvas()
  }, [model.notations, fitCanvas])

  // 首次打开超出视口的图时适应窗口。之后的侧栏调整和视口操作由用户控制。
  const openedDiagrams = useRef(new Set<string>())
  useEffect(() => {
    if (!activeDiagramId || activeViewId || !viewportSize || !drawingBounds || modelProjectRef.current !== activeProjectId) return
    const key = `${activeProjectId}/${activeDiagramId}`
    if (openedDiagrams.current.has(key)) return
    openedDiagrams.current.add(key)
    const { left, top, right, bottom } = drawingBounds
    if (left < 0 || top < 0 || right > viewportSize.width || bottom > viewportSize.height) {
      fitCanvas()
    }
  }, [activeProjectId, activeDiagramId, activeViewId, viewportSize, drawingBounds, fitCanvas])

  /**
   * 自动排布：只改写记法坐标，元素、关系与图归属一律不碰。
   * 一条 SET_NOTATIONS 写完整批，撤销一步回到排布前；超过服务端批量上限按图切分多批。
   */
  const runAutoLayout = async (strategy: LayoutChoice, scope: LayoutScope) => {
    setLayoutDialog(null)
    const targets = scope === 'diagram' ? (activeDiagramObj ? [activeDiagramObj] : []) : model.diagrams
    const elementById = new Map(model.elements.map((item) => [item.id, item]))
    const notationBy = new Map(model.notations.map((item) => [`${item.diagramId}|${item.elementId}`, item]))
    const batches: Record<string, unknown>[] = []
    let batch: Record<string, unknown>[] = []
    let moved = 0
    let unchanged = 0
    let immutable = 0
    for (const diagram of targets) {
      if (isLayoutImmutable(diagram.kind)) {
        immutable += 1
        continue
      }
      const elements = diagram.elementIds
        .map((id) => elementById.get(id))
        .filter((item): item is ModelElement => item !== undefined)
      if (elements.length === 0) {
        continue
      }
      const ids = new Set(elements.map((item) => item.id))
      const result = autoLayout({
        elements,
        relationships: model.relationships.filter((item) => ids.has(item.sourceId) && ids.has(item.targetId)),
        bounds: { maxX: canvas.maxX, maxY: canvas.maxY },
        nodeSize,
        sizeOf: (elementId) => {
          const glyph = controlSizeOf(elementById.get(elementId)?.type ?? '')
          if (glyph) {
            return glyph
          }
          const notation = notationBy.get(`${diagram.id}|${elementId}`)
          return notation ? { w: notation.width, h: notation.height } : undefined
        },
        strategy,
        direction: layoutDirection,
        nameOrder: layoutNameOrder,
      })
      // 排布没覆盖到全部元素就整图放弃：写一半只会把图面弄得更乱。
      if (result.placements.length !== elements.length) {
        continue
      }
      const items = result.placements
        .map((placement) => ({ placement, notation: notationBy.get(`${diagram.id}|${placement.elementId}`) }))
        .filter(({ placement, notation }) => {
          const glyph = controlSizeOf(elementById.get(placement.elementId)?.type ?? '')
          const wantW = glyph?.w ?? placement.w
          const wantH = glyph?.h ?? placement.h
          return !notation
            || Math.abs(notation.x - placement.x) > 1
            || Math.abs(notation.y - placement.y) > 1
            || (wantW !== undefined && Math.abs(notation.width - wantW) > 1)
            || (wantH !== undefined && Math.abs(notation.height - wantH) > 1)
        })
        .map(({ placement }) => {
          const glyph = controlSizeOf(elementById.get(placement.elementId)?.type ?? '')
          return {
            diagramId: diagram.id,
            elementId: placement.elementId,
            x: placement.x,
            y: placement.y,
            // 泳道排布会随内容改记法尺寸；控制节点锁规范图形尺寸；其余沿用原尺寸。
            ...(placement.w !== undefined ? { width: placement.w } : {}),
            ...(placement.h !== undefined ? { height: placement.h } : {}),
            ...(glyph ? { width: glyph.w, height: glyph.h } : {}),
          }
        })
      if (items.length === 0) {
        unchanged += 1
        continue
      }
      moved += items.length
      for (const item of items) {
        if (batch.length >= LAYOUT_BATCH_MAX) {
          batches.push({ items: batch })
          batch = []
        }
        batch.push(item)
      }
    }
    if (batches.length === 0 && batch.length > 0) {
      batches.push({ items: batch })
    }
    if (batches.length === 0) {
      say(immutable > 0 && moved === 0 && unchanged === 0
        ? '这些图的记法由图形自身规则排布（如序列图生命线），自动排布不参与'
        : '{count} 张图的位置与排布结果一致，未写入', { count: unchanged + immutable })
      return
    }
    fitAfterLayout.current = true
    for (const payload of batches) {
      const done = await runCommand('SET_NOTATIONS', payload)
      if (!done) {
        return
      }
    }
    say('自动排布：{count} 个记法已重排 · 位置未变 {same} 个元素 · 跳过不可排图 {skipped} 张', {
      count: moved, same: unchanged, skipped: immutable,
    })
  }

  // 泳道自动归位：打开含活动分区的图时，若泳道仍是默认尺寸（尚未排布），自动跑一次
  // 泳道排布让动作回到泳道内；已排布或手动调过尺寸的图不碰，每张图每次会话只触发一次。
  const swimlaneAutoApplied = useRef(new Set<string>())
  useEffect(() => {
    const diagram = activeDiagramObj
    if (!diagram || busy || !canEdit || swimlaneAutoApplied.current.has(diagram.id)) {
      return
    }
    const partitions = diagram.elementIds
      .map((id) => elementById.get(id))
      .filter((element): element is ModelElement => element !== undefined && isPartitionType(element.type))
    if (partitions.length === 0) {
      return
    }
    const notationByElement = new Map(
      model.notations.filter((item) => item.diagramId === diagram.id).map((item) => [item.elementId, item]),
    )
    const unarranged = partitions.every((element) => {
      const notation = notationByElement.get(element.id)
      return !notation || (notation.width === nodeSize.width && notation.height === nodeSize.height)
    })
    if (!unarranged) {
      return
    }
    swimlaneAutoApplied.current.add(diagram.id)
    void runAutoLayout('auto', 'diagram')
  }, [activeDiagramObj, model.notations, elementById, nodeSize, busy, canEdit])

  const positionById = useMemo(
    () => new Map(positions.map((item) => [item.element.id, item])),
    [positions],
  )

  const portLinks = useMemo(() => {
    const links: { x1: number; y1: number; x2: number; y2: number }[] = []
    for (const element of visibleElements) {
      if (shapeOf(element.type) !== 'port' || !element.ownerId) {
        continue
      }
      const ownerPos = positions.find((p) => p.element.id === element.ownerId)
      const portPos = positions.find((p) => p.element.id === element.id)
      if (!ownerPos || !portPos) {
        continue
      }
      links.push({
        x1: ownerPos.x + ownerPos.w,
        y1: ownerPos.y + ownerPos.h / 2,
        x2: portPos.x + portPos.w / 2,
        y2: portPos.y + portPos.h / 2,
      })
    }
    return links
  }, [visibleElements, positions])

  /**
   * 华望 propertyMenu 的语义：给定宿主元素，取元模型允许包含的子元素类型。
   * 新建对话框与画布「+」菜单共用同一份服务端 containment 规则，避免两处候选漂移。
   */
  const childOptionsFor = useCallback((ownerId: string | null): ElementTypeInfo[] => {
    if (!containment) {
      return []
    }
    if (ownerId === null) {
      return containment.rootTypes
        .map((code) => typeInfo.get(code))
        .filter((item): item is ElementTypeInfo => item !== undefined)
    }
    const parent = model.elements.find((element) => element.id === ownerId)
    if (!parent) {
      return []
    }
    const rule = containment.rules.find(
      (item) => item.parent.toLowerCase() === parent.type.toLowerCase(),
    )
    return rule?.children ?? []
  }, [containment, model.elements, typeInfo])

  const createOptions = useMemo<ElementTypeInfo[]>(
    () => (createDialog ? childOptionsFor(createDialog.ownerId) : []),
    [createDialog, childOptionsFor],
  )

  /**
   * 华望式新建元素弹窗的四段分组：服务端仍决定「能建什么」，前端只按类型语义
   * 做展示分组与过滤（对应华望 getCanCreateChildTypes 返回的 tag 字段）。
   */
  const createGroups = useMemo(() => {
    const keyword = createQuery.trim().toLowerCase()
    const options = createOptions.filter((item) => (
      !keyword
      || `${item.label} ${item.labelEn ?? ''} ${item.code} ${item.uml} ${item.stereotype}`.toLowerCase().includes(keyword)
    ))
    const bucketOf = (item: ElementTypeInfo): number => {
      const code = `${item.code} ${item.uml} ${item.stereotype}`.toLowerCase()
      if (/fme|fault|failure|hazard|risk|reliab|safety|安全|可靠|故障|风险/.test(code)) return 1
      if (/requirement|需求|functionalrequirement|performancerequirement|interfacerequirement/.test(code)
        && !/^requirement$/i.test(item.uml)) return 3
      if (/^(package|block|requirement|activity|usecase|actor|component|interface|class|diagramtype|tagdefinition|profile|metaclass|stereotype)$/i.test(item.uml)) return 0
      if (/block|part|port|connector|item|flow|state|activity|action|operation|property|module|模块|部件|端口/.test(code)) return 2
      return 0
    }
    const names = ['常用元素', '安全和可靠性', '其他模块', '其他需求']
    const namesEn = ['Common Elements', 'Security and Reliability', 'Other Blocks', 'Other Requirements']
    return names.map((name, index) => ({
      name,
      nameEn: namesEn[index],
      items: options.filter((item) => bucketOf(item) === index),
    })).filter((group) => group.items.length > 0)
  }, [createOptions, createQuery])

  /** 「+」浮层的子元素候选：与新建对话框同源的 containment 规则，按华望四段分组（无搜索框）。 */
  const quickChildGroups = useMemo(() => {
    if (!quickMenu || quickMenu.mode !== 'child') {
      return []
    }
    const options = childOptionsFor(quickMenu.targetId)
    const bucketOf = (item: ElementTypeInfo): number => {
      const code = `${item.code} ${item.uml} ${item.stereotype}`.toLowerCase()
      if (/fme|fault|failure|hazard|risk|reliab|safety|安全|可靠|故障|风险/.test(code)) return 1
      if (/requirement|需求|functionalrequirement|performancerequirement|interfacerequirement/.test(code)
        && !/^requirement$/i.test(item.uml)) return 3
      if (/^(package|block|requirement|activity|usecase|actor|component|interface|class|diagramtype|tagdefinition|profile|metaclass|stereotype)$/i.test(item.uml)) return 0
      if (/block|part|port|connector|item|flow|state|activity|action|operation|property|module|模块|部件|端口/.test(code)) return 2
      return 0
    }
    const names = ['常用元素', '安全和可靠性', '其他模块', '其他需求']
    const namesEn = ['Common Elements', 'Security and Reliability', 'Other Blocks', 'Other Requirements']
    return names.map((name, index) => ({
      name,
      nameEn: namesEn[index],
      items: options.filter((item) => bucketOf(item) === index),
    })).filter((group) => group.items.length > 0)
  }, [quickMenu, childOptionsFor])

  const canJoinDiagram = activeSpec?.allowedTypes.includes(createType) ?? false

  useEffect(() => {
    if (!createDialog || createOptions.length === 0) {
      return
    }
    if (createOptions.some((item) => item.code === createType)) {
      return
    }
    const first = createOptions[0]
    setCreateType(first.code)
    setCreateName(t('新建{label} {count}', { label: pick(first.label, first.labelEn), count: model.elements.length + 1 }))
    setCreateStereotype(first.stereotype)
  }, [createDialog, createOptions, createType, model.elements.length])

  /**
   * 把一个写操作挂进全局串行队列。
   *
   * <p>队列在「出队那一刻」才执行任务体，因此任务体里读到的 revisionRef.current
   * 一定是前一条命令落地后的最新版本号 —— 这正是消除 409 与静默丢写的关键。</p>
   *
   * <p>失败不阻断队列：后一条命令照常执行（此时它会拿到刷新后的 revision）。</p>
   *
   * <p>换项目时队列里待发的命令要丢弃：命令走的是「当前项目」请求头，
   * 排队期间用户切了项目，再发出去就打到新项目上去了。</p>
   *
   * <p>忙标志在这里统一计数：从入队起算，到任务体结束（含被丢弃）为止。
   * 只在执行期计数的话，排队等待的那段时间界面会显示空闲。</p>
   */
  const enqueueWrite = useCallback(<T,>(task: () => Promise<T>): Promise<T | undefined> => {
    const projectAtEnqueue = getProjectId()
    beginBusy()
    const run = async (): Promise<T | undefined> => {
      try {
        if (getProjectId() !== projectAtEnqueue) {
          // 项目已切换：这条命令属于旧项目，丢弃而不是打到新项目上。
          return undefined
        }
        return await task()
      } finally {
        endBusy()
      }
    }
    const result = commandQueueRef.current.then(run, run)
    // 队列尾永远保持 resolved：某条命令抛错不能让后面的写操作全部卡死。
    commandQueueRef.current = result.then(() => undefined, () => undefined)
    return result
  }, [beginBusy, endBusy])

  /**
   * 发一条写命令；载荷在**出队那一刻**才构造。
   *
   * <p>需要「读最新状态再算载荷」的写操作必须走这里：载荷在入队时构造的话，
   * 用的可能是上一条命令落地前的旧值。典型例子是连线样式——服务端
   * UPDATE_PROPERTY 是整包覆盖，用旧样式算出的载荷会把排队中前一条命令的结果抹掉。</p>
   */
  const runCommandDeferred = async (
    type: string,
    buildPayload: () => Record<string, unknown>,
  ): Promise<boolean> => {
    if (!canEdit) {
      say('当前角色为只读，无法编辑模型')
      return false
    }
    // 项目切换时被丢弃的命令返回 undefined：视为失败（没写成）。
    const applied = await enqueueWrite(async () => {
      try {
        // baseRevision 必须在出队时取：入队时取的可能是上一条命令落地前的旧版本号。
        const baseRevision = revisionRef.current
        const patch = await postCommand({
          type,
          payload: buildPayload(),
          baseRevision,
          clientCmdId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        })
        revisionRef.current = patch.revision
        say('已应用 rev {revision} · {count} 个对象受影响 · 校验：{delta}', { revision: patch.revision, count: patch.affectedIds.length, delta: patch.validationDelta })
        await applyLocalPatch(patch, baseRevision)
        syncCustomizationCatalog()
        return true
      } catch (error) {
        say('操作失败：{error}', { error: errorMessage(error) })
        await refresh()
        return false
      }
    })
    return applied ?? false
  }

  const runCommand = async (type: string, payload: Record<string, unknown>): Promise<boolean> =>
    runCommandDeferred(type, () => payload)

  /**
   * 定制目录（自定义图类型）跟着模型走：定义元素增删**或改属性**后要重新拉一次，
   * 否则「新建图」下拉还停在旧列表上、工具箱也还按旧白名单铺组件。
   *
   * <p>签名必须覆盖属性：只比对 id + 名字的话，改了白名单不会触发刷新，
   * 界面上「勾了没生效」。</p>
   *
   * <p>只在签名变化时才发请求：拖拽节点这类高频命令不会带上定制目录的往返。</p>
   */
  const customCatalogSig = (elements: ModelElement[]): string =>
    elements
      .filter((element) => isDiagramType(element) || isTagDefinition(element))
      .map((element) => {
        const props = element.properties ?? {}
        const relevant = Object.entries(props)
          .filter(([key]) => key.startsWith('custom:'))
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .sort()
          .join('|')
        return `${element.id}:${element.name}:${relevant}`
      })
      .sort()
      .join(',')

  const syncCustomizationCatalog = () => {
    const signature = customCatalogSig(modelRef.current.elements)
    if (signature === customSigRef.current) {
      return
    }
    customSigRef.current = signature
    void getCustomization().then(setCustomization).catch(() => undefined)
  }

  // ── 图形样式：三处写入都走命令（服务端权威 / 可撤销 / WS Patch 广播） ──
  /** 当前图上被选中元素对应的记法 id：多选时一次批量命令写完，一步撤销。 */
  const styleTargetIds = useMemo(() => {
    const picked = selectionSet
    return model.notations
      .filter((notation) => notation.diagramId === activeDiagramId && picked.has(notation.elementId))
      .map((notation) => notation.id)
  }, [model.notations, activeDiagramId, selectionSet])

  const selectedNotationsByType = useMemo(() => {
    const result = new Map<string, typeof model.notations>()
    for (const notation of model.notations) {
      if (notation.diagramId !== activeDiagramId || !selectionSet.has(notation.elementId)) continue
      const element = elementById.get(notation.elementId)
      if (!element) continue
      const code = codeOf(element.type)
      const notations = result.get(code) ?? []
      notations.push(notation)
      result.set(code, notations)
    }
    return result
  }, [activeDiagramId, selectionSet, model.notations, elementById, codeOf])

  const currentLineStyle = useMemo(
    () => relationStyleOf(selectedRelation, activeDiagramId),
    [selectedRelation, activeDiagramId],
  )

  const applyNodeStyle = async (patch: StyleMap, replace = false, keepShape = false): Promise<void> => {
    if (styleTargetIds.length === 0) {
      say('当前图没有可编辑的记法')
      return
    }
    const ok = await runCommandDeferred('SET_NOTATION_STYLE', () => {
      const existingShapes = keepShape
        ? new Map(modelRef.current.notations.map(({ id, style }) => [id, style?.shapeVariant]))
        : null
      return {
        items: styleTargetIds.map((id) => {
          const shapeVariant = existingShapes?.get(id)
          return { notationId: id, style: shapeVariant ? { ...patch, shapeVariant } : patch }
        }),
        ...(replace ? { replace: true } : {}),
      }
    })
    if (ok) say('已应用图形样式')
  }

  const applyLineStyle = async (patch: StyleMap, replace = false): Promise<void> => {
    if (!selectedRelationId || !activeDiagramId) {
      say('请先选中一条连线')
      return
    }
    const relationId = selectedRelationId
    const diagramId = activeDiagramId
    // 关系 properties 是整包写入：把增量合并进现有样式，空串键先剔除。
    // 合并必须在**出队那一刻**基于最新的关系样式算——若在这里算，
    // 排队中前一条连线样式命令的结果会被这一条整包覆盖掉（丢改动）。
    const ok = await runCommandDeferred('UPDATE_PROPERTY', () => {
      const relation = modelRef.current.relationships.find((item) => item.id === relationId)
      const current = relationStyleOf(relation, diagramId)
      const merged: StyleMap = replace ? { ...patch } : { ...current, ...patch }
      for (const key of Object.keys(merged)) {
        if (merged[key] === '') delete merged[key]
      }
      const key = `style:${diagramId}`
      return Object.keys(merged).length === 0
        ? { id: relationId, key, remove: true }
        : { id: relationId, key, value: merged }
    })
    if (ok) say('已应用连线样式')
  }

  const applyFrameStyle = async (patch: StyleMap, replace = false): Promise<void> => {
    if (!activeDiagramObj) return
    const ok = await runCommand('SET_DIAGRAM_STYLE', {
      diagramId: activeDiagramObj.id,
      style: patch,
      ...(replace ? { replace: true } : {}),
    })
    if (ok) say('已应用图框样式')
  }

  /** 图框开关按当前图落库，同时把选择记成本地新图默认。 */
  const setFrameVisible = (visible: boolean): void => {
    setFrameDefaultOpen(visible)
    if (!activeDiagramObj) return
    void applyFrameStyle({ frame: visible ? 'on' : 'off' })
  }

  const openMenu = (event: ReactMouseEvent, target: MenuTarget) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.min(event.clientY, window.innerHeight - (target.kind === 'reference' ? 124 : 280)),
      target,
    })
  }

  /** 图形右上角「+」：华望式「添加子元素」，宿主即该图形。 */
  const openQuickMenu = (event: ReactMouseEvent, ownerId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setQuickMenu({ x: event.clientX, y: event.clientY, targetId: ownerId, mode: 'child' })
  }

  /** 图形右键「快捷创建关系」：复用同一浮层，列当前图允许的关系类型。 */
  const openRelationQuickMenu = (event: ReactMouseEvent, sourceId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu(null)
    setQuickMenu({ x: event.clientX, y: event.clientY, targetId: sourceId, mode: 'relation' })
  }

  // 空白处的「新建」一律落到项目根 Package 下，保证模型树始终只有一个根。
  // 数据未就绪时不要打开一个空对话框——那会显示「该父类型不允许再包含子元素」，
  // 把连接故障伪装成元模型规则，用户根本无从判断发生了什么。
  const openCreate = (ownerId: string | null) => {
    if (!containment || !projectRootId) {
      say('模型数据尚未就绪，正在重新连接服务端；也可点顶部横幅的「立即重试」')
      return
    }
    const effective = ownerId ?? projectRootId
    const owner = effective
      ? model.elements.find((element) => element.id === effective)?.name ?? effective
      : t('项目根')
    setCreateDialog({ ownerId: effective, ownerName: owner })
    setCreateType('')
    setCreateQuery('')
    setCreateName('')
    setCreateStereotype('')
    setJoinDiagram(true)
    setMenu(null)
  }

  const openDiagramDialog = (ownerId: string | null, edit?: Diagram) => {
    if (!projectRootId) {
      say('模型数据尚未就绪，正在重新连接服务端；也可点顶部横幅的「立即重试」')
      return
    }
    // 编辑既有图时保持原宿主；新建图时宿主必须是命名空间/分类器，
    // 选中构造型/元类时回退到项目根，避免图与后续元素挂到元模型元素下。
    const effective = edit
      ? (edit.ownerId ?? projectRootId)
      : (namespaceHostId(ownerId) ?? projectRootId)
    const owner = effective
      ? model.elements.find((element) => element.id === effective)?.name ?? effective
      : t('项目根')
    setDiagramDialog({
      ownerId: effective,
      ownerName: owner,
      kind: edit?.customTypeId ?? edit?.kind ?? allSpecs[0]?.code ?? 'bdd',
      name: edit?.name ?? t('新建图 {count}', { count: model.diagrams.length + 1 }),
      editId: edit?.id ?? null,
    })
    setNewGraphGroup('all')
    setNewGraphQuery('')
    setMenu(null)
  }

  const submitCreate = async () => {
    if (!createDialog || !createType || !createName.trim()) {
      say('请填写元素名称并选择类型')
      return
    }
    const info = typeInfo.get(createType)
    const id = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const payload: Record<string, unknown> = {
      id,
      type: info?.uml ?? createType,
      name: createName.trim(),
      ownerId: createDialog.ownerId ?? '',
      stereotypes: createStereotype.trim() ? [createStereotype.trim()] : [],
    }
    if (joinDiagram && canJoinDiagram && activeDiagramId) {
      payload.diagramId = activeDiagramId
    }
    const ok = await runCommand('CREATE_ELEMENT', payload)
    if (ok) {
      setSelectedId(id)
      setCreateDialog(null)
    }
  }

  /** 表格工具栏的快捷新建：与对话框走同一条 CREATE_ELEMENT 命令，只是省去选择弹窗。 */
  const createTableElement = async (kind: 'requirement' | 'generic', ownerId: string, typeCode?: string) => {
    const rule = containment?.rules.find((item) => item.parent.toLowerCase() === 'package')
    const candidates = rule?.children ?? containment?.types ?? []
    const code = typeCode
      ?? (kind === 'requirement'
        ? candidates.find((item) => item.code === 'requirement')?.code
          ?? candidates.find((item) => /requirement/i.test(item.code))?.code
        : candidates.find((item) => item.code === 'Block')?.code)
      ?? candidates[0]?.code
    if (!code) {
      say('元模型规则尚未加载，无法新建元素')
      return
    }
    const info = typeInfo.get(code)
    const label = info ? pick(info.label, info.labelEn) : code
    const id = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const ok = await runCommand('CREATE_ELEMENT', {
      id,
      type: info?.uml ?? code,
      name: t('新建{label} {count}', { label, count: model.elements.length + 1 }),
      ownerId: ownerId || projectRootId || '',
      stereotypes: info?.stereotype ? [info.stereotype] : [],
    })
    if (ok) {
      selectOnTree({ kind: 'element', id })
    }
  }

  /**
   * 华望式「+」：以选中图形为宿主直接建子元素，并落到当前图其右侧。
   * 与工具箱拖放走同一条 CREATE_ELEMENT 命令，坐标一条下发，不补 MOVE_NOTATION。
   */
  const createQuickChild = async (typeCode: string) => {
    if (!quickMenu || quickMenu.mode !== 'child' || elementCreatingRef.current) {
      return
    }
    const ownerId = quickMenu.targetId
    const ownerName = elementById.get(ownerId)?.name ?? ownerId
    setQuickMenu(null)
    const info = typeInfo.get(typeCode)
    if (!info) {
      say('元素类型尚未加载，请稍后重试')
      return
    }
    if (namespaceHostId(ownerId) !== ownerId) {
      say('「{name}」不是命名空间元素，不能包含子元素', { name: ownerName })
      return
    }
    elementCreatingRef.current = true
    try {
      const ownerPos = positions.find((entry) => entry.element.id === ownerId)
      const size = nodeSizeFor(typeCode)
      const x = Math.round(clamp((ownerPos?.x ?? 40) + (ownerPos?.w ?? 160) + 36, 0, canvas.maxX))
      const y = Math.round(clamp((ownerPos?.y ?? 40) + Math.max(0, ((ownerPos?.h ?? 80) - size.height) / 2), 0, canvas.maxY))
      const label = pick(info.label, info.labelEn) ?? typeCode
      const id = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const ok = await runCommand('CREATE_ELEMENT', {
        id,
        type: info.uml ?? typeCode,
        name: t('新建{label} {count}', { label, count: model.elements.length + 1 }),
        ownerId,
        stereotypes: info.stereotype ? [info.stereotype] : [],
        ...(activeDiagramId ? { diagramId: activeDiagramId, x, y } : {}),
      })
      if (ok) {
        selectOnTree({ kind: 'element', id })
        say('已在「{owner}」下新建「{label}」', { owner: ownerName, label })
      }
    } finally {
      elementCreatingRef.current = false
    }
  }

  const submitDiagram = async () => {
    if (!diagramDialog || !diagramDialog.kind || !diagramDialog.name.trim()) {
      say('请填写图名称并选择类型')
      return
    }
    if (diagramDialog.editId) {
      const ok = await runCommand('RENAME_DIAGRAM', {
        id: diagramDialog.editId,
        name: diagramDialog.name.trim(),
      })
      if (ok) {
        setDiagramDialog(null)
      }
      return
    }
    const id = `dg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    // 选中的 spec 可能是用户自定义图类型：真正落到 Diagram 的是基底 kind + customTypeId。
    const chosen = allSpecs.find((spec) => spec.code === diagramDialog.kind)
    const custom = customization?.diagramTypes.find((item) => item.id === diagramDialog.kind)
    const baseKind = custom?.baseKind ?? chosen?.code ?? diagramDialog.kind
    const safeOwner = namespaceHostId(diagramDialog.ownerId ?? '') ?? projectRootId ?? ''
    const hostOwnerId = await ensureDiagramHost(baseKind, safeOwner)
    if (hostOwnerId === null) {
      return
    }
    const payload: Record<string, unknown> = {
      id,
      kind: baseKind,
      name: diagramDialog.name.trim(),
      ownerId: hostOwnerId,
      elementIds: [],
    }
    if (custom) {
      payload.customTypeId = custom.id
    }
    const ok = await runCommand('CREATE_DIAGRAM', payload)
    if (ok) {
      setActiveDiagramId(id)
      setSelectedDiagramId(id)
      setDiagramDialog(null)
    }
  }

  /**
   * 序列图的宿主是 Interaction：元模型的容器规则里生命线、片段、发生规格只能挂在交互（或片段）之下，
   * 图直接建在包下时工具箱建生命线必然被拒。建图时补上交互宿主（结构与示例模型 seq 图 owner=交互 一致），
   * 已有宿主就复用，不重复造空交互。返回 null 表示宿主创建失败，调用方不要再往下建图。
   */
  const ensureDiagramHost = async (kind: string, ownerId: string): Promise<string | null> => {
    if (kind !== 'seq') {
      return ownerId
    }
    const owner = model.elements.find((element) => element.id === ownerId)
    if (owner && codeOf(owner.type) === 'Interaction') {
      return ownerId
    }
    const existing = model.elements.find((element) =>
      codeOf(element.type) === 'Interaction' && (element.ownerId ?? projectRootId) === (ownerId || projectRootId))
    if (existing) {
      return existing.id
    }
    const info = typeInfo.get('Interaction')
    const id = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const ok = await runCommand('CREATE_ELEMENT', {
      id,
      type: info?.uml ?? 'Interaction',
      name: t('交互 {count}', { count: model.elements.filter((element) => codeOf(element.type) === 'Interaction').length + 1 }),
      ownerId: ownerId || projectRootId || '',
      documentation: '',
      stereotypes: [],
    })
    return ok ? id : null
  }

  /**
   * 序列图的消息不只是「一条线」：它在时间轴上的位置是模型数据（messageOrder），
   * 所以新建时就把序号一起落库（落最后），而不是靠关系数组的先后顺序碰巧对。
   */
  const relationPayload = (id: string, type: string, sourceId: string, targetId: string) => {
    const payload: Record<string, unknown> = { id, type, sourceId, targetId, diagramId: activeDiagramId }
    if (type.toLowerCase() === 'message') {
      // 消息种类工具预设的 messageSort 随关系一次落库，不必再进属性面板改枚举。
      const tool = seqMessageToolOf(seqMessageTool)
      payload.properties = {
        messageOrder: nextMessageOrder(seqLayout?.messages ?? []),
        ...(tool ? { messageSort: tool.sort } : {}),
      }
    }
    return payload
  }

  const submitRelation = async () => {
    if (!relationDialog || !relationDialog.sourceId || !relationDialog.targetId) {
      say('请选择关系的两端元素')
      return
    }
    const id = `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const ok = await runCommand('CREATE_RELATIONSHIP',
      relationPayload(id, relationDialog.type, relationDialog.sourceId, relationDialog.targetId))
    if (ok) {
      setRelationDialog(null)
    }
  }

  const submitDelete = async () => {
    if (!deleteDialog) {
      return
    }
    const ids = deleteDialog.ids && deleteDialog.ids.length > 0 ? deleteDialog.ids : [deleteDialog.elementId]
    const removedIds = new Set(ids.flatMap((id) => [id, ...descendants(id)]))
    const ok = ids.length > 1
      ? await runCommand('DELETE_ELEMENTS', { ids })
      : await runCommand('DELETE_ELEMENT', { id: ids[0] })
    if (ok) {
      if (selectedId && removedIds.has(selectedId)) {
        setSelectedId(null)
      }
      setSelectedIds((previous) => new Set([...previous].filter((id) => !removedIds.has(id))))
    }
    setDeleteDialog(null)
  }

  const submitDeleteDiagram = async (diagramId: string) => {
    const ok = await runCommand('DELETE_DIAGRAM', { id: diagramId })
    if (ok && selectedDiagramId === diagramId) {
      setSelectedDiagramId(null)
    }
  }

  const handleRenameDiagram = (diagramId: string, name: string) => {
    if (!name.trim()) {
      return
    }
    void runCommand('RENAME_DIAGRAM', { id: diagramId, name: name.trim() })
  }

  const handleUndo = useCallback(async () => {
    // 撤销必须与命令串行：它走的是另一个端点，若插在两条命令中间到达服务端，
    // 撤销的就不是用户以为的那一步。
    await enqueueWrite(async () => {
      try {
        const baseRevision = revisionRef.current
        const patch = await undo()
        revisionRef.current = patch.revision
        say('已撤销至 rev {revision}', { revision: patch.revision })
        await applyLocalPatch(patch, baseRevision)
      } catch (error) {
        say('撤销失败：{error}', { error: errorMessage(error) })
      }
    })
  }, [applyLocalPatch, enqueueWrite])

  const handleRedo = useCallback(async () => {
    await enqueueWrite(async () => {
      try {
        const baseRevision = revisionRef.current
        const patch = await redo()
        revisionRef.current = patch.revision
        say('已重做至 rev {revision}', { revision: patch.revision })
        await applyLocalPatch(patch, baseRevision)
      } catch (error) {
        say('重做失败：{error}', { error: errorMessage(error) })
      }
    })
  }, [applyLocalPatch, enqueueWrite])

  /**
   * 上移 / 下移一条序列图消息：整条时间轴归一化后由一条 SET_MESSAGE_ORDER 写完，
   * 一个 revision、一步撤销。顺序是模型数据（messageOrder），不是画布上的 y。
   */
  const moveMessage = useCallback(async (relationId: string, delta: number) => {
    if (!canEdit) {
      say('当前账号没有编辑模型的权限')
      return
    }
    const items = reorderMessages(seqLayout?.messages ?? [], relationId, delta)
    if (items.length === 0) {
      say('已经到时间轴{direction}了', { direction: delta < 0 ? '首' : '尾' })
      return
    }
    const ok = await runCommand('SET_MESSAGE_ORDER', { items })
    if (ok) {
      const index = items.findIndex((item) => item.id === relationId)
      say('已移到第 {index} 条消息', { index: index + 1 })
    }
  }, [canEdit, seqLayout, runCommand])

  /** 拖动消息线到某一行：与 Alt+↑/↓ 共用 SET_MESSAGE_ORDER，仍是一个 revision 一步撤销。 */
  const moveMessageTo = useCallback(async (relationId: string, targetIndex: number) => {
    if (!canEdit) {
      say('当前账号没有编辑模型的权限')
      return
    }
    const items = reorderMessagesTo(seqLayout?.messages ?? [], relationId, targetIndex)
    if (items.length === 0) {
      return
    }
    const ok = await runCommand('SET_MESSAGE_ORDER', { items })
    if (ok) {
      say('已移到第 {index} 条消息', { index: targetIndex + 1 })
    }
  }, [canEdit, seqLayout, runCommand])

  /* ---------------- 画布多选编辑：复制 / 粘贴 / 对齐 / 微调 ---------------- */

  /** 方向键微调落库：positions 已含偏移量，直接写绝对坐标；刷新完成后再清偏移避免回跳。 */
  const commitNudge = () => {
    if (nudgeTimer.current !== null) {
      window.clearTimeout(nudgeTimer.current)
      nudgeTimer.current = null
    }
    if (!nudge || !activeDiagramId) {
      setNudge(null)
      return
    }
    const items = positions
      .filter((item) => selectionSet.has(item.element.id) && !isBackdropShape(shapeOf(item.element.type)))
      .map((item) => ({
        diagramId: activeDiagramId,
        elementId: item.element.id,
        x: clamp(Math.round(item.x), 0, canvas.maxX),
        y: clamp(Math.round(item.y), 0, canvas.maxY),
        width: item.w,
        height: item.h,
      }))
    if (items.length === 0) {
      setNudge(null)
      return
    }
    void runCommand('SET_NOTATIONS', { items }).then(() => setNudge(null))
  }
  const commitNudgeRef = useRef(commitNudge)
  commitNudgeRef.current = commitNudge
  // 删除 / 重命名声明在组件后段，键盘 effect 的依赖数组在渲染期求值会踩 TDZ，用 ref 转发。
  const deleteSelectionRef = useRef<() => void>(() => {})
  const renameSelectionRef = useRef<() => void>(() => {})
  useEffect(() => () => {
    if (nudgeTimer.current !== null) {
      window.clearTimeout(nudgeTimer.current)
    }
  }, [])
  // 切图时丢弃未提交的框选与微调偏移，避免把上一张图的选择状态带进新画布。
  useEffect(() => {
    setMarquee(null)
    setNudge(null)
    setSelectedIds(new Set())
    if (nudgeTimer.current !== null) {
      window.clearTimeout(nudgeTimer.current)
      nudgeTimer.current = null
    }
  }, [activeDiagramId])

  /** 冻结当前选择为剪贴板快照：含选中元素的后代（深拷贝语义）与两端都在批内的关系。 */
  const buildSnapshot = (): ClipboardSnapshot | null => {
    const onCanvas = positions.filter((item) =>
      selectionSet.has(item.element.id) && !isBackdropShape(shapeOf(item.element.type)))
    if (onCanvas.length === 0) {
      return null
    }
    const full = new Set(onCanvas.map((item) => item.element.id))
    for (const id of [...full]) {
      for (const child of descendants(id)) {
        full.add(child)
      }
    }
    const elements = [...full]
      .map((id) => elementById.get(id))
      .filter((element): element is ModelElement => element !== undefined)
    const relationships = model.relationships.filter((relation) =>
      full.has(relation.sourceId) && full.has(relation.targetId))
    const notations = onCanvas.map((item) => ({ elementId: item.element.id, x: item.x, y: item.y, w: item.w, h: item.h }))
    return { diagramId: activeDiagramId, elements, relationships, notations }
  }

  const copySelection = () => {
    const snapshot = buildSnapshot()
    if (!snapshot) {
      say('请先在画布上选中图形（泳道 / 生命线是垫底形状，不随图形复制）')
      return
    }
    setClipboard(snapshot)
    say('已复制 {count} 个图形 · Ctrl/⌘+V 粘贴为副本', { count: snapshot.notations.length })
  }

  /**
   * 粘贴为副本：一条 PASTE_ELEMENTS 原子落库（元素 + 图归属 + 记法 + 批内关系），一步撤销。
   * 新 id 避开原对象；同命名空间重名自动加「副本 / 副本 2」；引用属性随 id 映射重写；
   * 手动走线 route: 不复制（副本按新位置自动路由）。跨图粘贴只放置当前图允许的类型。
   */
  const pasteFrom = async (snapshot: ClipboardSnapshot) => {
    if (!canEdit) {
      say('当前角色为只读，无法编辑模型')
      return
    }
    if (busy || snapshot.elements.length === 0) {
      return
    }
    const stamp = Date.now().toString(36)
    const idMap = new Map<string, string>()
    snapshot.elements.forEach((element, index) => {
      idMap.set(element.id, `e-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`)
    })
    const remap = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return idMap.get(value) ?? value
      }
      if (Array.isArray(value)) {
        return value.map(remap)
      }
      return value
    }
    const usedNames = new Set(model.elements.map((element) => `${element.ownerId ?? ''}\u0000${element.name}`))
    const suffix = locale === 'zh' ? '副本' : 'copy'
    const rows = snapshot.elements.map((element) => {
      const base = `${element.name} ${suffix}`
      let name = base
      let seq = 2
      while (usedNames.has(`${element.ownerId ?? ''}\u0000${name}`)) {
        name = `${base} ${seq}`
        seq += 1
      }
      usedNames.add(`${element.ownerId ?? ''}\u0000${name}`)
      const properties = Object.fromEntries(
        Object.entries(element.properties ?? {})
          .filter(([key]) => !key.startsWith('route:'))
          .map(([key, value]) => [key, remap(value)]),
      )
      return {
        id: idMap.get(element.id) as string,
        type: element.type,
        name,
        // 后代的所有者也要 remap，否则副本的子块会挂回原件下面。
        ownerId: (remap(element.ownerId) as string | null) ?? '',
        stereotypes: element.stereotypes,
        documentation: element.documentation,
        taggedValues: element.taggedValues,
        properties,
      }
    })
    // 只放置当前图允许的类型；跨图粘贴保留语义，不硬塞不兼容的图形。
    const allowed = activeSpec?.allowedTypes ?? []
    const targetDiagramId = activeDiagramId
    const notations = targetDiagramId
      ? snapshot.notations
        .filter((item) => {
          const element = snapshot.elements.find((candidate) => candidate.id === item.elementId)
          return element ? allowed.includes(codeOf(element.type)) : false
        })
        .map((item) => ({
          elementId: idMap.get(item.elementId) as string,
          x: clamp(Math.round(item.x + 24), 0, canvas.maxX),
          y: clamp(Math.round(item.y + 24), 0, canvas.maxY),
          width: item.w,
          height: item.h,
        }))
      : []
    const relationships = snapshot.relationships
      .filter((relation) => !targetDiagramId || (activeSpec?.allowedRelationships ?? []).includes(relation.type))
      .map((relation, index) => ({
        id: `rel-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        type: relation.type,
        sourceId: idMap.get(relation.sourceId) as string,
        targetId: idMap.get(relation.targetId) as string,
        name: relation.name,
        documentation: relation.documentation,
        stereotypes: relation.stereotypes,
        properties: Object.fromEntries(
          Object.entries(relation.properties ?? {})
            .filter(([key]) => !key.startsWith('route:'))
            .map(([key, value]) => [key, remap(value)]),
        ),
      }))
    const ok = await runCommand('PASTE_ELEMENTS', {
      diagramId: targetDiagramId,
      elements: rows,
      relationships,
      notations,
    })
    if (ok) {
      const newIds = notations.map((item) => item.elementId)
      if (newIds.length > 0) {
        setSelectedIds(new Set(newIds))
        setSelectedId(newIds[0])
        setSelectedRelationId(null)
      }
      say('已粘贴 {count} 个副本{relations}', {
        count: rows.length,
        relations: relationships.length > 0 ? t('（含 {count} 条关系）', { count: relationships.length }) : '',
      })
    }
  }

  const pasteClipboard = () => {
    if (!clipboard) {
      say('剪贴板为空：先选中图形按 Ctrl/⌘+C')
      return
    }
    void pasteFrom(clipboard)
  }

  const duplicateSelection = () => {
    const snapshot = buildSnapshot()
    if (!snapshot) {
      say('请先在画布上选中图形')
      return
    }
    void pasteFrom(snapshot)
  }

  const selectAllInDiagram = () => {
    const ids = positions
      .filter((item) => !isBackdropShape(shapeOf(item.element.type))
        && !(seqLayout?.frame && seqLayout.frame.element.id === item.element.id)
        && !seqFragmentIds.has(item.element.id))
      .map((item) => item.element.id)
    if (ids.length === 0) {
      return
    }
    setSelectedIds(new Set(ids))
    setSelectedId(ids[0])
    setSelectedRelationId(null)
    say('已全选当前图 {count} 个图形', { count: ids.length })
  }

  /** 对齐 / 分布：只动记法坐标，一条 SET_NOTATIONS 一步撤销。分布要求至少 3 个图形。 */
  const alignSelection = (mode: AlignMode) => {
    if (!activeDiagramId || busy) {
      return
    }
    const sel = positions.filter((item) =>
      selectionSet.has(item.element.id) && !isBackdropShape(shapeOf(item.element.type)))
    const minCount = mode === 'distH' || mode === 'distV' ? 3 : 2
    if (sel.length < minCount) {
      return
    }
    const left = Math.min(...sel.map((item) => item.x))
    const right = Math.max(...sel.map((item) => item.x + item.w))
    const top = Math.min(...sel.map((item) => item.y))
    const bottom = Math.max(...sel.map((item) => item.y + item.h))
    const targets = new Map<string, { x: number; y: number }>()
    if (mode === 'left') {
      sel.forEach((item) => targets.set(item.element.id, { x: left, y: item.y }))
    } else if (mode === 'right') {
      sel.forEach((item) => targets.set(item.element.id, { x: right - item.w, y: item.y }))
    } else if (mode === 'top') {
      sel.forEach((item) => targets.set(item.element.id, { x: item.x, y: top }))
    } else if (mode === 'bottom') {
      sel.forEach((item) => targets.set(item.element.id, { x: item.x, y: bottom - item.h }))
    } else if (mode === 'centerH') {
      sel.forEach((item) => targets.set(item.element.id, { x: (left + right) / 2 - item.w / 2, y: item.y }))
    } else if (mode === 'centerV') {
      sel.forEach((item) => targets.set(item.element.id, { x: item.x, y: (top + bottom) / 2 - item.h / 2 }))
    } else if (mode === 'distH') {
      const sorted = [...sel].sort((a, b) => a.x - b.x)
      // 包围盒装不下全部图形时（例如先左对齐再分布）负间距会把图形叠在一起，
      // 此时间距取下限 16，从最左端向右展开。
      const gap = Math.max(16, (right - left - sorted.reduce((sum, item) => sum + item.w, 0)) / (sorted.length - 1))
      let cursor = left
      for (const item of sorted) {
        targets.set(item.element.id, { x: cursor, y: item.y })
        cursor += item.w + gap
      }
    } else {
      const sorted = [...sel].sort((a, b) => a.y - b.y)
      const gap = Math.max(16, (bottom - top - sorted.reduce((sum, item) => sum + item.h, 0)) / (sorted.length - 1))
      let cursor = top
      for (const item of sorted) {
        targets.set(item.element.id, { x: item.x, y: cursor })
        cursor += item.h + gap
      }
    }
    const items = sel.map((item) => {
      const target = targets.get(item.element.id) as { x: number; y: number }
      return {
        diagramId: activeDiagramId,
        elementId: item.element.id,
        x: clamp(Math.round(target.x), 0, canvas.maxX),
        y: clamp(Math.round(target.y), 0, canvas.maxY),
        width: item.w,
        height: item.h,
      }
    })
    void runCommand('SET_NOTATIONS', { items })
    say('已对齐 {count} 个图形', { count: items.length })
  }

  /** 当前选中的可编辑图形数（排除垫底形状）：对齐菜单与浮动工具条的启用依据。 */
  const alignableCount = useMemo(
    () => positions.filter((item) =>
      selectionSet.has(item.element.id) && !isBackdropShape(shapeOf(item.element.type))).length,
    [positions, selectionSet],
  )

  /**
   * 全局快捷键：Ctrl/⌘+Z 撤销、Ctrl/⌘+Shift+Z 或 Ctrl+Y 重做、Esc 退出连线模式。
   * 序列图里 Alt+↑/↓ 调整选中消息的时间槽位置。
   * 输入框 / 文本域 / 下拉框 / 可编辑区不拦截，交给浏览器原生文本撤销；
   * busy 期间与空撤销栈时只给提示，不向服务端发空请求（否则会 500）。
   */
  useEffect(() => {
    const isTextEntry = (target: EventTarget | null): boolean => {
      const node = target instanceof HTMLElement ? target : null
      if (!node) {
        return false
      }
      const tag = node.tagName.toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/⌘+K 全局搜索：在输入框里也生效（覆盖浏览器默认地址栏搜索）。
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.repeat && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (searchOpen) {
          closeSearch()
        } else {
          openSearch()
        }
        return
      }
      if (event.key === 'Escape' && searchOpen) {
        closeSearch()
        return
      }
      if (event.key === 'Escape' && menu) {
        setMenu(null)
        return
      }
      if (event.key === 'Escape' && propDialog) {
        setPropDialog(null)
        setRefPicker(null)
        setRefSearch('')
        return
      }
      if (event.key === 'Escape' && relationTool) {
        setRelationTool(null)
        setRelationSource(null)
        say('已退出连线模式')
        return
      }
      if (event.key === 'Escape') {
        if (marquee) {
          setMarquee(null)
          return
        }
        if (selectedIds.size > 1) {
          setSelectedIds(selectedId ? new Set([selectedId]) : new Set())
          return
        }
      }
      // 序列图：Alt + ↑/↓ 改选中消息的时间槽位置（只对 message 关系生效）。
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat
        && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        && selectedRelationId && !isTextEntry(event.target)) {
        event.preventDefault()
        if (selectedRelationId.startsWith('virtual:')) {
          say('这条消息由导入的 Message 元素补全，没有对应关系，不能改顺序')
        } else {
          void moveMessage(selectedRelationId, event.key === 'ArrowUp' ? -1 : 1)
        }
        return
      }
      // 无 Ctrl/⌘/Alt 的编辑键：Del 删除、F2 重命名、方向键微调（Shift 步长 ×10）。
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !isTextEntry(event.target)) {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (canEdit && (selected || selectedDiagram || selectedRelation || selectionSet.size > 0)) {
            event.preventDefault()
            deleteSelectionRef.current()
          }
          return
        }
        if (event.key === 'F2') {
          event.preventDefault()
          renameSelectionRef.current()
          return
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const movable = canEdit && !busy && activeDiagramId
            && positions.some((item) => selectionSet.has(item.element.id) && !isBackdropShape(shapeOf(item.element.type)))
          if (!movable) {
            return
          }
          event.preventDefault()
          const step = event.shiftKey ? 10 : 1
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
          setNudge((previous) => ({ dx: (previous?.dx ?? 0) + dx, dy: (previous?.dy ?? 0) + dy }))
          if (nudgeTimer.current !== null) {
            window.clearTimeout(nudgeTimer.current)
          }
          // 连按只累积偏移，停顿后一条命令落库：一次微调 bursts 一步撤销，不刷几十条 revision。
          nudgeTimer.current = window.setTimeout(() => commitNudgeRef.current(), 350)
          return
        }
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat || isTextEntry(event.target)) {
        return
      }
      const key = event.key.toLowerCase()
      const wantsUndo = key === 'z' && !event.shiftKey
      const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey)
      if (wantsUndo || wantsRedo) {
        event.preventDefault()
        if (busy) {
          return
        }
        if (wantsUndo) {
          if ((health?.undoDepth ?? 0) === 0) {
            say('没有可撤销的操作 · Ctrl/⌘ + Z')
          } else {
            void handleUndo()
          }
        } else if ((health?.redoDepth ?? 0) === 0) {
          say('没有可重做的操作 · Ctrl/⌘ + Shift + Z 或 Ctrl + Y')
        } else {
          void handleRedo()
        }
        return
      }
      if (key === 'c') {
        event.preventDefault()
        copySelection()
      } else if (key === 'v') {
        event.preventDefault()
        pasteClipboard()
      } else if (key === 'd') {
        event.preventDefault()
        duplicateSelection()
      } else if (key === 'a') {
        event.preventDefault()
        selectAllInDiagram()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo, relationTool, busy, health, menu, propDialog, moveMessage, selectedRelationId,
    marquee, selectedIds, selectedId, selectionSet, canEdit, selected, selectedDiagram, selectedRelation,
    activeDiagramId, positions, copySelection, pasteClipboard,
    duplicateSelection, selectAllInDiagram, searchOpen, openSearch, closeSearch])

  const addToCurrentDiagram = async (elementId: string) => {
    if (!activeDiagramId) {
      return
    }
    await runCommand('ADD_TO_DIAGRAM', { diagramId: activeDiagramId, elementId })
    setMenu(null)
  }

  /**
   * 把模型树展开到目标对象并滚动到可视区，但不改变当前选中与提示。
   *
   * <p>三类对象的行 identity 不同，祖先链也各异：
   * 元素按 ownerId 逐级上溯（含图节点：元素也可能只出现在某张图的节点列表里）；
   * 图按宿主元素的 ownerId 上溯；关系挂在源/目标元素下的虚拟「关系」分组里，
   * 要把两端元素的祖先链都展开，并把关系分组从折叠集合中移除。
   * 画布点选时用它做静默跟随定位。</p>
   */
  const revealInTree = (targetId: string, kind: RevealKind = 'element') => {
    // 定位即让模型树可见：搜索 / 引用面板可能在「图表」「模型库」页触发，
    // 不切回「项目」页的话目标行根本不在 DOM 里，高亮与滚动都会落空。
    setLeftTab('project')
    const chain: string[] = []
    if (kind === 'relation') {
      const relation = relationById.get(targetId)
      if (relation) {
        for (const ownerId of [relation.sourceId, relation.targetId]) {
          // 关系分组挂在端点元素下：端点行本身就是折叠态时，只展开祖先链还不够，
          // 分组里的关系行根本不会渲染。把两端元素一并展开。
          chain.push(ownerId)
          let cursor = elementById.get(ownerId)
          while (cursor?.ownerId) {
            chain.push(cursor.ownerId)
            cursor = elementById.get(cursor.ownerId)
          }
        }
        // 关系分组默认展开；若之前被手动折叠，定位时打开两端分组。
        setCollapsedRelationGroups((previous) => {
          if (!previous.has(relationGroupId(relation.sourceId)) && !previous.has(relationGroupId(relation.targetId))) {
            return previous
          }
          const next = new Set(previous)
          next.delete(relationGroupId(relation.sourceId))
          next.delete(relationGroupId(relation.targetId))
          return next
        })
      }
    } else if (kind === 'diagram') {
      const diagram = diagramById.get(targetId)
      let cursor = diagram?.ownerId ? elementById.get(diagram.ownerId) : undefined
      while (cursor) {
        chain.push(cursor.id)
        cursor = cursor.ownerId ? elementById.get(cursor.ownerId) : undefined
      }
    } else if (extensionElementById.has(targetId)) {
      // 扩展包元素（SysML / UML 元模型）：展开扩展分组与扩展内的祖先链，
      // 否则搜索结果只能定位到一个不存在的项目树行。
      setShowExtensions(true)
      chain.push(EXTENSION_GROUP_ID)
      let cursor: ModelElement | undefined = extensionElementById.get(targetId)
      while (cursor?.ownerId) {
        chain.push(cursor.ownerId)
        cursor = extensionElementById.get(cursor.ownerId)
      }
    } else {
      let cursor = elementById.get(targetId)
      while (cursor?.ownerId) {
        chain.push(cursor.ownerId)
        cursor = elementById.get(cursor.ownerId)
      }
      // 元素可能只挂在图节点下：展开所有引用了它的图。
      for (const diagram of model.diagrams) {
        if (diagram.elementIds.includes(targetId)) {
          chain.push(diagram.id)
        }
      }
    }
    setExpanded((previous) => {
      const next = new Set(previous)
      for (const id of chain) {
        next.add(id)
      }
      return next
    })
    // 展开是异步渲染，等一帧再滚动，避免目标行尚未挂载。
    window.setTimeout(() => {
      const browser = browserRef.current
      const rows = visibleRowsRef.current
      // 虚拟化模式下目标行可能根本没挂载：行高统一，直接按行号算 scrollTop，
      // 滚动事件会把窗口移到目标附近，行随之渲染出来。
      if (browser && rows.length > TREE_VIRTUAL_THRESHOLD) {
        const index = rows.findIndex((row) => row.id === targetId && row.kind !== 'relationGroup')
        if (index >= 0) {
          browser.scrollTop = Math.max(0, 14 + index * TREE_ROW_H - (browser.clientHeight - TREE_ROW_H) / 2)
          return
        }
      }
      const selector = kind === 'relation'
        ? `[data-relation-id="${CSS.escape(targetId)}"]`
        : `[data-tree-id="${CSS.escape(targetId)}"]`
      document.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
  }

  /**
   * 华望式「树上高亮」统一入口（对标 SelectOnTreeAction）：
   * 切项目页 → 展开祖先 → 滚动居中 → 设为持久选中态。
   *
   * <p>高亮即树的选中态：element / diagram / relation 三态互斥，一直保持到用户
   * 点选别的节点，不再像旧实现那样 2.4 秒后消失。引用型属性、画布、属性面板、
   * 关系行都走这一个入口，行为与华望一致。</p>
   */
  const selectOnTree = ({ kind, id }: ModelReference) => {
    // 持久选中：三态互斥，保证属性面板与树高亮指向同一对象。
    if (kind === 'diagram') {
      setSelectedDiagramId(id)
      setSelectedId(null)
      setSelectedRelationId(null)
    } else if (kind === 'relation') {
      setSelectedRelationId(id)
      setSelectedId(null)
      setSelectedDiagramId(null)
    } else {
      setSelectedId(id)
      setSelectedDiagramId(null)
      setSelectedRelationId(null)
    }
    setTreeFilter('')
    revealInTree(id, kind)
    say('已在模型树中定位「{name}」', { name: referenceDetails({ kind, id }, 14)?.name ?? id })
  }

  /** 兼容旧调用点（属性面板引用 / 画布点选）：按元素树上高亮。 */
  const locateInTree = (elementId: string) => selectOnTree({ kind: 'element', id: elementId })

  /**
   * 模型树拖放：把已有元素拖到「图」节点上 → 真正加入该图并生成记法。
   * 语义同画布拖放（图只是视图，不拥有元素），落点按该图已有记法数量自动排布。
   */
  const addElementToDiagram = async (diagramId: string, elementId: string) => {
    const diagram = model.diagrams.find((item) => item.id === diagramId)
    const element = model.elements.find((item) => item.id === elementId)
    if (!diagram || !element) {
      return
    }
    if (diagram.elementIds.includes(elementId)) {
      setActiveDiagramId(diagramId)
      setSelectedId(elementId)
      say('「{element}」已在「{diagram}」中，已切换到该图', { element: element.name, diagram: diagram.name })
      return
    }
    const placed = model.notations.filter((notation) => notation.diagramId === diagramId).length
    const x = Math.round(clamp(36 + (placed % 3) * 196, 0, canvas.maxX))
    const y = Math.round(clamp(36 + Math.floor(placed / 3) * 128, 0, canvas.maxY))
    const ok = await runCommand('ADD_TO_DIAGRAM', { diagramId, elementId, x, y })
    if (ok) {
      setActiveDiagramId(diagramId)
      setSelectedId(elementId)
      setSelectedDiagramId(null)
      setExpanded((previous) => new Set(previous).add(diagramId))
      say('已把「{element}」加入「{diagram}」并落在 ({x}, {y})', { element: element.name, diagram: diagram.name, x, y })
    }
  }

  const locateInDiagram = (elementId: string) => {    const diagram = model.diagrams.find((item) => item.elementIds.includes(elementId))
    if (diagram) {
      setActiveDiagramId(diagram.id)
      setSelectedId(elementId)
      say('已定位到「{diagram}」', { diagram: diagram.name })
    } else {
      say('该元素尚未加入任何图，可用右键「加入当前图」')
    }
    setMenu(null)
  }

  /**
   * 搜索 / 引用面板的跳转：打开元素所在的图并把视口中心对准它的记法。
   * 优先留在当前图（元素就在当前图时不切图），否则取第一张包含它的图。
   * 主选中走 selectedId（selectionSet 会自动回退成单选），切图清多选的
   * 副作用不会把刚定位的对象冲掉。
   */
  const focusElementInDiagram = (elementId: string, diagramId?: string) => {
    const diagram = diagramId
      ? model.diagrams.find((item) => item.id === diagramId)
      : (activeDiagramId && model.diagrams.find((item) => item.id === activeDiagramId && item.elementIds.includes(elementId)))
        ?? model.diagrams.find((item) => item.elementIds.includes(elementId))
    setSelectedId(elementId)
    setSelectedDiagramId(null)
    setSelectedRelationId(null)
    revealInTree(elementId)
    if (!diagram) {
      return
    }
    setActiveViewId('')
    setActiveDiagramId(diagram.id)
    openTab({ kind: 'diagram', id: diagram.id })
    const notation = model.notations.find((item) => item.diagramId === diagram.id && item.elementId === elementId)
    if (notation) {
      openedDiagrams.current.add(`${activeProjectId}/${diagram.id}`)
      setPan({
        x: notation.x + notation.width / 2 - viewportWidth / (2 * zoom),
        y: notation.y + notation.height / 2 - viewportHeight / (2 * zoom),
      })
    }
  }

  const diagramForReference = ({ kind, id }: ModelReference): Diagram | undefined => {
    if (kind === 'diagram') return diagramById.get(id)
    const relation = kind === 'relation' ? relationById.get(id) : undefined
    if (kind === 'relation' && !relation) return undefined
    const contains = (diagram: Diagram) => relation
      ? diagram.elementIds.includes(relation.sourceId) && diagram.elementIds.includes(relation.targetId)
      : diagram.elementIds.includes(id)
    const current = activeDiagramId ? diagramById.get(activeDiagramId) : undefined
    return current && contains(current) ? current : model.diagrams.find(contains)
  }

  const focusReferenceInDiagram = (reference: ModelReference, diagram: Diagram) => {
    if (reference.kind === 'element') {
      focusElementInDiagram(reference.id, diagram.id)
      return
    }
    setActiveViewId('')
    setActiveDiagramId(diagram.id)
    openTab({ kind: 'diagram', id: diagram.id })
    selectOnTree(reference)
    if (reference.kind === 'relation') {
      const relation = relationById.get(reference.id)
      if (!relation) return
      const route = readRoute(relation.properties, diagram.id)
      const centers = model.notations.filter((item) => item.diagramId === diagram.id
        && (item.elementId === relation.sourceId || item.elementId === relation.targetId))
        .map((item) => ({ x: item.x + item.width / 2, y: item.y + item.height / 2 }))
      const points = route?.length ? route : centers
      if (points.length === 0) return
      const center = routeMidpoint(points)
      openedDiagrams.current.add(`${activeProjectId}/${diagram.id}`)
      setPan({ x: center.x - viewportWidth / (2 * zoom), y: center.y - viewportHeight / (2 * zoom) })
    }
  }

  /** 搜索面板回车 / 点击：按命中类型跳转，随后关闭面板。 */
  const activateSearchResult = (result: SearchResult) => {
    closeSearch()
    if (result.kind === 'element') {
      focusElementInDiagram(result.id)
      say('已定位到「{name}」', { name: result.name })
      return
    }
    if (result.kind === 'diagram') {
      activateTreeDiagram(result.id, true)
      say('已打开图「{name}」', { name: result.name })
      return
    }
    const relation = model.relationships.find((item) => item.id === result.id)
    if (!relation) {
      return
    }
    setSelectedRelationId(relation.id)
    setSelectedId(null)
    setSelectedDiagramId(null)
    const diagram = (activeDiagramId
      && model.diagrams.find((item) => item.id === activeDiagramId
        && item.elementIds.includes(relation.sourceId) && item.elementIds.includes(relation.targetId)))
      ?? model.diagrams.find((item) => item.elementIds.includes(relation.sourceId) && item.elementIds.includes(relation.targetId))
    if (diagram) {
      setActiveDiagramId(diagram.id)
      openTab({ kind: 'diagram', id: diagram.id })
    }
    say('已选中关系「{name}」', { name: result.name })
  }

  /* ── B3 校验与追溯：底部坞（问题面板 / 需求覆盖矩阵），数据全部来自服务端 /api/validation ── */

  /** 打开底部坞并立即拉一次权威校验报告（不等 debounce）。 */
  const openBottomDock = useCallback((tab: 'problems' | 'coverage') => {
    setBottomDockTab(tab)
    setBottomDockOpen(true)
    void loadValidation()
  }, [loadValidation])

  /** 点击一条校验问题：元素→选中并在图中定位；图→打开该图。 */
  const locateProblem = (issue: ValidationIssue) => {
    if (issue.targetType === 'diagram') {
      activateTreeDiagram(issue.targetId, true)
      say('已打开图「{name}」', { name: issue.targetName })
      return
    }
    focusElementInDiagram(issue.targetId)
    say('已定位到「{name}」', { name: issue.targetName })
  }

  /** 点击覆盖矩阵里的来源元素 / 需求名：选中并在图中定位。 */
  const locateCoverageRef = (refId: string, refName: string) => {
    focusElementInDiagram(refId)
    say('已定位到「{name}」', { name: refName })
  }

  const validationCounts = validationReport?.counts ?? { error: 0, warning: 0, info: 0 }
  const totalProblems = validationCounts.error + validationCounts.warning + validationCounts.info

  const filteredProblems = useMemo(() => {
    const rank = { error: 0, warning: 1, info: 2 } as const
    const issues = [...(validationReport?.issues ?? [])]
    issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.targetName.localeCompare(b.targetName))
    return problemFilter === 'all' ? issues : issues.filter((issue) => issue.severity === problemFilter)
  }, [validationReport, problemFilter])

  const filteredCoverage = useMemo(() => {
    const coverage = validationReport?.coverage ?? []
    switch (coverageFilter) {
      case 'unsatisfied': return coverage.filter((item) => !item.satisfied)
      case 'unverified': return coverage.filter((item) => !item.verified)
      case 'uncovered': return coverage.filter((item) => !item.satisfied || !item.verified)
      default: return coverage
    }
  }, [validationReport, coverageFilter])

  const coverageSummary = validationReport?.coverageSummary ?? { total: 0, satisfied: 0, verified: 0, fullyCovered: 0 }

  /**
   * 导出用的独立 SVG：还原整图画布、铺白底、把运行时 CSS 计算样式内联到每个节点
   * （节点文字 / 连线标签的字体与颜色来自 styles.css，脱离页面会丢样式），
   * 并剔除选择圈 / 拖拽手柄 / 框选等纯交互图元（data-export="omit"）。
   */
  const buildExportSvg = (): SVGSVGElement | null => {
    const svg = svgRef.current
    if (!svg) {
      return null
    }
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    // 导出的是整张图，不是当前视口：缩放平移后的 viewBox 必须还原成完整内容。
    // 名义画布只有 640×420，自动排布后的图面远超它，按内容包围盒取导出区域才不会裁切。
    const pad = 32
    // 选中环 / 拖拽手柄等标记不参与包围盒：先临时隐藏再量，导出区域才不受选择状态影响。
    const omitted = Array.from(svg.querySelectorAll('[data-export="omit"]')) as SVGElement[]
    const savedDisplay = omitted.map((node) => node.style.display)
    omitted.forEach((node) => { node.style.display = 'none' })
    const liveBox = svg.getBBox()
    omitted.forEach((node, index) => { node.style.display = savedDisplay[index] })
    const box = liveBox.width > 0 && liveBox.height > 0
      ? {
        x: Math.floor(liveBox.x - pad),
        y: Math.floor(liveBox.y - pad),
        w: Math.ceil(liveBox.width + pad * 2),
        h: Math.ceil(liveBox.height + pad * 2),
      }
      : { x: 0, y: 0, w: canvas.width, h: canvas.height }
    clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`)
    clone.setAttribute('width', String(box.w))
    clone.setAttribute('height', String(box.h))
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(box.x))
    rect.setAttribute('y', String(box.y))
    rect.setAttribute('width', String(box.w))
    rect.setAttribute('height', String(box.h))
    rect.setAttribute('fill', '#ffffff')
    const styleProps = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
      'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family',
      'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'paint-order']
    const inlineStyles = (live: Element, copy: Element) => {
      if (copy.getAttribute('data-export') === 'omit') {
        copy.remove()
        return
      }
      const computed = window.getComputedStyle(live)
      let css = ''
      for (const prop of styleProps) {
        const value = computed.getPropertyValue(prop)
        if (value) {
          css += `${prop}:${value};`
        }
      }
      copy.setAttribute('style', css)
      const liveChildren = Array.from(live.children)
      const copyChildren = Array.from(copy.children)
      for (let index = 0; index < liveChildren.length; index += 1) {
        inlineStyles(liveChildren[index], copyChildren[index])
      }
    }
    inlineStyles(svg, clone)
    // 白底必须在样式内联之后插入：内联按父子索引配对，提前插入会整体错位一格。
    clone.insertBefore(rect, clone.firstChild)
    return clone
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportSvg = () => {
    const clone = buildExportSvg()
    if (!clone) {
      return
    }
    const source = new XMLSerializer().serializeToString(clone)
    downloadBlob(new Blob([source], { type: 'image/svg+xml' }), `${activeDiagramObj?.name ?? 'diagram'}.svg`)
  }

  /** PNG 导出：独立 SVG 栅格化到 2× 画布，白底，文字与线型与页面一致。 */
  const exportPng = async () => {
    const clone = buildExportSvg()
    if (!clone) {
      return
    }
    const source = new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('SVG 栅格化失败'))
        image.src = url
      })
      const scale = 2
      const raster = document.createElement('canvas')
      raster.width = Number(clone.getAttribute('width')) * scale
      raster.height = Number(clone.getAttribute('height')) * scale
      const context = raster.getContext('2d')
      if (!context) {
        throw new Error('当前浏览器不支持 Canvas 2D')
      }
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, raster.width, raster.height)
      context.drawImage(image, 0, 0, raster.width, raster.height)
      const blob = await new Promise<Blob | null>((resolve) => raster.toBlob(resolve, 'image/png'))
      if (!blob) {
        throw new Error('PNG 编码失败')
      }
      downloadBlob(blob, `${activeDiagramObj?.name ?? 'diagram'}.png`)
      say('已导出 PNG（{width}×{height}）', { width: raster.width, height: raster.height })
    } catch (error) {
      say('导出 PNG 失败：{error}', { error: errorMessage(error) })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  /* ---------------- B4 模型交付报告 ---------------- */

  /**
   * 打开报告：先拉一次服务端权威校验 / 覆盖（保证交付数据最新），再用当前快照装配
   * 自包含 HTML。校验接口失败不阻断——退回已有缓存继续生成，并在 overlay 上提示。
   */
  const openReport = async () => {
    setReportOpen(true)
    setReportHtml('')
    setReportError(null)
    let validation = validationReport
    try {
      validation = await getValidation()
      setValidationReport(validation)
    } catch (error) {
      if (!validation) setReportError(errorMessage(error))
    }
    try {
      const html = buildModelReportHtml({
        projectName: workspace?.currentProjectName ?? projectRoot?.name ?? t('未命名项目'),
        model: modelRef.current,
        elements: projectElements,
        validation,
        labels: { type: typeLabel, diagram: diagramLabel, relation: relationLabel },
        generatedAt: new Date(),
        persistence: health?.persistence,
      })
      setReportHtml(html)
    } catch (error) {
      setReportError(errorMessage(error))
    }
  }

  const closeReport = useCallback(() => setReportOpen(false), [])

  const exportReportHtml = () => {
    if (!reportHtml) return
    const name = workspace?.currentProjectName ?? projectRoot?.name ?? 'model'
    downloadBlob(new Blob([reportHtml], { type: 'text/html;charset=utf-8' }), `${name}-${t('模型报告')}.html`)
    say('已导出模型报告 HTML')
  }

  const printReport = () => {
    const frame = reportFrameRef.current
    if (!frame?.contentWindow) {
      say('报告尚未就绪')
      return
    }
    frame.contentWindow.focus()
    frame.contentWindow.print()
  }

  // Esc 关闭报告 overlay（与全局搜索一致的退出方式）。
  useEffect(() => {
    if (!reportOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeReport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reportOpen, closeReport])

  /** 从最新快照读某对象（元素或关系）的标签值：供键值编辑器构造下一张表，避免过期闭包。 */
  const readLatestTagged = (id: string): Record<string, string> => {
    const snapshot = modelRef.current
    const element = snapshot.elements.find((item) => item.id === id)
    if (element) return element.taggedValues ?? {}
    const relation = snapshot.relationships.find((item) => item.id === id)
    return relation?.taggedValues ?? {}
  }

  /** 整张标签值表一次落库：UPDATE_PROPERTY key=taggedValues，一次命令一步撤销。
   *  返回命令 Promise，供编辑器把连续编辑串成链——后一次提交等前一次落库后再读最新快照，
   *  避免快速「失焦改值→点删除」时两条命令共用同一 baseRevision 而第二条 409 丢失。 */
  const commitTaggedValues = (id: string, next: Record<string, string>) =>
    runCommand('UPDATE_PROPERTY', { id, key: 'taggedValues', value: next })

  /* ---------------- XMI 导入导出 ---------------- */

  /** 导出：把服务端生成的交换文件取回本地。 */
  const runExport = async (kind: 'xmi' | 'sidecar' | 'native') => {
    beginBusy()
    try {
      if (kind === 'xmi') {
        await exportXmi()
        say('已导出 XMI 语义文件 model.xmi')
      } else if (kind === 'sidecar') {
        await exportSidecar()
        say('已导出布局侧车 model.di.json')
      } else {
        await exportNative()
        say('已导出项目快照 model.scofen.json')
      }
    } catch (error) {
      say('导出失败：{error}', { error: errorMessage(error) })
    } finally {
      endBusy()
    }
  }

  const openImportDialog = () => {
    setImportDialog({ semantic: '', semanticName: '', sidecar: '', sidecarName: '' })
    setMenu(null)
  }

  /** 读取用户选择的文件：语义文件与侧车分别读入同一对话框状态。 */
  const pickImportFile = async (target: 'semantic' | 'sidecar', file: File | undefined) => {
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      setImportDialog((current) => {
        if (!current) {
          return current
        }
        return target === 'semantic'
          ? { ...current, semantic: text, semanticName: file.name }
          : { ...current, sidecar: text, sidecarName: file.name }
      })
    } catch (error) {
      say('读取文件失败：{error}', { error: errorMessage(error) })
    }
  }

  /**
   * 提交导入。
   *
   * <p>导入语义是「整包替换当前项目」：当前项目的元素、关系、图与记号会被整体换掉
   * （通用扩展包除外，它是每个项目自带的系统公共内容）。撤销一次即可回到导入前。</p>
   */
  const submitImport = async () => {
    if (!importDialog || !importDialog.semantic.trim()) {
      say('请先选择 XMI 语义文件')
      return
    }
    // 导入是整包替换模型，必须排在队列里：与并发的命令交错会写坏模型。
    await enqueueWrite(async () => {
      try {
        const patch = await importXmi({
          semantic: importDialog.semantic,
          sidecar: importDialog.sidecar.trim() ? importDialog.sidecar : undefined,
        })
        revisionRef.current = patch.revision
        setImportDialog(null)
        // 整包替换后原来的选中项、标签与树展开状态多半已失效，全部复位。
        setSelectedId(null)
        setSelectedDiagramId(null)
        setSelectedRelationId(null)
        setRelationTool(null)
        setRelationSource(null)
        setTabs([])
        setActiveViewId('')
        setExpanded(new Set())
        await refresh()
        say(importDialog.sidecar.trim()
          ? '已导入模型（rev {revision}）· {count} 个对象受影响 · 可撤销'
          : '已导入模型（rev {revision}）· {count} 个对象受影响 · 未提供布局侧车，规范图由服务端重排',
        { revision: patch.revision, count: patch.affectedIds.length })
      } catch (error) {
        say('导入失败：{error}', { error: errorMessage(error) })
      }
    })
  }

  const toSvgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) {
      return { x: 0, y: 0 }
    }
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const matrix = svg.getScreenCTM()
    if (!matrix) {
      return { x: 0, y: 0 }
    }
    const transformed = point.matrixTransform(matrix.inverse())
    return { x: transformed.x, y: transformed.y }
  }

  const handlePointerDown = (
    event: ReactPointerEvent<SVGGElement>,
    element: ModelElement,
    x: number,
    y: number,
  ) => {
    event.preventDefault()
    // 连线模式下节点点击不再进入拖拽，而是依次作为关系的起点 / 终点。
    if (relationTool) {
      event.stopPropagation()
      setSelectedId(element.id)
      setSelectedDiagramId(null)
      void handleRelationPick(element.id)
      return
    }
    // Shift/Ctrl/⌘+点选：切换多选成员，不起拖拽；阻止冒泡免得画布把 Shift 当平移。
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.stopPropagation()
      const next = new Set(selectionSet)
      if (next.has(element.id)) {
        next.delete(element.id)
      } else {
        next.add(element.id)
      }
      setSelectedIds(next)
      const remaining = [...next]
      setSelectedId(next.has(element.id) ? element.id : remaining[remaining.length - 1] ?? null)
      setSelectedDiagramId(null)
      setSelectedRelationId(null)
      return
    }
    const point = toSvgPoint(event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    // 按住已多选成员：保持整组选择并整体拖动；点普通图形则收敛为单选。
    const groupDrag = selectionSet.size > 1 && selectionSet.has(element.id)
    if (!groupDrag) {
      setSelectedId(element.id)
    }
    setSelectedDiagramId(null)
    setSelectedRelationId(null)
    // 点选画布图形即静默定位到模型树：切到「项目」页让树可见，展开祖先链并高亮该行。
    setLeftTab('project')
    revealInTree(element.id)
    // 未落库的方向键微调并进本次拖拽：起手坐标已含偏移，松手一次写回，避免两条命令竞态。
    if (nudge) {
      if (nudgeTimer.current !== null) {
        window.clearTimeout(nudgeTimer.current)
        nudgeTimer.current = null
      }
      setNudge(null)
    }
    const group = groupDrag
      ? positions
        .filter((item) => selectionSet.has(item.element.id) && item.element.id !== element.id)
        .map((item) => ({ id: item.element.id, originX: item.x, originY: item.y }))
      : undefined
    setDrag({
      elementId: element.id,
      originX: x,
      originY: y,
      startX: point.x,
      startY: point.y,
      x,
      y,
      moved: false,
      group,
    })
  }

  /**
   * 屏幕像素 → 模型单位：getScreenCTM 的 a 分量就是「一个模型单位占多少像素」。
   * 用它换算比拿 viewBox 宽除以面板宽更准——两者宽高比不一致时 SVG 会留白，
   * 按面板宽换算会让拖动距离差一档，缩放越多越明显。
   */
  const pixelsToUnits = useCallback((pixels: number): number => {
    const matrix = svgRef.current?.getScreenCTM()
    return matrix && matrix.a > 0 ? pixels / matrix.a : pixels / zoom
  }, [zoom])

  const viewWidth = viewportWidth / zoom
  const viewHeight = viewportHeight / zoom

  /** 平移落点夹紧：视口始终与内容保留一段可见交集（规则见 clampPanTo）。 */
  const clampPan = useCallback(
    (x: number, y: number, level = zoom) => clampPanTo(
      x,
      y,
      drawingBounds ?? { left: 0, top: 0, right: canvas.maxX, bottom: canvas.maxY },
      viewportWidth / level,
      viewportHeight / level,
    ),
    [drawingBounds, canvas.maxX, canvas.maxY, viewportWidth, viewportHeight, zoom],
  )

  const clampedPan = clampPan(pan.x, pan.y)
  const viewBox = `${clampedPan.x} ${clampedPan.y} ${viewWidth} ${viewHeight}`

  const applyZoom = (next: number) => {
    if (!Number.isFinite(next)) return
    const level = clamp(Number(next.toFixed(3)), ZOOM_MIN, ZOOM_MAX)
    setPan(clampPan(
      clampedPan.x + viewWidth / 2 - viewportWidth / (2 * level),
      clampedPan.y + viewHeight / 2 - viewportHeight / (2 * level),
      level,
    ))
    setZoom(level)
  }

  /**
   * 按屏幕像素量平移视口（滚轮 / 触摸板双指）：deltaY 为正就是「往下滚」，
   * 视口跟着往下移，所以 pan 增大。注意与拖动相反——拖动是内容跟着手指走，
   * 滚动是视口跟着滚动方向走，两条手势的符号本来就不该一样。
   */
  const panByPixels = useCallback((dx: number, dy: number) => {
    const x = pixelsToUnits(dx)
    const y = pixelsToUnits(dy)
    setPan((current) => {
      const actual = clampPan(current.x, current.y)
      return clampPan(actual.x + x, actual.y + y)
    })
  }, [clampPan, pixelsToUnits])

  /** 小地图点击 / 拖动：把视口中心移到落点对应的模型坐标（仍走夹紧）。 */
  const minimapJump = useCallback((clientX: number, clientY: number) => {
    const svg = minimapRef.current
    if (!svg) {
      return
    }
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const matrix = svg.getScreenCTM()
    if (!matrix) {
      return
    }
    const anchor = point.matrixTransform(matrix.inverse())
    setPan(clampPan(anchor.x - viewWidth / 2, anchor.y - viewHeight / 2))
  }, [clampPan, viewWidth, viewHeight])

  /** 小地图取样范围：内容包围盒外扩 20 单位；空图退回名义画布。 */
  const minimapViewBox = (() => {
    const left = (drawingBounds?.left ?? 0) - 20
    const top = (drawingBounds?.top ?? 0) - 20
    const width = (drawingBounds ? drawingBounds.right - drawingBounds.left : viewportWidth) + 40
    const height = (drawingBounds ? drawingBounds.bottom - drawingBounds.top : viewportHeight) + 40
    return `${left} ${top} ${width} ${height}`
  })()

  /** 以光标为锚点缩放：光标下的模型点保持不动，缩放后不会丢掉正在看的目标。 */
  const zoomAtCursor = useCallback((clientX: number, clientY: number, deltaY: number) => {
    const svg = svgRef.current
    if (!svg) {
      return
    }
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const matrix = svg.getScreenCTM()
    if (!matrix) {
      return
    }
    const anchor = point.matrixTransform(matrix.inverse())
    if (deltaY === 0) return
    const next = Number(clamp(zoom * (deltaY < 0 ? 1.12 : 1 / 1.12), ZOOM_MIN, ZOOM_MAX).toFixed(3))
    if (Math.abs(next - zoom) < 0.0001) {
      return
    }
    const ratio = zoom / next
    setPan(clampPan(
      anchor.x - (anchor.x - clampedPan.x) * ratio,
      anchor.y - (anchor.y - clampedPan.y) * ratio,
      next,
    ))
    setZoom(next)
  }, [zoom, clampedPan.x, clampedPan.y, clampPan])

  // 滚轮监听必须是非 passive 的原生监听：React 的 onWheel 走被动通道，preventDefault 无效。
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      // 双指滚动 / 鼠标滚轮平移，捏合与 Ctrl/⌘+滚轮缩放：Chrome 把触摸板捏合报成带
      // ctrlKey 的滚轮事件，所以两条手势天然分得开，不必再让滚动去抢缩放。
      if (event.ctrlKey || event.metaKey) {
        zoomAtCursor(event.clientX, event.clientY, event.deltaY)
        return
      }
      // deltaMode=1 是「按行」计（部分鼠标滚轮），一行折 16 像素；触摸板给的就是像素。
      const scale = event.deltaMode === 1 ? 16 : 1
      panByPixels(event.deltaX * scale, event.deltaY * scale)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [activeViewId, zoomAtCursor, panByPixels])

  /**
   * 画布起手：空白左键拖 = 平移；Shift+空白拖 = 框选；中键拖 = 任意位置平移。
   * 左键按在图形上时不动视口，交给图形自己的拖拽 / 多选。
   */
  const handleCanvasPanStart = (event: ReactPointerEvent<SVGSVGElement>) => {
    const onBackground = event.target === event.currentTarget
    if (event.button === 0 && event.shiftKey && onBackground && !relationTool) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = toSvgPoint(event.clientX, event.clientY)
      setMarquee({ startX: start.x, startY: start.y, x: start.x, y: start.y })
      return
    }
    if (event.button !== 1 && !(event.button === 0 && onBackground)) {
      return
    }
    event.preventDefault()
    // 捕获指针：拖到画布外再松手也能正常结束平移，不会卡在 panning 状态。
    event.currentTarget.setPointerCapture(event.pointerId)
    setPanDrag({
      startX: event.clientX,
      startY: event.clientY,
      panX: clampedPan.x,
      panY: clampedPan.y,
      onBackground,
      moved: false,
    })
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (marquee) {
      const point = toSvgPoint(event.clientX, event.clientY)
      setMarquee({ ...marquee, x: point.x, y: point.y })
      return
    }
    if (seqDrag) {
      const moved = seqDrag.moved || Math.abs(event.clientY - seqDrag.startY) > 4
      const point = toSvgPoint(event.clientX, event.clientY)
      const rows = seqLayout?.messages ?? []
      let targetIndex = rows.findIndex((message) => Math.abs(message.y - point.y) <= SEQ_ROW_PITCH / 2)
      if (targetIndex < 0 && rows.length > 0) {
        targetIndex = point.y < rows[0].y ? 0 : rows.length - 1
      }
      if (targetIndex < 0) {
        targetIndex = seqDrag.fromIndex
      }
      if (moved !== seqDrag.moved || targetIndex !== seqDrag.targetIndex) {
        setSeqDrag({ ...seqDrag, moved, targetIndex })
      }
      return
    }
    if (panDrag) {
      const dx = event.clientX - panDrag.startX
      const dy = event.clientY - panDrag.startY
      const moved = panDrag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2
      setPan(clampPan(panDrag.panX - pixelsToUnits(dx), panDrag.panY - pixelsToUnits(dy)))
      if (moved !== panDrag.moved) {
        setPanDrag({ ...panDrag, moved })
      }
      return
    }
    if (edgeDrag) {
      const point = toSvgPoint(event.clientX, event.clientY)
      const dx = point.x - edgeDrag.startX
      const dy = point.y - edgeDrag.startY
      const moved = edgeDrag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2
      const shifted = moveRouteSegment(edgeDrag.orig, edgeDrag.segment, dx, dy)
      // 拖到首/末段时端点会离开节点边界：实时重挂回去，预览与落库都保持连线贴着图形。
      const points = shifted.length >= 3
        ? reattachRoute(shifted, edgeDrag.sourceRect, edgeDrag.targetRect)
        : shifted
      setEdgeDrag({ ...edgeDrag, points, moved })
      return
    }
    if (!drag) {
      return
    }
    const point = toSvgPoint(event.clientX, event.clientY)
    const nextX = clamp(drag.originX + point.x - drag.startX, 0, canvas.maxX)
    const nextY = clamp(drag.originY + point.y - drag.startY, 0, canvas.maxY)
    const moved =
      drag.moved || Math.abs(nextX - drag.originX) > 2 || Math.abs(nextY - drag.originY) > 2
    if (Math.abs(nextX - drag.x) < 0.01 && Math.abs(nextY - drag.y) < 0.01 && moved === drag.moved) {
      return
    }
    setDrag({ ...drag, x: nextX, y: nextY, moved })
  }

  const handlePointerUp = () => {
    if (marquee) {
      const finished = marquee
      setMarquee(null)
      const left = Math.min(finished.startX, finished.x)
      const right = Math.max(finished.startX, finished.x)
      const top = Math.min(finished.startY, finished.y)
      const bottom = Math.max(finished.startY, finished.y)
      if (right - left < 3 && bottom - top < 3) {
        return
      }
      // 框选只收前景图形：垫底的泳道 / 生命线、序列图框与片段不参与，否则一框一个准。
      const hits = positions
        .filter((item) => !isBackdropShape(shapeOf(item.element.type))
          && !(seqLayout?.frame && seqLayout.frame.element.id === item.element.id)
          && !seqFragmentIds.has(item.element.id)
          && item.x < right && item.x + item.w > left
          && item.y < bottom && item.y + item.h > top)
        .map((item) => item.element.id)
      setSelectedIds(new Set(hits))
      setSelectedId(hits[0] ?? null)
      setSelectedRelationId(null)
      setSelectedDiagramId(null)
      if (hits.length > 0) {
        say('已框选 {count} 个图形 · 拖动整体移动，Ctrl/⌘+C 复制', { count: hits.length })
      }
      return
    }
    if (edgeDrag) {
      const finished = edgeDrag
      setEdgeDrag(null)
      if (finished.moved && activeDiagramId) {
        // 一次拖拽 = 一条 UPDATE_PROPERTY = 一步撤销；路由按图存在关系 properties 上。
        const anchored = finished.points.length >= 3
          ? reattachRoute(finished.points, finished.sourceRect, finished.targetRect)
          : finished.points
        void runCommand('UPDATE_PROPERTY', {
          id: finished.relationId,
          key: `route:${activeDiagramId}`,
          value: simplifyRoute(anchored).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
        })
      }
      return
    }
    if (seqDrag) {
      const finished = seqDrag
      setSeqDrag(null)
      if (finished.moved && finished.targetIndex !== finished.fromIndex) {
        void moveMessageTo(finished.relationId, finished.targetIndex)
      }
      return
    }
    if (panDrag) {
      // 空白处按下又没拖动就是「点空白」：取消连线起点或关系选择。拖过了就只是平移，不改选择。
      if (!panDrag.moved && panDrag.onBackground) {
        if (relationTool) {
          setRelationSource(null)
        } else {
          setSelectedRelationId(null)
        }
      }
      setPanDrag(null)
      return
    }
    if (!drag) {
      return
    }
    const finished = drag
    setDrag(null)
    if (finished.moved && activeDiagramId) {
      const glyph = controlSizeOf(elementById.get(finished.elementId)?.type ?? '')
      if (finished.group && finished.group.length > 0) {
        // 整体拖动：主图形与组员同一增量，一条 SET_NOTATIONS 落库 = 一步撤销。
        const dx = finished.x - finished.originX
        const dy = finished.y - finished.originY
        const items = [{
          diagramId: activeDiagramId,
          elementId: finished.elementId,
          x: clamp(Math.round(finished.x), 0, canvas.maxX),
          y: clamp(Math.round(finished.y), 0, canvas.maxY),
          ...(glyph ? { width: glyph.w, height: glyph.h } : {}),
        }, ...finished.group.map((member) => {
          const memberGlyph = controlSizeOf(elementById.get(member.id)?.type ?? '')
          return {
            diagramId: activeDiagramId,
            elementId: member.id,
            x: clamp(Math.round(member.originX + dx), 0, canvas.maxX),
            y: clamp(Math.round(member.originY + dy), 0, canvas.maxY),
            ...(memberGlyph ? { width: memberGlyph.w, height: memberGlyph.h } : {}),
          }
        })]
        void runCommand('SET_NOTATIONS', { items })
      } else if (glyph) {
        // 控制节点图形宽高锁规范值：MOVE_NOTATION 会沿用旧大框，下次渲染居中收缩会再漂一次。
        void runCommand('SET_NOTATIONS', {
          items: [{
            diagramId: activeDiagramId,
            elementId: finished.elementId,
            x: Math.round(finished.x),
            y: Math.round(finished.y),
            width: glyph.w,
            height: glyph.h,
          }],
        })
      } else {
        void runCommand('MOVE_NOTATION', {
          diagramId: activeDiagramId,
          elementId: finished.elementId,
          x: Math.round(finished.x),
          y: Math.round(finished.y),
        })
      }
    }
  }

  // 组件工具箱只显示「当前图」允许的元素与关系，清单全部来自后端 MetamodelRegistry，
  // 不再把九大图的分组一次性堆在面板里（参考 EA / StarUML 的按图联动工具箱）。
  const paletteEntries = useMemo<ElementTypeInfo[]>(
    () => (activeSpec?.allowedTypes ?? [])
      .map((code) => typeInfo.get(code))
      .filter((item): item is ElementTypeInfo => item !== undefined)
      // 序列图里的「消息」是两条生命线之间的一条关系箭头，不是画布上的方块：
      // 元模型把 MESSAGE 同时登记成元素类型，工具箱再给一次只会让人拖出一个没用的框。
      .filter((item) => !(activeDiagramKind === 'seq' && item.code === 'Message')),
    [activeSpec, typeInfo, activeDiagramKind],
  )
  /**
   * 工具箱分组拆两层：核心类型直接铺开，规范全量类型（§16 具体动作）收进「更多」。
   * 两档都由服务端下发 tier，前端不硬编码名单。
   */
  /**
   * 核心工具箱：默认收起 ADVANCED 类型，但扩展图例外——标签定义与图类型是
   * 扩展图的主角（构造型下挂标签、图类型画扩展），收进「更多」等于藏起来。
   */
  // code 是 ElementType 枚举名（TAG_DEFINITION / DIAGRAM_TYPE），不是 UML 名。
  const coreUplift = useMemo(() => activeDiagramKind === 'profile'
    ? new Set(['TAG_DEFINITION', 'DIAGRAM_TYPE'])
    : new Set<string>(), [activeDiagramKind])
  const corePalette = useMemo<ElementTypeInfo[]>(
    () => paletteEntries.filter((item) => item.tier !== 'ADVANCED' || coreUplift.has(item.code)),
    [paletteEntries, coreUplift],
  )
  const advancedPalette = useMemo<ElementTypeInfo[]>(
    () => paletteEntries.filter((item) => item.tier === 'ADVANCED' && !coreUplift.has(item.code)),
    [paletteEntries, coreUplift],
  )
  const elementGroups = useMemo(() => {
    const groups: { key: string; label: string; items: ElementTypeInfo[] }[] = []
    for (const family of FAMILIES) {
      const items = corePalette.filter((item) => familyOfType(item.code) === family.key)
      if (items.length > 0) {
        groups.push({ key: family.key, label: pick(family.label, family.labelEn), items })
      }
    }
    return groups
  }, [corePalette, locale])

  /** 规范全量类型（UML §16 具体动作）：单独一组，默认收起。 */
  const advancedGroups = useMemo(() => {
    const groups: { key: string; label: string; items: ElementTypeInfo[] }[] = []
    for (const family of FAMILIES) {
      const items = advancedPalette.filter((item) => familyOfType(item.code) === family.key)
      if (items.length > 0) {
        groups.push({ key: family.key, label: pick(family.label, family.labelEn), items })
      }
    }
    return groups
  }, [advancedPalette, locale])

  const allRelations = useMemo(
    () => (relationCatalog.length > 0 ? relationCatalog : FALLBACK_RELATIONS),
    [relationCatalog],
  )
  const relationInfo = useMemo(
    () => new Map(allRelations.map((item) => [item.code, item])),
    [allRelations],
  )
  const relationEntries = useMemo<RelationshipTypeInfo[]>(
    () => (activeSpec?.allowedRelationships ?? []).map((code) => relationInfo.get(code) ?? {
      code, label: code, stereotype: code, family: 'structure',
    }),
    [activeSpec, relationInfo],
  )
  /** 当前激活的序列图消息种类：状态栏、连线提示都用它显示具体工具名。 */
  const activeSeqTool = useMemo(() => seqMessageToolOf(seqMessageTool), [seqMessageTool])
  const relationGroups = useMemo(() => {
    const order = ['requirement', 'namespace', 'structure', 'constraint',
      'activity', 'interaction', 'state', 'usecase']
    const groups: { key: string; label: string; items: RelationshipTypeInfo[] }[] = []
    for (const key of order) {
      const items = relationEntries.filter((item) => item.family === key)
      if (items.length > 0) {
        groups.push({ key, label: t(RELATION_FAMILY_LABELS[key] ?? key), items })
      }
    }
    const grouped = new Set(groups.map((group) => group.key))
    const rest = relationEntries.filter((item) => !grouped.has(item.family))
    if (rest.length > 0) {
      groups.push({ key: 'other', label: t('其他'), items: rest })
    }
    return groups
  }, [relationEntries, locale])
  /** 关系类型显示名：服务端同时下发中英文，按当前语言取。 */
  /** 关系族名的双语显示名。身份要稳定：模型树行组件靠它判断自己是否需要重渲染。 */
  const relationLabel = useCallback(
    (code: string) => {
      const info = relationInfo.get(code)
      return info ? pick(info.label, info.labelEn) : code
    },
    [relationInfo],
  )

  const toggleToolGroup = (key: string) => {
    setOpenToolGroups((previous) => {
      const next = new Set(previous)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  /** 点选（或拖入）关系组件 → 进入连线模式，随后在画布上依次点击起点、终点。 */
  const activateRelationTool = (code: string) => {
    setRelationTool(code)
    setSeqMessageTool(null)
    setRelationSource(null)
    say('已选择「{relation}」：在画布上依次点击起点与终点（Esc 退出）', { relation: relationLabel(code) })
  }

  /** 序列图的消息种类工具：仍走 'message' 关系，只是预设 messageSort / 自消息端点。 */
  const activateSeqMessageTool = (key: string) => {
    const tool = seqMessageToolOf(key)
    if (!tool) {
      return
    }
    setRelationTool('message')
    setSeqMessageTool(key)
    setRelationSource(null)
    say('已选择「{tool}」：{hint}', { tool: pick(tool.label, tool.labelEn), hint: t(tool.hint) })
  }

  /** 工具箱里的线型缩略图：与画布共用 messageSortStyle，按钮上就能看出线型差别。 */
  const renderSeqToolIcon = (tool: SeqMessageToolDef): ReactNode => {
    const style = messageSortStyle(tool.sort)
    const dash = style.dashed ? style.dash : undefined
    const pen = { stroke: style.color, strokeWidth: 1.5, fill: 'none' as const }
    return (
      <svg className="seq-tool-glyph" width={18} height={16} viewBox="0 0 18 16" aria-hidden="true">
        {tool.self ? (
          <>
            <polyline points="3,3 13,3 13,11 3,11" {...pen} strokeDasharray={dash} />
            <polyline points="7,8 3,11 7,14" {...pen} />
          </>
        ) : tool.sort === 'createMessage' ? (
          <>
            <line x1={2} y1={5} x2={13} y2={10} {...pen} strokeDasharray={dash} />
            <rect x={12} y={10} width={5} height={5} {...pen} />
          </>
        ) : (
          <>
            <line x1={2} y1={8} x2={14} y2={8} {...pen} strokeDasharray={dash} />
            {style.arrow === 'filled'
              ? <polygon points="15,8 10,5 10,11" fill={style.color} stroke="none" />
              : <polyline points="10,5 15,8 10,11" {...pen} />}
          </>
        )}
      </svg>
    )
  }

  /**
   * 由连线工具建一条关系。
   *
   * <p>序列图消息保持工具激活以便连续画同类消息；其他关系（含泛化）一次只建一条，
   * 建完退出连线模式——反复点击同一个起点/终点正是在堆重复泛化。</p>
   */
  const createToolRelationship = async (tool: string, sourceId: string, targetId: string) => {
    if (relationCreatingRef.current) {
      return false
    }
    relationCreatingRef.current = true
    try {
      const id = `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const ok = await runCommand('CREATE_RELATIONSHIP', relationPayload(id, tool, sourceId, targetId))
      if (ok) {
        setRelationSource(null)
        const continuous = activeDiagramKind === 'seq' && tool === 'message'
        if (!continuous) {
          setRelationTool(null)
          setSeqMessageTool(null)
        }
        say(continuous
          ? (sourceId === targetId
            ? '已创建给自己的消息，可继续连线或按 Esc 退出'
            : '已创建 «{relation}» 关系，可继续连线或按 Esc 退出')
          : '已创建 «{relation}» 关系', { relation: relationLabel(tool) })
      }
      return ok
    } finally {
      relationCreatingRef.current = false
    }
  }

  const openRelationDialog = () => {
    setRelationDialog({
      sourceId: selectedId ?? relationSource ?? '',
      targetId: '',
      type: relationTool ?? relationEntries[0]?.code ?? 'trace',
    })
  }

  const handleRelationPick = async (elementId: string) => {
    if (!relationTool || relationCreatingRef.current) {
      return
    }
    const tool = relationTool === 'message' ? seqMessageToolOf(seqMessageTool) : null
    // 自消息只点一条生命线：一步建成 source = target 的关系，不要逼用户点两次同一个目标。
    const selfTool = activeDiagramKind === 'seq' && !!tool?.self
    if (!relationSource) {
      if (selfTool) {
        await createToolRelationship(relationTool, elementId, elementId)
        return
      }
      setRelationSource(elementId)
      say('起点：{name}；请点击终点元素', { name: model.elements.find((e) => e.id === elementId)?.name ?? elementId })
      return
    }
    if (relationSource === elementId) {
      // 序列图里点回起点是画「给自己的消息」；但创建 / 销毁自己没有 UML 语义，
      // 这两类工具点回起点仍按取消处理，避免建出一条画不出表头 / X 的自反消息。
      const selfAllowed = !tool
        || (tool.sort !== 'createMessage' && tool.sort !== 'deleteMessage')
      if (activeDiagramKind === 'seq' && relationTool === 'message' && selfAllowed) {
        await createToolRelationship(relationTool, elementId, elementId)
        return
      }
      setRelationSource(null)
      say('已取消起点，请重新选择起点元素')
      return
    }
    await createToolRelationship(relationTool, relationSource, elementId)
  }

  /**
   * 从工具箱创建元素：owner 取当前图的语义宿主（块/交互/活动等），并加入当前图。
   * 坐标随 CREATE_ELEMENT 一条命令下发，由服务端在生成 Notation 时写入——
   * 不再补发 MOVE_NOTATION，避免连续命令的 409 竞态与「撤销两次才删掉元素」。
   */
  const paletteShape = (type: string): string => {
    const existing = selectedNotationsByType.get(type) ?? []
    const shapes = new Set(existing.map(({ style }) => shapeVariantOf(type, style)))
    if (shapes.size > 1) return 'mixed'
    return shapes.values().next().value ?? paletteShapes[type] ?? ''
  }

  const createElementFromPalette = async (typeCode: string, x: number, y: number) => {
    if (!activeDiagramObj || !activeDiagramId || elementCreatingRef.current) {
      return
    }
    elementCreatingRef.current = true
    try {
      // 图的宿主必须是命名空间/分类器：不合法时不要发命令，否则元素会挂到元模型元素下。
      const diagramOwner = activeDiagramObj.ownerId ?? ''
      if (diagramOwner && namespaceHostId(diagramOwner) !== diagramOwner) {
        say('当前图的宿主不是命名空间，无法在此新建元素')
        return
      }
      const info = typeInfo.get(typeCode)
      const id = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const variant = paletteShape(typeCode)
      const shapeVariant = variant === 'mixed' ? paletteShapes[typeCode] : variant
      const payload: Record<string, unknown> = {
        id,
        type: info?.uml ?? typeCode,
        name: t('新建{label} {count}', { label: pick(info?.label, info?.labelEn) ?? typeCode, count: model.elements.length + 1 }),
        ownerId: diagramOwner,
        stereotypes: info?.stereotype ? [info.stereotype] : [],
        diagramId: activeDiagramId,
        x: Math.round(clamp(x, 0, canvas.maxX)),
        y: Math.round(clamp(y, 0, canvas.maxY)),
        ...(shapeVariant ? { style: { shapeVariant } } : {}),
      }
      const ok = await runCommand('CREATE_ELEMENT', payload)
      if (ok) {
        setSelectedId(id)
        say('已在 ({x}, {y}) 放置「{name}」', { x: payload.x, y: payload.y, name: payload.name })
      }
    } finally {
      elementCreatingRef.current = false
    }
  }

  const renderPaletteItem = (type: ElementTypeInfo) => {
    const options = shapeOptions(type.code)
    const label = pick(type.label, type.labelEn)
    const create = (
      <button
        key={type.code}
        type="button"
        className="tb-item"
        data-tb-type={type.code}
        draggable={canEdit}
        disabled={busy}
        onDragStart={(event) => event.dataTransfer.setData('text/scofen-type', type.code)}
        onClick={() => createFromPaletteAtCenter(type.code)}
        title={t('«{stereotype}» {label} · {uml}｜点击或拖入画布', { stereotype: type.stereotype, label, uml: type.uml })}
      >
        <TypeIcon code={type.code} size={16} />
        <span className="tb-item-label">{label}</span>
      </button>
    )
    if (!options) return create
    const selected = selectedNotationsByType.get(type.code) ?? []
    const current = paletteShape(type.code)
    return (
      <div key={type.code} className="tb-shape-row">
        {create}
        <select
          className="tb-shape-select"
          aria-label={t('{type}图形样式', { type: label })}
          title={selected.length ? t('更改选中图元的形状') : t('设置新建图元的形状')}
          data-tb-shape={type.code}
          disabled={!canEdit || busy}
          value={current}
          onChange={async (event) => {
            const shapeVariant = event.target.value
            if (selected.length && !await runCommand('SET_NOTATION_STYLE', {
              items: selected.map(({ id }) => ({ notationId: id, style: { shapeVariant } })),
            })) return
            setPaletteShapes((previous) => ({ ...previous, [type.code]: shapeVariant }))
          }}
        >
          <option value="">{t('标准')}</option>
          {current === 'mixed' && <option value="mixed" disabled>{t('混合样式')}</option>}
          {options.map(({ value, label: shapeLabel }) => <option key={value} value={value}>{t(shapeLabel)}</option>)}
        </select>
      </div>
    )
  }

  /** 工具箱点选：把新元素放在视口中心，尺寸按当前图种/类型取，避免扩展图节点偏移。 */
  const createFromPaletteAtCenter = (typeCode: string) => {
    const size = nodeSizeFor(typeCode)
    void createElementFromPalette(
      typeCode,
      clampedPan.x + viewWidth / 2 - size.width / 2,
      clampedPan.y + viewHeight / 2 - size.height / 2,
    )
  }

  const handleCanvasDrop = (event: ReactDragEvent<SVGSVGElement>) => {
    event.preventDefault()
    const relationCode = event.dataTransfer.getData('text/scofen-relation')
    if (relationCode) {
      activateRelationTool(relationCode)
      return
    }
    const point = toSvgPoint(event.clientX, event.clientY)

    // 模型树里已有的元素：已在当前图 → 移动；未在当前图 → 加入图并落在指定位置。
    const elementId = event.dataTransfer.getData('text/scofen-element')
    if (elementId) {
      const existing = model.elements.find((element) => element.id === elementId)
      const size = existing ? nodeSizeFor(codeOf(existing.type)) : nodeSize
      const x = Math.round(clamp(point.x - size.width / 2, 0, canvas.maxX))
      const y = Math.round(clamp(point.y - size.height / 2, 0, canvas.maxY))
      const inCurrentDiagram = activeDiagramObj?.elementIds.includes(elementId) ?? false
      void runCommand(inCurrentDiagram ? 'MOVE_NOTATION' : 'ADD_TO_DIAGRAM', {
        diagramId: activeDiagramId,
        elementId,
        x,
        y,
      })
      setSelectedId(elementId)
      say('已把「{name}」放置在 ({x}, {y})', { name: existing?.name ?? elementId, x, y })
      return
    }

    const code = event.dataTransfer.getData('text/scofen-type')
    if (code) {
      // 以鼠标落点作为图形中心；尺寸随图种/类型变化（扩展图构造型是 100×50）。
      const size = nodeSizeFor(code)
      const x = Math.round(clamp(point.x - size.width / 2, 0, canvas.maxX))
      const y = Math.round(clamp(point.y - size.height / 2, 0, canvas.maxY))
      void createElementFromPalette(code, x, y)
    }
  }

  // ── 空间 / 项目导航（个人空间、团队空间、空间下的项目列表） ──
  const allProjects = useMemo(
    () => workspace?.spaces.flatMap((space) => space.projects) ?? [],
    [workspace],
  )
  const selectedProject = useMemo<WorkspaceProject | null>(
    () => allProjects.find((project) => project.id === activeProjectId)
      ?? allProjects.find((project) => project.current)
      ?? null,
    [allProjects, activeProjectId],
  )
  const currentSpaceLabel = useMemo(
    () => workspace?.spaces.find((space) => space.projects.some((project) => project.id === activeProjectId))?.label
      ?? t('个人空间'),
    [workspace, activeProjectId, locale],
  )

  const toggleSpace = (code: string) => {
    setOpenSpaces((previous) => {
      const next = new Set(previous)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  /** 打开项目：切换请求头 → 切换 UI → effect 重新拉快照并重连 WS。 */
  const openProject = (project: WorkspaceProject) => {
    setProjectPickerOpen(false)
    setSpaceDrawerOpen(false)
    if (project.id === activeProjectId) {
      say('当前编辑项目：{name}', { name: project.name })
      return
    }
    setProjectId(project.id)
    setActiveProjectId(project.id)
    setProjectPanel(null)
    setRequirementImportOpen(false)
    setPendingObjectLink(null)
    setSelectedId(null)
    setSelectedDiagramId(null)
    setMenu(null)
    setRelationTool(null)
    setRelationSource(null)
    // 换项目后重新播种展开状态：否则新项目的树会沿用上一个项目的折叠集合。
    expandedSeeded.current = false
    relationMountsSeeded.current = false
    setExpanded(new Set())
    setCollapsedRelationGroups(new Set())
    const spaceLabel = workspace?.spaces.find((space) => space.code === project.spaceCode)?.label ?? ''
    say('已打开项目「{name}」· {space}', { name: project.name, space: spaceLabel })
  }

  const openNewProject = (spaceCode: string) => {
    setNewProjectSpace(spaceCode)
    setNewProjectName('')
    setNewProjectDesc('')
    setNewProjectDialog(true)
  }

  const submitNewProject = async () => {
    if (!newProjectName.trim()) {
      return
    }
    beginBusy()
    try {
      const created = await createProject({
        spaceCode: newProjectSpace,
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
      })
      setNewProjectDialog(false)
      setOpenSpaces((previous) => new Set(previous).add(created.spaceCode))
      setProjectId(created.id)
      setActiveProjectId(created.id)
      setProjectPickerOpen(false)
      setSpaceDrawerOpen(false)
      say('已创建并打开项目「{name}」', { name: created.name })
    } catch (error) {
      say('新建项目失败：{error}', { error: errorMessage(error) })
    } finally {
      endBusy()
    }
  }

  /**
   * 删除项目。
   *
   * <p>删掉当前项目时必须先把请求头切到别的项目，否则后续 refresh() 会带着
   * 已经不存在的 project id 打到服务端（目录接口会回退到主示例项目，
   * 模型接口则直接 404，界面就卡在空壳上）。</p>
   */
  const confirmDeleteProject = async () => {
    const target = deleteProjectTarget
    if (!target || busy) {
      return
    }
    beginBusy()
    try {
      await deleteProject(target.id)
      setDeleteProjectTarget(null)
      const fallback = (workspace?.spaces ?? [])
        .flatMap((space) => space.projects)
        .find((project) => project.id !== target.id)
      if (target.id === activeProjectId) {
        if (fallback) {
          setProjectId(fallback.id)
          setActiveProjectId(fallback.id)
          setSelectedId(null)
          setSelectedDiagramId(null)
          setSelectedRelationId(null)
          // 文档标签是按旧项目的图/元素/表格打开的，换项目后一律清空。
          setTabs([])
          setActiveViewId('')
          expandedSeeded.current = false
          relationMountsSeeded.current = false
          setExpanded(new Set())
          say('已删除项目「{name}」，已切换到「{next}」', { name: target.name, next: fallback.name })
        } else {
          say('已删除项目「{name}」', { name: target.name })
        }
      } else {
        say('已删除项目「{name}」', { name: target.name })
      }
      await refresh()
    } catch (error) {
      say('删除项目失败：{error}', { error: errorMessage(error) })
    } finally {
      endBusy()
    }
  }

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleRelationGroup = (id: string) => {
    setCollapsedRelationGroups((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  /**
   * 可见行序列：把「折叠状态 + 筛选 + 关系挂载」压成一个扁平数组。
   *
   * <p>顺序与旧的递归渲染一致（子元素 → 本节点下的图 → 「关系」虚拟分组），但 DOM
   * 不再按层嵌套，缩进交给 paddingLeft。这样每次状态变化只重建这份描述符数组
   * （每行几次查表、零 i18n、零 React 元素），真正要重渲染的行由 memo 挑出来：
   * 折叠一个节点时其余几千行原样跳过。行数再大也不会像递归渲染那样整树重画。</p>
   */
  const visibleRows = useMemo<TreeRowProps[]>(() => {
    const rows: TreeRowProps[] = []
    const hits = treeFilterHits
    // 筛选态强制全开：命中项的祖先链已在 hits 里，未命中的子树整棵剪掉。
    const isOpen = (id: string) => (hits ? true : expanded.has(id))
    const keep = (id: string) => !hits || hits.has(id)

    const pushRelationGroup = (ownerId: string, depth: number) => {
      const items = relationsByOwner.get(ownerId)
      if (!items || items.length === 0) {
        return
      }
      const groupId = relationGroupId(ownerId)
      const open = !collapsedRelationGroups.has(groupId)
      rows.push({
        kind: 'relationGroup', id: groupId, depth, childCount: items.length,
        isOpen: open, isSelected: false, isDropTarget: false, ownerId,
      })
      if (!open) {
        return
      }
      for (const item of items) {
        rows.push({
          kind: 'relation', id: item.relation.id, depth: depth + 1, childCount: 0,
          isOpen: false, isSelected: selectedRelationId === item.relation.id,
          isDropTarget: false,
          ownerId, direction: item.direction, peerId: item.peerId,
        })
      }
    }

    const pushExtensionElement = (element: ModelElement, depth: number) => {
      // 扩展包也参与名称筛选：未命中的分支整支剪掉，命中项在筛选态强制展开，
      // 否则用户搜到 Block 却只能看到折叠的 SysML 包。
      if (hits && !hits.has(element.id)) {
        return
      }
      const kids = extensionChildrenByOwner.get(element.id) ?? []
      const open = hits ? true : expanded.has(element.id)
      rows.push({
        kind: 'extensionElement', id: element.id, depth, childCount: kids.length,
        isOpen: open, isSelected: false, isDropTarget: false,
      })
      if (!open) {
        return
      }
      for (const kid of kids) {
        pushExtensionElement(kid, depth + 1)
      }
    }

    // 元素与其名下图互为父子：图 d 的宿主是 Element，d 的成员里又常包含那个 Element
    // （包图里画包自己）。画布点选会「在模型树中定位」，把两者一起展开，递归就会在
    // 元素 ↔ 图之间无限往返、把调用栈打爆。用一条路径栈拦住重复进入，行照常输出一次。
    const path = new Set<string>()
    // 同一元素可能既是项目层级的子节点、又是某张图的成员；只按路径防环挡不住这种
    // 跨分支重复，会把元类 / 块在树里显示两遍。全树按 id 只输出一次，先到先得——
    // rootNodes 先铺项目层级，因此元素优先保留在自己的命名空间下。
    const emitted = new Set<string>()

    const pushDiagram = (diagram: Diagram, depth: number) => {
      if (!keep(diagram.id) || path.has(diagram.id)) {
        return
      }
      const members = diagramMembersByDiagram.get(diagram.id) ?? []
      const open = isOpen(diagram.id)
      rows.push({
        kind: 'diagram', id: diagram.id, depth, childCount: members.length, isOpen: open,
        isSelected: selectedDiagramId === diagram.id,
        isDropTarget: treeDropTarget === diagram.id,
      })
      if (!open) {
        return
      }
      path.add(diagram.id)
      for (const member of members) {
        pushElement(member, depth + 1)
      }
      path.delete(diagram.id)
    }

    function pushElement(element: ModelElement, depth: number): void {
      if (!keep(element.id) || path.has(element.id) || emitted.has(element.id)) {
        return
      }
      const kids = childrenByOwner.get(element.id) ?? []
      const diagrams = diagramsByOwner.get(element.id) ?? []
      const relationItems = relationsByOwner.get(element.id)
      const open = isOpen(element.id)
      rows.push({
        kind: 'element', id: element.id, depth,
        childCount: kids.length + diagrams.length + (relationItems ? 1 : 0), isOpen: open,
        isSelected: selectedId === element.id,
        isDropTarget: false,
      })
      emitted.add(element.id)
      if (!open) {
        return
      }
      path.add(element.id)
      for (const kid of kids) {
        pushElement(kid, depth + 1)
      }
      for (const diagram of diagrams) {
        pushDiagram(diagram, depth + 1)
      }
      // 关系分组是虚拟内容，不参与筛选命中。
      if (relationItems && !hits) {
        pushRelationGroup(element.id, depth + 1)
      }
      path.delete(element.id)
    }

    for (const node of rootNodes) {
      // rootNodes 只可能是这两类；虚拟节点由下面的分组分支单独铺。
      if (node.type === 'element') {
        pushElement(node.ref, 0)
      } else if (node.type === 'diagram') {
        pushDiagram(node.ref, 0)
      }
    }
    // 扩展包与项目根同级：它是系统提供的独立内容，不是项目根的子节点。
    // 筛选态下只有命中扩展元素时才渲染该分组，并强制展开到命中项；
    // 即使扩展包平时被开关隐藏，搜索命中也要临时显示，否则 Block 元类“搜不到”。
    const extensionHits = !hits || extensionElements.some((element) => hits.has(element.id))
    if (extensionRoots.length > 0 && extensionHits && (showExtensions || hits)) {
      const open = hits ? true : expanded.has(EXTENSION_GROUP_ID)
      const roots = hits ? extensionRoots.filter((root) => hits.has(root.id)) : extensionRoots
      rows.push({
        kind: 'extensionGroup', id: EXTENSION_GROUP_ID, depth: 0,
        childCount: roots.length, isOpen: open, isSelected: false,
        isDropTarget: false,
      })
      if (open) {
        for (const root of roots) {
          pushExtensionElement(root, 1)
        }
      }
    }
    if (!hits) {
      pushRelationGroup(ORPHAN_RELATION_OWNER, 0)
    }
    return rows
  }, [
    childrenByOwner, collapsedRelationGroups, diagramMembersByDiagram, diagramsByOwner, expanded,
    extensionChildrenByOwner, extensionElements, extensionRoots, relationsByOwner, rootNodes, selectedDiagramId,
    selectedId, selectedRelationId, showExtensions, treeDropTarget, treeFilterHits,
  ])
  // 定位大行号时按这份最新行表算 scrollTop（revealInTree 的定时器闭包读 ref，不读旧渲染）。
  visibleRowsRef.current = visibleRows

  /**
   * 模型树虚拟化：仅项目视图且行数超阈值时启用。上下占位 div 撑出总高度，
   * 只渲染视口附近（含 10 行余量）的行；行高由 CSS 强制统一为 TREE_ROW_H。
   * 小树保持整表渲染，scrollIntoView 等既有行为不受影响。
   */
  const treeVirtual = leftTab === 'project' && visibleRows.length > TREE_VIRTUAL_THRESHOLD
  const treeWindow = useMemo(() => {
    if (!treeVirtual) {
      return { start: 0, end: visibleRows.length, rows: visibleRows }
    }
    const start = Math.max(0, Math.min(
      Math.floor(treeViewport.top / TREE_ROW_H) - 10,
      Math.max(0, visibleRows.length - 1),
    ))
    const end = Math.max(start, Math.min(visibleRows.length, Math.ceil((treeViewport.top + treeViewport.height) / TREE_ROW_H) + 10))
    return { start, end, rows: visibleRows.slice(start, end) }
  }, [treeVirtual, visibleRows, treeViewport])

  /** 滚动取行：rAF 节流，一次滚动帧只 setState 一次。 */
  const handleTreeScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    if (treeScrollRaf.current !== 0) {
      return
    }
    treeScrollRaf.current = window.requestAnimationFrame(() => {
      treeScrollRaf.current = 0
      setTreeViewport({ top: node.scrollTop, height: node.clientHeight })
    })
  }, [])
  useEffect(() => () => {
    if (treeScrollRaf.current !== 0) {
      window.cancelAnimationFrame(treeScrollRaf.current)
    }
  }, [])

  /**
   * 筛选词变化时把树滚回顶部。
   *
   * <p>大项目里用户往往已经滚到树的中后段；筛选后行数骤减，滚动位置却仍停在旧底部，
   * 视口落在命中列表的尾部甚至空白处，看起来就像筛选没生效。这里同时复位 DOM
   * 滚动与虚拟窗口起点，保证命中行第一时间出现在视野里。</p>
   */
  useEffect(() => {
    const node = browserRef.current
    if (node) {
      node.scrollTop = 0
    }
    setTreeViewport((previous) => (previous.top === 0 ? previous : { ...previous, top: 0 }))
  }, [treeFilter])

  /**
   * 树行的只读取数表。身份只在模型快照 / 目录 / 权限变化时更换，
   * 折叠与选中这类纯交互不碰它，行组件的 memo 才拦得住无关行。
   */
  const treeData = useMemo<TreeData>(() => ({
    elementById,
    diagramById,
    relationById,
    extensionElementById,
    codeOf,
    typeLabel,
    diagramLabel,
    relationLabel,
    rootId: projectRootId,
    extensionRootIds,
    canEdit,
  }), [
    elementById, diagramById, relationById, extensionElementById, codeOf, typeLabel,
    diagramLabel, relationLabel, projectRootId, extensionRootIds, canEdit,
  ])

  /**
   * 全局搜索打分：名称权重最高（精确 > 前缀 > 包含），其次构造型，再次文档 /
   * 标签值 / 属性值 / id。空输入时列出图作为快速导航。结果按分数降序、同分按名称，
   * 截断到上限——大项目敲一个字不至于渲染上千行。
   */
  const searchResults = useMemo<SearchResult[]>(() => {
    const needle = searchNeedle
    if (!needle) {
      return model.diagrams.slice(0, 12).map((diagram) => ({
        kind: 'diagram' as const,
        id: diagram.id,
        name: diagram.name,
        sub: diagramLabel(diagram.kind),
        score: 0,
      }))
    }
    const results: SearchResult[] = []
    // 只按名称做模糊检索：归一化掉大小写与空白 / 分隔符后再比包含关系，
    // 不再扫文档、标签、属性值与 id（那些命中往往与用户输入的名称无关，噪音太大）。
    const normalizedNeedle = normalizeName(needle)
    const fieldScore = (text: string): number => {
      const normalized = normalizeName(text)
      if (!normalized) {
        return 0
      }
      if (normalized === normalizedNeedle) {
        return 100
      }
      if (normalized.startsWith(normalizedNeedle)) {
        return 60
      }
      return normalized.includes(normalizedNeedle) ? 40 : 0
    }
    for (const element of projectElements) {
      const score = fieldScore(element.name)
      if (score > 0) {
        results.push({ kind: 'element', id: element.id, name: element.name, sub: typeLabel(element.type), score })
      }
    }
    // 扩展包（SysML / UML 元模型）同样参与名称搜索：搜 Block 要能搜到元模型里的 Block。
    for (const element of extensionElements) {
      const score = fieldScore(element.name)
      if (score > 0) {
        results.push({ kind: 'element', id: element.id, name: element.name, sub: typeLabel(element.type), score })
      }
    }
    for (const diagram of model.diagrams) {
      const score = fieldScore(diagram.name)
      if (score > 0) {
        results.push({ kind: 'diagram', id: diagram.id, name: diagram.name, sub: diagramLabel(diagram.kind), score })
      }
    }
    for (const relation of model.relationships) {
      const label = relation.name?.trim() || relationLabel(relation.type)
      const score = fieldScore(label)
      if (score > 0) {
        const source = elementById.get(relation.sourceId)?.name ?? relation.sourceId
        const target = elementById.get(relation.targetId)?.name ?? relation.targetId
        results.push({
          kind: 'relation', id: relation.id, name: label,
          sub: `${relationLabel(relation.type)} · ${source} → ${target}`, score,
        })
      }
    }
    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return results.slice(0, SEARCH_MAX_RESULTS)
  }, [searchNeedle, projectElements, model.diagrams, model.relationships, elementById, typeLabel, diagramLabel, relationLabel])

  // 结果集变化时把高亮行收回到第一条，避免停留在越界下标。
  useEffect(() => {
    setSearchIndex(0)
  }, [searchResults])

  // ↑↓ 移动高亮时把当前行滚进可视区（结果列表自身可滚动）。
  useEffect(() => {
    if (!searchOpen) {
      return
    }
    document.querySelector(`[data-search-index="${searchIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [searchIndex, searchOpen, searchResults])

  const selectTreeElement = (elementId: string) => {
    setSelectedId(elementId)
    setSelectedDiagramId(null)
  }

  const selectTreeExtensionElement = (elementId: string) => {
    setSelectedId(elementId)
    setSelectedDiagramId(null)
    setSelectedRelationId(null)
  }

  const selectTreeRelation = (relationId: string) => {
    setSelectedRelationId(relationId)
    setSelectedId(null)
    setSelectedDiagramId(null)
  }

  const activateTreeDiagram = (diagramId: string, withTab: boolean) => {
    setActiveDiagramId(diagramId)
    setSelectedDiagramId(diagramId)
    setSelectedId(null)
    if (withTab) {
      openTab({ kind: 'diagram', id: diagramId })
    }
  }

  const locateProjectObject = (target: ObjectTarget) => {
    if (target.type === 'diagram' && model.diagrams.some(item => item.id === target.id)) {
      activateTreeDiagram(target.id, true)
    } else if (target.type === 'relationship' && model.relationships.some(item => item.id === target.id)) {
      selectTreeRelation(target.id)
    } else if (target.type === 'element' && model.elements.some(item => item.id === target.id)) {
      selectOnTree({ kind: 'element', id: target.id })
    }
  }

  useEffect(() => {
    if (!pendingObjectLink || pendingObjectLink.project !== activeProjectId || modelProjectRef.current !== activeProjectId) return
    if (pendingObjectLink.target && !pendingObjectLink.baseline) locateProjectObject(pendingObjectLink.target)
    setProjectPanel({ section: pendingObjectLink.baseline ? 'baseline' : 'review', link: pendingObjectLink })
    setPendingObjectLink(null)
  }, [pendingObjectLink, activeProjectId, model])

  const selectedProjectTarget: ObjectTarget | undefined = selectedRelationId ? { type: 'relationship', id: selectedRelationId }
    : selectedDiagramId ? { type: 'diagram', id: selectedDiagramId }
      : selectedId ? { type: 'element', id: selectedId }
        : activeDiagramId && !activeViewId ? { type: 'diagram', id: activeDiagramId } : undefined

  const refreshProjectWorkflow = async (modelChanged = false) => {
    if (modelChanged) await refresh()
    await Promise.all([refreshProjectOverview(), loadValidation()])
  }

  /**
   * 行组件的动作集合：对象身份一次生成后不再更换，实现函数每次渲染写回 ref。
   *
   * <p>这些实现要读当前模型、布局与草稿状态，直接放进 context 会让 context 每次渲染
   * 换身份，从而把整棵树的行全部重渲染——正是这次要修的开销。</p>
   */
  /**
   * 用「图类型」元素建一张图并打开。
   *
   * <p>图类型只是定义（`DiagramType` 元素），点开它本身没有任何画面——这正是
   * 「扩展图库里的图打不开」的原因。这里补上缺的那一步：按定义的基底建一张空图、
   * 带上 `customTypeId`（图框标题 / 工具箱白名单靠它解析），然后激活它。
   * 同类型已经有图时直接打开第一张，不重复建。</p>
   */
  const openOrCreateDiagramOfType = async (definitionId: string) => {
    const definition = model.elements.find((element) => element.id === definitionId)
    if (!definition) {
      return
    }
    const existing = model.diagrams.find((diagram) => diagram.customTypeId === definitionId)
    if (existing) {
      setActiveDiagramId(existing.id)
      setSelectedDiagramId(existing.id)
      setSelectedId(null)
      openTab({ kind: 'diagram', id: existing.id })
      return
    }
    if (!canEdit) {
      say(t('当前账号只读，无法新建图'))
      return
    }
    // 基底取自服务端解析后的定制目录（与新建图对话框同一份数据），目录未到就落回模块定义图。
    const baseKind = customization?.diagramTypes.find((item) => item.id === definitionId)?.baseKind ?? 'bdd'
    const hostOwnerId = await ensureDiagramHost(baseKind, projectRootId ?? '')
    if (hostOwnerId === null) {
      return
    }
    const taken = new Set(model.diagrams.map((diagram) => diagram.name))
    let name = definition.name
    for (let index = 2; taken.has(name); index += 1) {
      name = `${definition.name} ${index}`
    }
    const id = `dg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const ok = await runCommand('CREATE_DIAGRAM', {
      id,
      kind: baseKind,
      name,
      ownerId: hostOwnerId,
      elementIds: [],
      customTypeId: definitionId,
    })
    if (ok) {
      setActiveDiagramId(id)
      setSelectedDiagramId(id)
      setSelectedId(null)
      openTab({ kind: 'diagram', id })
      say(t('已用「{name}」新建一张图', { name: definition.name }))
    }
  }

  const treeActionsImpl = useRef<TreeActions>({
    toggleExpanded: () => undefined,
    toggleRelationGroup: () => undefined,
    selectElement: () => undefined,
    selectExtensionElement: () => undefined,
    selectRelation: () => undefined,
    activateDiagram: () => undefined,
    openDiagramOfType: () => undefined,
    addElementToDiagram: () => undefined,
    setDropTarget: () => undefined,
    openMenu: () => undefined,
  })
  treeActionsImpl.current = {
    toggleExpanded,
    toggleRelationGroup,
    selectElement: selectTreeElement,
    selectExtensionElement: selectTreeExtensionElement,
    selectRelation: selectTreeRelation,
    activateDiagram: activateTreeDiagram,
    openDiagramOfType: (id) => {
      void openOrCreateDiagramOfType(id)
    },
    addElementToDiagram: (diagramId, elementId) => {
      void addElementToDiagram(diagramId, elementId)
    },
    setDropTarget: setTreeDropTarget,
    openMenu,
  }
  const treeActions = useMemo<TreeActions>(() => ({
    toggleExpanded: (id) => treeActionsImpl.current.toggleExpanded(id),
    toggleRelationGroup: (id) => treeActionsImpl.current.toggleRelationGroup(id),
    selectElement: (id) => treeActionsImpl.current.selectElement(id),
    selectExtensionElement: (id) => treeActionsImpl.current.selectExtensionElement(id),
    selectRelation: (id) => treeActionsImpl.current.selectRelation(id),
    activateDiagram: (id, withTab) => treeActionsImpl.current.activateDiagram(id, withTab),
    openDiagramOfType: (id) => treeActionsImpl.current.openDiagramOfType(id),
    addElementToDiagram: (diagramId, elementId) =>
      treeActionsImpl.current.addElementToDiagram(diagramId, elementId),
    setDropTarget: (id) => treeActionsImpl.current.setDropTarget(id),
    openMenu: (event, target) => treeActionsImpl.current.openMenu(event, target),
  }), [])
  const menuTarget = menu?.target ?? null
  const selectedDiagramOwnerId = selectedDiagram?.ownerId || projectRootId
  const menuElement =
    menuTarget?.kind === 'element'
      ? model.elements.find((element) => element.id === menuTarget.id) ?? null
      : null
  const menuDiagram =
    menuTarget?.kind === 'diagram'
      ? model.diagrams.find((diagram) => diagram.id === menuTarget.id) ?? null
      : null
  const menuRelation =
    menuTarget?.kind === 'relation'
      ? model.relationships.find((relation) => relation.id === menuTarget.id) ?? null
      : null
  const menuReference: ModelReference | null = menuTarget?.kind === 'reference'
    ? { kind: menuTarget.objectKind, id: menuTarget.id } : null
  const menuReferenceDetails = menuReference && referenceDetails(menuReference, 16)
  const menuReferenceDiagram = menuReferenceDetails && menuReference ? diagramForReference(menuReference) : undefined
  const removeReference = (removal: ReferenceRemoval) => {
    const spec = propEntry?.properties.find((item) => item.key === removal.key)
    if (!canEdit || !spec?.editable || removal.targetId !== propTargetId) return
    const isRelationship = selectedRelation !== null
    setMenu(null)
    void runCommandDeferred('UPDATE_PROPERTY', () => {
      const snapshot = modelRef.current
      const target = (isRelationship ? snapshot.relationships : snapshot.elements).find((item) => item.id === removal.targetId)
      const values = propertyItems(spec.key === 'stereotypes' ? target?.stereotypes : target?.properties?.[spec.key])
      if (values[removal.index] !== removal.value) throw new Error(t('引用值已变化，请重新选择'))
      const next = values.filter((_, index) => index !== removal.index)
      return {
        id: removal.targetId, key: spec.key,
        ...(spec.kind === 'REFERENCE' || next.length === 0 ? { remove: true } : { value: next }),
      }
    })
  }
  const menuChildCount = menuElement ? descendants(menuElement.id).length : 0
  const menuInDiagram = menuElement
    ? model.diagrams.some((diagram) => diagram.elementIds.includes(menuElement.id))
    : false
  const menuTypeAllowed = menuElement
    ? (activeSpec?.allowedTypes.includes(codeOf(menuElement.type)) ?? false)
    : false

  const renderNode = (element: ModelElement, x: number, y: number, w: number, h: number, style: StyleMap = {}): ReactNode => {
    const shape = shapeOf(element.type)
    const code = codeOf(element.type)
    const info = typeInfo.get(code)
    const shapeVariant = shapeVariantOf(code, style)
    const selected = selectedId === element.id
    const multiSelected = selectedIds.size > 1 && selectedIds.has(element.id)
    const isLinkSource = relationSource === element.id
    const isPort = shape === 'port' || shape === 'flowport'
    // 生命线以图面计算为准：表头对齐到同一行，宽度取到放得下名字，竖线一直伸到共享底边。
    const lifeline = shape === 'lifeline' ? seqLifelineById.get(element.id) : undefined
    const bw = isPort ? METRICS.portSize : lifeline?.width ?? w
    const bh = isPort ? METRICS.portSize : lifeline?.height ?? h
    const bx = isPort ? x + w / 2 - bw / 2 : lifeline?.x ?? x
    const by = isPort ? y + h / 2 - bh / 2 : lifeline?.y ?? y
    const children = childrenByOwner.get(element.id) ?? []
    // 默认外观来自统一字典（shapeStyle.ts），用户样式只覆盖差异项。
    const look = appearanceOf(shape)
    // 用户样式覆盖默认值；连线起点 / 选中态是临时交互色，优先级更高。
    const fill = isLinkSource ? INTERACTIVE.linkSourceFill : selected ? INTERACTIVE.selectedFill : colorOr(style, 'fill', look.fill)
    const stroke = isLinkSource ? INTERACTIVE.linkSourceStroke : selected ? INTERACTIVE.selectedStroke : colorOr(style, 'stroke', look.stroke)
    const strokeW = isLinkSource || selected ? 2 : numberValue(style, 'strokeWidth', look.strokeWidth)
    const fontSize = numberValue(style, 'fontSize', 12)
    const smallFontSize = Math.max(8, fontSize - 2)
    const fontColor = shapeVariant && (selected || isLinkSource) ? look.textColor : colorOr(style, 'fontColor', look.textColor)
    const fontWeight = style.fontWeight === 'bold' ? 700 : undefined
    // CSS 类里的 fill / font-size 会盖住 SVG presentation attribute，
    // 因此样式覆盖必须用内联 style（优先级高于类选择器）。
    const baseTextStyle: CSSProperties = {
      ...(fontColor ? { fill: fontColor } : {}),
      ...(fontWeight ? { fontWeight } : {}),
    }
    const nameTextStyle: CSSProperties = { ...baseTextStyle, fontSize }
    const smallTextStyle: CSSProperties = { ...baseTextStyle, fontSize: smallFontSize }
    // 类三栏 / 枚举 / 用例按 UML 规范居中排字，其余左对齐（用户显式设 textAlign 时听用户的）。
    const centered = (shape === 'classifier' || shape === 'usecase' || shape === 'enumeration'
      || (!!shapeVariant && shapeVariant !== 'layer'))
      && style.textAlign === undefined
    const labelX = centered ? bx + bw / 2 : alignX(style, bx, bw)
    const labelAnchor = centered ? 'middle' : alignAnchor(style)
    const onDown = (event: ReactPointerEvent<SVGGElement>) => handlePointerDown(event, element, bx, by)

    // 类三栏：属性与操作按子元素类型分流（UML 类记法的两个隔间）。
    const attributeChildren = children.filter((child) =>
      ['Property', 'ValueProperty', 'ReferenceProperty', 'FlowProperty', 'Port', 'FlowPort', 'Parameter']
        .includes(codeOf(child.type)))
    const operationChildren = children.filter((child) => codeOf(child.type) === 'Operation')
    const classRows = {
      attributeCount: Math.min(attributeChildren.length, 3),
      operationCount: Math.min(operationChildren.length, 3),
    }

    // 包标签页：名字写进标签页（UML 规范），标签页高度跟着字号走。
    const pkgTabH = Math.max(packageTabHeight(bh), fontSize + 8)

    let shapeSvg: ReactNode = null
    switch (shapeVariant || shape) {
      case 'database':
        shapeSvg = databaseGlyph({ x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'layer':
      case 'container':
      case 'rectangle':
      case 'rounded':
        shapeSvg = <rect x={bx} y={by} width={bw} height={bh}
          rx={shapeVariant === 'rounded' ? Math.min(8, bh / 4) : 0}
          fill={fill} stroke={stroke} strokeWidth={strokeW} />
        break
      case 'package': {
        // 包名按 UML 规范写在标签页里：标签页宽度跟着名字长度走，
        // 否则「«Package»」标签会从标签页里溢出来。
        // 名字用主字号（跟随样式面板的字号设置），标签页高度随之长高。
        const tabW = Math.min(Math.max(bw * 0.28, textWidth(element.name, fontSize) + 16), bw * 0.72)
        shapeSvg = packageGlyph({ x: bx, y: by, w: bw, h: bh },
          { fill, stroke, strokeWidth: strokeW }, { tabWidth: tabW, tabHeight: pkgTabH })
        break
      }
      case 'requirement':
        shapeSvg = glyphFor('requirement', { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'comment':
        shapeSvg = glyphFor('comment', { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'usecase':
        shapeSvg = glyphFor('usecase', { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'state':
        shapeSvg = glyphFor('state', { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'pseudostate':
        shapeSvg = glyphFor('pseudostate', { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'actor': {
        // 火柴人只占框体上部，底部留给名字（UML 规范：参与者名字在人形下方）。
        // 人形本身是窄的：宽画布上画个 168 宽的火柴人只会更像一根棍。
        const glyphW = Math.min(bw, 78)
        const glyphH = bh * 0.7
        shapeSvg = glyphFor('actor',
          { x: bx + (bw - glyphW) / 2, y: by + bh * 0.05, w: glyphW, h: glyphH },
          { fill, stroke, strokeWidth: strokeW })
        break
      }
      case 'port':
      case 'flowport':
        shapeSvg = glyphFor(shape, { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'frame':
        shapeSvg = glyphFor('frame', { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
        break
      case 'swimlane': {
        const headerFill = isLinkSource ? '#d8efe9' : selected ? '#dbe7fb' : '#e8eef9'
        const bodyFill = isLinkSource ? '#f2fbf8' : selected ? '#f3f7fe' : colorOr(style, 'fill', '#fafdff')
        shapeSvg = swimlaneGlyph({ x: bx, y: by, w: bw, h: bh },
          { fill: bodyFill, stroke, strokeWidth: strokeW },
          { headerFill, bodyFill, headerHeight: SWIMLANE_HEADER })
        break
      }
      case 'lifeline': {
        const axisX = bx + bw / 2
        const axisEnd = lifeline?.bottom ?? by + bh
        const headerFill = isLinkSource ? '#d8efe9' : selected ? '#dbe7fb' : colorOr(style, 'fill', '#e6f0ff')
        shapeSvg = (
          <g>
            {/* 先竖线后表头：线从框底边起笔，压在矩形之下不留毛边。 */}
            <line className="lifeline-axis" x1={axisX} y1={by + bh} x2={axisX} y2={axisEnd} stroke={stroke} strokeWidth={strokeW} strokeDasharray="6 4" />
            <rect x={bx} y={by} width={bw} height={bh} fill={headerFill}
              stroke={lifeline?.created ? '#2f855a' : stroke} strokeWidth={strokeW} />
            {/* 被 createMessage 创建：表头不在公共表头行，绿色描边 + 左侧落点三角说明来由。 */}
            {lifeline?.created && (
              <path className="seq-created-mark" d={`M${bx - 8},${by + 4} l8,6 -8,6 z`}
                fill="#2f855a" stroke="none" pointerEvents="none" />
            )}
            <text x={axisX} y={by + 17} textAnchor="middle" className="node-type" style={smallTextStyle}>«{info?.uml ?? 'Lifeline'}»</text>
            <text x={axisX} y={by + 34} textAnchor="middle" className="node-name" style={nameTextStyle}>{wrapLabel(element.name, bw - 10, fontSize, 1)[0]}</text>
            {/* 销毁消息打到的那一行：虚线到此为止，按 UML 画一个大 X 作终止符。 */}
            {lifeline?.destroyedAt !== undefined && (
              <g className="seq-destroy" stroke="#c53030" strokeWidth={2}>
                <line x1={axisX - 7} y1={lifeline.destroyedAt - 7} x2={axisX + 7} y2={lifeline.destroyedAt + 7} />
                <line x1={axisX + 7} y1={lifeline.destroyedAt - 7} x2={axisX - 7} y2={lifeline.destroyedAt + 7} />
              </g>
            )}
            {/* 竖线也要可点：不透明命中条比 1px 虚线好抓，拖动即移动该生命线。 */}
            <rect x={axisX - 7} y={by + bh} width={14} height={Math.max(0, axisEnd - by - bh)} fill="#000000" fillOpacity={0} />
          </g>
        )
        break
      }
      case 'control': {
        const glyph = controlGlyph(element.type)
        if (!glyph) {
          shapeSvg = <rect x={bx} y={by} width={bw} height={bh} rx={8} fill={colorOr(style, 'fill', '#eef6ff')} stroke={stroke} strokeWidth={strokeW} />
          break
        }
        const cx = bx + bw / 2
        const cy = by + bh / 2
        const ink = selected ? INTERACTIVE.selectedStroke : colorOr(style, 'stroke', INK)
        const r = Math.min(bw, bh) / 2 - 1
        let glyphSvg: ReactNode
        switch (glyph) {
          case 'initial':
            glyphSvg = <circle cx={cx} cy={cy} r={r} fill={ink} />
            break
          case 'final':
            glyphSvg = (
              <g>
                <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={ink} strokeWidth={2} />
                <circle cx={cx} cy={cy} r={Math.max(3, r - 6)} fill={ink} />
              </g>
            )
            break
          case 'flowfinal':
            glyphSvg = (
              <g stroke={ink} strokeWidth={2}>
                <circle cx={cx} cy={cy} r={r} fill="#ffffff" />
                <line x1={cx - r * 0.55} y1={cy - r * 0.55} x2={cx + r * 0.55} y2={cy + r * 0.55} />
                <line x1={cx - r * 0.55} y1={cy + r * 0.55} x2={cx + r * 0.55} y2={cy - r * 0.55} />
              </g>
            )
            break
          case 'fork':
          case 'join':
            glyphSvg = <rect x={bx} y={by} width={bw} height={bh} rx={1.5} fill={ink} />
            break
          default:
            glyphSvg = (
              <polygon
                points={`${cx},${by} ${bx + bw},${cy} ${cx},${by + bh} ${bx},${cy}`}
                fill={selected ? INTERACTIVE.selectedFill : '#ffffff'}
                stroke={ink}
                strokeWidth={1.6}
              />
            )
        }
        shapeSvg = (
          <g>
            {selected && (
              <rect x={bx - 5} y={by - 5} width={bw + 10} height={bh + 10} rx={6} fill="none" stroke={INTERACTIVE.multiSelectStroke} strokeWidth={1.2} strokeDasharray="4 3" data-export="omit" />
            )}
            {glyphSvg}
            {/* 小图形难点中：透明命中区罩住图形与下方名称。 */}
            <rect x={bx - 8} y={by - 8} width={bw + 16} height={bh + 40} fill="#000000" fillOpacity={0} />
          </g>
        )
        break
      }
      case 'classifier':
        shapeSvg = classifierGlyph({ x: bx, y: by, w: bw, h: bh },
          { fill, stroke, strokeWidth: strokeW, divider: look.dividerColor }, classRows)
        break
      default:
        shapeSvg = glyphFor(shape, { x: bx, y: by, w: bw, h: bh }, { fill, stroke, strokeWidth: strokeW })
    }

    const glyphKind = shape === 'control' ? controlGlyph(element.type) : null
    const isContainer = shape === 'frame'
    const isUsecase = shape === 'usecase'
    const isClass = shape === 'classifier'
    const isEnum = shape === 'enumeration'
    const isCentredShape = isUsecase || shape === 'action' || shape === 'object'
    const showText =
      !shapeVariant && !isPort && shape !== 'pseudostate' && shape !== 'actor' && shape !== 'swimlane' && shape !== 'lifeline' && !glyphKind && !isContainer && shape !== 'package'
    const showLabel = shape === 'actor' || shape === 'pseudostate'
    // 有隔间的形状：SysML 块（子元素）与包（成员）；枚举的字面量单独按隔间线排布。
    const showCompartment =
      !shapeVariant && !isPort && (shape === 'block' || shape === 'package') && children.length > 0
    // 有隔间的形状名字只能占隔间线以上一行；其余按框高折行，末行省略，杜绝标签跨框。
    const nameLines = wrapLabel(
      element.name,
      bw - 24,
      fontSize,
      showCompartment ? 1 : Math.max(1, Math.floor((bh - 50) / (fontSize + 2)) + 1),
    )
    // 名称基线：用例 / 动作 / 对象节点按 UML 规范居中；类三栏固定在名称栏内。
    const nameBaseline = isCentredShape
      ? by + bh / 2 + fontSize / 3
      : isClass ? by + 36 : isEnum ? by + 24 : by + TEXT.nameBaseline
    const variantLines = shapeVariant
      ? wrapLabel(element.name, Math.max(1, bw - (shapeVariant === 'database' ? 32 : 20)), fontSize,
        shapeVariant === 'container' || shapeVariant === 'layer' ? 1 : Math.max(1, Math.floor((bh - 6) / (fontSize + 2))))
      : []
    // 类三栏的两段隔间高度，与 classifierGlyph 的分隔线位置保持一致。
    const classNameH = Math.min(METRICS.classNameH, bh * METRICS.classNameHRatio)
    const classAttrH = classRows.attributeCount > 0
      ? Math.min(METRICS.classLineH * classRows.attributeCount, bh * METRICS.classRowHRatio)
      : Math.min(METRICS.classLineH * 0.6, bh * METRICS.classEmptyHRatio)
    // 枚举的字面量隔间线在 55% 高度处。
    const enumDividerY = by + bh * 0.55

    return (
      <g
        className={`node ${drag?.elementId === element.id && drag.moved ? 'dragging' : ''} ${isLinkSource ? 'link-source' : ''}`}
        data-element-id={element.id}
        data-shape-variant={shapeVariant || undefined}
        fillOpacity={numberValue(style, 'fillOpacity', 1)}
        strokeDasharray={dashArray(style, 'strokeDash')}
        onPointerDown={onDown}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openMenu(event, { kind: 'element', id: element.id })
        }}
      >
        {multiSelected && !selected && (
          <rect
            x={bx - 4}
            y={by - 4}
            width={bw + 8}
            height={bh + 8}
            rx={6}
            fill="none"
            stroke="#1890ff"
            strokeWidth={1.2}
            strokeDasharray="4 3"
            data-export="omit"
          />
        )}
        {shapeSvg}
        {variantLines.length > 0 && (
          <text x={labelX}
            y={shapeVariant === 'container' ? by + Math.min(bh / 2, fontSize + 6)
              : by + bh / 2 - ((variantLines.length - 1) * (fontSize + 2)) / 2}
            dominantBaseline="central" textAnchor={labelAnchor}
            className="node-name" style={nameTextStyle} fillOpacity={1}>
            {variantLines.map((line, index) => (
              <tspan key={index} x={labelX} dy={index === 0 ? 0 : fontSize + 2}>{line}</tspan>
            ))}
          </text>
        )}
        {selected && !multiSelected && !relationTool && (
          <g
            className="node-quick-add"
            data-export="omit"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => openQuickMenu(event, element.id)}
          >
            <title>{t('添加子元素')}</title>
            {/* 华望 v4.6.0.1：图形右上角外侧 9×9 黑圆白十字；透明 rect 只放大点击热区，不改视觉。 */}
            <rect x={bx + bw - 3} y={by + 7} width={15} height={15} fill="transparent" />
            <image
              href={svgUrl('Canvasiconaddh')}
              x={bx + bw}
              y={by + 10}
              width={9}
              height={9}
              pointerEvents="none"
            />
          </g>
        )}
        {glyphKind && (
          <text x={labelX} y={by + bh + 15} textAnchor={labelAnchor} className="control-label" style={smallTextStyle} fillOpacity={1}>
            {wrapLabel(element.name, 150, smallFontSize, 2).map((line, index) => (
              <tspan key={index} x={labelX} dy={index === 0 ? 0 : smallFontSize + 1}>{line}</tspan>
            ))}
          </text>
        )}
        {showText && !isCentredShape && (
          <text x={labelX} y={by + TEXT.typeBaseline} textAnchor={labelAnchor} className="node-type" style={smallTextStyle} fillOpacity={1}>
            {wrapLabel(`«${info?.uml ?? element.type}»`, bw - 24, smallFontSize, 1)[0]}
          </text>
        )}
        {showText && (
          <text x={labelX} y={nameBaseline} textAnchor={labelAnchor} className="node-name" style={nameTextStyle} fillOpacity={1}>
            {nameLines.map((line, index) => (
              <tspan key={index} x={labelX} dy={index === 0 ? 0 : fontSize + 2}>{line}</tspan>
            ))}
          </text>
        )}
        {isContainer && (
          <text x={bx + 7} y={by + METRICS.frameTabH - 4} className="node-name" style={smallTextStyle} fillOpacity={1}>
            {wrapLabel(element.name, METRICS.frameTabW - 10, smallFontSize, 1)[0]}
          </text>
        )}
        {/* 包：名字写在文件夹的标签页里（UML 规范），用主字号（跟随样式面板设置）。 */}
        {shape === 'package' && !shapeVariant && (
          <text x={bx + METRICS.packageTabPadX} y={by + pkgTabH - 6} className="node-name" style={nameTextStyle} fillOpacity={1}>
            {wrapLabel(element.name, Math.max(20, bw * 0.72 - 12), fontSize, 1)[0]}
          </text>
        )}
        {showLabel && (
          <text x={shape === 'actor' ? bx + bw / 2 : labelX} y={by + bh - 4}
            textAnchor={shape === 'actor' ? 'middle' : labelAnchor}
            className="node-name" style={nameTextStyle} fillOpacity={1}>{element.name}</text>
        )}
        {showCompartment && (
          <>
            <line x1={bx + 6} y1={by + METRICS.dividerOffset} x2={bx + bw - 6} y2={by + METRICS.dividerOffset} stroke={look.dividerColor} strokeWidth={1} />
            {children.slice(0, 3).map((child, index) => (
              <text key={child.id} x={labelX} y={by + 66 + index * (smallFontSize + 1)} textAnchor={labelAnchor} className="node-child" style={smallTextStyle} fillOpacity={1}>{child.name}</text>
            ))}
            {children.length > 3 && (
              <text x={labelX} y={by + 66 + 3 * (smallFontSize + 1)} textAnchor={labelAnchor} className="node-child" style={smallTextStyle} fillOpacity={1}>+{children.length - 3}</text>
            )}
          </>
        )}
        {/* 类三栏：属性栏与操作栏分别列在各自隔间内。 */}
        {isClass && classRows.attributeCount > 0 && (
          <>
            {attributeChildren.slice(0, 3).map((child, index) => (
              <text key={child.id} x={bx + METRICS.classPadX} y={by + classNameH + 14 + index * METRICS.classLineH}
                className="node-child" style={smallTextStyle} fillOpacity={1}>{child.name}</text>
            ))}
            {attributeChildren.length > 3 && (
              <text x={bx + METRICS.classPadX} y={by + classNameH + 14 + 3 * METRICS.classLineH}
                className="node-child" style={smallTextStyle} fillOpacity={1}>+{attributeChildren.length - 3}</text>
            )}
          </>
        )}
        {isClass && classRows.operationCount > 0 && (
          <>
            {operationChildren.slice(0, 3).map((child, index) => (
              <text key={child.id} x={bx + METRICS.classPadX} y={by + classNameH + classAttrH + 14 + index * METRICS.classLineH}
                className="node-child" style={smallTextStyle} fillOpacity={1}>{child.name}</text>
            ))}
            {operationChildren.length > 3 && (
              <text x={bx + METRICS.classPadX} y={by + classNameH + classAttrH + 14 + 3 * METRICS.classLineH}
                className="node-child" style={smallTextStyle} fillOpacity={1}>+{operationChildren.length - 3}</text>
            )}
          </>
        )}
        {/* 枚举：字面量列在隔间线下方。 */}
        {isEnum && children.length > 0 && (
          <>
            {children.slice(0, 4).map((child, index) => (
              <text key={child.id} x={bx + METRICS.classPadX} y={enumDividerY + 16 + index * METRICS.classLineH}
                className="node-child" style={smallTextStyle} fillOpacity={1}>{child.name}</text>
            ))}
            {children.length > 4 && (
              <text x={bx + METRICS.classPadX} y={enumDividerY + 16 + 4 * METRICS.classLineH}
                className="node-child" style={smallTextStyle} fillOpacity={1}>+{children.length - 4}</text>
            )}
          </>
        )}
      </g>
    )
  }

  /**
   * 序列图的一条消息：水平箭头落在自己的时间槽上，标签压在线上方（带时间轴序号）。
   * 激活条统一由 seqLayout 画——它们可能跨越多行，不能挂在某一条消息上。
   * 线型按 UML 规范的 messageSort：同步调用实心三角、异步开放箭头、信号/创建/删除/回复带构造型。
   */
  const renderSeqMessage = (message: SeqMessage): ReactNode => {
    const style = messageSortStyle(message.sort)
    const notation = message.virtual ? { ...style, color: '#8a97a8' } : style
    const isSelected = selectedRelationId === message.relation.id || seqDrag?.relationId === message.relation.id
    // 序列消息与通用连线共用同一份「按图的连线样式」。
    const lineStyle = relationStyleOf(message.relation, activeDiagramId)
    const lineColor = colorOr(lineStyle, 'lineColor', notation.color)
    const labelSize = numberValue(lineStyle, 'labelFontSize', 10.5)
    const strokeWidth = isSelected ? 2.2 : numberValue(lineStyle, 'lineWidth', 1.4)
    const dash = dashArray(lineStyle, 'lineDash') ?? (notation.dashed ? (notation.dash || '6 4') : undefined)
    const bar = message.activation
    // 箭头停在激活条边缘，不扎进条里；没有激活条才贴到生命线中心。
    // createMessage 例外：它斜指新生命线的表头顶边，终点不能被激活条挤偏。
    const startX = message.fromX
    const endX = message.endY !== undefined
      ? message.toX
      : bar ? (message.toX >= startX ? bar.x : bar.x + bar.width) : message.toX
    const rowY = message.y
    const endY = message.endY ?? rowY
    const selfY = rowY + SEQ_SELF_HEIGHT
    const points = message.self
      ? `${startX},${rowY} ${startX + SEQ_SELF_BUMP},${rowY} ${startX + SEQ_SELF_BUMP},${selfY} ${startX},${selfY}`
      : ''
    const arrow = message.self
      ? arrowGeometry(startX + SEQ_SELF_BUMP, selfY, startX, selfY)
      : arrowGeometry(startX, rowY, endX, endY)
    const name = message.label.trim()
    const stereotype = notation.stereotype ? `«${notation.stereotype}»` : ''
    const lines: { text: string; baseline: number; color: string }[] = []
    if (stereotype) {
      lines.push({ text: stereotype, baseline: rowY - 22, color: lineColor })
    }
    if (name) {
      // 前缀时间轴序号：读图的人据此确认「谁先谁后」，与拖动改顺序直接对应。
      lines.push({ text: `${message.seqNo}: ${name}`, baseline: rowY - 8, color: '#2d3748' })
    }
    // 自消息往右折出，标签起笔在折线右侧；横向消息标签居中对齐到箭头中点。
    const anchorStart = message.self
    const labelX = anchorStart ? startX + SEQ_SELF_BUMP + 8 : (startX + endX) / 2
    const boxWidth = Math.max(0, ...lines.map((line) => line.text.length * labelSize * 0.61)) + 10
    const boxX = anchorStart ? labelX - 4 : labelX - boxWidth / 2
    const boxY = (lines[0]?.baseline ?? rowY) - 12
    const sourceName = seqLifelineById.get(message.relation.sourceId)?.element.name ?? ''
    const targetName = seqLifelineById.get(message.relation.targetId)?.element.name ?? ''
    const messageTip = (
      <title>
        {name || `«${message.relation.type}» ${relationLabel(message.relation.type)}`}
        {'：'}{sourceName} → {targetName}{t('｜点击查看 / 编辑关系属性')}
        {message.virtual ? t(' · 导入补全的只读消息') : t(' · 拖动或 Alt+↑/↓ 调整时间顺序')}
      </title>
    )
    const pickMessage = (event: ReactPointerEvent<SVGElement>) => {
      event.stopPropagation()
      if (relationTool) {
        return
      }
      setSelectedId(null)
      setSelectedDiagramId(null)
      if (message.virtual) {
        // 虚拟消息没有真实关系：选中树上的 Message 元素，别让属性面板去查一个不存在的 id。
        setSelectedRelationId(null)
        setSelectedId(message.relation.id.slice('virtual:'.length))
        say('这条消息由导入的 Message 元素补全，没有对应关系，不能改顺序')
        return
      }
      setSelectedRelationId(message.relation.id)
      if (!canEdit || event.button !== 0 || !seqLayout) {
        return
      }
      const fromIndex = seqLayout.messages.findIndex((item) => item.relation.id === message.relation.id)
      event.currentTarget.setPointerCapture(event.pointerId)
      setSeqDrag({
        relationId: message.relation.id,
        startY: event.clientY,
        fromIndex,
        targetIndex: fromIndex,
        moved: false,
      })
    }
    // 与通用关系连线一致：右键命中线弹出关系菜单（含「树上高亮」）；
    // 虚拟消息没有真实关系，改弹 Message 元素的元素菜单。
    const openMessageMenu = (event: ReactMouseEvent<SVGElement>) => {
      if (relationTool) {
        return
      }
      setSelectedId(null)
      setSelectedDiagramId(null)
      if (message.virtual) {
        setSelectedRelationId(null)
        setSelectedId(message.relation.id.slice('virtual:'.length))
        openMenu(event, { kind: 'element', id: message.relation.id.slice('virtual:'.length) })
        return
      }
      setSelectedRelationId(message.relation.id)
      openMenu(event, { kind: 'relation', id: message.relation.id })
    }
    return (
      /* 与通用连线同规矩：整组不吃指针，只有末尾透明粗线负责命中点选。 */
      <g
        key={message.relation.id}
        className={`seq-message sort-${message.sort}${message.self ? ' self' : ''}${message.virtual ? ' virtual' : ''}`}
        data-seq-sort={message.sort}
        pointerEvents="none"
      >
        {isSelected && (
          <line
            x1={Math.min(startX, endX)}
            y1={rowY}
            x2={Math.max(startX, endX)}
            y2={endY}
            stroke="#1890ff"
            strokeWidth={strokeWidth + 7}
            strokeOpacity={0.18}
            strokeLinecap="round"
          />
        )}
        {message.self ? (
          <polyline className="seq-line" points={points} fill="none" stroke={lineColor} strokeWidth={strokeWidth} strokeDasharray={dash} />
        ) : (
          <line className="seq-line" x1={startX} y1={rowY} x2={endX} y2={endY} stroke={lineColor} strokeWidth={strokeWidth} strokeDasharray={dash} />
        )}
        {notation.arrow === 'filled' && (
          <polygon points={arrow.points} fill={lineColor} stroke="none" />
        )}
        {notation.arrow === 'open' && (
          <polyline
            points={`${arrow.v1} ${message.self ? startX : endX},${message.self ? selfY : endY} ${arrow.v2}`}
            fill="none"
            stroke={lineColor}
            strokeWidth={strokeWidth}
          />
        )}
        {lines.length > 0 && (
          <>
            <rect className="seq-label" x={boxX} y={boxY} width={boxWidth} height={lines.length * (labelSize + 3) + 3} rx={3} fill="#ffffff" opacity={0.92} />
            {lines.map((line) => (
              <text
                key={line.text}
                x={labelX}
                y={line.baseline}
                textAnchor={anchorStart ? 'start' : 'middle'}
                className="edge-label"
                style={{ fill: line.color, fontSize: labelSize }}
              >
                {line.text}
              </text>
            ))}
          </>
        )}
        {message.self ? (
          <polyline
            className="seq-hit"
            points={points}
            fill="none"
            stroke="#000000"
            strokeOpacity={0}
            strokeWidth={12}
            pointerEvents={relationTool ? 'none' : 'stroke'}
            style={{ cursor: relationTool ? 'crosshair' : message.virtual ? 'default' : 'grab' }}
            onPointerDown={pickMessage}
            onContextMenu={openMessageMenu}
          >
            {messageTip}
          </polyline>
        ) : (
          <line
            className="seq-hit"
            x1={startX}
            y1={rowY}
            x2={endX}
            y2={endY}
            stroke="#000000"
            strokeOpacity={0}
            strokeWidth={12}
            strokeLinecap="round"
            pointerEvents={relationTool ? 'none' : 'stroke'}
            style={{ cursor: relationTool ? 'crosshair' : message.virtual ? 'default' : 'grab' }}
            onPointerDown={pickMessage}
            onContextMenu={openMessageMenu}
          >
            {messageTip}
          </line>
        )}
      </g>
    )
  }

  /**
   * 序列图的激活条：跨行的一段，统一画在生命线之上、消息之下。
   * 条本身不吃指针——点它应该等于点它下面的生命线或消息，所以 pointerEvents 关掉。
   */
  const renderSeqActivation = (activation: SeqActivation): ReactNode => (
    <rect
      key={`act-${activation.lifelineId}-${activation.y}-${activation.depth}`}
      className="seq-bar"
      x={activation.x}
      y={activation.y}
      width={activation.width}
      height={activation.height}
      fill="#f4f8fd"
      stroke="#9db8d9"
      strokeWidth={1}
      pointerEvents="none"
    />
  )

  /**
   * 交互图框：UML 里 Interaction 就是序列图的边框（左上五边形「sd 名称」），
   * 不是画布上可以随便拖的一个方块。图里有 Interaction 就按它框住整张图。
   *
   * <p>序列图只有这一层图框（通用图框会让开），所以样式面板里的图框样式在这里消费：
   * 框线颜色 / 粗细、标签底色、标签文字色、字号、自定义标题。</p>
   */
  const renderSeqFrame = (frame: NonNullable<typeof seqLayout>['frame']): ReactNode => {
    if (!frame) {
      return null
    }
    const border = colorOr(frameStyle, 'frameBorder', '#9aa5b1')
    const borderW = numberValue(frameStyle, 'frameBorderWidth', 1.2)
    const labelFill = colorOr(frameStyle, 'frameKindColor', '#eef2f7')
    const labelColor = colorOr(frameStyle, 'frameText', '#1c2430')
    const labelSize = Math.min(18, numberValue(frameStyle, 'frameFontSize', 12))
    const title = frameStyle.frameTitle?.trim() ? frameStyle.frameTitle : `sd ${frame.label}`
    const tabHeight = 22 + Math.max(0, labelSize - 12)
    const tabWidth = Math.max(84, estimateTextWidth(title, labelSize) + 34)
    const focused = selectedId === frame.element.id
    return (
      <g key="seq-frame" className="seq-frame" pointerEvents="none">
        <rect
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          fill="#ffffff"
          fillOpacity={0.5}
          stroke={focused ? '#1890ff' : border}
          strokeWidth={focused ? 2 : borderW}
        />
        <path
          d={`M${frame.x},${frame.y} h${tabWidth - 12} l12,${tabHeight} h-${tabWidth} z`}
          fill={labelFill}
          stroke={focused ? '#1890ff' : border}
          strokeWidth={1}
          pointerEvents="auto"
          style={{ cursor: 'pointer' }}
          onPointerDown={(event) => {
            // 五边形标签就是交互本身：点它等于选中 Interaction（框体不挡画布，别把整张图变成一块死区）。
            event.stopPropagation()
            setSelectedId(frame.element.id)
            setSelectedRelationId(null)
            setSelectedDiagramId(null)
          }}
        />
        <text
          x={frame.x + 9}
          y={frame.y + 16 + Math.max(0, labelSize - 12) / 2}
          className="seq-frame-label"
          style={{ fill: labelColor, fontSize: `${labelSize}px` }}
        >{title}</text>
      </g>
    )
  }

  /**
   * 组合片段：UML 的 alt / opt / loop 框。区间（起始/结束消息排位）与守卫都是模型属性，
   * 这里只把区间换算成图面矩形；每个操作数之间画一条水平虚线并标 [guard]。
   * 框体不吃指针，只有左上角的 operator 标签可选中（属性面板里改区间与守卫）。
   */
  const renderSeqFragment = (fragment: SeqFragment): ReactNode => {
    const focused = selectedId === fragment.element.id
    const stroke = focused ? '#1890ff' : '#8a97a8'
    const firstGuard = fragment.guards[0]?.trim()
    const label = `${fragment.operator}${firstGuard ? ` [${firstGuard}]` : ''}`
    const tabWidth = Math.max(58, label.length * 8 + 24)
    const tabHeight = 19
    return (
      <g key={`seq-fragment-${fragment.element.id}`} className="seq-fragment" pointerEvents="none">
        <rect
          x={fragment.x}
          y={fragment.y}
          width={fragment.width}
          height={fragment.height}
          fill="#f8fafc"
          fillOpacity={0.55}
          stroke={stroke}
          strokeWidth={focused ? 1.8 : 1.1}
        />
        {fragment.operandLines.map((y, index) => (
          <g key={`operand-${index}`}>
            <line
              x1={fragment.x}
              y1={y}
              x2={fragment.x + fragment.width}
              y2={y}
              stroke={stroke}
              strokeWidth={1}
              strokeDasharray="5 4"
              opacity={0.8}
            />
            {fragment.guards[index + 1]?.trim() && (
              <text x={fragment.x + 10} y={y + 14} className="seq-fragment-guard">
                {`[${fragment.guards[index + 1].trim()}]`}
              </text>
            )}
          </g>
        ))}
        <path
          d={`M${fragment.x},${fragment.y} h${tabWidth - 10} l10,${tabHeight} h-${tabWidth} z`}
          fill="#e8eef7"
          stroke={stroke}
          strokeWidth={1}
          pointerEvents="auto"
          style={{ cursor: 'pointer' }}
          onPointerDown={(event) => {
            event.stopPropagation()
            setSelectedId(fragment.element.id)
            setSelectedRelationId(null)
            setSelectedDiagramId(null)
          }}
        />
        <text x={fragment.x + 8} y={fragment.y + 13} className="seq-fragment-label">{label}</text>
      </g>
    )
  }

  // ── 顶部菜单栏：把原先散落在顶栏与画布工具条里的命令收进 8 个菜单 ──
  const renameSelection = () => {
    if (selected) {
      openNameDialog()
      return
    }
    if (selectedDiagram) {
      openDiagramDialog(selectedDiagram.ownerId, selectedDiagram)
    }
  }

  const deleteSelection = () => {
    // 画布多选：批量删除选中图形（含后代），一条 DELETE_ELEMENTS、一步撤销。
    const multi = [...selectionSet].filter((id) => {
      const element = elementById.get(id)
      return element !== undefined && !isProjectRoot(element) && !extensionRootIds.has(id)
        && positions.some((item) => item.element.id === id)
    })
    if (multi.length > 1) {
      const count = multi.reduce((sum, id) => sum + descendants(id).length, 0)
      setDeleteDialog({
        elementId: multi[0],
        name: t('{count} 个对象', { count: multi.length }),
        count,
        ids: multi,
      })
      return
    }
    if (selected) {
      if (isProjectRoot(selected)) {
        say('项目根节点不可删除')
        return
      }
      if (extensionRootIds.has(selected.id)) {
        say('通用扩展包随项目提供，不可删除；包内的元类与构造型可以删除')
        return
      }
      setDeleteDialog({ elementId: selected.id, name: selected.name, count: descendants(selected.id).length })
      return
    }
    if (selectedDiagram) {
      void submitDeleteDiagram(selectedDiagram.id)
      return
    }
    if (selectedRelation) {
      const id = selectedRelation.id
      setSelectedRelationId(null)
      void runCommand('DELETE_RELATIONSHIP', { id })
    }
  }
  deleteSelectionRef.current = deleteSelection
  renameSelectionRef.current = renameSelection

  const menus: MenuDef[] = [
    {
      label: '文件',
      entries: [
        { label: '新建项目…', run: () => setNewProjectDialog(true), disabled: !canCreateProject },
        { label: '工作空间面板', run: () => setSpaceDrawerOpen(true) },
        'separator',
        { label: '新建元素…', run: () => openCreate(null) },
        { label: '新建图…', run: () => openDiagramDialog(null) },
        { label: '新建需求表', run: () => openTableView('requirement-table') },
        { label: '新建通用表', run: () => openTableView('generic-table') },
        { label: '新建通用矩阵', run: () => openTableView('generic-matrix') },
        { label: '新建需求满足矩阵', run: () => openTableView('satisfy-matrix') },
        { label: '新建需求验证矩阵', run: () => openTableView('verify-matrix') },
        { label: '导入需求 Excel / CSV…', run: () => setRequirementImportOpen(true), disabled: !canImport },
        { label: '新建关系…', run: openRelationDialog, disabled: !canEdit || !activeDiagramObj },
        'separator',
        { label: '导入 XMI…', run: openImportDialog, disabled: !canImport },
        { label: '导出 XMI…', run: () => void runExport('xmi'), disabled: !canExport },
        { label: '导出布局侧车…', run: () => void runExport('sidecar'), disabled: !canExport },
        { label: '导出项目快照…', run: () => void runExport('native'), disabled: !canExport },
        'separator',
        { label: '导出当前图为 SVG', run: exportSvg, disabled: !canExport || !activeDiagramObj },
        { label: '导出当前图为 PNG', run: () => void exportPng(), disabled: !canExport || !activeDiagramObj },
        'separator',
        { label: '生成模型报告…', run: () => void openReport() },
        'separator',
        { label: '退出登录', run: onLogout, danger: true },
      ],
    },
    {
      label: '编辑',
      entries: [
        { label: '全局搜索…', hint: 'Ctrl/⌘ + K', run: openSearch },
        'separator',
        {
          label: '撤销',
          hint: 'Ctrl/⌘ + Z',
          run: () => void handleUndo(),
          disabled: !canEdit || busy || (health?.undoDepth ?? 0) === 0,
        },
        {
          label: '重做',
          hint: 'Ctrl + Y',
          run: () => void handleRedo(),
          disabled: !canEdit || busy || (health?.redoDepth ?? 0) === 0,
        },
        'separator',
        { label: '复制选中图形', hint: 'Ctrl/⌘ + C', run: copySelection, disabled: !canEdit || alignableCount === 0 },
        { label: '粘贴为副本', hint: 'Ctrl/⌘ + V', run: pasteClipboard, disabled: !canEdit || busy || !clipboard },
        { label: '创建副本', hint: 'Ctrl/⌘ + D', run: duplicateSelection, disabled: !canEdit || busy || alignableCount === 0 },
        { label: '全选当前图图形', hint: 'Ctrl/⌘ + A', run: selectAllInDiagram, disabled: !activeDiagramObj },
        'separator',
        { label: '重命名选中对象', hint: 'F2', run: renameSelection, disabled: !canEdit || !selected && !selectedDiagram },
        {
          label: '删除选中对象',
          hint: 'Del',
          run: deleteSelection,
          disabled: !canEdit || !selected && !selectedDiagram && !selectedRelation && selectionSet.size === 0,
          danger: true,
        },
        'separator',
        { label: '左对齐', run: () => alignSelection('left'), disabled: !canEdit || busy || alignableCount < 2 },
        { label: '水平居中', run: () => alignSelection('centerH'), disabled: !canEdit || busy || alignableCount < 2 },
        { label: '右对齐', run: () => alignSelection('right'), disabled: !canEdit || busy || alignableCount < 2 },
        { label: '顶对齐', run: () => alignSelection('top'), disabled: !canEdit || busy || alignableCount < 2 },
        { label: '垂直居中', run: () => alignSelection('centerV'), disabled: !canEdit || busy || alignableCount < 2 },
        { label: '底对齐', run: () => alignSelection('bottom'), disabled: !canEdit || busy || alignableCount < 2 },
        { label: '横向等间距', run: () => alignSelection('distH'), disabled: !canEdit || busy || alignableCount < 3 },
        { label: '纵向等间距', run: () => alignSelection('distV'), disabled: !canEdit || busy || alignableCount < 3 },
      ],
    },
    {
      label: '视图',
      entries: [
        { label: '左栏 · 项目', run: () => setLeftTab('project'), checked: leftTab === 'project' },
        { label: '左栏 · 图表', run: () => setLeftTab('charts'), checked: leftTab === 'charts' },
        { label: '左栏 · 表格', run: () => setLeftTab('tables'), checked: leftTab === 'tables' },
        { label: '左栏 · 模型库', run: () => setLeftTab('library'), checked: leftTab === 'library' },
        'separator',
        { label: '属性档位 · 标准', run: () => setPropView('STANDARD'), checked: propView === 'STANDARD' },
        { label: '属性档位 · 专家', run: () => setPropView('EXPERT'), checked: propView === 'EXPERT' },
        { label: '属性档位 · 全部', run: () => setPropView('ALL'), checked: propView === 'ALL' },
        'separator',
        {
          label: toolboxCollapsed ? '展开组件工具箱' : '收起组件工具箱',
          run: () => setToolboxCollapsed((previous) => !previous),
        },
        { label: '适应窗口', run: fitCanvas },
        { label: '小地图', run: () => setMinimapOpen((previous) => !previous), checked: minimapOpen },
        {
          label: 'SysML 图框',
          run: () => setFrameVisible(!frameEnabled),
          checked: frameEnabled,
          disabled: !!seqLayout?.frame,
          hint: seqLayout?.frame ? '序列图用 sd 图框，不再叠一层' : undefined,
        },
        { label: '缩放重置 100%', run: () => applyZoom(1), disabled: !canEdit || zoom === 1 && pan.x === 0 && pan.y === 0 },
      ],
    },
    {
      label: '模型',
      entries: [
        { label: '在项目根下新建元素…', run: () => openCreate(projectRootId) },
        { label: '新建关系…', run: openRelationDialog, disabled: !canEdit || !activeDiagramObj },
        'separator',
        {
          label: '把选中元素加入当前图',
          run: () => selectedId && void addToCurrentDiagram(selectedId),
          disabled: !canEdit || !selectedId || !activeDiagramId,
        },
        {
          label: '在图中定位选中元素',
          run: () => selectedId && locateInDiagram(selectedId),
          disabled: !canEdit || !selectedId,
        },
        'separator',
        {
          label: '自动排布…',
          run: () => setLayoutDialog(activeDiagramObj ? 'diagram' : 'all'),
          disabled: !canEdit || busy || model.diagrams.length === 0,
        },
        'separator',
        { label: '重新连接并刷新', run: () => void bootstrap() },
      ],
    },
    {
      label: '分析',
      entries: [
        {
          label: '校验问题面板',
          run: () => openBottomDock('problems'),
          checked: bottomDockOpen && bottomDockTab === 'problems',
        },
        {
          label: '需求覆盖矩阵',
          run: () => openBottomDock('coverage'),
          checked: bottomDockOpen && bottomDockTab === 'coverage',
        },
        { label: '生成模型报告…', run: () => void openReport() },
        'separator',
        {
          label: '模型统计',
          run: () => say('{elements} 元素 · {relations} 关系 · {diagrams} 图 · rev {revision}', {
            elements: model.elements.length,
            relations: model.relationships.length,
            diagrams: model.diagrams.length,
            revision: health?.revision ?? model.revision,
          }),
        },
        {
          label: '规范属性目录',
          run: () => say('元类 {types} · 元属性 {props} · 关系类型 {relations}', {
            types: propCatalog?.metaclasses.length ?? 0,
            props: Object.values(propCatalog?.types ?? {}).reduce((sum, entry) => sum + entry.properties.length, 0),
            relations: Object.keys(propCatalog?.relationships ?? {}).length,
          }),
        },
        'separator',
        { label: '重新校验并刷新', run: () => { void refresh(); void loadValidation() } },
      ],
    },
    {
      label: '工具',
      entries: [
        { label: '界面语言 · 中文', run: () => setLocale('zh'), checked: locale === 'zh' },
        { label: '界面语言 · English', run: () => setLocale('en'), checked: locale === 'en' },
        'separator',
        { label: '导出当前图为 SVG', run: exportSvg, disabled: !activeDiagramObj },
        { label: '导出当前图为 PNG', run: () => void exportPng(), disabled: !activeDiagramObj },
        { label: '适应窗口', run: fitCanvas },
      ],
    },
    {
      label: '窗口',
      entries: [
        ...tabs.slice(0, 12).map<MenuEntry>((tab) => ({
          label: tab.kind === 'diagram'
            ? `图 · ${model.diagrams.find((item) => item.id === tab.id)?.name ?? tab.id}`
            : `对象 · ${elementById.get(tab.id)?.name ?? tab.id}`,
          run: () => activateTab(tab),
          checked: activeTabKey === `${tab.kind}:${tab.id}`,
        })),
        ...(tabs.length > 0 ? ['separator' as const] : []),
        {
          label: '关闭其他标签',
          run: () => {
            const keep = tabs.find((tab) => `${tab.kind}:${tab.id}` === activeTabKey)
            if (keep) {
              closeOtherTabs(keep)
            }
          },
          disabled: !canEdit || tabs.length < 2,
        },
        { label: '关闭全部标签', run: () => { setTabs([]); setActiveViewId('') }, disabled: !canEdit || tabs.length === 0 },
      ],
    },
    {
      label: '帮助',
      entries: [
        {
          label: '快捷键',
          run: () => say('Ctrl/⌘+K 全局搜索 · Ctrl/⌘+Z 撤销 · Ctrl+Y 重做 · Shift+点选多选 · Shift+空白拖拽框选 · Ctrl/⌘+C/V/D 复制/粘贴/副本 · Ctrl/⌘+A 全选 · Del 删除 · F2 重命名 · 方向键微调（Shift ×10） · Esc 取消多选/退出连线 · 空白拖动或双指滚动平移 · 捏合或 Ctrl/⌘+滚轮缩放'),
        },
        {
          label: '关于 Scofen Modeler Studio',
          run: () => say('Scofen Modeler Studio · SysML 1.6 / UML 2.5.1 轻量建模器 · 每个项目独立命令通道与撤销栈'),
        },
      ],
    },
  ]

  return (
    <div className="app">
      {adminOpen && (
        <AdminPanel
          onClose={() => setAdminOpen(false)}
          onMessage={(key, vars) => say(key, vars)}
        />
      )}
      {connectionError && (
        <div className="connection-banner" role="alert">
          <span className="cb-dot" aria-hidden="true" />
          <span className="cb-text">{t('连接服务端失败：{error}', { error: connectionError })}</span>
          <span className="cb-retry">{t('自动重试第 {count} 次', { count: retryCount + 1 })}</span>
          <button type="button" onClick={() => void bootstrap()}>{t('立即重试')}</button>
        </div>
      )}
      <header className="topbar">
        <nav className="menubar" ref={menubarRef}>
          <span className="mb-brand">
            <span className="mark" aria-hidden="true" />
            <strong>Scofen Modeler Studio</strong>
          </span>
          {menus.map((menu) => (
            <div className="mb-item" key={menu.label}>
              <button
                type="button"
                className={`mb-btn ${menubarOpen === menu.label ? 'open' : ''}`}
                onClick={() => setMenubarOpen((previous) => (previous === menu.label ? null : menu.label))}
                onPointerEnter={() => { if (menubarOpen) { setMenubarOpen(menu.label) } }}
              >
                {t(menu.label)}
              </button>
              {menubarOpen === menu.label && (
                <div className="mb-drop" role="menu">
                  {menu.entries.map((entry, index) => (
                    entry === 'separator'
                      ? <div className="mb-sep" key={`sep-${index}`} role="separator" />
                      : (
                        <button
                          type="button"
                          role="menuitem"
                          key={`${entry.label}-${index}`}
                          className={`mb-entry${entry.checked ? ' checked' : ''}${entry.danger ? ' danger' : ''}`}
                          disabled={entry.disabled}
                          title={entry.hint ? t(entry.hint) : undefined}
                          onClick={() => {
                            setMenubarOpen(null)
                            entry.run?.()
                          }}
                        >
                          <span className="mb-check">{entry.checked ? '✓' : ''}</span>
                          <span className="mb-entry-label">{t(entry.label)}</span>
                          {entry.hint && <span className="mb-hint">{t(entry.hint)}</span>}
                        </button>
                      )
                  ))}
                </div>
              )}
            </div>
          ))}
          <span className="mb-fill" />
          <button type="button" className="project-menu-button" disabled={!activeGrant?.canView}
            onClick={() => { setProjectPanel({ section: 'review' }); void refreshProjectOverview() }}>项目工作区</button>
          <LocaleSwitch compact />
          <div className="user-chip">
            <span className="user-avatar" aria-hidden="true">{session.user.username.slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{session.user.displayName}</span>
            {!canEdit && <span className="role-badge" title={t('当前角色只能查看，不能编辑模型')}>{t('只读')}</span>}
            {canManageUsers && (
              <button type="button" onClick={() => setAdminOpen((open) => !open)} title={t('用户与角色')}>
                {t('用户')}
              </button>
            )}
            <button type="button" onClick={onLogout} title={t('退出登录')}>{t('登出')}</button>
          </div>
        </nav>

        <div className="toolbar">
          <div className="tb-icons">
            <button type="button" className="tbi" title={t('新建元素…')} disabled={!canEdit} onClick={() => openCreate(null)}>＋</button>
            <button type="button" className="tbi" title={t('新建图…')} disabled={!canEdit} onClick={() => openDiagramDialog(null)}>▧</button>
            <button type="button" className="tbi" title={t('新建关系…')} disabled={!canEdit || !activeDiagramObj} onClick={openRelationDialog}>↔</button>
            <span className="tbi-sep" />
            <button type="button" className="tbi" title={t('撤销 · Ctrl/⌘ + Z')} disabled={!canEdit || busy || (health?.undoDepth ?? 0) === 0} onClick={() => void handleUndo()}>↶</button>
            <button type="button" className="tbi" title={t('重做 · Ctrl + Y')} disabled={!canEdit || busy || (health?.redoDepth ?? 0) === 0} onClick={() => void handleRedo()}>↷</button>
            <span className="tbi-sep" />
            <button type="button" className="tbi" title={t('放大')} onClick={() => applyZoom(zoom * 1.25)}>＋</button>
            <button type="button" className="tbi" title={t('缩小')} onClick={() => applyZoom(zoom / 1.25)}>−</button>
            <button type="button" className="tbi wide" title={t('适应窗口')} onClick={fitCanvas}>{t('适应')}</button>
            <button
              type="button"
              className="tbi wide"
              title={t('自动排布：按关系语义重排当前图的节点坐标')}
              disabled={!canEdit || busy || model.diagrams.length === 0}
              onClick={() => setLayoutDialog(activeDiagramObj ? 'diagram' : 'all')}
            >{t('排布')}</button>
            <span className="tbi-sep" />
            <button type="button" className="tbi" title={t('导出当前图为 SVG')} disabled={!activeDiagramObj} onClick={exportSvg}>⇩</button>
          </div>

        {/* 空间 / 项目选择器：替代原来的常驻最左列与顶部九图切换条 */}
        <div className="project-picker" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`project-switch ${projectPickerOpen ? 'open' : ''}`}
            onClick={() => setProjectPickerOpen((open) => !open)}
            title={t('切换空间与项目')}
          >
            <span className="pp-space">{currentSpaceLabel}</span>
            <span className="crumb-sep">/</span>
            <TypeIcon code="PACKAGE" size={14} />
            <strong>{workspace?.currentProjectName ?? projectRoot?.name ?? t('未命名项目')}</strong>
            <span className="crumb-tag">{t('当前项目')}</span>
            <span className="pp-caret">▾</span>
          </button>
          {projectPickerOpen && (
            <div className="project-popover">
              <div className="pp-head">
                <span>{t('工作空间与项目')}</span>
                <button
                  type="button"
                  onClick={() => { setSpaceDrawerOpen(true); setProjectPickerOpen(false) }}
                >{t('完整面板')}</button>
              </div>
              <div className="pp-scroll">
                {(workspace?.spaces ?? []).map((space) => (
                  <div className="pp-space-group" key={space.code}>
                    <div className="pp-space-title">
                      <span className={`space-glyph ${space.kind}`} aria-hidden="true">
                        {space.kind === 'personal' ? '◉' : '◎'}
                      </span>
                      <strong>{space.label}</strong>
                      <span className="space-count">{space.projectCount}</span>
                      <button
                        type="button"
                        title={t('在{space}新建项目', { space: space.label })}
                        onClick={() => openNewProject(space.code)}
                      >＋</button>
                    </div>
                    {space.projects.map((project) => (
                      <div className="pp-project-row" key={project.id}>
                        <button
                          type="button"
                          className={`pp-project ${project.id === activeProjectId ? 'active' : ''}`}
                          onClick={() => openProject(project)}
                          title={`${project.name} · ${project.description || project.status}`}
                        >
                          <TypeIcon code="PACKAGE" size={15} />
                          <span className="pp-project-body">
                            <span className="pp-project-name">{project.name}</span>
                            <span className="pp-project-meta">
                              {project.opened
                                ? t('{diagrams} 图 · {elements} 元素 · rev {revision}', { diagrams: project.diagramCount, elements: project.elementCount, revision: project.revision })
                                : t('尚未打开 · 点击打开')}
                            </span>
                          </span>
                          {project.id === activeProjectId
                            ? <span className="pp-current">{t('已打开')}</span>
                            : <span className="pp-open">{t('打开')}</span>}
                        </button>
                        {project.deletable && (
                          <button
                            type="button"
                            className="pp-project-del"
                            data-project-delete={project.id}
                            title={t('删除项目「{name}」', { name: project.name })}
                            aria-label={t('删除项目「{name}」', { name: project.name })}
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleteProjectTarget(project)
                            }}
                          >×</button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {!workspace && <p className="hint">{t('正在加载空间目录…')}</p>}
              </div>
              <div className="pp-foot">
                <span>{t('点击项目即可打开 · 新建后自动打开')}</span>
                <button
                  type="button"
                  onClick={() => { setSpaceDrawerOpen(true); setProjectPickerOpen(false) }}
                >{t('空间详情')}</button>
              </div>
            </div>
          )}
        </div>

        <div className="top-actions">
          <span className="pill">{t('SysML 1.6 · 十图')}</span>
          <span className="pill rev">{t('rev {revision}', { revision: health?.revision ?? model.revision })}</span>
        </div>
        </div>
      </header>

      <div
        className={`workspace ${toolboxCollapsed ? 'toolbox-collapsed' : ''}`}
        ref={workspaceRef}
        style={{
          '--dock-left': `${Math.round(dockWidths.left)}px`,
          '--dock-tool': `${Math.round(dockWidths.tool)}px`,
        } as CSSProperties}
      >
        {/* 列宽拖拽手柄：贴在两列分隔线上（窄屏媒体查询会隐藏）。 */}
        <div
          className={`dock-resizer left${dockDrag === 'left' ? ' dragging' : ''}`}
          style={{ left: `${Math.round(dockWidths.left)}px` }}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('拖动调整模型树宽度')}
          data-dock-resizer="left"
          onPointerDown={(event) => {
            event.preventDefault()
            setDockDrag('left')
          }}
        />
        {!toolboxCollapsed && (
          <div
            className={`dock-resizer tool${dockDrag === 'tool' ? ' dragging' : ''}`}
            style={{ left: `${Math.round(dockWidths.left + 1 + dockWidths.tool)}px` }}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('拖动调整工具箱宽度')}
            data-dock-resizer="tool"
            onPointerDown={(event) => {
              event.preventDefault()
              setDockDrag('tool')
            }}
          />
        )}
        {/* 完整空间面板按需从左侧展开；平时只保留顶栏的项目选择器，不占画布宽度 */}
        {spaceDrawerOpen && (
          <>
            <div className="drawer-scrim" onPointerDown={() => setSpaceDrawerOpen(false)} />
            <aside className="space-drawer" aria-label={t('空间与项目导航')}>
          <div className="space-head">
            <span className="space-title">{t('工作空间')}</span>
            <button
              type="button"
              className="drawer-close"
              title={t('收起空间面板')}
              onClick={() => setSpaceDrawerOpen(false)}
            >×</button>
            <button
              type="button"
              className="space-add"
              title={t('新建项目')}
              onClick={() => openNewProject('personal')}
            >＋</button>
          </div>
          <div className="space-scroll">
            {(workspace?.spaces ?? []).map((space) => (
              <div className="space-group" key={space.code}>
                <button
                  type="button"
                  className={`space-group-head ${openSpaces.has(space.code) ? 'open' : ''}`}
                  onClick={() => toggleSpace(space.code)}
                >
                  <span className={`space-glyph ${space.kind}`} aria-hidden="true">
                    {space.kind === 'personal' ? '◉' : '◎'}
                  </span>
                  <span className="space-group-label">{space.label}</span>
                  <span className="space-count">{space.projectCount}</span>
                  <span className="space-caret">{openSpaces.has(space.code) ? '⌄' : '›'}</span>
                </button>
                {openSpaces.has(space.code) && (
                  <div className="space-projects">
                    <div className="space-owner">
                      {space.owner} · {t('{count} 成员', { count: space.memberCount })}
                      <button
                        type="button"
                        className="space-owner-add"
                        title={t('在{space}新建项目', { space: space.label })}
                        onClick={() => openNewProject(space.code)}
                      >＋</button>
                    </div>
                    {space.projects.map((project) => (
                      <div className="space-project-row" key={project.id}>
                        <button
                          type="button"
                          className={`space-project ${project.id === activeProjectId ? 'selected' : ''} ${project.current ? 'current' : ''}`}
                          onClick={() => openProject(project)}
                          title={`${project.name} · ${project.description || project.status}`}
                        >
                          <TypeIcon code={project.current ? 'MODEL' : 'PACKAGE'} size={15} />
                          <span className="space-project-body">
                            <span className="space-project-name">{project.name}</span>
                            <span className="space-project-meta">
                              {project.opened
                                ? t('{diagrams} 图 · {elements} 元素 · rev {revision}', { diagrams: project.diagramCount, elements: project.elementCount, revision: project.revision })
                                : t('尚未打开 · {owner}', { owner: project.owner })}
                            </span>
                          </span>
                          {project.current && <span className="space-current-dot" title={t('当前编辑项目')} />}
                        </button>
                        {project.deletable && (
                          <button
                            type="button"
                            className="space-project-del"
                            data-project-delete={project.id}
                            title={t('删除项目「{name}」', { name: project.name })}
                            aria-label={t('删除项目「{name}」', { name: project.name })}
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleteProjectTarget(project)
                            }}
                          >×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!workspace && <p className="hint">{t('正在加载空间目录…')}</p>}

            {/* 项目详情与目录说明跟随列表一起滚动，不占用项目列表的可视高度 */}
            {selectedProject && (
              <div className="space-detail">
                <div className="space-detail-head">
                  <TypeIcon code={selectedProject.current ? 'MODEL' : 'PACKAGE'} size={16} />
                  <strong>{selectedProject.name}</strong>
                </div>
                <p className="space-detail-desc">{selectedProject.description || t('暂无描述')}</p>
                <div className="kv"><span>{t('所属空间')}</span><code>{workspace?.spaces.find((s) => s.code === selectedProject.spaceCode)?.label ?? '—'}</code></div>
                <div className="kv"><span>{t('负责人')}</span><code>{selectedProject.owner}</code></div>
                <div className="kv"><span>{t('状态')}</span><code>{selectedProject.status}</code></div>
                {selectedProject.current ? (
                  <>
                    <div className="kv"><span>{t('图 / 元素')}</span><code>{selectedProject.diagramCount} / {selectedProject.elementCount}</code></div>
                    <div className="kv"><span>{t('关系 / 修订')}</span><code>{selectedProject.relationshipCount} / rev {selectedProject.revision}</code></div>
                  </>
                ) : (
                  <p className="space-detail-note">{t('点击项目即可打开并编辑；M0 内存态模型在服务重启后回到初始基线。')}</p>
                )}
              </div>
            )}
            <div className="space-foot">{workspace?.note ?? t('空间目录加载中…')}</div>
          </div>
        </aside>
          </>
        )}

        <div className="left-dock" ref={leftDockRef}>
        <aside className="tree">
          <div className="tree-head" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'project'}
              className={`tree-head-tab ${leftTab === 'project' ? 'active' : ''}`}
              onClick={() => setLeftTab('project')}
            >{t('项目')}</button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'charts'}
              className={`tree-head-tab ${leftTab === 'charts' ? 'active' : ''}`}
              onClick={() => setLeftTab('charts')}
            >{t('图表')}</button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'tables'}
              className={`tree-head-tab ${leftTab === 'tables' ? 'active' : ''}`}
              onClick={() => setLeftTab('tables')}
            >{t('表格')}</button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'library'}
              className={`tree-head-tab ${leftTab === 'library' ? 'active' : ''}`}
              onClick={() => setLeftTab('library')}
            >{t('模型库')}</button>
            <span className="tree-head-count" title={t('项目元素数（不含隔离的扩展包）')}>{projectElements.length}</span>
            <button
              type="button"
              className="tree-head-search"
              title={t('全局搜索（Ctrl/⌘+K）')}
              aria-label={t('全局搜索')}
              onClick={openSearch}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="6.8" cy="6.8" r="4.2" /><path d="M10 10l3.6 3.6" />
              </svg>
            </button>
          </div>
          {leftTab === 'project' ? (
            <div className="browser-filter">
              <input
                value={treeFilter}
                onChange={(event) => setTreeFilter(event.target.value)}
                placeholder={t('按名称筛选元素 / 图…')}
                aria-label={t('筛选模型树')}
              />
              {treeFilter && (
                <button type="button" className="clear-filter" onClick={() => setTreeFilter('')} title={t('清除筛选')}>×</button>
              )}
              {/* 扩展包显示 / 隐藏：与项目隔离的系统内容，切换是否内嵌到项目树 */}
              <button
                type="button"
                className={`ext-toggle${showExtensions ? ' active' : ''}`}
                aria-pressed={showExtensions}
                aria-label={showExtensions ? t('隐藏扩展包') : t('显示扩展包')}
                title={t('{action} · UML / SysML 扩展包与项目隔离，由系统内嵌提供', {
                  action: showExtensions ? t('隐藏扩展包') : t('显示扩展包'),
                })}
                data-tree-kind="ext-toggle"
                onClick={() => setShowExtensions((previous) => !previous)}
              >
                <TypeIcon code="PROFILE" size={15} />
                <span className="ext-toggle-mark" aria-hidden="true">{showExtensions ? '◉' : '○'}</span>
              </button>
            </div>
          ) : leftTab === 'charts' ? (
            <div className="panel-title panel-title-charts">
              <span>{t('按图类型分组 · 共 {count} 张', { count: model.diagrams.length })}</span>
              <span className="chart-group-actions">
                <button
                  type="button"
                  className="chart-group-action"
                  onClick={() => setCollapsedChartKinds(new Set())}
                >{t('展开全部')}</button>
                <button
                  type="button"
                  className="chart-group-action"
                  onClick={() => setCollapsedChartKinds(new Set(diagramsByKind.map(([kind]) => kind)))}
                >{t('折叠全部')}</button>
              </span>
            </div>
          ) : leftTab === 'tables' ? (
            <div className="panel-title">{t('表格与矩阵 · 双击打开视图')}</div>
          ) : (
            <div className="panel-title">
              {t('通用扩展包 · 元类 / 构造型 / 关系')}
            </div>
          )}
          <div
            className={`browser${treeVirtual ? ' virtualized' : ''}`}
            ref={browserRef}
            onScroll={handleTreeScroll}
            onContextMenu={(event) => openMenu(event, { kind: 'root', id: null })}
          >
            {leftTab === 'charts' ? (
              <>
                {diagramsByKind.map(([kind, list]) => {
                  // 自定义图类型的 key 是定义元素 id，图符仍用它的基底 kind（目录里带着）。
                  const customType = customization?.diagramTypes.find((item) => item.id === kind)
                  return (
                  <section className="chart-group" key={kind}>
                    <button
                      type="button"
                      className="chart-group-head"
                      aria-expanded={!collapsedChartKinds.has(kind)}
                      title={collapsedChartKinds.has(kind) ? t('展开该类型') : t('折叠该类型')}
                      onClick={() => setCollapsedChartKinds((previous) => {
                        const next = new Set(previous)
                        if (next.has(kind)) {
                          next.delete(kind)
                        } else {
                          next.add(kind)
                        }
                        return next
                      })}
                    >
                      <span className={`chart-group-chevron ${collapsedChartKinds.has(kind) ? 'collapsed' : ''}`} aria-hidden="true">▾</span>
                      <DiagramIcon code={customType?.baseKind ?? kind} size={14} />
                      <span className="chart-group-label">{diagramLabel(kind)}</span>
                      <span className="chart-group-count">{list.length}</span>
                    </button>
                    {!collapsedChartKinds.has(kind) && list.map((diagram) => (
                      <button
                        type="button"
                        key={diagram.id}
                        className={`chart-row chart-item ${diagram.id === activeDiagramId ? 'active' : ''}`}
                        data-diagram-id={diagram.id}
                        title={t('{name} · {count} 个元素', { name: diagram.name, count: diagram.elementIds.length })}
                        onClick={() => {
                          setActiveDiagramId(diagram.id)
                          setSelectedDiagramId(diagram.id)
                          setSelectedId(null)
                          openTab({ kind: 'diagram', id: diagram.id })
                        }}
                      >
                        <span className="chart-row-name">{diagram.name}</span>
                        <span className="chart-row-count">{diagram.elementIds.length}</span>
                      </button>
                    ))}
                  </section>
                  )
                })}
                {diagramsByKind.length === 0 && <p className="hint">{t('暂无图，右键空白处新建图')}</p>}
              </>
            ) : leftTab === 'tables' ? (
              <>
                {TABLE_VIEWS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`chart-row chart-item ${activeViewId === item.id ? 'active' : ''}`}
                    data-table-view-id={item.id}
                    title={item.labelEn}
                    onClick={() => openTableView(item.id)}
                  >
                    <img src={svgUrl(item.icon)} width={15} height={15} alt="" aria-hidden="true" />
                    <span className="chart-row-name">{t(item.label)}</span>
                  </button>
                ))}
                <p className="browser-note">
                  {t('需求表、通用表与通用矩阵直接读取当前模型；属性与关系的修改仍走模型命令，可撤销。')}
                </p>
              </>
            ) : leftTab === 'library' ? (
              <>
                {libraryPackages.map(({ pkg, metaclasses, stereotypes, relationships }) => (
                  <section className="chart-group" key={pkg.id}>
                    <button
                      type="button"
                      className={`chart-row ${pkg.id === selectedId ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedId(pkg.id)
                        setSelectedDiagramId(null)
                        setSelectedRelationId(null)
                      }}
                    >
                      <TypeIcon code="PACKAGE" size={14} />
                      <span className="chart-row-name">{pkg.name}</span>
                      <span className="chart-row-count">{metaclasses} / {stereotypes} / {relationships}</span>
                    </button>
                    <p className="chart-group-note">
                      {t('元类 {metaclasses} · 构造型 {stereotypes} · 关系 {relationships}',
                        { metaclasses, stereotypes, relationships })}
                    </p>
                  </section>
                ))}
                {libraryPackages.length === 0 && <p className="hint">{t('扩展包清单加载中…')}</p>}
                <p className="browser-note">
                  {t('扩展包随项目提供、整体不可删；包内元类、构造型与关系可增删。')}
                </p>
              </>
            ) : (
              <>
            <TreeDataContext.Provider value={treeData}>
              <TreeActionsContext.Provider value={treeActions}>
                {treeVirtual && <div className="tree-spacer" style={{ height: treeWindow.start * TREE_ROW_H }} aria-hidden="true" />}
                {treeWindow.rows.map((row) => (
                  <TreeRow key={`${row.kind}:${row.id}:${row.ownerId ?? ''}`} {...row} />
                ))}
                {treeVirtual && <div className="tree-spacer" style={{ height: (visibleRows.length - treeWindow.end) * TREE_ROW_H }} aria-hidden="true" />}
              </TreeActionsContext.Provider>
            </TreeDataContext.Provider>
            {rootNodes.length === 0 && <p className="hint">{t('暂无元素，右键空白处新建元素')}</p>}
            {treeFilterHits && treeFilterHits.size === 0 && (
              <p className="hint">{t('没有匹配「{keyword}」的元素或图', { keyword: treeFilter })}</p>
            )}
            <div className="browser-foot">
              <span>{t('{elements} 元素 · {diagrams} 图', { elements: projectElements.length, diagrams: model.diagrams.length })}</span>
              <span>{t('{count} 关系', { count: model.relationships.length })}</span>
            </div>
              </>
            )}
          </div>

        </aside>

        <aside
          className="props-dock"
          aria-label={t('属性窗口（常驻左下角）')}
          onContextMenu={(event) => {
            // 属性栏正文也接受关系右键：顶部对象头已有菜单，但用户常常直接右键正文，
            // 这里按当前展示的关系补一个同款菜单；输入框 / 按钮保留原生右键。
            if (!selectedRelation) {
              return
            }
            const target = event.target as HTMLElement
            if (target.closest('input, textarea, select, button, a, .props-object')) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            openMenu(event, { kind: 'relation', id: selectedRelation.id })
          }}
          style={propsHeight == null
            ? undefined
            : { height: `${Math.round(propsHeight)}px`, maxHeight: 'none' }}
        >
          {/* 上下分隔把手：拖拽调整属性窗口高度，双击恢复默认 */}
          <div
            className={`props-grip${dockDrag === 'props' ? ' dragging' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('拖动调整属性窗口高度')}
            title={t('上下拖动调整属性窗口高度，双击恢复默认')}
            data-dock-resizer="props"
            onPointerDown={(event) => {
              event.preventDefault()
              setDockDrag('props')
            }}
            onDoubleClick={() => setPropsHeight(null)}
          />
          <div className="props-head">
            {([
              ['attrs', '属性'],
              ['tags', '标签'],
              ['relations', '关系'],
              ['whereused', '引用面板'],
              ['notation', '记法'],
            ] as const).map(([code, label]) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={propsTab === code}
                className={`props-tab ${propsTab === code ? 'active' : ''}`}
                onClick={() => setPropsTab(code)}
              >{t(label)}</button>
            ))}
          </div>
          <div
            className="props-object"
            title={t('右键可在模型树中高亮当前对象')}
            onContextMenu={(event) => {
              // 属性框顶部对象头与模型树 / 画布同源：按当前展示的对象派发对应右键菜单，
              // 让「图上选一个图形 → 属性框右键 → 树中持久高亮」这条链路可用。
              if (selectedDiagram) {
                openMenu(event, { kind: 'diagram', id: selectedDiagram.id })
              } else if (selectedRelation) {
                openMenu(event, { kind: 'relation', id: selectedRelation.id })
              } else if (selected) {
                openMenu(event, { kind: 'element', id: selected.id })
              }
            }}
          >
            {selectedDiagram ? (
              <DiagramIcon code={selectedDiagram.kind} size={20} />
            ) : selectedRelation ? (
              <RelationIcon code={selectedRelation.type} size={20} />
            ) : selected ? (
              <TypeIcon code={codeOf(selected.type)} size={20} />
            ) : (
              <span className="props-placeholder" aria-hidden="true">—</span>
            )}
            <span className="props-object-name">
              {selectedDiagram?.name
                ?? selected?.name
                ?? (selectedRelation
                  ? (selectedRelation.name?.trim() || `«${selectedRelation.type}» ${relationLabel(selectedRelation.type)}`)
                  : t('未选择对象'))}
            </span>
            <span className="props-object-kind">
              {selectedDiagram
                ? diagramLabel(selectedDiagram.kind)
                : selectedRelation
                  ? t('关系 · {relation}', { relation: relationLabel(selectedRelation.type) })
                  : selected
                    ? typeLabel(selected.type)
                    : ''}
            </span>
          </div>
          {propsTab === 'attrs' ? (
            selectedDiagram ? (
              <>
                <div className="kv"><span>{t('类型')}</span><code>{t('图 · {label}', { label: pick(specs.find((s) => s.code === selectedDiagram.kind)?.label, specs.find((s) => s.code === selectedDiagram.kind)?.labelEn) ?? selectedDiagram.kind })}</code></div>
                <label className="field">
                  <span>{t('图名称')}</span>
                  <input
                    defaultValue={selectedDiagram.name}
                    key={selectedDiagram.id}
                    onBlur={(event) => handleRenameDiagram(selectedDiagram.id, event.target.value)}
                  />
                </label>
                <div className="kv">
                  <span>{t('所有者')}</span>
                  {selectedDiagramOwnerId
                    ? renderModelReference({ kind: 'element', id: selectedDiagramOwnerId }, 'diagram-owner')
                    : <code>{t('项目根')}</code>}
                </div>
                <div className="kv"><span>{t('元素数')}</span><code>{t('{count} 个', { count: selectedDiagram.elementIds.length })}</code></div>
                <div className="kv"><span>ID</span><code>{selectedDiagram.id}</code></div>
              </>
            ) : (selected || selectedRelation) ? (
              <>
                <div className="prop-toolbar">
                  <button
                    type="button"
                    className={`prop-tool${propSearchOpen || propQuery ? ' on' : ''}`}
                    title={t('按属性 key 搜索')}
                    aria-label={t('按属性 key 搜索')}
                    onClick={() => setPropSearchOpen((previous) => !previous || !!propQuery)}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <circle cx="6.8" cy="6.8" r="4.2" /><path d="M10 10l3.6 3.6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={`prop-tool prop-sort-tool${propSort !== 'CATALOG' ? ' on' : ''}`}
                    title={propSort === 'CATALOG'
                      ? t('按属性 key 排序（当前：规范顺序）')
                      : propSort === 'KEY_ASC'
                        ? t('按属性 key 升序（点击切换降序）')
                        : t('按属性 key 降序（点击恢复规范顺序）')}
                    onClick={() => setPropSort((previous) =>
                      previous === 'CATALOG' ? 'KEY_ASC' : previous === 'KEY_ASC' ? 'KEY_DESC' : 'CATALOG')}
                  >{propSort === 'CATALOG' ? '⇅' : propSort === 'KEY_ASC' ? 'A↓Z' : 'Z↓A'}</button>
                  <button
                    type="button"
                    className="prop-tool"
                    title={t('展开 / 收起全部属性分组')}
                    aria-label={t('展开 / 收起全部属性分组')}
                    onClick={() => setCollapsedPropGroups((previous) =>
                      previous.size >= propGroups.length && propGroups.length > 0
                        ? new Set<string>()
                        : new Set(propGroups.map((group) => group.code)))}
                  >▤</button>
                  <span className="prop-tool-spacer" />
                  <select
                    className="prop-view-select"
                    value={propView}
                    title={t('属性档位')}
                    aria-label={t('属性档位')}
                    onChange={(event) => setPropView(event.target.value as PropertyView)}
                  >
                    {(propCatalog?.levels ?? [
                      { code: 'STANDARD' as PropertyView, label: t('标准'), labelEn: 'Standard' },
                      { code: 'EXPERT' as PropertyView, label: t('专家'), labelEn: 'Expert' },
                      { code: 'ALL' as PropertyView, label: t('全部'), labelEn: 'All' },
                    ]).map((level) => (
                      <option key={level.code} value={level.code}>
                        {pick(level.label, level.labelEn)} · {propViewCount(level.code)}
                      </option>
                    ))}
                  </select>
                </div>
                {propSearchOpen && (
                  <div className="prop-search-row">
                    <input
                      autoFocus
                      value={propQuery}
                      spellCheck={false}
                      placeholder={t('搜索属性 key，如 name / visibility')}
                      onChange={(event) => setPropQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setPropQuery('')
                          setPropSearchOpen(false)
                        }
                      }}
                    />
                    <span className="prop-search-count">
                      {t('{matched} / {total} 项', {
                        matched: propVisibleCount, total: propViewCount(propView),
                      })}
                    </span>
                    <button
                      type="button"
                      className="prop-search-close"
                      title={t('关闭搜索')}
                      aria-label={t('关闭搜索')}
                      onClick={() => { setPropQuery(''); setPropSearchOpen(false) }}
                    >×</button>
                  </div>
                )}
                {selectedRelation && (
                  <div className="rel-endpoints">
                    <button
                      type="button"
                      className="rel-endpoint"
                      title={t('选中源元素')}
                      onContextMenu={(event) => openReferenceMenu(event, { kind: 'element', id: selectedRelation.sourceId })}
                      onClick={() => {
                        setSelectedId(selectedRelation.sourceId)
                        setSelectedRelationId(null)
                        setSelectedDiagramId(null)
                      }}
                    >
                      <span className="rel-endpoint-tag">{t('源')}</span>
                      {model.elements.find((element) => element.id === selectedRelation.sourceId)?.name
                        ?? selectedRelation.sourceId}
                    </button>
                    <span className="rel-arrow" aria-hidden="true">→</span>
                    <button
                      type="button"
                      className="rel-endpoint"
                      title={t('选中目标元素')}
                      onContextMenu={(event) => openReferenceMenu(event, { kind: 'element', id: selectedRelation.targetId })}
                      onClick={() => {
                        setSelectedId(selectedRelation.targetId)
                        setSelectedRelationId(null)
                        setSelectedDiagramId(null)
                      }}
                    >
                      <span className="rel-endpoint-tag">{t('目标')}</span>
                      {model.elements.find((element) => element.id === selectedRelation.targetId)?.name
                        ?? selectedRelation.targetId}
                    </button>
                  </div>
                )}
                <div className="prop-list">
                  {propGroups.length === 0 && (
                    <p className="hint">{propQuery.trim()
                      ? t('没有匹配的属性 key')
                      : t('该类型暂无属性定义（属性目录加载中或服务端未登记）')}</p>
                  )}
                  {propGroups.map((group) => {
                    const collapsed = collapsedPropGroups.has(group.code)
                    return (
                      <section className={`prop-group${collapsed ? ' collapsed' : ''}`} key={group.code}>
                        <button
                          type="button"
                          className="prop-group-head"
                          onClick={() => setCollapsedPropGroups((previous) => {
                            const next = new Set(previous)
                            if (next.has(group.code)) {
                              next.delete(group.code)
                            } else {
                              next.add(group.code)
                            }
                            return next
                          })}
                        >
                          <span className="prop-group-twisty">{collapsed ? '▸' : '▾'}</span>
                          <span className="prop-group-label">{group.label}</span>
                          <span className="prop-group-count">{group.specs.length}</span>
                        </button>
                        {!collapsed && group.specs.map((spec) => renderPropertyRow(spec))}
                      </section>
                    )
                  })}
                </div>
                {selectedRelation && (
                  <div className="prop-actions">
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      title={t('删除该关系（可通过撤销恢复）')}
                      onClick={() => {
                        const id = selectedRelation.id
                        setSelectedRelationId(null)
                        void runCommand('DELETE_RELATIONSHIP', { id })
                      }}
                    >{t('删除关系')}</button>
                  </div>
                )}
              </>
            ) : (
              <p className="hint">{t('在左侧模型树或画布中选择一个元素、关系或图')}</p>
            )
          ) : propsTab === 'tags' ? (
            <div className="tags-panel">
              {(selected || selectedRelation) ? (
                <>
                  <div className="kv">
                    <span>{t('构造型')}</span>
                    <div className="prop-value-cards">
                      {(selectedRelation ?? selected)!.stereotypes.length > 0
                        ? (selectedRelation ?? selected)!.stereotypes.map((name, index) => renderStereotypeChip(name, index))
                        : <code>—</code>}
                    </div>
                  </div>
                  <div className="kv">
                    <span>{t('语义族')}</span>
                    <code>
                      {selectedRelation
                        ? t(RELATION_FAMILY_LABELS[relationInfo.get(selectedRelation.type)?.family ?? ''] ?? '—')
                        : pick(FAMILIES.find((f) => f.key === familyOfType(codeOf(selected!.type)))?.label, FAMILIES.find((f) => f.key === familyOfType(codeOf(selected!.type)))?.labelEn) ?? '—'}
                    </code>
                  </div>
                  {selectedRelation && (
                    <div className="kv">
                      <span>{t('关系')}</span>
                      <code>{t('{relation}（«{code}»）', { relation: relationLabel(selectedRelation.type), code: selectedRelation.type })}</code>
                    </div>
                  )}
                  <div className="kv"><span>{t('文档')}</span><code>{(selectedRelation ?? selected)!.documentation || '—'}</code></div>
                  <div className="kv"><span>XMI ID</span><code>{selected?.xmiId || '—'}</code></div>
                  <TypedTagsEditor
                    targetId={(selectedRelation ?? selected)!.id}
                    stereotypes={(selectedRelation ?? selected)!.stereotypes ?? []}
                    elements={model.elements}
                    taggedValues={(selectedRelation ?? selected)!.taggedValues ?? {}}
                    canEdit={canEdit}
                    readLatest={readLatestTagged}
                    onCommit={commitTaggedValues}
                    onNotice={say}
                  />
                  <TaggedValuesEditor
                    targetId={(selectedRelation ?? selected)!.id}
                    taggedValues={(selectedRelation ?? selected)!.taggedValues ?? {}}
                    canEdit={canEdit}
                    readLatest={readLatestTagged}
                    onCommit={commitTaggedValues}
                    onNotice={say}
                  />
                </>
              ) : (
                <p className="hint">{t('选择一个模型元素或关系以查看其构造型、文档与标签值')}</p>
              )}
            </div>
          ) : propsTab === 'relations' ? (
            <div className="rel-tab">
              {selected ? (
                selectionRelations.outgoing.length + selectionRelations.incoming.length === 0
                  ? <p className="hint">{t('该元素尚未参与任何关系')}</p>
                  : (
                    <>
                      <div className="rel-tab-group">
                        <div className="rel-tab-head">{t('出边 {count}', { count: selectionRelations.outgoing.length })}</div>
                        {selectionRelations.outgoing.map((relation) => renderRelationLink(relation, 'out'))}
                      </div>
                      <div className="rel-tab-group">
                        <div className="rel-tab-head">{t('入边 {count}', { count: selectionRelations.incoming.length })}</div>
                        {selectionRelations.incoming.map((relation) => renderRelationLink(relation, 'in'))}
                      </div>
                    </>
                  )
              ) : selectedRelation ? (
                <>
                  <div className="kv"><span>{t('类型')}</span><code>{relationLabel(selectedRelation.type)}（«{selectedRelation.type}»）</code></div>
                  {renderRelationLink(selectedRelation, 'out')}
                  {renderRelationLink(selectedRelation, 'in')}
                  <p className="hint">{t('关系也是模型对象：选中连线后可在「属性」页签按关系元类编辑属性。')}</p>
                </>
              ) : (
                <p className="hint">{t('选择一个元素或关系以查看它的连线')}</p>
              )}
            </div>
          ) : propsTab === 'whereused' ? (
            <div className="rel-tab whereused-tab">
              {selected && whereUsed ? (
                whereUsed.total === 0 ? (
                  <p className="hint">{t('该元素尚未被任何图、关系或属性引用')}</p>
                ) : (
                  <>
                    {whereUsed.owner && (
                      <div className="rel-tab-group">
                        <div className="rel-tab-head">{t('所有者')}</div>
                        <button type="button" className="rel-link-row" onClick={() => locateInTree(whereUsed.owner!.id)}
                          onContextMenu={(event) => openReferenceMenu(event, { kind: 'element', id: whereUsed.owner!.id })}>
                          <TypeIcon code={codeOf(whereUsed.owner.type)} size={14} />
                          <span className="rel-link-other">{whereUsed.owner.name}</span>
                        </button>
                      </div>
                    )}
                    {whereUsed.diagrams.length > 0 && (
                      <div className="rel-tab-group">
                        <div className="rel-tab-head">{t('所在图 {count}', { count: whereUsed.diagrams.length })}</div>
                        {whereUsed.diagrams.map((diagram) => (
                          <button
                            type="button"
                            key={diagram.id}
                            className="rel-link-row"
                            title={t('在「{diagram}」中定位', { diagram: diagram.name })}
                            onClick={() => focusElementInDiagram(selected.id, diagram.id)}
                            onContextMenu={(event) => openReferenceMenu(event, { kind: 'diagram', id: diagram.id })}
                          >
                            <DiagramIcon code={diagram.kind} size={14} />
                            <span className="rel-link-other">{diagram.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {whereUsed.incoming.length > 0 && (
                      <div className="rel-tab-group">
                        <div className="rel-tab-head">{t('被引用 {count}', { count: whereUsed.incoming.length })}</div>
                        {whereUsed.incoming.map((relation) => renderRelationLink(relation, 'in'))}
                      </div>
                    )}
                    {whereUsed.referrers.length > 0 && (
                      <div className="rel-tab-group">
                        <div className="rel-tab-head">{t('属性引用 {count}', { count: whereUsed.referrers.length })}</div>
                        {whereUsed.referrers.map((referrer) => (
                          <button
                            type="button"
                            key={`${referrer.kind}-${referrer.id}-${referrer.key}`}
                            className="rel-link-row"
                            title={t('{name} 的属性「{key}」引用了此对象', { name: referrer.name, key: referrer.key })}
                            onContextMenu={(event) => openReferenceMenu(event, referrer)}
                            onClick={() => {
                              if (referrer.kind === 'relation') {
                                setSelectedRelationId(referrer.id)
                                setSelectedId(null)
                                setSelectedDiagramId(null)
                              } else {
                                locateInTree(referrer.id)
                              }
                            }}
                          >
                            {referrer.kind === 'relation'
                              ? <RelationIcon code={model.relationships.find((item) => item.id === referrer.id)?.type ?? 'dependency'} size={14} />
                              : <TypeIcon code={codeOf(elementById.get(referrer.id)?.type ?? 'BLOCK')} size={14} />}
                            <span className="rel-link-other">{referrer.name}</span>
                            <span className="whereused-key">{referrer.key}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )
              ) : selectedRelation && whereUsed ? (
                <>
                  <div className="rel-tab-group">
                    <div className="rel-tab-head">{t('端点')}</div>
                    {whereUsed.endpoints.map((endpoint) => (
                      <button type="button" key={endpoint.id} className="rel-link-row" onClick={() => locateInTree(endpoint.id)}
                        onContextMenu={(event) => openReferenceMenu(event, { kind: 'element', id: endpoint.id })}>
                        <TypeIcon code={codeOf(endpoint.type)} size={14} />
                        <span className="rel-link-other">{endpoint.name}</span>
                      </button>
                    ))}
                  </div>
                  {whereUsed.diagrams.length > 0 && (
                    <div className="rel-tab-group">
                      <div className="rel-tab-head">{t('所在图 {count}', { count: whereUsed.diagrams.length })}</div>
                      {whereUsed.diagrams.map((diagram) => (
                        <button
                          type="button"
                          key={diagram.id}
                          className="rel-link-row"
                          onContextMenu={(event) => openReferenceMenu(event, { kind: 'diagram', id: diagram.id })}
                          onClick={() => {
                            setActiveDiagramId(diagram.id)
                            setSelectedDiagramId(diagram.id)
                            openTab({ kind: 'diagram', id: diagram.id })
                          }}
                        >
                          <DiagramIcon code={diagram.kind} size={14} />
                          <span className="rel-link-other">{diagram.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {whereUsed.total === 0 && <p className="hint">{t('该关系尚未出现在任何图中')}</p>}
                </>
              ) : (
                <p className="hint">{t('选择一个对象以查看它被哪些图、关系与属性引用')}</p>
              )}
            </div>
          ) : (
            <div className="notation-panel">
              {selectedDiagram ? (
                <>
                  <div className="kv"><span>{t('画布')}</span><code>{Math.round(viewportWidth)} × {Math.round(viewportHeight)} px</code></div>
                  <div className="kv"><span>{t('节点默认')}</span><code>{nodeSize.width} × {nodeSize.height}</code></div>
                  <div className="kv"><span>{t('图内元素')}</span><code>{selectedDiagram.elementIds.length}</code></div>
                  <div className="kv"><span>{t('缩放')}</span><code>{Math.round(zoom * 100)}%</code></div>
                  <p className="hint">{t('记法样式（坐标、尺寸、线型）由服务端 Notation 对象保存，经 WS Patch 广播给所有会话。')}</p>
                </>
              ) : selected ? (
                selectionNotation ? (
                  <>
                    <div className="kv"><span>{t('所在图')}</span><code>{diagramLabel(activeDiagramKind)}</code></div>
                    <div className="kv"><span>{t('坐标')}</span><code>{Math.round(selectionNotation.x)}, {Math.round(selectionNotation.y)}</code></div>
                    <div className="kv"><span>{t('尺寸')}</span><code>{Math.round(selectionNotation.width ?? nodeSize.width)} × {Math.round(selectionNotation.height ?? nodeSize.height)}</code></div>
                    <div className="kv"><span>{t('记法 ID')}</span><code>{selectionNotation.id}</code></div>
                    <p className="hint">{t('拖动图形只会改动记法坐标，不改变模型元素本身。')}</p>
                  </>
                ) : (
                  <p className="hint">{t('该元素不在当前图中：切到包含它的图，或右键「加入当前图」')}</p>
                )
              ) : (
                <p className="hint">{t('选择一个元素或图以查看它的记法信息')}</p>
              )}
            </div>
          )}
          <div className="props-foot">
            <span>
              {!selectedDiagram && !selected && !selectedRelation
                ? t('未选择对象')
                : propsTab === 'attrs'
                  ? t('共 {count} 项', { count: propVisibleCount })
                  : propsTab === 'relations'
                    ? t('{count} 条连线', { count: selectionRelations.outgoing.length + selectionRelations.incoming.length })
                    : propsTab === 'whereused'
                      ? t('{count} 处引用', { count: whereUsed?.total ?? 0 })
                      : selectedDiagram
                      ? t('图 · {count} 元素', { count: selectedDiagram.elementIds.length })
                      : selected
                        ? typeLabel(selected.type)
                        : selectedRelation
                          ? relationLabel(selectedRelation.type)
                          : t('未选择对象')}
            </span>
            <span className="props-foot-note">
              {propEntry
                ? t('{count} 个元类', { count: propEntry.metaclasses.length })
                : propCatalog?.specification ?? 'UML 2.5.1 + SysML 1.6'}
            </span>
          </div>
        </aside>
        </div>

        {/* 模型树右侧的垂直组件工具箱：只展示当前图相关元素 + 关系组件（对齐参考截图） */}
        <aside className={`toolbox ${toolboxCollapsed ? 'collapsed' : ''}`} aria-label={t('组件工具箱（模型树右侧）')}>
          <div className="tb-tabs">
            <button
              type="button"
              className={toolboxTab === 'components' ? 'active' : ''}
              onClick={() => setToolboxTab('components')}
            >{t('组件')}</button>
            <button
              type="button"
              className={toolboxTab === 'styles' ? 'active' : ''}
              onClick={() => setToolboxTab('styles')}
            >{t('样式')}</button>
            <button
              type="button"
              className={toolboxTab === 'custom' ? 'active' : ''}
              onClick={() => setToolboxTab('custom')}
            >{t('定制')}</button>
            <button
              type="button"
              className="tb-collapse"
              title={toolboxCollapsed ? t('展开工具箱') : t('收起工具箱（把宽度还给画布）')}
              onClick={() => setToolboxCollapsed((previous) => !previous)}
            >{toolboxCollapsed ? '»' : '«'}</button>
          </div>
          {toolboxCollapsed ? (
            <div className="tb-rail">
              {paletteEntries.map((type) => (
                <button
                  key={type.code}
                  type="button"
                  className="tb-rail-item"
                  disabled={busy}
                  title={t('«{stereotype}» {label} · {uml}｜点击或拖入画布', { stereotype: type.stereotype, label: pick(type.label, type.labelEn), uml: type.uml })}
                  draggable={canEdit}
                  onDragStart={(event) => event.dataTransfer.setData('text/scofen-type', type.code)}
                  onClick={() => createFromPaletteAtCenter(type.code)}
                >
                  <TypeIcon code={type.code} size={16} />
                </button>
              ))}
            </div>
          ) : (
          <>
          {toolboxTab === 'components' ? (
            <>
              <div className="tb-current">
                {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={15} />}
                <span className="tb-current-name">{activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : t('未选择图')}</span>
                <span className="tb-count">{activeDiagramObj?.name ?? ''}</span>
              </div>
              <div className="tb-scroll">
                {/* 序列图把七种消息组件置顶：画时序图时最常用，不该藏在关系组底部让人滚半天 */}
                {activeDiagramKind === 'seq' && (
                  <div className={`tb-group current seq-message-group ${openToolGroups.has('seqMessages') ? 'open' : ''}`}>
                    <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('seqMessages')}>
                      <RelationIcon code="message" size={16} />
                      <span className="tb-group-label">{t('消息种类')}</span>
                      <span className="tb-count">{SEQ_MESSAGE_TOOLS.length}</span>
                      <span className="tb-caret">{openToolGroups.has('seqMessages') ? '⌄' : '›'}</span>
                    </button>
                    {openToolGroups.has('seqMessages') && (
                      <div className="tb-items">
                        {SEQ_MESSAGE_TOOLS.map((tool) => (
                          <button
                            key={tool.key}
                            type="button"
                            data-seq-tool={tool.key}
                            className={`tb-item relation seq-msg-tool ${relationTool === 'message' && seqMessageTool === tool.key ? 'tool-active' : ''}`}
                            disabled={busy}
                            onClick={() => activateSeqMessageTool(tool.key)}
                            title={t('{label}｜{hint}', { label: pick(tool.label, tool.labelEn), hint: t(tool.hint) })}
                          >
                            {renderSeqToolIcon(tool)}
                            <span className="tb-item-label">{pick(tool.label, tool.labelEn)}</span>
                          </button>
                        ))}
                        <p className="tb-tip">{t('选一种消息点起点与终点生命线；「给自己的消息」只点一条')}</p>
                      </div>
                    )}
                  </div>
                )}
                {/* 元素：仅当前图允许的类型，按语义族分小节 */}
                <div className={`tb-group current ${openToolGroups.has('elements') ? 'open' : ''}`}>
                  <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('elements')}>
                    {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={16} />}
                    <span className="tb-group-label">{t('元素 · {label}', { label: activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : t('当前图') })}</span>
                    <span className="tb-count">{corePalette.length}</span>
                    <span className="tb-caret">{openToolGroups.has('elements') ? '⌄' : '›'}</span>
                  </button>
                  {openToolGroups.has('elements') && (
                    <div className="tb-items">
                      {elementGroups.map((group) => (
                        <div className="tb-sect" key={group.key}>
                          <div className="tb-sect-label">{group.label}</div>
                          {group.items.map(renderPaletteItem)}
                        </div>
                      ))}
                      <p className="tb-tip">{t('仅显示当前图允许的 {count} 类元素 · 点击 / 拖入画布', { count: corePalette.length })}</p>
                    </div>
                  )}
                </div>

                {/*
                  更多规范类型：UML 2.5.1 §16 有四十余个具体动作，全平铺会把工具箱淹掉。
                  它们仍然可建、可校验、可导入导出，只是默认收起。
                */}
                {advancedGroups.length > 0 && (
                  <div className={`tb-group ${openToolGroups.has('advanced') ? 'open' : ''}`}>
                    <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('advanced')}>
                      <TypeIcon code="CALL_BEHAVIOR_ACTION" size={16} />
                      <span className="tb-group-label">{t('更多规范类型')}</span>
                      <span className="tb-count">{advancedPalette.length}</span>
                      <span className="tb-caret">{openToolGroups.has('advanced') ? '⌄' : '›'}</span>
                    </button>
                    {openToolGroups.has('advanced') && (
                      <div className="tb-items">
                        {advancedGroups.map((group) => (
                          <div className="tb-sect" key={`advanced:${group.key}`}>
                            <div className="tb-sect-label">{group.label}</div>
                            {group.items.map(renderPaletteItem)}
                          </div>
                        ))}
                        <p className="tb-tip">{t('UML 2.5.1 §16 具体动作：默认收起，避免撑爆工具箱')}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 关系：当前图规范允许的关系组件，点选后在画布依次点击起点与终点 */}
                <div className={`tb-group current ${openToolGroups.has('relations') ? 'open' : ''}`}>
                  <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('relations')}>
                    <RelationIcon code={relationEntries[0]?.code ?? 'trace'} size={16} />
                    <span className="tb-group-label">{t('关系')}</span>
                    <span className="tb-count">{relationEntries.length}</span>
                    <span className="tb-caret">{openToolGroups.has('relations') ? '⌄' : '›'}</span>
                  </button>
                  {openToolGroups.has('relations') && (
                    <div className="tb-items">
                      {/* 序列图的七种消息组件已置顶成独立分组，这里只列其余关系。 */}
                      {relationGroups.map((group) => {
                        // 序列图里通用「消息」已被上面七种组件取代，别再列一个不带种类的空壳。
                        const items = activeDiagramKind === 'seq'
                          ? group.items.filter((rel) => rel.code.toLowerCase() !== 'message')
                          : group.items
                        if (items.length === 0) {
                          return null
                        }
                        return (
                        <div className="tb-sect" key={group.key}>
                          <div className="tb-sect-label">{group.label}</div>
                          {items.map((rel) => (
                            <button
                              key={rel.code}
                              type="button"
                              className={`tb-item relation ${relationTool === rel.code && !seqMessageTool ? 'tool-active' : ''}`}
                              draggable={canEdit}
                              disabled={busy}
                              onDragStart={(event) => event.dataTransfer.setData('text/scofen-relation', rel.code)}
                              onClick={() => activateRelationTool(rel.code)}
                              title={t('«{stereotype}» {label}｜点选后在画布依次点击起点与终点', { stereotype: rel.stereotype, label: pick(rel.label, rel.labelEn) })}
                            >
                              <RelationIcon code={rel.code} size={16} />
                              <span className="tb-item-label">{pick(rel.label, rel.labelEn)}</span>
                            </button>
                          ))}
                        </div>
                        )
                      })}
                      {relationTool && (
                        <div className="tb-link-hint">
                          <span>{t('连线中 · «{relation}»', {
                            relation: activeSeqTool
                              ? pick(activeSeqTool.label, activeSeqTool.labelEn)
                              : relationLabel(relationTool),
                          })}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setRelationTool(null)
                              setRelationSource(null)
                            }}
                          >{t('退出')}</button>
                        </div>
                      )}
                      <button type="button" className="tb-item action" onClick={openRelationDialog}>
                        <span className="tb-action-glyph" aria-hidden="true">↔</span>
                        <span className="tb-item-label">{t('关系向导（选两端）…')}</span>
                      </button>
                      <p className="tb-tip">{t('按当前图规范过滤；选中关系后在画布点起点、再点终点即可连线')}</p>
                    </div>
                  )}
                </div>

                {/* 通用：与图无关的动作类工具 */}
                <div className={`tb-group ${openToolGroups.has('generic') ? 'open' : ''}`}>
                  <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('generic')}>
                    <span className="tb-action-glyph" aria-hidden="true">◇</span>
                    <span className="tb-group-label">{t('通用')}</span>
                    <span className="tb-count">4</span>
                    <span className="tb-caret">{openToolGroups.has('generic') ? '⌄' : '›'}</span>
                  </button>
                  {openToolGroups.has('generic') && (
                    <div className="tb-items">
                      <button
                        type="button"
                        className="tb-item action"
                        disabled={busy}
                        onClick={() => openCreate(null)}
                      >
                        <span className="tb-action-glyph" aria-hidden="true">＋</span>
                        <span className="tb-item-label">{t('新建元素…')}</span>
                      </button>
                      <button
                        type="button"
                        className="tb-item action"
                        disabled={busy}
                        onClick={() => openDiagramDialog(null)}
                      >
                        <span className="tb-action-glyph" aria-hidden="true">▧</span>
                        <span className="tb-item-label">{t('新建图…')}</span>
                      </button>
                      <button type="button" className="tb-item action" onClick={openRelationDialog}>
                        <span className="tb-action-glyph" aria-hidden="true">↔</span>
                        <span className="tb-item-label">{t('新建关系…')}</span>
                      </button>
                      <button
                        type="button"
                        className="tb-item action"
                        disabled={!selectedId || busy}
                        onClick={() => selectedId && void addToCurrentDiagram(selectedId)}
                      >
                        <span className="tb-action-glyph" aria-hidden="true">＋</span>
                        <span className="tb-item-label">{t('把选中元素加入当前图')}</span>
                      </button>
                      <p className="tb-tip">{t('新建元素 / 新建图 / 关系向导在此；元素与关系组件随当前图联动。')}</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : toolboxTab === 'styles' ? (
            <div className="tb-scroll tb-style-scroll">
              <div className="tb-style-head">
                {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={18} />}
                <span>{activeDiagramObj?.name ?? t('未选择图')}</span>
                <code>{activeSpec?.layout ?? '—'}</code>
              </div>
              <StylePanel
                catalog={styleCatalog}
                canEdit={canEdit}
                busy={busy}
                diagram={activeDiagramObj}
                frameEnabled={frameEnabled}
                frameToggleDisabled={!!seqLayout?.frame}
                targetKind={selectedRelationId ? 'relation' : styleTargetIds.length > 0 ? 'elements' : 'none'}
                selectionLabel={selectedRelationId
                  ? `${t('关系')} · ${selectedRelation?.name || (selectedRelation ? relationLabel(selectedRelation.type) : '')}`
                  : selected?.name ?? (styleTargetIds.length > 1 ? t('{count} 个图形', { count: styleTargetIds.length }) : '')}
                selectionCount={selectedRelationId ? 1 : styleTargetIds.length}
                nodeStyle={selectionNotation?.style ?? {}}
                lineStyle={currentLineStyle}
                frameStyle={frameStyle}
                onApplyNode={(patch, replace, keepShape) => void applyNodeStyle(patch, replace, keepShape)}
                onApplyLine={(patch, replace) => void applyLineStyle(patch, replace)}
                onApplyFrame={(patch, replace) => void applyFrameStyle(patch, replace)}
                onToggleFrame={(visible) => setFrameVisible(visible)}
              />
            </div>
          ) : (
            <div className="tb-scroll tb-custom-scroll">
              <CustomizationPanel
                customization={customization}
                elements={model.elements}
                specs={specs}
                containment={containment}
                relations={relationCatalog}
                canEdit={canEdit}
                busy={busy}
                runCommand={runCommand}
                onNotice={say}
                ownerId={projectRootId ?? ''}
                onSelectElement={(id) => setSelectedId(id)}
              />
            </div>
          )}
          <div className="tb-foot">
            <span>{activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : '—'}</span>
            <span>{t('{count} 元素 · {relations} 关系', { count: paletteEntries.length, relations: relationEntries.length })}</span>
          </div>
          </>
          )}
        </aside>

        <main className="canvas">
          <div className="doc-tabs" role="tablist" aria-label={t('已打开的标签页')}>
            {tabs.map((tab) => {
              const key = `${tab.kind}:${tab.id}`
              const active = key === activeTabKey
              const label = tab.kind === 'view'
                ? tableViewLabel(tab.id as TableViewId)
                : tab.kind === 'diagram'
                  ? (model.diagrams.find((item) => item.id === tab.id)?.name ?? tab.id)
                  : (elementById.get(tab.id)?.name ?? tab.id)
              return (
                <div
                  key={key}
                  className={`doc-tab ${tab.kind} ${active ? 'active' : ''}`}
                  data-tab-id={tab.id}
                  data-tab-key={key}
                  role="tab"
                  aria-selected={active}
                  tabIndex={0}
                  title={tab.kind === 'view' ? t('表格 / 矩阵视图') : tab.kind === 'diagram' ? t('图 · 点击切换画布') : t('对象 · 点击编辑属性')}
                  onClick={() => activateTab(tab)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateTab(tab) } }}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab) } }}
                >
                  {tab.kind === 'view'
                    ? <img src={svgUrl(tableViewIcon(tab.id as TableViewId))} width={13} height={13} alt="" aria-hidden="true" />
                    : tab.kind === 'diagram'
                      ? <DiagramIcon code={model.diagrams.find((item) => item.id === tab.id)?.kind ?? ''} size={13} />
                      : <TypeIcon code={codeOf(elementById.get(tab.id)?.type ?? '')} size={13} />}
                  <span className="doc-tab-label">{label}</span>
                  <button
                    type="button"
                    className="doc-tab-x"
                    title={t('关闭标签')}
                    onClick={(event) => { event.stopPropagation(); closeTab(tab) }}
                  >×</button>
                </div>
              )
            })}
            <button
              type="button"
              className="doc-tab-add"
              title={t('新建图…')}
              onClick={() => openDiagramDialog(null)}
            >＋</button>
            <span className="doc-tabs-meta">
              {tabs.length} · {Math.round(zoom * 100)}%
            </span>
          </div>
          {activeViewId ? (
            <TableView
              key={`${activeProjectId}/${activeViewId}`}
              view={activeViewId}
              elements={projectElements}
              relationships={model.relationships}
              relations={relationCatalog}
              containment={containment}
              validation={validationReport?.revision === model.revision ? validationReport : null}
              projectRootId={projectRootId}
              selectedId={selectedId}
              busy={busy}
              canEdit={canEdit}
              canImport={canImport}
              canExport={canExport}
              canDelete={canEdit && permissions.has('model.delete')}
              typeInfo={typeInfo}
              savedViews={overview?.views ?? []}
              onSaveView={async view => { const saved = await projectApi(activeProjectId).saveView(view); await refreshProjectOverview(); return saved }}
              onDeleteView={async id => { await projectApi(activeProjectId).deleteView(id); await refreshProjectOverview() }}
              onImport={() => setRequirementImportOpen(true)}
              onSelectElement={(id) => selectOnTree({ kind: 'element', id })}
              onSelectRelation={selectTreeRelation}
              onReferenceContextMenu={(event, kind, id) => openReferenceMenu(event, { kind, id })}
              onRename={(id, name) => { void runCommand('RENAME_ELEMENT', { id, name }) }}
              onDocumentation={(id, documentation) => { void runCommand('UPDATE_DOCUMENTATION', { id, documentation }) }}
              onProperty={(id, key, value) => { void runCommand('UPDATE_PROPERTY', { id, key, value }) }}
              onOpenCreate={(ownerId) => openCreate(ownerId)}
              onCreateQuickElement={(kind, ownerId, typeCode) => { void createTableElement(kind, ownerId, typeCode) }}
              onMatrix={async links => { await projectApi(activeProjectId).matrix(model.revision, links); await refresh() }}
            />
          ) : (
          <>
          <div className="diagram-toolbar">
            <div className="dt-head">
              <span className="dt-kind">
                {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={15} />}
                {activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : t('未选择图')}
              </span>
              <span className="dt-name">{activeDiagramObj?.name ?? '—'}</span>
              <span className="dt-counts">
                {paletteEntries.length} {t('类元素')} · {relationEntries.length} {t('类关系')}
                {relationTool && <span className="dt-linkflag">{t(' · 连线中 «{relation}»（Esc 退出）', {
                  relation: activeSeqTool ? pick(activeSeqTool.label, activeSeqTool.labelEn) : relationLabel(relationTool),
                })}</span>}
              </span>
              <button
                type="button"
                className={`dt-frame-toggle${frameEnabled && !seqLayout?.frame ? ' active' : ''}`}
                aria-pressed={frameEnabled && !seqLayout?.frame}
                title={t(seqLayout?.frame ? '序列图用 sd 图框，不再叠一层' : '显示 SysML 标准图框（图种与图名）')}
                onClick={() => setFrameVisible(!frameEnabled)}
                disabled={!activeDiagramObj || !!seqLayout?.frame}
              >
                {t('SysML 图框')}
              </button>
            </div>
          </div>
          <svg
            ref={svgRef}
            className={`${relationTool ? 'linking' : ''}${panDrag ? ' panning' : ''}`.trim() || undefined}
            viewBox={viewBox}
            role="img"
            aria-label={t('模型画布，图形可拖拽；Shift+点选多选，Shift+空白拖拽框选；空白处拖动或双指滚动平移，捏合或 Ctrl/⌘+滚轮缩放')}
            onPointerDown={handleCanvasPanStart}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = event.dataTransfer.types.includes('text/scofen-element')
                ? 'link'
                : 'copy'
            }}
            onDrop={handleCanvasDrop}
          >
            <defs>
              {CANVAS_GRADIENTS.map((g) => (
                <linearGradient key={g.id} id={g.id}
                  x1="0" y1="0" x2={g.vertical ? '0' : '1'} y2={g.vertical ? '1' : '0'}>
                  <stop offset="0%" stopColor={g.from} />
                  <stop offset="100%" stopColor={g.to} />
                </linearGradient>
              ))}
            </defs>
            {diagramFrame ? (
              <g
                className={`diagram-frame${toolboxTab === 'styles' && !selectedId && !selectedRelationId ? ' frame-focused' : ''}`}
                pointerEvents="none"
                data-frame="true"
                data-frame-title={diagramFrame.name}
              >
                <rect
                  x={diagramFrame.x}
                  y={diagramFrame.y}
                  width={diagramFrame.w}
                  height={diagramFrame.h}
                  fill="#ffffff"
                  fillOpacity={0.55}
                  stroke={diagramFrame.border}
                  strokeWidth={diagramFrame.borderW}
                />
                {/* 首页标签可点：选中图框并切到「样式」页签，标题与配色可直接编辑。 */}
                <path
                  d={`M ${diagramFrame.x} ${diagramFrame.y} H ${diagramFrame.x + diagramFrame.headerW - diagramFrame.notch} L ${diagramFrame.x + diagramFrame.headerW} ${diagramFrame.y + diagramFrame.headerH} H ${diagramFrame.x} Z`}
                  fill={diagramFrame.kindColor}
                  fillOpacity={0.1}
                  stroke={diagramFrame.border}
                  strokeWidth={diagramFrame.borderW}
                  strokeLinejoin="round"
                  pointerEvents="all"
                  data-frame-header="true"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedId(null)
                    setSelectedIds(new Set())
                    setSelectedRelationId(null)
                    setSelectedDiagramId(null)
                    setToolboxTab('styles')
                    say('已选中图框，可在「样式」页签调整')
                  }}
                />
                <text
                  x={diagramFrame.x + 12}
                  y={diagramFrame.y + 16}
                  fontSize={diagramFrame.kindSize}
                  fontWeight={700}
                  fill={diagramFrame.kindColor}
                >
                  {diagramFrame.kindLine}
                </text>
                <text
                  x={diagramFrame.x + 12}
                  y={diagramFrame.y + 32}
                  fontSize={diagramFrame.nameSize}
                  fontWeight={700}
                  fill={diagramFrame.titleColor}
                >
                  {diagramFrame.name}
                </text>
              </g>
            ) : null}
            {portLinks.map((link, index) => (
              <line
                key={`pl-${index}`}
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                stroke="#9aa5b1"
                strokeWidth={1.2}
                strokeDasharray="2 2"
                pointerEvents="none"
              />
            ))}
            {seqLayout?.frame ? renderSeqFrame(seqLayout.frame) : null}
            {seqLayout?.fragments.map((fragment) => renderSeqFragment(fragment))}
            {positions.map(({ element, x, y, w, h, style }) => (
              // 序列图的交互是图框、组合片段是区间框，都不再画成画布上的普通方块。
              (seqLayout?.frame && seqLayout.frame.element.id === element.id) || seqFragmentIds.has(element.id)
                ? null : renderNode(element, x, y, w, h, style)
            ))}
            {seqLayout?.activations.map((activation) => renderSeqActivation(activation))}
            {seqDrag?.moved && seqLayout?.messages[seqDrag.targetIndex] && (
              <g className="seq-drop-marker" pointerEvents="none">
                <rect
                  x={seqLayout.box.left}
                  y={seqLayout.messages[seqDrag.targetIndex].y - SEQ_ROW_PITCH / 2 + 3}
                  width={Math.max(80, seqLayout.box.right - seqLayout.box.left)}
                  height={SEQ_ROW_PITCH - 6}
                  rx={4}
                  fill="#1890ff"
                  opacity={0.08}
                />
                <line
                  x1={seqLayout.box.left}
                  y1={seqLayout.messages[seqDrag.targetIndex].y - SEQ_ROW_PITCH / 2}
                  x2={seqLayout.box.right}
                  y2={seqLayout.messages[seqDrag.targetIndex].y - SEQ_ROW_PITCH / 2}
                  stroke="#1890ff"
                  strokeWidth={1.6}
                  strokeDasharray="7 4"
                />
                <text
                  x={seqLayout.box.left + 6}
                  y={seqLayout.messages[seqDrag.targetIndex].y - SEQ_ROW_PITCH / 2 - 5}
                  className="seq-drop-label"
                >
                  {t('放到第 {index} 条', { index: seqDrag.targetIndex + 1 })}
                </text>
              </g>
            )}
            {seqLayout?.messages.map((message) => renderSeqMessage(message))}
            {positions.length === 0 && (
              <text x={clampedPan.x + viewWidth / 2} y={clampedPan.y + viewHeight / 2}
                textAnchor="middle" className="empty" pointerEvents="none" data-export="omit">
                {activeDiagramObj
                  ? t('当前图暂无元素')
                  : t('未打开图 · 项目共 {count} 个元素，规模过大不再铺开总览', { count: projectElements.length })}
              </text>
            )}
            {model.relationships.map((relation) => {
              // 序列图里两端都是生命线的消息已按时间槽水平铺开，不再画成对角连线。
              if (seqMessageIds.has(relation.id)) {
                return null
              }
              // 泳道归属靠动作落在泳道内表达，画虚线反而把表格式泳道弄花。
              if (isLaneMembershipRelation(relation.type, activeDiagramObj?.kind ?? '')) {
                return null
              }
              const from = positionById.get(relation.sourceId)
              const to = positionById.get(relation.targetId)
              if (!from || !to) {
                return null
              }
              const fromShape = shapeOf(from.element.type)
              const toShape = shapeOf(to.element.type)
              const fw = fromShape === 'port' ? 26 : from.w
              const fh = fromShape === 'port' ? 26 : from.h
              const tw = toShape === 'port' ? 26 : to.w
              const th = toShape === 'port' ? 26 : to.h
              const sc = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
              const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
              const sourceRect = { x: sc.x - fw / 2, y: sc.y - fh / 2, w: fw, h: fh }
              const targetRect = { x: tc.x - tw / 2, y: tc.y - th / 2, w: tw, h: th }
              // 手动走线按图持久化；节点移动后端点自动重挂，拖拽中用实时路由。
              const manual = readRoute(relation.properties, activeDiagramId ?? '')
              const dragging = edgeDrag?.relationId === relation.id ? edgeDrag : null
              const route = dragging
                ? dragging.points
                : manual
                  ? reattachRoute(manual, sourceRect, targetRect)
                  : orthogonalRoute(sourceRect, targetRect)
              const sEdge = route[0]
              const tEdge = route[route.length - 1]
              const prevPoint = route[route.length - 2] ?? sEdge
              const style = relationshipStyle(relation.type)
              // 用户连线样式按图挂在关系 properties 上，覆盖规范默认线型。
              const lineStyle = relationStyleOf(relation, activeDiagramId)
              const lineColor = colorOr(lineStyle, 'lineColor', style.color)
              const lineWidth = numberValue(lineStyle, 'lineWidth', style.width ?? 1)
              const lineDash = dashArray(lineStyle, 'lineDash') ?? (style.dashed ? '5 4' : undefined)
              const labelSize = numberValue(lineStyle, 'labelFontSize', 10.5)
              const arrow = arrowGeometry(prevPoint.x, prevPoint.y, tEdge.x, tEdge.y)
              const mid = routeMidpoint(route)
              const midX = mid.x
              const midY = mid.y
              const routePoints = route.map((point) => `${point.x},${point.y}`).join(' ')
              const isSelected = selectedRelationId === relation.id
              const sourceName = from.element.name
              const targetName = to.element.name
              return (
                /*
                 * 连线画在节点之上保证标签可读。容器整体不接收指针事件，只有末尾一条
                 * 透明加粗线接收命中（pointerEvents="stroke"），这样关系可以点选，
                 * 又不会在连线模式下挡住节点点选。
                 */
                <g
                  key={relation.id}
                  pointerEvents="none"
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    if (readRoute(relation.properties, activeDiagramId ?? '')) {
                      void runCommand('UPDATE_PROPERTY', {
                        id: relation.id,
                        key: `route:${activeDiagramId}`,
                        remove: true,
                      })
                      say('已恢复该连线的自动路由')
                    }
                  }}
                >
                  {isSelected && (
                    <polyline
                      points={routePoints}
                      fill="none"
                      stroke="#1890ff"
                      strokeWidth={lineWidth + 7}
                      strokeOpacity={0.18}
                      strokeLinecap="round"
                      data-export="omit"
                    />
                  )}
                  <polyline
                    points={routePoints}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={isSelected ? lineWidth + 0.8 : lineWidth}
                    strokeDasharray={lineDash}
                  />
                  {style.arrow === 'filled' && (
                    <polygon points={arrow.points} fill={lineColor} stroke="none" />
                  )}
                  {style.arrow === 'hollow' && (
                    <polygon points={arrow.points} fill="#ffffff" stroke={lineColor} strokeWidth={1.4} />
                  )}
                  {style.arrow === 'open' && (
                    <polyline points={`${arrow.v1} ${tEdge.x},${tEdge.y} ${arrow.v2}`} fill="none" stroke={lineColor} strokeWidth={lineWidth} />
                  )}
                  {style.label && (
                    <g>
                      <rect
                        x={midX - style.label.length * labelSize * 0.32 - 3}
                        y={midY - labelSize * 0.85}
                        width={style.label.length * labelSize * 0.64 + 6}
                        height={labelSize + 4.5}
                        rx={3}
                        fill="#ffffff"
                        opacity={0.92}
                      />
                      <text x={midX} y={midY + labelSize / 3} textAnchor="middle" className="edge-label"
                        style={{ fill: lineColor, fontSize: labelSize }}>
                        «{style.label}»
                      </text>
                    </g>
                  )}
                  <polyline
                    points={routePoints}
                    fill="none"
                    stroke="#000000"
                    strokeOpacity={0}
                    strokeWidth={12}
                    strokeLinecap="round"
                    pointerEvents={relationTool ? 'none' : 'stroke'}
                    data-export="omit"
                    style={{ cursor: relationTool ? 'crosshair' : 'pointer' }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      if (relationTool) {
                        return
                      }
                      if (selectedRelationId !== relation.id) {
                        say('已选中连线：拖拽线段调整走线，双击恢复自动路由')
                      }
                      setSelectedRelationId(relation.id)
                      setSelectedId(null)
                      setSelectedDiagramId(null)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      openMenu(event, { kind: 'relation', id: relation.id })
                    }}
                  >
                    <title>
                      {relation.name?.trim() || `«${relation.type}» ${relationLabel(relation.type)}`}
                      {'：'}{sourceName} → {targetName}{t('｜点击查看 / 编辑关系属性')}
                    </title>
                  </polyline>
                  {/* 选中后线段拖拽手柄盖在主命中线之上：否则 12px 主线会盖住手柄，按下只选中却拖不动。 */}
                  {isSelected && !relationTool && route.slice(0, -1).map((point, index) => {
                    const next = route[index + 1]
                    const horizontal = Math.abs(next.x - point.x) >= Math.abs(next.y - point.y)
                    return (
                      <polyline
                        key={`seg-${index}`}
                        points={`${point.x},${point.y} ${next.x},${next.y}`}
                        fill="none"
                        stroke="#000000"
                        strokeOpacity={0}
                        strokeWidth={14}
                        pointerEvents="stroke"
                        data-export="omit"
                        style={{ cursor: horizontal ? 'row-resize' : 'col-resize' }}
                        onContextMenu={(event) => {
                          // 选中态下这些线柄盖在主命中线之上；不给它们右键，
                          // 用户右键已选中的连线时就弹不出「树上高亮」。
                          event.preventDefault()
                          event.stopPropagation()
                          openMenu(event, { kind: 'relation', id: relation.id })
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          event.currentTarget.setPointerCapture(event.pointerId)
                          const start = toSvgPoint(event.clientX, event.clientY)
                          setSelectedRelationId(relation.id)
                          setSelectedId(null)
                          setSelectedDiagramId(null)
                          setEdgeDrag({
                            relationId: relation.id,
                            segment: index,
                            startX: start.x,
                            startY: start.y,
                            orig: route,
                            points: route,
                            moved: false,
                            sourceRect,
                            targetRect,
                          })
                        }}
                      />
                    )
                  })}
                  {isSelected && !relationTool && route.slice(1, -1).map((point, index) => (
                    <circle
                      key={`vtx-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={3.5}
                      fill="#ffffff"
                      stroke="#1890ff"
                      strokeWidth={1.4}
                      pointerEvents="none"
                      data-export="omit"
                    />
                  ))}
                </g>
              )
            })}
            {marquee && (
              <rect
                x={Math.min(marquee.startX, marquee.x)}
                y={Math.min(marquee.startY, marquee.y)}
                width={Math.abs(marquee.x - marquee.startX)}
                height={Math.abs(marquee.y - marquee.startY)}
                fill="#1890ff"
                fillOpacity={0.08}
                stroke="#1890ff"
                strokeWidth={1}
                strokeDasharray="5 3"
                pointerEvents="none"
                data-export="omit"
              />
            )}
          </svg>
          {canEdit && activeDiagramObj && alignableCount >= 2 && (
            <div className="multi-toolbar" role="toolbar" aria-label={t('多选对齐工具')}>
              <span className="multi-count">{t('{count} 个图形', { count: alignableCount })}</span>
              <button type="button" disabled={busy} title={t('左对齐')} onClick={() => alignSelection('left')}>{t('左齐')}</button>
              <button type="button" disabled={busy} title={t('水平居中')} onClick={() => alignSelection('centerH')}>{t('水平中')}</button>
              <button type="button" disabled={busy} title={t('右对齐')} onClick={() => alignSelection('right')}>{t('右齐')}</button>
              <span className="multi-sep" aria-hidden="true" />
              <button type="button" disabled={busy} title={t('顶对齐')} onClick={() => alignSelection('top')}>{t('顶齐')}</button>
              <button type="button" disabled={busy} title={t('垂直居中')} onClick={() => alignSelection('centerV')}>{t('垂直中')}</button>
              <button type="button" disabled={busy} title={t('底对齐')} onClick={() => alignSelection('bottom')}>{t('底齐')}</button>
              <span className="multi-sep" aria-hidden="true" />
              <button type="button" disabled={busy || alignableCount < 3} title={t('横向等间距（至少 3 个）')} onClick={() => alignSelection('distH')}>{t('横等距')}</button>
              <button type="button" disabled={busy || alignableCount < 3} title={t('纵向等间距（至少 3 个）')} onClick={() => alignSelection('distV')}>{t('纵等距')}</button>
              <span className="multi-sep" aria-hidden="true" />
              <button type="button" disabled={busy} title={t('复制（Ctrl/⌘+C）')} onClick={copySelection}>{t('复制')}</button>
              <button type="button" disabled={busy} className="multi-danger" title={t('删除（Del）')} onClick={deleteSelection}>{t('删除')}</button>
              <button
                type="button"
                className="multi-close"
                title={t('取消多选（Esc）')}
                onClick={() => setSelectedIds(selectedId ? new Set([selectedId]) : new Set())}
              >✕</button>
            </div>
          )}
          {activeDiagramObj && positions.length > 0 && (
            minimapOpen ? (
              <div className="minimap" aria-label={t('小地图')}>
                <div className="minimap-head">
                  <span>{t('小地图')}</span>
                  <button
                    type="button"
                    className="minimap-close"
                    title={t('关闭小地图')}
                    aria-label={t('关闭小地图')}
                    onClick={() => setMinimapOpen(false)}
                  >×</button>
                </div>
                <svg
                  ref={minimapRef}
                  viewBox={minimapViewBox}
                  preserveAspectRatio="xMidYMid meet"
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    minimapDragRef.current = true
                    minimapJump(event.clientX, event.clientY)
                  }}
                  onPointerMove={(event) => {
                    if (minimapDragRef.current) {
                      minimapJump(event.clientX, event.clientY)
                    }
                  }}
                  onPointerUp={() => { minimapDragRef.current = false }}
                  onPointerCancel={() => { minimapDragRef.current = false }}
                >
                  {positions.map((item) => (
                    <rect
                      key={item.element.id}
                      x={item.x}
                      y={item.y}
                      width={item.w}
                      height={item.h}
                      className={`minimap-node${isBackdropShape(shapeOf(item.element.type)) ? ' backdrop' : ''}${selectionSet.has(item.element.id) ? ' selected' : ''}`}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  <rect
                    className="minimap-view"
                    x={clampedPan.x}
                    y={clampedPan.y}
                    width={viewWidth}
                    height={viewHeight}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            ) : (
              <button
                type="button"
                className="minimap-reopen"
                title={t('打开小地图')}
                aria-label={t('打开小地图')}
                onClick={() => setMinimapOpen(true)}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                  <rect x="8.5" y="7.5" width="5" height="4.5" rx="0.8" fill="currentColor" stroke="none" />
                </svg>
              </button>
            )
          )}
          </>
          )}
        </main>
      </div>

      {bottomDockOpen && (
        <section className="bottom-dock" aria-label={t('校验与追溯')}>
          <div className="bd-head">
            <div className="bd-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={bottomDockTab === 'problems'}
                className={`bd-tab ${bottomDockTab === 'problems' ? 'active' : ''}`}
                onClick={() => setBottomDockTab('problems')}
              >
                {t('校验问题')}
                {totalProblems > 0 && <span className="bd-tab-count">{totalProblems}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bottomDockTab === 'coverage'}
                className={`bd-tab ${bottomDockTab === 'coverage' ? 'active' : ''}`}
                onClick={() => setBottomDockTab('coverage')}
              >
                {t('需求覆盖')}
                {coverageSummary.total > 0 && <span className="bd-tab-count">{coverageSummary.total}</span>}
              </button>
            </div>
            <div className="bd-actions">
              {bottomDockTab === 'problems' ? (
                <div className="bd-filter" role="group" aria-label={t('按严重度筛选')}>
                  <button type="button" className={`bd-chip ${problemFilter === 'all' ? 'active' : ''}`} onClick={() => setProblemFilter('all')}>{t('全部')} {totalProblems}</button>
                  <button type="button" className={`bd-chip err ${problemFilter === 'error' ? 'active' : ''}`} onClick={() => setProblemFilter('error')}>{t('错误')} {validationCounts.error}</button>
                  <button type="button" className={`bd-chip warn ${problemFilter === 'warning' ? 'active' : ''}`} onClick={() => setProblemFilter('warning')}>{t('警告')} {validationCounts.warning}</button>
                </div>
              ) : (
                <div className="bd-filter" role="group" aria-label={t('按覆盖筛选')}>
                  <button type="button" className={`bd-chip ${coverageFilter === 'all' ? 'active' : ''}`} onClick={() => setCoverageFilter('all')}>{t('全部')}</button>
                  <button type="button" className={`bd-chip warn ${coverageFilter === 'unsatisfied' ? 'active' : ''}`} onClick={() => setCoverageFilter('unsatisfied')}>{t('未满足')}</button>
                  <button type="button" className={`bd-chip warn ${coverageFilter === 'unverified' ? 'active' : ''}`} onClick={() => setCoverageFilter('unverified')}>{t('未验证')}</button>
                  <button type="button" className={`bd-chip err ${coverageFilter === 'uncovered' ? 'active' : ''}`} onClick={() => setCoverageFilter('uncovered')}>{t('有缺口')}</button>
                </div>
              )}
              <button type="button" className="bd-icon" title={t('重新校验')} disabled={validationLoading} onClick={() => void loadValidation()}>⟳</button>
              <button type="button" className="bd-icon" title={t('收起面板')} onClick={() => setBottomDockOpen(false)}>▾</button>
            </div>
          </div>

          <div className="bd-body">
            {validationError ? (
              <div className="bd-empty err">{t('校验加载失败：{error}', { error: validationError })}</div>
            ) : bottomDockTab === 'problems' ? (
              filteredProblems.length === 0 ? (
                <div className={`bd-empty ${totalProblems === 0 && !validationLoading ? 'ok' : ''}`}>
                  {validationLoading
                    ? t('正在校验…')
                    : totalProblems === 0
                      ? t('模型校验通过，没有发现问题')
                      : t('当前筛选下没有问题')}
                </div>
              ) : (
                <ul className="problem-list">
                  {filteredProblems.map((issue, index) => (
                    <li key={`${issue.code}-${issue.targetId}-${index}`}>
                      <button type="button" className={`problem-row ${issue.severity}`} title={issue.message} onClick={() => locateProblem(issue)}>
                        <span className={`problem-sev ${issue.severity}`} aria-hidden="true">
                          {issue.severity === 'error' ? '✕' : issue.severity === 'warning' ? '⚠' : 'ℹ'}
                        </span>
                        <span className="problem-msg">{issue.message}</span>
                        <span className="problem-target">{issue.targetType === 'diagram' ? t('图') : t('元素')} · {issue.targetName}</span>
                        <span className="problem-go" aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <div className="coverage-wrap">
                <table className="coverage-table">
                  <thead>
                    <tr>
                      <th className="cov-req">{t('需求')}</th>
                      <th className="cov-col">{t('满足 satisfy')}</th>
                      <th className="cov-col">{t('验证 verify')}</th>
                      <th className="cov-state">{t('状态')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCoverage.length === 0 ? (
                      <tr>
                        <td colSpan={4} className={`bd-empty ${coverageSummary.total === 0 && !validationLoading ? 'ok' : ''}`}>
                          {validationLoading
                            ? t('正在校验…')
                            : coverageSummary.total === 0
                              ? t('模型中没有需求元素')
                              : t('当前筛选下没有需求')}
                        </td>
                      </tr>
                    ) : filteredCoverage.map((item) => (
                      <tr key={item.id} className={!item.satisfied || !item.verified ? 'gap' : ''}>
                        <td className="cov-req">
                          <button type="button" className="cov-link" onClick={() => locateCoverageRef(item.id, item.name)}>{item.name}</button>
                        </td>
                        <td className="cov-col">
                          {item.satisfied ? (
                            <span className="cov-refs">
                              {item.satisfiedBy.map((ref) => (
                                <button key={ref.id} type="button" className="cov-ref sat" onClick={() => locateCoverageRef(ref.id, ref.name)}>{ref.name}</button>
                              ))}
                            </span>
                          ) : <span className="cov-none">{t('未满足')}</span>}
                        </td>
                        <td className="cov-col">
                          {item.verified ? (
                            <span className="cov-refs">
                              {item.verifiedBy.map((ref) => (
                                <button key={ref.id} type="button" className="cov-ref ver" onClick={() => locateCoverageRef(ref.id, ref.name)}>{ref.name}</button>
                              ))}
                            </span>
                          ) : <span className="cov-none">{t('未验证')}</span>}
                        </td>
                        <td className="cov-state">
                          <span className={`cov-badge ${item.satisfied && item.verified ? 'full' : item.satisfied || item.verified ? 'partial' : 'none'}`}>
                            {item.satisfied && item.verified ? t('已覆盖') : item.satisfied || item.verified ? t('部分') : t('缺口')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {bottomDockTab === 'coverage' && !validationError && coverageSummary.total > 0 && (
            <div className="bd-foot">
              <span className="cov-stat">{t('需求 {n}', { n: coverageSummary.total })}</span>
              <span className="cov-stat sat">{t('满足 {n}/{total}', { n: coverageSummary.satisfied, total: coverageSummary.total })}</span>
              <span className="cov-stat ver">{t('验证 {n}/{total}', { n: coverageSummary.verified, total: coverageSummary.total })}</span>
              <span className="cov-stat full">{t('全覆盖 {n}/{total}', { n: coverageSummary.fullyCovered, total: coverageSummary.total })}</span>
              <span className="cov-bar" aria-hidden="true">
                <span className="cov-bar-fill" style={{ width: `${coverageSummary.total ? Math.round(coverageSummary.fullyCovered / coverageSummary.total * 100) : 0}%` }} />
              </span>
            </div>
          )}
        </section>
      )}

      <footer className="statusbar">
        <div className="sb-group sb-left">
          <span className="sb-item sb-selected">
            <span className="sb-dot" data-kind={selectedDiagram ? 'diagram' : selectedRelation ? 'relation' : selected ? 'element' : 'none'} aria-hidden="true" />
            {selectedDiagram
              ? `${t('图')} · ${selectedDiagram.name}`
              : selected
                ? `${typeLabel(selected.type)} · ${selected.name}${selectionNotation ? ` · ${Math.round(selectionNotation.x)}, ${Math.round(selectionNotation.y)}` : ''}`
                : selectedRelation
                  ? `${t('关系')} · ${relationLabel(selectedRelation.type)}`
                  : t('未选择对象')}
          </span>
          <span className="sb-item sb-message">{t(message.key, message.vars)}</span>
        </div>
        <div className="sb-group sb-center">
          <button type="button" className="sb-btn" title={t('缩小')} onClick={() => applyZoom(zoom / 1.25)}>−</button>
          <button type="button" className="sb-zoom" title={t('缩放重置 100%')} onClick={() => applyZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="sb-btn" title={t('放大')} onClick={() => applyZoom(zoom * 1.25)}>＋</button>
          <button type="button" className="sb-btn wide" title={t('适应窗口')} onClick={fitCanvas}>{t('适应窗口')}</button>
        </div>
        <div className="sb-group sb-right">
          <button
            type="button"
            className={`sb-problems${validationCounts.error > 0 ? ' has-error' : validationCounts.warning > 0 ? ' has-warning' : ' clean'}${bottomDockOpen ? ' active' : ''}`}
            title={t('校验问题面板')}
            onClick={() => (bottomDockOpen ? setBottomDockOpen(false) : openBottomDock('problems'))}
          >
            {validationCounts.error > 0 && <span className="sb-badge err">✕ {validationCounts.error}</span>}
            {validationCounts.warning > 0 && <span className="sb-badge warn">⚠ {validationCounts.warning}</span>}
            {totalProblems === 0 && <span className="sb-badge ok">✓ {t('校验通过')}</span>}
          </button>
          {relationTool && (
            <span className="sb-item link-status">
              {t('连线 «{relation}» · {hint} · Esc 退出', {
                relation: activeSeqTool ? pick(activeSeqTool.label, activeSeqTool.labelEn) : relationLabel(relationTool),
                hint: activeSeqTool?.self
                  ? t('点击一条生命线即可建出给自己的消息')
                  : relationSource ? t('点击终点元素') : t('点击起点元素'),
              })}
            </span>
          )}
          <span className="sb-item">
            {t('{elements} 元素 · {relations} 关系 · {diagrams} 图', {
              elements: model.elements.length,
              relations: model.relationships.length,
              diagrams: model.diagrams.length,
            })}
          </span>
          <span className="sb-item">rev {health?.revision ?? model.revision}</span>
          <span className={`sb-item sb-online ${health?.status === 'UP' ? 'up' : ''}`}>
            {health?.status === 'UP' ? t('在线') : t('未连接')}
          </span>
        </div>
      </footer>

      {menu && (
        <div
          className={menuReference ? 'context-menu reference-menu' : 'context-menu'}
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="menu-title">
            {menuDiagram && <DiagramIcon code={menuDiagram.kind} size={16} />}
            {menuRelation && <RelationIcon code={menuRelation.type} size={16} />}
            {menuElement && <TypeIcon code={codeOf(menuElement.type)} size={16} />}
            {menuTarget?.kind === 'root' && projectRoot && <TypeIcon code="Model" size={16} />}
            {menuReferenceDetails && menuReferenceDetails.icon}
            <span>{menuDiagram
              ? menuDiagram.name
              : menuRelation
                ? (menuRelation.name?.trim() || relationLabel(menuRelation.type))
                : menuElement
                  ? menuElement.name
                  : menuTarget?.kind === 'reference'
                    ? menuReferenceDetails?.name ?? t('引用目标')
                    : t('项目根')}</span>
          </div>
          {menuTarget?.kind === 'element' && (
            <>
              <button type="button" onClick={() => openCreate(menuElement!.id)}>{t('新建子元素…')}</button>
              <button type="button" onClick={() => openDiagramDialog(menuElement!.id)}>{t('在此新建图…')}</button>
              <div className="menu-section">{t('表格与矩阵')}</div>
              {TABLE_VIEWS.map((item) => (
                <button type="button" key={item.id} onClick={() => openTableView(item.id)}>{t(item.label)}</button>
              ))}
              {isDiagramType(menuElement!) && (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null)
                    void openOrCreateDiagramOfType(menuElement!.id)
                  }}
                >{t('用此类型新建图')}</button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedId(menuElement!.id)
                  setSelectedRelationId(null)
                  setSelectedDiagramId(null)
                  setMenu(null)
                  window.setTimeout(() => openNameDialogRef.current(), 30)
                }}
              >{t('重命名')}</button>
              {!menuInDiagram && menuTypeAllowed && activeDiagramId && (
                <button type="button" onClick={() => void addToCurrentDiagram(menuElement!.id)}>{t('加入当前图')}</button>
              )}
              {menuInDiagram && (
                <button type="button" onClick={() => locateInDiagram(menuElement!.id)}>{t('在图中定位')}</button>
              )}
              <button
                type="button"
                onClick={() => { selectOnTree({ kind: 'element', id: menuElement!.id }); setMenu(null) }}
              >{t('树上高亮')}</button>
              {menuInDiagram && (
                <button
                  type="button"
                  onClick={(event) => openRelationQuickMenu(event, menuElement!.id)}
                >{t('快捷创建关系…')}</button>
              )}
              {isProjectRoot(menuElement) ? (
                <button type="button" className="disabled-hint" disabled title={t('项目根节点不可删除')}>
                  {t('项目根节点 · 不可删除')}
                </button>
              ) : extensionRootIds.has(menuElement!.id) ? (
                // 通用扩展包随项目提供，服务端也会拒绝删除：这里直接给出不可用提示。
                <button
                  type="button"
                  className="disabled-hint"
                  disabled
                  title={t('通用扩展包：SysML / UML 的元类与构造型随项目提供')}
                >
                  {t('通用扩展包 · 不可删除')}
                </button>
              ) : (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setDeleteDialog({
                      elementId: menuElement!.id,
                      name: menuElement!.name,
                      count: menuChildCount,
                    })
                    setMenu(null)
                  }}
                >{t('删除')}{menuChildCount > 0 ? t('（含 {count} 个后代）', { count: menuChildCount }) : ''}</button>
              )}
            </>
          )}
          {menuTarget?.kind === 'diagram' && (
            <>
              <button type="button" onClick={() => { setActiveDiagramId(menuDiagram!.id); setSelectedDiagramId(menuDiagram!.id); setMenu(null) }}>{t('在图中定位')}</button>
              <button
                type="button"
                onClick={() => { selectOnTree({ kind: 'diagram', id: menuDiagram!.id }); setMenu(null) }}
              >{t('树上高亮')}</button>
              <button
                type="button"
                onClick={() => {
                  openDiagramDialog(menuDiagram!.ownerId, menuDiagram!)
                  setMenu(null)
                }}
              >{t('重命名图')}</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const id = menuDiagram!.id
                  setMenu(null)
                  void submitDeleteDiagram(id)
                }}
              >{t('删除图')}</button>
            </>
          )}
          {menuTarget?.kind === 'relation' && (
            <>
              <button
                type="button"
                onClick={() => { selectOnTree({ kind: 'relation', id: menuRelation!.id }); setMenu(null) }}
              >{t('树上高亮')}</button>
              <button
                type="button"
                onClick={() => {
                  setSelectedRelationId(menuRelation!.id)
                  setSelectedId(null)
                  setSelectedDiagramId(null)
                  setPropsTab('attrs')
                  setMenu(null)
                }}
              >{t('查看关系属性')}</button>
            </>
          )}
          {menuTarget?.kind === 'reference' && menuReference && menuReferenceDetails && (
            <>
              <button type="button" onClick={() => { selectOnTree(menuReference); setMenu(null) }}>
                {t('树上高亮')}
              </button>
              <button
                type="button"
                className={menuReferenceDiagram ? undefined : 'disabled-hint'}
                disabled={!menuReferenceDiagram}
                title={menuReferenceDiagram ? undefined : t(menuReference.kind === 'relation'
                  ? '该关系尚未出现在任何图中' : '该元素尚未加入任何图，可用右键「加入当前图」')}
                onClick={() => {
                  if (menuReferenceDiagram) focusReferenceInDiagram(menuReference, menuReferenceDiagram)
                  setMenu(null)
                }}
              >{t('画上高亮')}</button>
              {menuTarget.removal && canEdit && (
                <button type="button" className="danger" onClick={() => removeReference(menuTarget.removal!)}>{t('移除')}</button>
              )}
            </>
          )}
          {menuTarget?.kind === 'root' && (
            <>
              <button type="button" onClick={() => openCreate(null)}>{t('在项目根下新建元素…')}</button>
              <button type="button" onClick={() => openDiagramDialog(null)}>{t('在项目根下新建图…')}</button>
              <div className="menu-section">{t('表格与矩阵')}</div>
              {TABLE_VIEWS.map((item) => (
                <button type="button" key={item.id} onClick={() => openTableView(item.id)}>{t(item.label)}</button>
              ))}
            </>
          )}
        </div>
      )}

      {/* 图形右上角「+」浮层：child=华望式子元素 ContextMenu；relation=右键发起的关系类型菜单 */}
      {quickMenu && (() => {
        const target = elementById.get(quickMenu.targetId)
        const targetName = target?.name ?? quickMenu.targetId
        return (
          <div
            className="quick-menu"
            style={{
              left: Math.min(quickMenu.x, window.innerWidth - 232),
              top: Math.min(quickMenu.y, window.innerHeight - 430),
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="menu-title">
              {target && <TypeIcon code={codeOf(target.type)} size={16} />}
              <span>{quickMenu.mode === 'child'
                ? t('为「{name}」添加子元素', { name: targetName })
                : t('以「{name}」为起点', { name: targetName })}</span>
            </div>
            {quickMenu.mode === 'child' ? (
              quickChildGroups.length === 0 ? (
                <div className="quick-menu-empty">{t('该图形不允许再包含子元素')}</div>
              ) : quickChildGroups.flatMap((group) => [
                <div className="menu-section" key={`${group.name}-head`}>{t(group.name)}</div>,
                ...group.items.map((item) => (
                  <button
                    type="button"
                    key={item.code}
                    title={`${item.uml} · ${item.labelEn ?? item.label}`}
                    onClick={() => void createQuickChild(item.code)}
                  >
                    <TypeIcon code={item.code} size={14} />
                    <span>{pick(item.label, item.labelEn)}</span>
                  </button>
                )),
              ])
            ) : (
              relationEntries.length === 0 ? (
                <div className="quick-menu-empty">{t('当前图未开放关系类型')}</div>
              ) : relationEntries.map((rel) => (
                <button
                  type="button"
                  key={rel.code}
                  onClick={() => {
                    activateRelationTool(rel.code)
                    setRelationSource(quickMenu.targetId)
                    setQuickMenu(null)
                  }}
                >
                  <RelationIcon code={rel.code} size={14} />
                  <span>{pick(rel.label, rel.labelEn)}</span>
                </button>
              ))
            )}
          </div>
        )
      })()}

      {/* Ctrl/⌘+K 全局搜索：名称 / 文档 / 标签 / 属性值打分，↑↓ 选择、Enter 跳转 */}
      {searchOpen && (
        <div className="search-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) closeSearch() }}>
          <div className="search-palette" role="dialog" aria-label={t('全局搜索')} onPointerDown={(event) => event.stopPropagation()}>
            <div className="search-input-row">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="6.8" cy="6.8" r="4.2" /><path d="M10 10l3.6 3.6" />
              </svg>
              <input
                autoFocus
                value={searchQuery}
                spellCheck={false}
                placeholder={t('按名称搜索元素、图、关系…')}
                aria-label={t('全局搜索')}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  const count = searchResults.length
                  if (event.key === 'ArrowDown' && count > 0) {
                    event.preventDefault()
                    setSearchIndex((previous) => (previous + 1) % count)
                  } else if (event.key === 'ArrowUp' && count > 0) {
                    event.preventDefault()
                    setSearchIndex((previous) => (previous - 1 + count) % count)
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    const result = searchResults[searchIndex]
                    if (result) {
                      activateSearchResult(result)
                    }
                  }
                }}
              />
              <kbd className="search-esc">Esc</kbd>
            </div>
            <div className="search-results" role="listbox" aria-label={t('搜索结果')}>
              {searchResults.map((result, index) => (
                <button
                  type="button"
                  key={`${result.kind}:${result.id}`}
                  role="option"
                  aria-selected={index === searchIndex}
                  data-search-index={index}
                  className={`search-row${index === searchIndex ? ' active' : ''}`}
                  onMouseEnter={() => setSearchIndex(index)}
                  onClick={() => activateSearchResult(result)}
                >
                  {result.kind === 'diagram'
                    ? <DiagramIcon code={model.diagrams.find((item) => item.id === result.id)?.kind ?? 'bdd'} size={15} />
                    : result.kind === 'relation'
                      ? <RelationIcon code={model.relationships.find((item) => item.id === result.id)?.type ?? 'dependency'} size={15} />
                      : <TypeIcon code={codeOf(elementById.get(result.id)?.type ?? 'BLOCK')} size={15} />}
                  <span className="search-name">{result.name}</span>
                  <span className="search-sub">{result.sub}</span>
                  <span className="search-kind">{t(result.kind === 'diagram' ? '图' : result.kind === 'relation' ? '关系' : '元素')}</span>
                </button>
              ))}
              {searchNeedle && searchResults.length === 0 && (
                <p className="hint search-empty">{t('没有匹配「{keyword}」的模型对象', { keyword: searchQuery.trim() })}</p>
              )}
              {!searchNeedle && searchResults.length === 0 && (
                <p className="hint search-empty">{t('暂无图可快速打开')}</p>
              )}
            </div>
            <div className="search-foot">
              <span><kbd>↑</kbd><kbd>↓</kbd> {t('选择')}</span>
              <span><kbd>Enter</kbd> {t('打开')}</span>
              <span className="search-count">{t('{count} 个结果', { count: searchResults.length })}</span>
            </div>
          </div>
        </div>
      )}

      {/* B4 模型交付报告：iframe srcDoc 预览自包含 HTML，导出即同一份字符串。 */}
      {reportOpen && (
        <div className="report-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) closeReport() }}>
          <div className="report-shell" role="dialog" aria-label={t('模型交付报告')} onPointerDown={(event) => event.stopPropagation()}>
            <div className="report-bar">
              <div className="report-bar-title">
                <span className="report-bar-mark" aria-hidden="true">▤</span>
                <div className="report-bar-text">
                  <strong>{t('模型交付报告')}</strong>
                  <span className="report-bar-sub">{workspace?.currentProjectName ?? projectRoot?.name ?? t('未命名项目')} · rev {model.revision}</span>
                </div>
              </div>
              <div className="report-bar-actions">
                <button type="button" className="report-btn" onClick={() => void openReport()} title={t('用最新模型与校验数据重新生成')}>↻ {t('刷新')}</button>
                <button type="button" className="report-btn" onClick={printReport} disabled={!reportHtml} title={t('打印 / 另存为 PDF')}>⎙ {t('打印')}</button>
                <button type="button" className="report-btn primary" onClick={exportReportHtml} disabled={!reportHtml} title={t('导出自包含 HTML 文件')}>⇩ {t('导出 HTML')}</button>
                <button type="button" className="report-close" onClick={closeReport} aria-label={t('关闭')}>✕</button>
              </div>
            </div>
            {reportError && <div className="report-error">{t('校验数据加载失败：{error}', { error: reportError })}</div>}
            <div className="report-body">
              {reportHtml
                ? <iframe ref={reportFrameRef} className="report-frame" title={t('模型交付报告')} srcDoc={reportHtml} />
                : reportError
                  ? <div className="report-loading">{t('报告生成失败，请点「刷新」重试。')}</div>
                  : <div className="report-loading"><span className="report-spinner" aria-hidden="true" />{t('正在装配报告…')}</div>}
            </div>
          </div>
        </div>
      )}

      {projectPanel && <ProjectPanel key={`${activeProjectId}/${projectPanel.link?.baseline ?? ''}`}
        project={activeProjectId} name={selectedProject?.name ?? projectRoot?.name ?? ''} model={model}
        target={projectPanel.link?.target ?? selectedProjectTarget} link={projectPanel.link} section={projectPanel.section}
        overview={overview} validation={validationReport} onRefresh={refreshProjectWorkflow}
        onClose={() => setProjectPanel(null)} onLocate={target => { locateProjectObject(target); setProjectPanel(null) }} />}
      {requirementImportOpen && canImport && projectRootId && <RequirementImportPanel key={activeProjectId}
        project={activeProjectId} revision={model.revision} rootId={projectRootId}
        packages={projectElements.filter(element => element.type.toLowerCase() === 'package')}
        onClose={() => setRequirementImportOpen(false)} onCommitted={refresh} />}

      {/* 属性编辑弹框：行尾「⋯」打开，控件由元属性的值类型决定 */}
      {propDialogSpec && propDialogSpec.editable && canEdit && (
        <div className="modal-overlay" onPointerDown={closePropDialog}>
          <div className="modal prop-dialog" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <span className="prop-dlg-mark" aria-hidden="true">⋯</span>
              {t('编辑属性 · {label}', { label: pick(propDialogSpec.label, propDialogSpec.labelEn) })}
            </h2>
            <p className="modal-sub">
              {t('{metaclass} · {umlName} · {spec}', {
                metaclass: pick(propDialogSpec.metaclassLabel, propDialogSpec.metaclassLabelEn),
                umlName: propDialogSpec.umlName,
                spec: propDialogSpec.spec,
              })}
            </p>
            <div className="prop-dlg-meta">
              <span>{t('值类型 {kind}', { kind: propDialogSpec.kind })}</span>
              <code>{propDialogSpec.key}</code>
              {propDialogLive(propDialogSpec) && <span className="prop-dlg-live">{t('即时生效')}</span>}
            </div>
            {renderPropDialogEditor(propDialogSpec)}
            <div className="modal-actions">
              {propDialogLive(propDialogSpec)
                ? <button type="button" className="primary" onClick={closePropDialog}>{t('完成')}</button>
                : <button type="button" onClick={closePropDialog}>{t('取消')}</button>}
              {propertyText(propDialogSpec).trim() !== '' && propDialogSpec.key !== 'name' && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => clearPropValue(propDialogSpec)}
                >{t('清除值')}</button>
              )}
              {!propDialogLive(propDialogSpec) && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => applyPropDraft(propDialogSpec)}
                >{t('应用')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteProjectTarget && (
        <div className="modal-overlay" onPointerDown={() => setDeleteProjectTarget(null)}>
          <div className="modal" role="alertdialog" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code="PACKAGE" size={18} />
              {t('删除项目')}
            </h2>
            <p className="modal-sub">{t('删除后该项目目录项与落库快照一并移除，不可恢复。')}</p>
            <div className="danger-target">
              <TypeIcon code="PACKAGE" size={16} />
              <strong>{deleteProjectTarget.name}</strong>
              <span>{deleteProjectTarget.description || deleteProjectTarget.status}</span>
            </div>
            {deleteProjectTarget.id === activeProjectId && (
              <p className="hint">{t('这是当前编辑项目，删除后会切换到目录里的第一个项目。')}</p>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setDeleteProjectTarget(null)}>{t('取消')}</button>
              <button
                type="button"
                className="primary danger"
                data-confirm="delete-project"
                disabled={busy}
                onClick={() => void confirmDeleteProject()}
              >{t('永久删除')}</button>
            </div>
          </div>
        </div>
      )}

      {newProjectDialog && (
        <div className="modal-overlay" onPointerDown={() => setNewProjectDialog(false)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code="PACKAGE" size={18} />
              {t('新建项目')}
            </h2>
            <p className="modal-sub">{t('在指定空间下创建并立即打开项目')}</p>
            <label className="field">
              <span>{t('所属空间')}</span>
              <select value={newProjectSpace} onChange={(event) => setNewProjectSpace(event.target.value)}>
                {(workspace?.spaces ?? []).map((space) => (
                  <option key={space.code} value={space.code}>{space.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('项目名称')}</span>
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder={t('例如：制动系统模型')}
              />
            </label>
            <label className="field">
              <span>{t('描述（可选）')}</span>
              <input
                value={newProjectDesc}
                onChange={(event) => setNewProjectDesc(event.target.value)}
                placeholder={t('一句话说明项目范围')}
              />
            </label>
            <p className="hint">{t('创建后会立即打开该项目并分配独立的内存态模型；服务重启后回到初始基线。')}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setNewProjectDialog(false)}>{t('取消')}</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !newProjectName.trim()}
                onClick={() => void submitNewProject()}
              >{t('创建')}</button>
            </div>
          </div>
        </div>
      )}

      {layoutDialog && (
        <div className="modal-overlay" onPointerDown={() => setLayoutDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <span className="mark" aria-hidden="true">▦</span>
              {t('自动排布')}
            </h2>
            <p className="modal-sub">{t('按关系语义重排节点坐标：需求置顶、泛化向上、同父聚簇、少交叉')}</p>
            <label className="field">
              <span>{t('范围')}</span>
              <select
                value={layoutDialog}
                onChange={(event) => setLayoutDialog(event.target.value as LayoutScope)}
              >
                <option value="diagram">{t('仅当前图')}{activeDiagramObj ? ` · ${activeDiagramObj.name}` : ''}</option>
                <option value="all">{t('全部图表')} · {model.diagrams.length}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('策略')}</span>
              <select
                value={layoutStrategy}
                onChange={(event) => setLayoutStrategy(event.target.value as LayoutChoice)}
              >
                <option value="auto">{t('自动：逐图打分挑一种')}</option>
                <option value="layered">{t('分层：需求置顶、泛化向上，层内同父聚簇')}</option>
                <option value="hubbed">{t('枢纽：中心节点贴边，其余按簇分块')}</option>
                <option value="grouped">{t('分组：按父子归属成块，适合结构图')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('方向（华望类图布局）')}</span>
              <select
                value={layoutDirection}
                onChange={(event) => setLayoutDirection(event.target.value as LayoutDirection)}
              >
                <option value="auto">{t('自动：按图面比例挑一个方向')}</option>
                <option value="down">{t('向下：层自上而下，层间距 50')}</option>
                <option value="right">{t('向右：层自左而右，层间距 50')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('层内次序')}</span>
              <select
                value={layoutNameOrder}
                onChange={(event) => setLayoutNameOrder(event.target.value as LayoutNameOrder)}
              >
                <option value="none">{t('默认：减少交叉并让同父聚簇')}</option>
                <option value="asc">{t('名称正序')}</option>
                <option value="desc">{t('名称倒序')}</option>
              </select>
            </label>
            <p className="hint">
              {t('只改写记法坐标：元素、关系与归属不变。整批一次写入，撤销一步即可回到排布前；序列图等由图形自身规则排布的图不参与。')}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setLayoutDialog(null)}>{t('取消')}</button>
              <button
                type="button"
                className="primary"
                disabled={busy || (layoutDialog === 'diagram' && !activeDiagramObj)}
                onClick={() => void runAutoLayout(layoutStrategy, layoutDialog)}
              >{t('开始排布')}</button>
            </div>
          </div>
        </div>
      )}

      {importDialog && (
        <div className="modal-overlay" onPointerDown={() => setImportDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code="MODEL" size={18} />
              {t('导入 XMI')}
            </h2>
            <p className="modal-sub">{t('导入会整包替换当前项目的内容（通用扩展包保留）')}</p>
            <label className="field">
              <span>{t('XMI 语义文件（.xmi，必选）')}</span>
              <input
                type="file"
                accept=".xmi,text/xml,application/xml"
                onChange={(event) => void pickImportFile('semantic', event.target.files?.[0])}
              />
              {importDialog.semanticName && (
                <span className="hint">{importDialog.semanticName}</span>
              )}
            </label>
            <label className="field">
              <span>{t('布局侧车（.di.json，可选）')}</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void pickImportFile('sidecar', event.target.files?.[0])}
              />
              {importDialog.sidecarName && (
                <span className="hint">{importDialog.sidecarName}</span>
              )}
            </label>
            <p className="hint">
              {t('标准 XMI 不承载图类型、图名与坐标；没有侧车时语义完整，但规范图布局由服务端重新排布。导入后可通过「撤销」一步回到导入前。')}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setImportDialog(null)}>{t('取消')}</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !importDialog.semantic.trim()}
                onClick={() => void submitImport()}
              >{t('导入')}</button>
            </div>
          </div>
        </div>
      )}

      {createDialog && (
        <div className="modal-overlay" onPointerDown={() => setCreateDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code={createType || 'PACKAGE'} size={18} />
              {t('新建元素')}
            </h2>
            <p className="modal-sub">{t('父节点：{name}', { name: createDialog.ownerName })}</p>
            {!containment ? (
              <p className="hint">{t('元模型规则尚未加载，请检查网络连接；页面会自动重试。')}</p>
            ) : createOptions.length === 0 ? (
              <p className="hint">{t('按元模型规则，该父类型不允许再包含子元素。')}</p>
            ) : (
              <>
                <div className="choose-element">
                  <div className="ce-head">
                    <TypeIcon code={createType || 'PACKAGE'} size={15} />
                    {t('元素类型（按规范过滤）')}
                    <input
                      className="ce-search"
                      value={createQuery}
                      placeholder={t('搜索元素种类…')}
                      aria-label={t('搜索元素种类')}
                      onChange={(event) => setCreateQuery(event.target.value)}
                    />
                  </div>
                  <div className="ce-groups" role="listbox" aria-label={t('元素种类')}>
                    {createGroups.map((group) => (
                      <section className="ce-group" key={group.name}>
                        <h3>{t(group.name)}</h3>
                        <div className="ce-items">
                          {group.items.map((option) => (
                            <button
                              type="button"
                              role="option"
                              aria-selected={option.code === createType}
                              key={option.code}
                              className={`ce-item${option.code === createType ? ' selected' : ''}`}
                              title={`${option.uml} · ${option.labelEn ?? option.label}`}
                              onClick={() => {
                                setCreateType(option.code)
                                setCreateStereotype(option.stereotype)
                                setCreateName(t('新建{label} {count}', {
                                  label: pick(option.label, option.labelEn),
                                  count: model.elements.length + 1,
                                }))
                              }}
                            >
                              <TypeIcon code={option.code} size={16} />
                              <span>{pick(option.label, option.labelEn)}</span>
                              <small>{option.uml}</small>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                    {createGroups.length === 0 && <p className="hint">{t('没有匹配的元素种类。')}</p>}
                  </div>
                  {createType && (
                    <p className="ce-current">
                      {t('已选择：«{stereotype}» {label}（{uml}）', {
                        stereotype: typeInfo.get(createType)?.stereotype ?? '',
                        label: typeInfo.get(createType) ? pick(typeInfo.get(createType)!.label, typeInfo.get(createType)!.labelEn) : createType,
                        uml: typeInfo.get(createType)?.uml ?? createType,
                      })}
                    </p>
                  )}
                </div>
                <label className="field">
                  <span>{t('名称（同命名空间内唯一，不区分大小写）')}</span>
                  <input value={createName} onChange={(event) => setCreateName(event.target.value)} />
                </label>
                <label className="field">
                  <span>{t('构造型')}</span>
                  <input
                    value={createStereotype}
                    onChange={(event) => setCreateStereotype(event.target.value)}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={joinDiagram && canJoinDiagram}
                    disabled={!canJoinDiagram}
                    onChange={(event) => setJoinDiagram(event.target.checked)}
                  />
                  {t('同时加入当前图（{label}）', { label: activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : '—' })}
                </label>
                {!canJoinDiagram && (
                  <p className="hint">
                    {t('该元素类型不允许出现在当前图，服务端会拒绝；仅创建到模型树中。')}
                  </p>
                )}
              </>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setCreateDialog(null)}>{t('取消')}</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !containment || createOptions.length === 0 || !createName.trim()}
                onClick={() => void submitCreate()}
              >
                {t('创建')}
              </button>
            </div>
          </div>
        </div>
      )}

      {diagramDialog && (
        <div className="modal-overlay" onPointerDown={() => setDiagramDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <DiagramIcon
                code={customization?.diagramTypes.find((item) => item.id === diagramDialog.kind)?.baseKind
                  ?? diagramDialog.kind}
                size={18}
              />
              {t('新建图')}
            </h2>
            <p className="modal-sub">{t('所属：{name}', { name: diagramDialog.ownerName })}</p>
            {/* 华望 NewGraph：分组标签 + 搜索 + 缩略图卡片墙，点击卡片直接选类型。 */}
            <div className="new-graph">
              <div className="ng-labels">
                {(['all', 'spec', 'custom'] as const).map((group) => {
                  if (group === 'custom' && (customization?.diagramTypes.length ?? 0) === 0) {
                    return null
                  }
                  const label = group === 'all' ? t('全部图表') : group === 'spec' ? t('规范图') : t('自定义图')
                  return (
                    <button
                      type="button"
                      key={group}
                      className={`ng-label${newGraphGroup === group ? ' selected' : ''}`}
                      onClick={() => setNewGraphGroup(group)}
                    >{label}</button>
                  )
                })}
                <input
                  className="ng-search"
                  value={newGraphQuery}
                  placeholder={t('搜索想要创建的图')}
                  onChange={(event) => setNewGraphQuery(event.target.value)}
                />
              </div>
              <div className="ng-grid">
                {allSpecs
                  .filter((option) => newGraphGroup === 'all'
                    || (newGraphGroup === 'spec' ? specs.some((spec) => spec.code === option.code)
                      : specs.every((spec) => spec.code !== option.code)))
                  .filter((option) => {
                    const q = newGraphQuery.trim().toLowerCase()
                    return !q || `${pick(option.label, option.labelEn)} ${option.code} ${option.labelEn ?? ''}`
                      .toLowerCase().includes(q)
                  })
                  .map((option) => (
                    <button
                      type="button"
                      key={option.code}
                      className={`ng-card${diagramDialog.kind === option.code ? ' selected' : ''}`}
                      title={option.labelEn ? `${option.label} · ${option.labelEn}` : option.label}
                      onClick={() => setDiagramDialog({ ...diagramDialog, kind: option.code })}
                    >
                      <span className="ng-thumb">
                        <DiagramIcon
                          code={customization?.diagramTypes.find((item) => item.id === option.code)?.baseKind ?? option.code}
                          size={52}
                        />
                      </span>
                      <span className="ng-name">{pick(option.label, option.labelEn)}</span>
                      <span className="ng-en">{option.labelEn ?? option.code}</span>
                    </button>
                  ))}
              </div>
            </div>
            {/* select 保留为同状态的兼容入口：脚本按 optgroup 选取自定义图类型，卡片与它双向同步。 */}
            <label className="field ng-compat-field">
              <span>{t('图类型')}</span>
              <select
                value={diagramDialog.kind}
                onChange={(event) => setDiagramDialog({ ...diagramDialog, kind: event.target.value })}
              >
                <optgroup label={t('规范图')}>
                  {specs.map((option) => (
                    <option key={option.code} value={option.code}>{pick(option.label, option.labelEn)}</option>
                  ))}
                </optgroup>
                {(customization?.diagramTypes.length ?? 0) > 0 && (
                  <optgroup label={t('自定义图')}>
                    {customization!.diagramTypes.map((option) => (
                      <option key={option.id} value={option.id}>{pick(option.label, option.labelEn)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="field">
              <span>{t('图名称')}</span>
              <input
                value={diagramDialog.name}
                onChange={(event) => setDiagramDialog({ ...diagramDialog, name: event.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setDiagramDialog(null)}>{t('取消')}</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !diagramDialog.name.trim()}
                onClick={() => void submitDiagram()}
              >
                {t('创建')}
              </button>
            </div>
          </div>
        </div>
      )}

      {relationDialog && (
        <div className="modal-overlay" onPointerDown={() => setRelationDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2>{t('新建关系')}</h2>
            <p className="modal-sub">
              {t('在「{label}」中建立语义关系 · 类型按当前图规范过滤', { label: activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : t('当前图') })}
            </p>
            <label className="field">
              <span>{t('源元素')}</span>
              <select
                value={relationDialog.sourceId}
                onChange={(event) => setRelationDialog({ ...relationDialog, sourceId: event.target.value })}
              >
                <option value="">{t('— 选择源 —')}</option>
                {model.elements.map((element) => (
                  <option key={element.id} value={element.id}>{t('{name}（{type}）', { name: element.name, type: element.type })}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('目标元素')}</span>
              <select
                value={relationDialog.targetId}
                onChange={(event) => setRelationDialog({ ...relationDialog, targetId: event.target.value })}
              >
                <option value="">{t('— 选择目标 —')}</option>
                {model.elements.map((element) => (
                  <option key={element.id} value={element.id}>{t('{name}（{type}）', { name: element.name, type: element.type })}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('关系类型')}</span>
              <select
                value={relationDialog.type}
                onChange={(event) => setRelationDialog({ ...relationDialog, type: event.target.value })}
              >
                {(relationEntries.length > 0 ? relationEntries : allRelations).map((rel) => (
                  <option key={rel.code} value={rel.code}>{t('{label}（«{code}»）', { label: pick(rel.label, rel.labelEn), code: rel.code })}</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setRelationDialog(null)}>{t('取消')}</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !relationDialog.sourceId || !relationDialog.targetId}
                onClick={() => void submitRelation()}
              >
                {t('创建')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div className="modal-overlay" onPointerDown={() => setDeleteDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2>{t('删除元素')}</h2>
            <p className="modal-sub">
              {t('确认删除「{name}」？', { name: deleteDialog.name })}
              {deleteDialog.count > 0 && t(' 将级联删除 {count} 个后代元素、相关关系与图形记法。', { count: deleteDialog.count })}
            </p>
            <p className="hint">{t('服务端以单条原子命令完成，所有在线会话同步；可用「撤销」恢复整棵子树。')}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDeleteDialog(null)}>{t('取消')}</button>
              <button type="button" className="primary danger" disabled={busy} onClick={() => void submitDelete()}>
                {t('确认删除')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
