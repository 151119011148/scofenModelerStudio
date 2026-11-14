import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  clearSession,
  createProject,
  deleteProject,
  exportNative,
  exportSidecar,
  exportXmi,
  getContainment,
  getDiagrams,
  getExtensionPackages,
  getHealth,
  getModel,
  getProjectId,
  getProperties,
  getRelationships,
  getWorkspaces,
  importXmi,
  loadSession,
  logout,
  patchSocketUrl,
  postCommand,
  redo,
  setProjectId,
  setUnauthorizedHandler,
  undo,
} from './api'
import type {
  ContainmentSpec,
  Diagram,
  DiagramSpec,
  ElementTypeInfo,
  ExtensionPackageInfo,
  Health,
  ModelElement,
  ModelSnapshot,
  PropertyCatalogInfo,
  PropertySpec,
  PropertyView,
  Relationship,
  RelationshipTypeInfo,
  Session,
  WorkspaceDirectoryInfo,
  WorkspaceProject,
} from './types'
import { arrowGeometry, controlGlyph, controlSizeOf, isBackdropShape, isLaneMembershipRelation, isPartitionType, moveRouteSegment, orthogonalRoute, readRoute, reattachRoute, relationshipStyle, routeMidpoint, shapeOf, simplifyRoute, SWIMLANE_HEADER, wrapLabel, type RoutePoint } from './notation'
import {
  layoutSequence, messageSortStyle, nextMessageOrder, reorderMessages, reorderMessagesTo,
  SEQ_MESSAGE_TOOLS, seqMessageToolOf, SEQ_ROW_PITCH, SEQ_SELF_BUMP, SEQ_SELF_HEIGHT,
} from './sequenceLayout'
import type { SeqActivation, SeqFragment, SeqMessage, SeqMessageToolDef } from './sequenceLayout'
import { autoLayout, isLayoutImmutable } from './layout'
import type { LayoutChoice } from './layout'
import { DiagramIcon, FAMILIES, RelationIcon, TypeIcon, familyOfType } from './icons'
import { pick, setLocale, t, useLocale } from './i18n'
import LocaleSwitch from './LocaleSwitch'
import LoginView from './LoginView'
import AdminPanel from './AdminPanel'

const EMPTY_MODEL: ModelSnapshot = {
  revision: 0,
  elements: [],
  relationships: [],
  diagrams: [],
  notations: [],
}

const FALLBACK_CANVAS = { maxX: 4000, maxY: 2600, width: 640, height: 420 }
const FALLBACK_NODE = { width: 168, height: 84 }
const ROOT_KEY = '__root__'
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
 */
const EXTENSION_ID_PREFIXES = ['ext-', 'mc-', 'st-', 'rel-', 'prim-', 'val-', 'unit-', 'dim-', 'std-']
const isExtensionId = (id: string) => EXTENSION_ID_PREFIXES.some((prefix) => id.startsWith(prefix))

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
  isLocated: boolean
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
  const { kind, id, depth, childCount, isOpen, isSelected, isLocated, isDropTarget } = props
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
    return (
      <div
        className="tree-row virtual-group extension-element"
        data-tree-kind="extension-element"
        data-element-id={element.id}
        style={indent}
        role="button"
        tabIndex={0}
        title={t('{name} · 扩展包只读定义（与项目模型隔离）', { name: element.name })}
        onClick={() => {
          actions.selectExtensionElement(element.id)
          if (hasChildren) {
            actions.toggleExpanded(element.id)
          }
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
        className={`tree-row diagram${isSelected ? ' selected' : ''}${isDropTarget ? ' drop-target' : ''}${isLocated ? ' located' : ''}`}
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
        <DiagramIcon code={diagram.kind} size={16} title={data.diagramLabel(diagram.kind)} />
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
  return (
    <div
      className={`tree-row element${isSelected ? ' selected' : ''}${isRoot ? ' root-node' : ''}${isLocated ? ' located' : ''}`}
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
      title={t('{label} · 可拖入画布或图节点', { label: info })}
      onClick={() => actions.selectElement(element.id)}
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
      <TypeIcon code={data.codeOf(element.type)} size={16} title={info} />
      <span className="tree-label">{element.name}</span>
      {isRoot ? (
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

type MenuTarget =
  | { kind: 'element'; id: string }
  | { kind: 'diagram'; id: string }
  | { kind: 'root'; id: null }
  /** 引用型属性的目标元素：菜单提供「树上高亮」与「移除」。 */
  | { kind: 'reference'; id: string; propKey: string; index: number }

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
}

interface DiagramDialogState {
  ownerId: string | null
  ownerName: string
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
}

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
  kind: 'diagram' | 'element'
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
  level: number,
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
  const canEdit = permissions.has('model.edit')
  const canExport = permissions.has('model.export')
  const canImport = permissions.has('model.import')
  const canCreateProject = permissions.has('project.create')
  const canDeleteProject = permissions.has('project.delete')
  const canManageUsers = permissions.has('user.manage')
  const [health, setHealth] = useState<Health | null>(null)
  const [model, setModel] = useState<ModelSnapshot>(EMPTY_MODEL)
  const [specs, setSpecs] = useState<DiagramSpec[]>([])
  const [containment, setContainment] = useState<ContainmentSpec | null>(null)
  const [activeDiagramId, setActiveDiagramId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null)
  // 关系是独立模型对象：选中连线后在属性窗口按关系类型的元类链编辑属性。
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null)
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
  const [busy, setBusy] = useState(false)
  // 用户与角色管理抽屉：仅 user.manage 权限可见。
  const [adminOpen, setAdminOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // 模型树拖放：元素拖到图节点上时高亮可接收的图。
  const [treeDropTarget, setTreeDropTarget] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)
  const [diagramDialog, setDiagramDialog] = useState<DiagramDialogState | null>(null)
  const [relationDialog, setRelationDialog] = useState<RelationshipDialogState | null>(null)
  // 自动排布：打开时记住范围，策略单独存（关窗重开不必再选一遍）。
  const [layoutDialog, setLayoutDialog] = useState<LayoutScope | null>(null)
  const [layoutStrategy, setLayoutStrategy] = useState<LayoutChoice>('auto')
  const [createType, setCreateType] = useState('')
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
  const [toolboxTab, setToolboxTab] = useState<'components' | 'styles'>('components')
  const [openToolGroups, setOpenToolGroups] = useState<Set<string>>(
    () => new Set(['elements', 'relations', 'generic', 'seqMessages']),
  )
  const [relationCatalog, setRelationCatalog] = useState<RelationshipTypeInfo[]>([])
  // 连线工具：选中关系组件后在画布上依次点击起点、终点创建关系。
  const [relationTool, setRelationTool] = useState<string | null>(null)
  const [relationSource, setRelationSource] = useState<string | null>(null)
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
  const [propsTab, setPropsTab] = useState<'attrs' | 'tags' | 'relations' | 'notation'>('attrs')
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
  // 「树上高亮」：模型树中需要展开祖先并高亮定位的元素 id。
  const [treeLocateId, setTreeLocateId] = useState<string | null>(null)
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
  const [leftTab, setLeftTab] = useState<'project' | 'charts' | 'library'>('project')
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
        left: clamp(localStorage.getItem('scofen.modeler.dock.left'), 268, DOCK_LEFT_MIN, DOCK_LEFT_MAX),
        tool: clamp(localStorage.getItem('scofen.modeler.dock.tool'), 198, DOCK_TOOL_MIN, DOCK_TOOL_MAX),
      }
    } catch {
      return { left: 268, tool: 198 }
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
  const [panDrag, setPanDrag] = useState<{
    startX: number
    startY: number
    panX: number
    panY: number
    /** 起手落在空白画布上：没拖动的话按「取消选择」处理，拖了才算平移。 */
    onBackground: boolean
    moved: boolean
  } | null>(null)

  // 所有 /api 请求都带当前项目头；在渲染期同步，避免切换项目时首帧请求串到旧项目。
  setProjectId(activeProjectId)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  /** 左栏容器：属性面板上下拖拽时以它为高度基准（底边固定）。 */
  const leftDockRef = useRef<HTMLDivElement | null>(null)
  const menubarRef = useRef<HTMLElement | null>(null)
  // 命令的 baseRevision 必须取「最新已知 revision」而非渲染闭包里的 model.revision：
  // 同一次事件里连续发两条命令时，state 尚未更新，旧值会触发 409 乐观锁冲突。
  const revisionRef = useRef(0)

  /** 拉取当前项目的权威快照；失败返回 false，由 bootstrap 统一调度重试。 */
  const refresh = useCallback(async (): Promise<boolean> => {
    // 记下发起时的项目：请求在飞行途中用户可能已经切项目（或删掉了当前项目），
    // 那次失败属于旧项目，不该把「连接失败」横幅挂到新项目头上。
    const projectAtStart = getProjectId()
    try {
      // 空间目录不认项目头，先单独取：模型接口 404 时（本地重启后记住的项目 id 已失效）
      // 它也得落到 state，否则选择器是空的，用户连「换一个项目」这条路都走不通。
      const nextWorkspace = await getWorkspaces().catch(() => null)
      if (nextWorkspace) {
        setWorkspace(nextWorkspace)
      }
      const [nextHealth, nextModel] = await Promise.all([
        getHealth(),
        getModel(),
      ])
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
      getRelationships().then(setRelationCatalog),
      getContainment().then(setContainment),
      getProperties().then(setPropCatalog),
      getExtensionPackages().then((catalog) => {
        setExtensionPackages(catalog.packages ?? [])
        // 与项目快照隔离的只读定义：扩展包虚拟树只认这份数据。
        setExtensionElements(catalog.elements ?? [])
      }),
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
          const payload = JSON.parse(event.data) as { type?: string }
          if (payload.type === 'patch') {
            void refresh()
          }
        } catch {
          // 忽略非 JSON 心跳帧
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (stopped) {
          return
        }
        // 断线不会自愈：只有重连后才收得到别的会话广播的 Patch。
        timer = window.setTimeout(open, Math.min(1000 * 2 ** attempt++, 15_000))
      }
    }
    open()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      socket?.close()
    }
  }, [refresh, activeProjectId, session.token])

  useEffect(() => {
    if (!menu) {
      return
    }
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

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
  const nodeSize = containment?.node ?? FALLBACK_NODE

  const activeDiagramObj = useMemo(
    () => model.diagrams.find((item) => item.id === activeDiagramId) ?? null,
    [model.diagrams, activeDiagramId],
  )
  const activeDiagramKind = activeDiagramObj?.kind ?? ''
  const activeSpec = useMemo(
    () => specs.find((spec) => spec.code === activeDiagramKind) ?? null,
    [specs, activeDiagramKind],
  )

  // 模型装载完成后默认激活第一张图
  useEffect(() => {
    if (activeDiagramId === '' && model.diagrams.length > 0) {
      setActiveDiagramId(model.diagrams[0].id)
    }
  }, [activeDiagramId, model.diagrams])

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
        tab.kind === 'diagram'
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
      return spec ? pick(spec.label, spec.labelEn) : kind
    },
    [specs],
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

  /** 模型树筛选：命中项 + 其祖先链，保证命中行所在的路径可见。 */
  const treeFilterHits = useMemo(() => {
    const needle = treeFilter.trim().toLowerCase()
    if (!needle) {
      return null
    }
    const hits = new Set<string>()
    // 隔离内容不参与项目模型筛选：扩展包只在自己的虚拟分组里浏览。
    for (const element of projectElements) {
      if (element.name.toLowerCase().includes(needle)) {
        hits.add(element.id)
      }
    }
    for (const diagram of model.diagrams) {
      if (diagram.name.toLowerCase().includes(needle)) {
        hits.add(diagram.id)
      }
    }
    // 祖先链：只留命中项会导致父节点被过滤、子树根本渲染不出来。
    for (const id of [...hits]) {
      let cursor = elementById.get(id)?.ownerId ?? null
      while (cursor) {
        hits.add(cursor)
        cursor = elementById.get(cursor)?.ownerId ?? null
      }
    }
    return hits
  }, [treeFilter, projectElements, model.diagrams, elementById])

  /** 图表视图：按图类型分组，和工具箱的九图语义一致。 */
  const diagramsByKind = useMemo(() => {
    const map = new Map<string, Diagram[]>()
    for (const diagram of model.diagrams) {
      const list = map.get(diagram.kind)
      if (list) {
        list.push(diagram)
      } else {
        map.set(diagram.kind, [diagram])
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

  /** 画布视口在 clampPan 一节定义（要按内容包围盒夹紧，得等 positions 算完）。 */
  const applyZoom = useCallback((next: number) => {
    if (!Number.isFinite(next)) {
      return
    }
    const level = clamp(Number(next.toFixed(3)), ZOOM_MIN, ZOOM_MAX)
    // ＋/− 与「重置 100%」以视口中心为锚点：原来只动缩放、viewBox 左上角钉在原处，
    // 放大时正在看的图会被推出视口，还得再平移找回来。
    const center = {
      x: pan.x + canvas.width / (2 * zoom),
      y: pan.y + canvas.height / (2 * zoom),
    }
    setZoom(level)
    setPan({
      x: center.x - canvas.width / (2 * level),
      y: center.y - canvas.height / (2 * level),
    })
  }, [pan, zoom, canvas])

  // ── 文档标签：图标签切画布，对象标签只切属性窗口的编辑对象 ──
  const activeTabKey = selectedId && tabs.some((tab) => tab.kind === 'element' && tab.id === selectedId)
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
    const wasActive = target.kind === 'diagram' ? target.id === activeDiagramId : target.id === selectedId
    if (!wasActive) {
      return
    }
    if (target.kind === 'element') {
      setSelectedId(null)
      return
    }
    const fallback = next[index] ?? next[index - 1] ?? next.find((tab) => tab.kind === 'diagram') ?? null
    if (fallback) {
      activateTab(fallback)
    } else {
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

  /** 引用型属性的 id 列表：单值引用取首个，列表型取全部。 */
  const referenceIds = (spec: PropertySpec): string[] => {
    const raw = propertyRaw(spec)
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item)).filter((item) => item.trim() !== '')
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
      return [raw.trim()]
    }
    return []
  }

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
    const raw = propertyRaw(spec)
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item)).filter((item) => item.trim() !== '')
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
      return [raw.trim()]
    }
    return []
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

  /** 按子元素类型列出名称，供「拥有的部件 / 端口 / 约束」等派生属性使用。 */
  const childNamesOfTypes = (types: string[]): string => {
    if (!selected) {
      return '—'
    }
    const names = (childrenByOwner.get(selected.id) ?? [])
      .filter((child) => types.includes(codeOf(child.type)))
      .map((child) => child.name)
    return names.join(', ') || '—'
  }

  /** 计算 / 派生属性在客户端按当前快照实时求值，不落库、不可写。 */
  const derivedText = (key: string): string => {
    if (selectedRelation) {
      const source = model.elements.find((element) => element.id === selectedRelation.sourceId)
      const target = model.elements.find((element) => element.id === selectedRelation.targetId)
      const endpoint = (element: ModelElement | undefined, id: string) =>
        element ? `${element.name}（${id}）` : id
      switch (key) {
        case 'id': return selectedRelation.id
        case 'relationshipType': return selectedRelation.type
        case 'source':
        case 'sourceId':
          return endpoint(source, selectedRelation.sourceId)
        case 'target':
        case 'targetId':
          return endpoint(target, selectedRelation.targetId)
        case 'ownerId':
          return selectedRelation.ownerId ?? projectRoot?.name ?? t('项目根')
        case 'qualifiedName':
          return `${source?.name ?? '?'} ⇒ ${target?.name ?? '?'}`
        case 'relatedElement':
          return [source?.name, target?.name].filter(Boolean).join(', ') || '—'
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
      case 'ownerId':
      case 'owner':
      case 'namespace':
        return model.elements.find((element) => element.id === selected.ownerId)?.name
          ?? selected.ownerId ?? '—'
      case 'ownedElement':
      case 'ownedMember':
        return (childrenByOwner.get(selected.id) ?? []).map((child) => child.name).join(', ') || '—'
      case 'ownedPart': return childNamesOfTypes(['PART'])
      case 'ownedPort': return childNamesOfTypes(['PORT', 'FLOW_PORT'])
      case 'ownedConnector': return childNamesOfTypes(['CONNECTOR'])
      case 'ownedConstraint': return childNamesOfTypes(['CONSTRAINT_PROPERTY'])
      case 'ownedParameter': return childNamesOfTypes(['CONSTRAINT_PARAMETER'])
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

  /**
   * 引用型属性的目标元素卡片：缩略图（类型图标）+ 名称，右键可「树上高亮」。
   *
   * <p>规范里的引用型属性存的是元素 id；界面上只显示名称，id 放在次要位置与
   * tooltip 里，便于核对与排查。</p>
   */
  const renderReferenceCard = (
    spec: PropertySpec,
    elementId: string,
    index: number,
  ): ReactNode => {
    const target = elementById.get(elementId)
    if (!target) {
      return (
        <span className="prop-ref-card missing" key={`${spec.key}:${index}`}>
          <span className="prop-ref-missing">{t('未引用的元素')}</span>
          <code className="prop-ref-id">{elementId}</code>
        </span>
      )
    }
    const typeText = typeLabel(target.type)
    return (
      <span
        className="prop-ref-card"
        key={`${spec.key}:${index}`}
        title={`${target.name}（${target.id}）· ${typeText}｜${t('右键可树上高亮')}`}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setMenu({
            x: event.clientX,
            y: event.clientY,
            target: { kind: 'reference', id: target.id, propKey: spec.key, index },
          })
        }}
      >
        <TypeIcon code={codeOf(target.type)} size={14} />
        <span className="prop-ref-name">{target.name}</span>
        <code className="prop-ref-id">{target.id}</code>
      </span>
    )
  }

  /**
   * 构造型 chip：构造型属性存的是构造型名，按名解析到通用扩展包里的构造型元素，
   * 于是它同样能以「缩略图 + 名称 + id」呈现，右键即可在模型树上定位。
   * 解析不到（用户自造的构造型名）时退回普通文本。
   */
  const renderStereotypeChip = (
    spec: PropertySpec,
    stereotypeName: string,
    index: number,
  ): ReactNode => {
    const target = stereotypeByName.get(stereotypeName.trim().toLowerCase())
    if (!target) {
      return <span className="prop-chip-text">{stereotypeName}</span>
    }
    return renderReferenceCard(spec, target.id, index)
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
                  ? renderStereotypeChip(spec, value, index)
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
  const renderPropertyValue = (spec: PropertySpec, readOnly: boolean): ReactNode => {
    if (readOnly) {
      return <code className="prop-static">{derivedText(spec.key)}</code>
    }
    const isReference = (spec.kind === 'REFERENCE' || spec.kind === 'REFERENCE_LIST')
      && spec.referencesElement !== false
    if (isReference) {
      const ids = referenceIds(spec)
      return ids.length === 0
        ? <span className="prop-empty">—</span>
        : (
          <div className="prop-value-cards">
            {ids.map((elementId, index) => renderReferenceCard(spec, elementId, index))}
          </div>
        )
    }
    if (spec.kind === 'STRING_LIST' || spec.kind === 'REFERENCE_LIST') {
      const values = spec.kind === 'STRING_LIST' ? stringList(spec) : referenceIds(spec)
      return values.length === 0
        ? <span className="prop-empty">—</span>
        : (
          <div className="prop-value-chips">
            {values.map((value, index) => (
              <span className="prop-chip" key={`${value}:${index}`}>
                {spec.key === 'stereotypes'
                  ? renderStereotypeChip(spec, value, index)
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
        <div className="prop-value">{renderPropertyValue(spec, readOnly)}</div>
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
      return {
        element,
        x: active?.x ?? baseX,
        y: active?.y ?? baseY,
        w: glyph?.w ?? oldW,
        h: glyph?.h ?? oldH,
      }
    // 垫底形状（泳道、生命线）先画：SVG 后画的盖在先画的上面，不透明底必须垫在动作/消息之下。
    }).sort((a, b) => Number(isBackdropShape(shapeOf(b.element.type))) - Number(isBackdropShape(shapeOf(a.element.type))))
  }, [visibleElements, model.notations, activeDiagramId, drag, nodeSize.width, nodeSize.height])

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
   * 适应窗口：把当前图的内容包围盒整体缩进视口。
   * 原来只是「回到 100% 并归零平移」，自动排布把图铺到几千单位宽之后那样等于什么都没做。
   */
  const fitCanvas = useCallback(() => {
    if (!contentBox) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }
    const left = contentBox.left
    const top = contentBox.top
    const width = contentBox.right - left + FIT_PADDING * 2
    const height = contentBox.bottom - top + FIT_PADDING * 2
    const next = clamp(Math.min(canvas.width / width, canvas.height / height), ZOOM_MIN, 1)
    setZoom(Number(next.toFixed(3)))
    setPan({
      x: Math.round(left - FIT_PADDING - (canvas.width / next - width) / 2),
      y: Math.round(top - FIT_PADDING - (canvas.height / next - height) / 2),
    })
  }, [contentBox, canvas.width, canvas.height])

  // 排布写完坐标才缩放：模型是异步刷回来的，先立个牌子，等新记法渲染出来再适应窗口。
  const fitAfterLayout = useRef(false)
  useEffect(() => {
    if (!fitAfterLayout.current) {
      return
    }
    fitAfterLayout.current = false
    fitCanvas()
  }, [model.notations, fitCanvas])

  /**
   * 序列图的消息是逐行往下堆的，消息一多图面就比默认画布高，打开时底部会被裁掉
   * （示例图七条消息、创建出来的表头与销毁 X 全在视口外）。第一次打开这张图时若内容
   * 超出视口就自动适应窗口一次；按图 id 记牌子，之后用户自己缩放 / 平移不会再被拉回。
   */
  const autoFitSeqDiagram = useRef<string | null>(null)
  useEffect(() => {
    if (!activeDiagramId || !seqLayout || autoFitSeqDiagram.current === activeDiagramId) {
      return
    }
    const box = seqLayout.box
    if (box.bottom <= canvas.height && box.right <= canvas.width) {
      return
    }
    autoFitSeqDiagram.current = activeDiagramId
    fitCanvas()
  }, [activeDiagramId, seqLayout, fitCanvas, canvas.width, canvas.height])

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

  const createOptions = useMemo<ElementTypeInfo[]>(() => {
    if (!containment || !createDialog) {
      return []
    }
    if (createDialog.ownerId === null) {
      return containment.rootTypes
        .map((code) => typeInfo.get(code))
        .filter((item): item is ElementTypeInfo => item !== undefined)
    }
    const parent = model.elements.find((element) => element.id === createDialog.ownerId)
    if (!parent) {
      return []
    }
    const rule = containment.rules.find(
      (item) => item.parent.toLowerCase() === parent.type.toLowerCase(),
    )
    return rule?.children ?? []
  }, [containment, createDialog, model.elements, typeInfo])

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

  const runCommand = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    if (!canEdit) {
      say('当前角色为只读，无法编辑模型')
      return false
    }
    setBusy(true)
    try {
      const patch = await postCommand({
        type,
        payload,
        baseRevision: revisionRef.current,
        clientCmdId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      revisionRef.current = patch.revision
      say('已应用 rev {revision} · {count} 个对象受影响 · 校验：{delta}', { revision: patch.revision, count: patch.affectedIds.length, delta: patch.validationDelta })
      await refresh()
      return true
    } catch (error) {
      say('操作失败：{error}', { error: errorMessage(error) })
      await refresh()
      return false
    } finally {
      setBusy(false)
    }
  }

  const openMenu = (event: ReactMouseEvent, target: MenuTarget) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.min(event.clientY, window.innerHeight - 280),
      target,
    })
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
    const effective = ownerId ?? projectRootId
    const owner = effective
      ? model.elements.find((element) => element.id === effective)?.name ?? effective
      : t('项目根')
    setDiagramDialog({
      ownerId: effective,
      ownerName: owner,
      kind: edit?.kind ?? specs[0]?.code ?? 'bdd',
      name: edit?.name ?? t('新建图 {count}', { count: model.diagrams.length + 1 }),
      editId: edit?.id ?? null,
    })
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
    const hostOwnerId = await ensureDiagramHost(diagramDialog.kind, diagramDialog.ownerId ?? '')
    if (hostOwnerId === null) {
      return
    }
    const ok = await runCommand('CREATE_DIAGRAM', {
      id,
      kind: diagramDialog.kind,
      name: diagramDialog.name.trim(),
      ownerId: hostOwnerId,
      elementIds: [],
    })
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
    const removedIds = new Set([deleteDialog.elementId, ...descendants(deleteDialog.elementId)])
    const ok = await runCommand('DELETE_ELEMENT', { id: deleteDialog.elementId })
    if (ok && selectedId && removedIds.has(selectedId)) {
      setSelectedId(null)
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
    setBusy(true)
    try {
      const patch = await undo()
      revisionRef.current = patch.revision
      say('已撤销至 rev {revision}', { revision: patch.revision })
      await refresh()
    } catch (error) {
      say('撤销失败：{error}', { error: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const handleRedo = useCallback(async () => {
    setBusy(true)
    try {
      const patch = await redo()
      revisionRef.current = patch.revision
      say('已重做至 rev {revision}', { revision: patch.revision })
      await refresh()
    } catch (error) {
      say('重做失败：{error}', { error: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }, [refresh])

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
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat || isTextEntry(event.target)) {
        return
      }
      const key = event.key.toLowerCase()
      const wantsUndo = key === 'z' && !event.shiftKey
      const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey)
      if (!wantsUndo && !wantsRedo) {
        return
      }
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
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo, relationTool, busy, health, propDialog, moveMessage, selectedRelationId])

  // 「树上高亮」的标记在 2.4 秒后自动消隐：用户看一眼就知道定位到了哪儿，
  // 又不会被一直高亮干扰后续操作。
  useEffect(() => {
    if (!treeLocateId) {
      return
    }
    const timer = window.setTimeout(() => setTreeLocateId(null), 2400)
    return () => window.clearTimeout(timer)
  }, [treeLocateId])

  const addToCurrentDiagram = async (elementId: string) => {
    if (!activeDiagramId) {
      return
    }
    await runCommand('ADD_TO_DIAGRAM', { diagramId: activeDiagramId, elementId })
    setMenu(null)
  }

  /**
   * 把模型树展开到目标元素并滚动到可视区，但不改变当前选中与提示。
   *
   * <p>祖先链按 ownerId 逐级上溯（含图节点：元素也可能只出现在某张图的节点列表里，
   * 此时把那张图也展开），保证目标行确实渲染在树上。画布点选时用它做静默跟随定位。</p>
   */
  const revealInTree = (elementId: string) => {
    const chain: string[] = []
    let cursor = elementById.get(elementId)
    while (cursor?.ownerId) {
      chain.push(cursor.ownerId)
      cursor = elementById.get(cursor.ownerId)
    }
    // 元素可能只挂在图节点下：展开所有引用了它的图。
    for (const diagram of model.diagrams) {
      if (diagram.elementIds.includes(elementId)) {
        chain.push(diagram.id)
      }
    }
    setExpanded((previous) => {
      const next = new Set(previous)
      for (const id of chain) {
        next.add(id)
      }
      return next
    })
    setTreeLocateId(elementId)
    // 展开是异步渲染，等一帧再滚动，避免目标行尚未挂载。
    window.setTimeout(() => {
      document
        .querySelector(`[data-tree-id="${CSS.escape(elementId)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
  }

  /** 「树上高亮」菜单动作：静默定位 + 选中 + 提示，供属性面板/画布右键调用。 */
  const locateInTree = (elementId: string) => {
    revealInTree(elementId)
    setSelectedId(elementId)
    setSelectedDiagramId(null)
    const target = elementById.get(elementId)
    say('已在模型树中定位「{name}」', { name: target?.name ?? elementId })
  }

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

  const exportSvg = () => {
    const svg = svgRef.current
    if (!svg) {
      return
    }
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    // 导出的是整张图，不是当前视口：缩放平移后的 viewBox 必须还原成完整画布。
    clone.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', String(canvas.width))
    rect.setAttribute('height', String(canvas.height))
    rect.setAttribute('fill', '#ffffff')
    clone.insertBefore(rect, clone.firstChild)
    const source = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([source], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeDiagramObj?.name ?? 'diagram'}.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  /* ---------------- XMI 导入导出 ---------------- */

  /** 导出：把服务端生成的交换文件取回本地。 */
  const runExport = async (kind: 'xmi' | 'sidecar' | 'native') => {
    setBusy(true)
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
      setBusy(false)
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
    setBusy(true)
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
      setExpanded(new Set())
      await refresh()
      say(importDialog.sidecar.trim()
        ? '已导入模型（rev {revision}）· {count} 个对象受影响 · 可撤销'
        : '已导入模型（rev {revision}）· {count} 个对象受影响 · 未提供布局侧车，九图由服务端重排',
      { revision: patch.revision, count: patch.affectedIds.length })
    } catch (error) {
      say('导入失败：{error}', { error: errorMessage(error) })
    } finally {
      setBusy(false)
    }
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
    const point = toSvgPoint(event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(element.id)
    setSelectedDiagramId(null)
    // 点选画布图形即静默定位到模型树：切到「项目」页让树可见，展开祖先链并高亮该行。
    setLeftTab('project')
    revealInTree(element.id)
    setDrag({
      elementId: element.id,
      originX: x,
      originY: y,
      startX: point.x,
      startY: point.y,
      x,
      y,
      moved: false,
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

  /** 当前图的内容包围盒；空图退回整张画布，新建图也要能正常平移。序列图用推导出的内容盒（见 contentBox）。 */
  const panBox = useMemo(
    () => contentBox ?? { left: 0, top: 0, right: canvas.maxX, bottom: canvas.maxY },
    [contentBox, canvas.maxX, canvas.maxY],
  )

  const viewWidth = canvas.width / zoom
  const viewHeight = canvas.height / zoom

  /** 平移落点夹紧：视口始终与内容保留一段可见交集（规则见 clampPanTo）。 */
  const clampPan = useCallback(
    (x: number, y: number, level = zoom) => clampPanTo(
      x,
      y,
      level,
      panBox,
      canvas.width / level,
      canvas.height / level,
    ),
    [canvas.width, canvas.height, panBox, zoom],
  )

  /**
   * 按屏幕像素量平移视口（滚轮 / 触摸板双指）：deltaY 为正就是「往下滚」，
   * 视口跟着往下移，所以 pan 增大。注意与拖动相反——拖动是内容跟着手指走，
   * 滚动是视口跟着滚动方向走，两条手势的符号本来就不该一样。
   */
  const panByPixels = useCallback((dx: number, dy: number) => {
    setPan((current) => clampPan(current.x + pixelsToUnits(dx), current.y + pixelsToUnits(dy)))
  }, [clampPan, pixelsToUnits])

  /**
   * 画布视口：zoom 收窄取样范围、pan 平移原点，再按内容包围盒夹紧——
   * 显示出来的永远在范围内，缩放和平移都不怕把图推丢。
   */
  const clampedPan = clampPan(pan.x, pan.y)
  const viewBox = `${clampedPan.x} ${clampedPan.y} ${viewWidth} ${viewHeight}`

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
    const next = clamp(zoom * (deltaY < 0 ? 1.12 : 1 / 1.12), ZOOM_MIN, ZOOM_MAX)
    if (Math.abs(next - zoom) < 0.0001) {
      return
    }
    const ratio = zoom / next
    setPan(clampPan(
      anchor.x - (anchor.x - pan.x) * ratio,
      anchor.y - (anchor.y - pan.y) * ratio,
      next,
    ))
    setZoom(Number(next.toFixed(3)))
  }, [zoom, pan, clampPan])

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
  }, [zoomAtCursor, panByPixels])

  /**
   * 平移起手：空白画布上左键直接拖，任意位置 Shift+左键 / 中键拖。
   * 左键按在图形上时不动视口，交给图形自己的拖拽。
   */
  const handleCanvasPanStart = (event: ReactPointerEvent<SVGSVGElement>) => {
    const onBackground = event.target === event.currentTarget
    if (event.button !== 1 && !(event.button === 0 && (onBackground || event.shiftKey))) {
      return
    }
    event.preventDefault()
    // 捕获指针：拖到画布外再松手也能正常结束平移，不会卡在 panning 状态。
    event.currentTarget.setPointerCapture(event.pointerId)
    setPanDrag({
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
      onBackground,
      moved: false,
    })
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
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
      if (glyph) {
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
  const corePalette = useMemo<ElementTypeInfo[]>(
    () => paletteEntries.filter((item) => item.tier !== 'ADVANCED'),
    [paletteEntries],
  )
  const advancedPalette = useMemo<ElementTypeInfo[]>(
    () => paletteEntries.filter((item) => item.tier === 'ADVANCED'),
    [paletteEntries],
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

  /** 由连线工具建一条关系：成功后只清起点，工具保持激活以便连续画同类消息。 */
  const createToolRelationship = async (tool: string, sourceId: string, targetId: string) => {
    const id = `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const ok = await runCommand('CREATE_RELATIONSHIP', relationPayload(id, tool, sourceId, targetId))
    if (ok) {
      setRelationSource(null)
      say(sourceId === targetId
        ? '已创建给自己的消息，可继续连线或按 Esc 退出'
        : '已创建 «{relation}» 关系，可继续连线或按 Esc 退出', { relation: relationLabel(tool) })
    }
    return ok
  }

  const openRelationDialog = () => {
    setRelationDialog({
      sourceId: selectedId ?? relationSource ?? '',
      targetId: '',
      type: relationTool ?? relationEntries[0]?.code ?? 'trace',
    })
  }

  const handleRelationPick = async (elementId: string) => {
    if (!relationTool) {
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
  const createElementFromPalette = async (typeCode: string, x: number, y: number) => {
    if (!activeDiagramObj || !activeDiagramId) {
      return
    }
    const info = typeInfo.get(typeCode)
    const id = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const payload: Record<string, unknown> = {
      id,
      type: info?.uml ?? typeCode,
      name: t('新建{label} {count}', { label: pick(info?.label, info?.labelEn) ?? typeCode, count: model.elements.length + 1 }),
      ownerId: activeDiagramObj.ownerId ?? '',
      stereotypes: info?.stereotype ? [info.stereotype] : [],
      diagramId: activeDiagramId,
      x: Math.round(clamp(x, 0, canvas.maxX)),
      y: Math.round(clamp(y, 0, canvas.maxY)),
    }
    const ok = await runCommand('CREATE_ELEMENT', payload)
    if (ok) {
      setSelectedId(id)
      say('已在 ({x}, {y}) 放置「{name}」', { x: payload.x, y: payload.y, name: payload.name })
    }
  }

  const handleCanvasDrop = (event: ReactDragEvent<SVGSVGElement>) => {
    event.preventDefault()
    const relationCode = event.dataTransfer.getData('text/scofen-relation')
    if (relationCode) {
      activateRelationTool(relationCode)
      return
    }
    const point = toSvgPoint(event.clientX, event.clientY)
    // 以鼠标落点作为图形中心，视觉上更符合「拖到这里就生成在这里」。
    const x = Math.round(clamp(point.x - nodeSize.width / 2, 0, canvas.maxX))
    const y = Math.round(clamp(point.y - nodeSize.height / 2, 0, canvas.maxY))

    // 模型树里已有的元素：已在当前图 → 移动；未在当前图 → 加入图并落在指定位置。
    const elementId = event.dataTransfer.getData('text/scofen-element')
    if (elementId) {
      const inCurrentDiagram = activeDiagramObj?.elementIds.includes(elementId) ?? false
      void runCommand(inCurrentDiagram ? 'MOVE_NOTATION' : 'ADD_TO_DIAGRAM', {
        diagramId: activeDiagramId,
        elementId,
        x,
        y,
      })
      setSelectedId(elementId)
      say('已把「{name}」放置在 ({x}, {y})', { name: model.elements.find((e) => e.id === elementId)?.name ?? elementId, x, y })
      return
    }

    const code = event.dataTransfer.getData('text/scofen-type')
    if (code) {
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
    setBusy(true)
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
      setBusy(false)
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
    setBusy(true)
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
          // 文档标签是按旧项目的图/元素打开的，换项目后一律清空。
          setTabs([])
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
      setBusy(false)
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
        isOpen: open, isSelected: false, isLocated: false, isDropTarget: false, ownerId,
      })
      if (!open) {
        return
      }
      for (const item of items) {
        rows.push({
          kind: 'relation', id: item.relation.id, depth: depth + 1, childCount: 0,
          isOpen: false, isSelected: selectedRelationId === item.relation.id,
          isLocated: false, isDropTarget: false,
          ownerId, direction: item.direction, peerId: item.peerId,
        })
      }
    }

    const pushExtensionElement = (element: ModelElement, depth: number) => {
      const kids = extensionChildrenByOwner.get(element.id) ?? []
      const open = expanded.has(element.id)
      rows.push({
        kind: 'extensionElement', id: element.id, depth, childCount: kids.length,
        isOpen: open, isSelected: false, isLocated: false, isDropTarget: false,
      })
      if (!open) {
        return
      }
      for (const kid of kids) {
        pushExtensionElement(kid, depth + 1)
      }
    }

    const pushDiagram = (diagram: Diagram, depth: number) => {
      if (!keep(diagram.id)) {
        return
      }
      const members = diagramMembersByDiagram.get(diagram.id) ?? []
      const open = isOpen(diagram.id)
      rows.push({
        kind: 'diagram', id: diagram.id, depth, childCount: members.length, isOpen: open,
        isSelected: selectedDiagramId === diagram.id, isLocated: treeLocateId === diagram.id,
        isDropTarget: treeDropTarget === diagram.id,
      })
      if (!open) {
        return
      }
      for (const member of members) {
        pushElement(member, depth + 1)
      }
    }

    function pushElement(element: ModelElement, depth: number): void {
      if (!keep(element.id)) {
        return
      }
      const kids = childrenByOwner.get(element.id) ?? []
      const diagrams = diagramsByOwner.get(element.id) ?? []
      const relationItems = relationsByOwner.get(element.id)
      const open = isOpen(element.id)
      rows.push({
        kind: 'element', id: element.id, depth,
        childCount: kids.length + diagrams.length + (relationItems ? 1 : 0), isOpen: open,
        isSelected: selectedId === element.id, isLocated: treeLocateId === element.id,
        isDropTarget: false,
      })
      if (!open) {
        return
      }
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
    }

    for (const node of rootNodes) {
      // rootNodes 只可能是这两类；虚拟节点由下面的分组分支单独铺。
      if (node.type === 'element') {
        pushElement(node.ref, 0)
      } else if (node.type === 'diagram') {
        pushDiagram(node.ref, 0)
      }
    }
    // 扩展包与项目根同级：它是系统提供的独立内容，不是项目根的子节点，也不参与筛选。
    if (showExtensions && extensionRoots.length > 0 && !hits) {
      const open = expanded.has(EXTENSION_GROUP_ID)
      rows.push({
        kind: 'extensionGroup', id: EXTENSION_GROUP_ID, depth: 0,
        childCount: extensionRoots.length, isOpen: open, isSelected: false,
        isLocated: false, isDropTarget: false,
      })
      if (open) {
        for (const root of extensionRoots) {
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
    extensionChildrenByOwner, extensionRoots, relationsByOwner, rootNodes, selectedDiagramId,
    selectedId, selectedRelationId, showExtensions, treeDropTarget, treeFilterHits, treeLocateId,
  ])

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

  /**
   * 行组件的动作集合：对象身份一次生成后不再更换，实现函数每次渲染写回 ref。
   *
   * <p>这些实现要读当前模型、布局与草稿状态，直接放进 context 会让 context 每次渲染
   * 换身份，从而把整棵树的行全部重渲染——正是这次要修的开销。</p>
   */
  const treeActionsImpl = useRef<TreeActions>({
    toggleExpanded: () => undefined,
    toggleRelationGroup: () => undefined,
    selectElement: () => undefined,
    selectExtensionElement: () => undefined,
    selectRelation: () => undefined,
    activateDiagram: () => undefined,
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
    addElementToDiagram: (diagramId, elementId) =>
      treeActionsImpl.current.addElementToDiagram(diagramId, elementId),
    setDropTarget: (id) => treeActionsImpl.current.setDropTarget(id),
    openMenu: (event, target) => treeActionsImpl.current.openMenu(event, target),
  }), [])
  const menuTarget = menu?.target ?? null
  const menuElement =
    menuTarget?.kind === 'element'
      ? model.elements.find((element) => element.id === menuTarget.id) ?? null
      : null
  const menuDiagram =
    menuTarget?.kind === 'diagram'
      ? model.diagrams.find((diagram) => diagram.id === menuTarget.id) ?? null
      : null
  const menuChildCount = menuElement ? descendants(menuElement.id).length : 0
  const menuInDiagram = menuElement
    ? model.diagrams.some((diagram) => diagram.elementIds.includes(menuElement.id))
    : false
  const menuTypeAllowed = menuElement
    ? (activeSpec?.allowedTypes.includes(codeOf(menuElement.type)) ?? false)
    : false

  const renderNode = (element: ModelElement, x: number, y: number, w: number, h: number): ReactNode => {
    const shape = shapeOf(element.type)
    const info = typeInfo.get(codeOf(element.type))
    const selected = selectedId === element.id
    const isLinkSource = relationSource === element.id
    const isPort = shape === 'port'
    // 生命线以图面计算为准：表头对齐到同一行，宽度取到放得下名字，竖线一直伸到共享底边。
    const lifeline = shape === 'lifeline' ? seqLifelineById.get(element.id) : undefined
    const bw = isPort ? 26 : lifeline?.width ?? w
    const bh = isPort ? 26 : lifeline?.height ?? h
    const bx = isPort ? x + w / 2 - 13 : lifeline?.x ?? x
    const by = isPort ? y + h / 2 - 13 : lifeline?.y ?? y
    const children = (childrenByOwner.get(element.id) ?? []).map((child) => child.name)
    const fill = isLinkSource ? '#e6f6f3' : selected ? '#e9f0fc' : '#ffffff'
    const stroke = isLinkSource ? '#0f766e' : selected ? '#2b5cb8' : '#cbd3dd'
    const strokeW = isLinkSource || selected ? 2 : 1
    const onDown = (event: ReactPointerEvent<SVGGElement>) => handlePointerDown(event, element, bx, by)

    let shapeSvg: ReactNode = null
    switch (shape) {
      case 'package':
        shapeSvg = (
          <path
            d={`M${bx},${by + 18} h34 v-18 h${bw - 34} v18 h0 v${bh - 18} h-${bw} z`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW}
          />
        )
        break
      case 'requirement':
      case 'comment': {
        const fold = 12
        const d = `M${bx},${by} h${bw - fold} l${fold},${fold} v${bh - fold} h-${bw} z M${bx + bw - fold},${by} v${fold} h-${fold}`
        shapeSvg = (
          <path
            d={d}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW}
            strokeDasharray={shape === 'comment' ? '4 3' : undefined}
          />
        )
        break
      }
      case 'usecase':
        shapeSvg = (
          <ellipse cx={bx + bw / 2} cy={by + bh / 2} rx={bw / 2 - 2} ry={bh / 2 - 2} fill={fill} stroke={stroke} strokeWidth={strokeW} />
        )
        break
      case 'state':
        shapeSvg = (
          <g>
            <rect x={bx} y={by} width={bw} height={bh} rx={10} fill={fill} stroke={stroke} strokeWidth={strokeW} />
            <rect x={bx + 4} y={by + 4} width={bw - 8} height={bh - 8} rx={7} fill="none" stroke={stroke} strokeWidth={1} opacity={0.6} />
          </g>
        )
        break
      case 'pseudostate':
        shapeSvg = (
          <circle cx={bx + bw / 2} cy={by + bh / 2} r={11} fill={selected ? '#fdecc8' : '#fff4d6'} stroke="#b7791f" strokeWidth={1.6} />
        )
        break
      case 'actor': {
        const cxActor = bx + bw / 2
        const headY = by + 14
        shapeSvg = (
          <g fill="none" stroke={stroke} strokeWidth={1.6}>
            <circle cx={cxActor} cy={headY} r={7} fill={fill} />
            <line x1={cxActor} y1={headY + 7} x2={cxActor} y2={by + bh - 22} />
            <line x1={cxActor - 13} y1={by + bh - 14} x2={cxActor + 13} y2={by + bh - 14} />
            <line x1={cxActor - 11} y1={by + bh - 22} x2={cxActor - 4} y2={by + bh - 12} />
            <line x1={cxActor + 11} y1={by + bh - 22} x2={cxActor + 4} y2={by + bh - 12} />
          </g>
        )
        break
      }
      case 'port':
        shapeSvg = <rect x={bx} y={by} width={bw} height={bh} fill={selected ? '#d6e4ff' : '#eef3fb'} stroke="#2b6cb0" strokeWidth={1.4} />
        break
      case 'frame':
        shapeSvg = (
          <g>
            <rect x={bx} y={by + 16} width={bw} height={bh - 16} rx={4} fill={fill} stroke={stroke} strokeWidth={strokeW} />
            <path d={`M${bx + 6},${by + 16} v-12 h46 v12`} fill="#f1f5f9" stroke={stroke} strokeWidth={strokeW} />
          </g>
        )
        break
      case 'swimlane': {
        const headerFill = isLinkSource ? '#d8efe9' : selected ? '#dbe7fb' : '#e8edf4'
        const bodyFill = isLinkSource ? '#f2fbf8' : selected ? '#f3f7fe' : '#fafbfd'
        shapeSvg = (
          <g>
            <rect x={bx} y={by} width={bw} height={bh} fill={bodyFill} stroke={stroke} strokeWidth={strokeW} />
            <rect x={bx} y={by} width={bw} height={SWIMLANE_HEADER} fill={headerFill} stroke={stroke} strokeWidth={strokeW} />
            <text x={bx + bw / 2} y={by + SWIMLANE_HEADER / 2 + 4} textAnchor="middle" className="node-name">
              {wrapLabel(element.name, bw - 12, 13, 1)[0]}
            </text>
          </g>
        )
        break
      }
      case 'lifeline': {
        const axisX = bx + bw / 2
        const axisEnd = lifeline?.bottom ?? by + bh
        const headerFill = isLinkSource ? '#d8efe9' : selected ? '#dbe7fb' : '#f8fafc'
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
            <text x={axisX} y={by + 17} textAnchor="middle" className="node-type">«{info?.uml ?? 'Lifeline'}»</text>
            <text x={axisX} y={by + 34} textAnchor="middle" className="node-name">{wrapLabel(element.name, bw - 10, 13, 1)[0]}</text>
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
          shapeSvg = <rect x={bx} y={by} width={bw} height={bh} rx={8} fill="#eef6ff" stroke={stroke} strokeWidth={strokeW} />
          break
        }
        const cx = bx + bw / 2
        const cy = by + bh / 2
        const ink = selected ? '#2b5cb8' : '#1f2937'
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
                fill={selected ? '#e9f0fc' : '#ffffff'}
                stroke={ink}
                strokeWidth={1.6}
              />
            )
        }
        shapeSvg = (
          <g>
            {selected && (
              <rect x={bx - 5} y={by - 5} width={bw + 10} height={bh + 10} rx={6} fill="none" stroke="#2b5cb8" strokeWidth={1.2} strokeDasharray="4 3" />
            )}
            {glyphSvg}
            {/* 小图形难点中：透明命中区罩住图形与下方名称。 */}
            <rect x={bx - 8} y={by - 8} width={bw + 16} height={bh + 40} fill="#000000" fillOpacity={0} />
          </g>
        )
        break
      }
      case 'action':
      case 'object':
        shapeSvg = (
          <rect
            x={bx}
            y={by}
            width={bw}
            height={bh}
            rx={shape === 'action' ? 22 : 8}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW}
          />
        )
        break
      default:
        shapeSvg = <rect x={bx} y={by} width={bw} height={bh} rx={8} fill={fill} stroke={stroke} strokeWidth={strokeW} />
    }

    const glyphKind = shape === 'control' ? controlGlyph(element.type) : null
    const showText =
      !isPort && shape !== 'pseudostate' && shape !== 'actor' && shape !== 'swimlane' && shape !== 'lifeline' && !glyphKind
    const showLabel = shape === 'actor' || shape === 'pseudostate'
    const showCompartment =
      !isPort && (shape === 'block' || shape === 'frame' || shape === 'requirement' || shape === 'package') && children.length > 0
    // 有隔间的形状名字只能占隔间线以上一行；其余按框高折行，末行省略，杜绝标签跨框。
    const nameLines = wrapLabel(
      element.name,
      bw - 24,
      13,
      showCompartment ? 1 : Math.max(1, Math.floor((bh - 50) / 15) + 1),
    )

    return (
      <g
        className={`node ${drag?.elementId === element.id && drag.moved ? 'dragging' : ''} ${isLinkSource ? 'link-source' : ''}`}
        data-element-id={element.id}
        onPointerDown={onDown}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openMenu(event, { kind: 'element', id: element.id })
        }}
      >
        {shapeSvg}
        {glyphKind && (
          <text x={bx + bw / 2} y={by + bh + 15} textAnchor="middle" className="control-label">
            {wrapLabel(element.name, 150, 11, 2).map((line, index) => (
              <tspan key={index} x={bx + bw / 2} dy={index === 0 ? 0 : 12}>{line}</tspan>
            ))}
          </text>
        )}
        {showText && (
          <>
            <text x={bx + 12} y={by + 22} className="node-type">{wrapLabel(`«${info?.uml ?? element.type}»`, bw - 24, 11, 1)[0]}</text>
            <text x={bx + 12} y={by + 42} className="node-name">
              {nameLines.map((line, index) => (
                <tspan key={index} x={bx + 12} dy={index === 0 ? 0 : 15}>{line}</tspan>
              ))}
            </text>
          </>
        )}
        {showLabel && (
          <text x={bx + bw / 2} y={by + bh - 4} textAnchor="middle" className="node-name">{element.name}</text>
        )}
        {showCompartment && (
          <>
            <line x1={bx + 6} y1={by + 50} x2={bx + bw - 6} y2={by + 50} stroke="#d4dae3" strokeWidth={1} />
            {children.slice(0, 3).map((name, index) => (
              <text key={index} x={bx + 12} y={by + 66 + index * 12} className="node-child">{name}</text>
            ))}
            {children.length > 3 && (
              <text x={bx + 12} y={by + 66 + 3 * 12} className="node-child">+{children.length - 3}</text>
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
    const strokeWidth = isSelected ? 2.2 : 1.4
    const dash = notation.dashed ? (notation.dash || '6 4') : undefined
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
      lines.push({ text: stereotype, baseline: rowY - 22, color: notation.color })
    }
    if (name) {
      // 前缀时间轴序号：读图的人据此确认「谁先谁后」，与拖动改顺序直接对应。
      lines.push({ text: `${message.seqNo}: ${name}`, baseline: rowY - 8, color: '#2d3748' })
    }
    // 自消息往右折出，标签起笔在折线右侧；横向消息标签居中对齐到箭头中点。
    const anchorStart = message.self
    const labelX = anchorStart ? startX + SEQ_SELF_BUMP + 8 : (startX + endX) / 2
    const boxWidth = Math.max(0, ...lines.map((line) => line.text.length * 6.4)) + 10
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
            stroke="#2b5cb8"
            strokeWidth={strokeWidth + 7}
            strokeOpacity={0.18}
            strokeLinecap="round"
          />
        )}
        {message.self ? (
          <polyline className="seq-line" points={points} fill="none" stroke={notation.color} strokeWidth={strokeWidth} strokeDasharray={dash} />
        ) : (
          <line className="seq-line" x1={startX} y1={rowY} x2={endX} y2={endY} stroke={notation.color} strokeWidth={strokeWidth} strokeDasharray={dash} />
        )}
        {notation.arrow === 'filled' && (
          <polygon points={arrow.points} fill={notation.color} stroke="none" />
        )}
        {notation.arrow === 'open' && (
          <polyline
            points={`${arrow.v1} ${message.self ? startX : endX},${message.self ? selfY : endY} ${arrow.v2}`}
            fill="none"
            stroke={notation.color}
            strokeWidth={strokeWidth}
          />
        )}
        {lines.length > 0 && (
          <>
            <rect className="seq-label" x={boxX} y={boxY} width={boxWidth} height={lines.length * 14 + 3} rx={3} fill="#ffffff" opacity={0.92} />
            {lines.map((line) => (
              <text
                key={line.text}
                x={labelX}
                y={line.baseline}
                textAnchor={anchorStart ? 'start' : 'middle'}
                className="edge-label"
                fill={line.color}
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
   */
  const renderSeqFrame = (frame: NonNullable<typeof seqLayout>['frame']): ReactNode => {
    if (!frame) {
      return null
    }
    const tabHeight = 22
    const tabWidth = Math.max(84, frame.label.length * 13 + 34)
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
          stroke={focused ? '#2b5cb8' : '#9aa5b1'}
          strokeWidth={focused ? 2 : 1.2}
        />
        <path
          d={`M${frame.x},${frame.y} h${tabWidth - 12} l12,${tabHeight} h-${tabWidth} z`}
          fill="#eef2f7"
          stroke={focused ? '#2b5cb8' : '#9aa5b1'}
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
        <text x={frame.x + 9} y={frame.y + 16} className="seq-frame-label">{`sd ${frame.label}`}</text>
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
    const stroke = focused ? '#2b5cb8' : '#8a97a8'
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

  const menus: MenuDef[] = [
    {
      label: '文件',
      entries: [
        { label: '新建项目…', run: () => setNewProjectDialog(true) },
        { label: '工作空间面板', run: () => setSpaceDrawerOpen(true) },
        'separator',
        { label: '新建元素…', run: () => openCreate(null) },
        { label: '新建图…', run: () => openDiagramDialog(null) },
        { label: '新建关系…', run: openRelationDialog, disabled: !canEdit || !activeDiagramObj },
        'separator',
        { label: '导入 XMI…', run: openImportDialog, disabled: !canImport },
        { label: '导出 XMI…', run: () => void runExport('xmi'), disabled: !canExport },
        { label: '导出布局侧车…', run: () => void runExport('sidecar'), disabled: !canExport },
        { label: '导出项目快照…', run: () => void runExport('native'), disabled: !canExport },
        'separator',
        { label: '导出当前图为 SVG', run: exportSvg, disabled: !activeDiagramObj },
        'separator',
        { label: '退出登录', run: onLogout, danger: true },
      ],
    },
    {
      label: '编辑',
      entries: [
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
        { label: '重命名选中对象', hint: 'F2', run: renameSelection, disabled: !canEdit || !selected && !selectedDiagram },
        {
          label: '删除选中对象',
          hint: 'Del',
          run: deleteSelection,
          disabled: !canEdit || !selected && !selectedDiagram && !selectedRelation,
          danger: true,
        },
      ],
    },
    {
      label: '视图',
      entries: [
        { label: '左栏 · 项目', run: () => setLeftTab('project'), checked: leftTab === 'project' },
        { label: '左栏 · 图表', run: () => setLeftTab('charts'), checked: leftTab === 'charts' },
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
        { label: '重新校验并刷新', run: () => void refresh() },
      ],
    },
    {
      label: '工具',
      entries: [
        { label: '界面语言 · 中文', run: () => setLocale('zh'), checked: locale === 'zh' },
        { label: '界面语言 · English', run: () => setLocale('en'), checked: locale === 'en' },
        'separator',
        { label: '导出当前图为 SVG', run: exportSvg, disabled: !activeDiagramObj },
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
        { label: '关闭全部标签', run: () => setTabs([]), disabled: !canEdit || tabs.length === 0 },
      ],
    },
    {
      label: '帮助',
      entries: [
        {
          label: '快捷键',
          run: () => say('Ctrl/⌘+Z 撤销 · Ctrl+Y 重做 · 双指滚动或拖动空白平移画布 · 捏合或 Ctrl/⌘+滚轮缩放 · Esc 退出连线'),
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
                          title={entry.hint}
                          onClick={() => {
                            setMenubarOpen(null)
                            entry.run?.()
                          }}
                        >
                          <span className="mb-check">{entry.checked ? '✓' : ''}</span>
                          <span className="mb-entry-label">{t(entry.label)}</span>
                          {entry.hint && <span className="mb-hint">{entry.hint}</span>}
                        </button>
                      )
                  ))}
                </div>
              )}
            </div>
          ))}
          <span className="mb-fill" />
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
              title={t('自动排布：按关系方向重排当前图的节点坐标')}
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
                        {canDeleteProject && project.deletable !== false && (
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
          <span className="pill">{t('SysML 1.6 · 九图')}</span>
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
                        {canDeleteProject && project.deletable !== false && (
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
              aria-selected={leftTab === 'library'}
              className={`tree-head-tab ${leftTab === 'library' ? 'active' : ''}`}
              onClick={() => setLeftTab('library')}
            >{t('模型库')}</button>
            <span className="tree-head-count" title={t('项目元素数（不含隔离的扩展包）')}>{projectElements.length}</span>
          </div>
          {leftTab === 'project' ? (
            <div className="browser-filter">
              <input
                value={treeFilter}
                onChange={(event) => setTreeFilter(event.target.value)}
                placeholder={t('筛选元素 / 图…')}
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
          ) : (
            <div className="panel-title">
              {t('通用扩展包 · 元类 / 构造型 / 关系')}
            </div>
          )}
          <div className="browser" onContextMenu={(event) => openMenu(event, { kind: 'root', id: null })}>
            {leftTab === 'charts' ? (
              <>
                {diagramsByKind.map(([kind, list]) => (
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
                      <DiagramIcon code={kind} size={14} />
                      <span className="chart-group-label">{diagramLabel(kind)}</span>
                      <span className="chart-group-count">{list.length}</span>
                    </button>
                    {!collapsedChartKinds.has(kind) && list.map((diagram) => (
                      <button
                        type="button"
                        key={diagram.id}
                        className={`chart-row ${diagram.id === activeDiagramId ? 'active' : ''}`}
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
                ))}
                {diagramsByKind.length === 0 && <p className="hint">{t('暂无图，右键空白处新建图')}</p>}
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
                {visibleRows.map((row) => (
                  <TreeRow key={`${row.kind}:${row.id}:${row.ownerId ?? ''}`} {...row} />
                ))}
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
          <div className="props-object">
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
                <div className="kv"><span>{t('所有者')}</span><code>{selectedDiagram.ownerId || projectRoot?.name || t('项目根')}</code></div>
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
                    <code>{(selectedRelation ?? selected)!.stereotypes.map((s) => `«${s}»`).join(' ') || '—'}</code>
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
                  {Object.entries((selectedRelation ?? selected)!.taggedValues ?? {}).map(([key, value]) => (
                    <div className="kv" key={key}><span>{key}</span><code>{value}</code></div>
                  ))}
                  {Object.keys((selectedRelation ?? selected)!.taggedValues ?? {}).length === 0 && <p className="hint">{t('暂无标签值')}</p>}
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
          ) : (
            <div className="notation-panel">
              {selectedDiagram ? (
                <>
                  <div className="kv"><span>{t('画布')}</span><code>{canvas.width} × {canvas.height}</code></div>
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
                  onClick={() => void createElementFromPalette(
                    type.code,
                    canvas.width / 2 - nodeSize.width / 2,
                    canvas.height / 2 - nodeSize.height / 2,
                  )}
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
                          {group.items.map((type) => (
                            <button
                              key={type.code}
                              type="button"
                              className="tb-item"
                              draggable={canEdit}
                              disabled={busy}
                              onDragStart={(event) => event.dataTransfer.setData('text/scofen-type', type.code)}
                              onClick={() =>
                                void createElementFromPalette(
                                  type.code,
                                  canvas.width / 2 - nodeSize.width / 2,
                                  canvas.height / 2 - nodeSize.height / 2,
                                )
                              }
                              title={t('«{stereotype}» {label} · {uml}｜点击或拖入画布', { stereotype: type.stereotype, label: pick(type.label, type.labelEn), uml: type.uml })}
                            >
                              <TypeIcon code={type.code} size={16} />
                              <span className="tb-item-label">{pick(type.label, type.labelEn)}</span>
                            </button>
                          ))}
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
                            {group.items.map((type) => (
                              <button
                                key={type.code}
                                type="button"
                                className="tb-item"
                                draggable={canEdit}
                                disabled={busy}
                                onDragStart={(event) => event.dataTransfer.setData('text/scofen-type', type.code)}
                                onClick={() =>
                                  void createElementFromPalette(
                                    type.code,
                                    canvas.width / 2 - nodeSize.width / 2,
                                    canvas.height / 2 - nodeSize.height / 2,
                                  )
                                }
                                title={t('«{stereotype}» {label} · {uml}｜点击或拖入画布', { stereotype: type.stereotype, label: pick(type.label, type.labelEn), uml: type.uml })}
                              >
                                <TypeIcon code={type.code} size={16} />
                                <span className="tb-item-label">{pick(type.label, type.labelEn)}</span>
                              </button>
                            ))}
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
          ) : (
            <div className="tb-scroll">
              <div className="panel-title">{t('当前图')}</div>
              <div className="tb-style-head">
                {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={18} />}
                <span>{activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : t('未选择图')}</span>
              </div>
              <div className="kv"><span>{t('布局器')}</span><code>{activeSpec?.layout ?? '—'}</code></div>
              <div className="kv"><span>{t('校验分组')}</span><code>{activeSpec?.validationGroup ?? '—'}</code></div>
              <div className="kv"><span>{t('画布')}</span><code>{canvas.width}×{canvas.height}</code></div>
              <div className="kv"><span>{t('节点')}</span><code>{nodeSize.width}×{nodeSize.height}</code></div>
              <div className="panel-title">{t('语义族图例')}</div>
              {FAMILIES.map((family) => (
                <div className="tb-legend" key={family.key}>
                  <span className="legend-swatch" style={{ background: family.color }} />
                  <span>{pick(family.label, family.labelEn)}</span>
                </div>
              ))}
              <p className="tb-tip">{t('记法样式由服务端 Notation 对象保存；图形坐标经 WS Patch 广播给所有会话。')}</p>
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
              const label = tab.kind === 'diagram'
                ? (model.diagrams.find((item) => item.id === tab.id)?.name ?? tab.id)
                : (elementById.get(tab.id)?.name ?? tab.id)
              return (
                <div
                  key={key}
                  className={`doc-tab ${tab.kind} ${active ? 'active' : ''}`}
                  role="tab"
                  aria-selected={active}
                  tabIndex={0}
                  title={tab.kind === 'diagram' ? t('图 · 点击切换画布') : t('对象 · 点击编辑属性')}
                  onClick={() => activateTab(tab)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateTab(tab) } }}
                  onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab) } }}
                >
                  {tab.kind === 'diagram'
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
            </div>
          </div>
          <svg
            ref={svgRef}
            className={`${relationTool ? 'linking' : ''}${panDrag ? ' panning' : ''}`.trim() || undefined}
            viewBox={viewBox}
            role="img"
            aria-label={t('模型画布，图形可拖拽；空白处拖动或双指滚动平移，捏合或 Ctrl/⌘+滚轮缩放')}
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
            <defs />
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
            {positions.map(({ element, x, y, w, h }) => (
              // 序列图的交互是图框、组合片段是区间框，都不再画成画布上的普通方块。
              (seqLayout?.frame && seqLayout.frame.element.id === element.id) || seqFragmentIds.has(element.id)
                ? null : renderNode(element, x, y, w, h)
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
                  fill="#2b5cb8"
                  opacity={0.08}
                />
                <line
                  x1={seqLayout.box.left}
                  y1={seqLayout.messages[seqDrag.targetIndex].y - SEQ_ROW_PITCH / 2}
                  x2={seqLayout.box.right}
                  y2={seqLayout.messages[seqDrag.targetIndex].y - SEQ_ROW_PITCH / 2}
                  stroke="#2b5cb8"
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
              <text x={canvas.width / 2} y={canvas.height / 2} textAnchor="middle" className="empty">
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
                      stroke="#2b5cb8"
                      strokeWidth={(style.width ?? 1.4) + 7}
                      strokeOpacity={0.18}
                      strokeLinecap="round"
                    />
                  )}
                  <polyline
                    points={routePoints}
                    fill="none"
                    stroke={style.color}
                    strokeWidth={isSelected ? (style.width ?? 1.4) + 0.8 : style.width}
                    strokeDasharray={style.dashed ? '5 4' : undefined}
                  />
                  {style.arrow === 'filled' && (
                    <polygon points={arrow.points} fill={style.color} stroke="none" />
                  )}
                  {style.arrow === 'hollow' && (
                    <polygon points={arrow.points} fill="#ffffff" stroke={style.color} strokeWidth={1.4} />
                  )}
                  {style.arrow === 'open' && (
                    <polyline points={`${arrow.v1} ${tEdge.x},${tEdge.y} ${arrow.v2}`} fill="none" stroke={style.color} strokeWidth={style.width} />
                  )}
                  {style.label && (
                    <g>
                      <rect
                        x={midX - style.label.length * 3.4 - 3}
                        y={midY - 9}
                        width={style.label.length * 6.8 + 6}
                        height={15}
                        rx={3}
                        fill="#ffffff"
                        opacity={0.92}
                      />
                      <text x={midX} y={midY + 2} textAnchor="middle" className="edge-label" fill={style.color}>
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
                        style={{ cursor: horizontal ? 'row-resize' : 'col-resize' }}
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
                      stroke="#2b5cb8"
                      strokeWidth={1.4}
                      pointerEvents="none"
                    />
                  ))}
                </g>
              )
            })}
          </svg>
        </main>
      </div>

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
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="menu-title">
            {menuDiagram && <DiagramIcon code={menuDiagram.kind} size={16} />}
            {menuElement && <TypeIcon code={codeOf(menuElement.type)} size={16} />}
            {menuTarget?.kind === 'root' && projectRoot && <TypeIcon code={codeOf(projectRoot.type)} size={16} />}
            <span>{menuDiagram ? menuDiagram.name : menuElement ? menuElement.name : t('项目根')}</span>
          </div>
          {menuTarget?.kind === 'element' && (
            <>
              <button type="button" onClick={() => openCreate(menuElement!.id)}>{t('新建子元素…')}</button>
              <button type="button" onClick={() => openDiagramDialog(menuElement!.id)}>{t('在此新建图…')}</button>
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
                onClick={() => {
                  setLeftTab('project')
                  locateInTree(menuElement!.id)
                  setMenu(null)
                }}
              >{t('树上高亮')}</button>
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
          {menuTarget?.kind === 'reference' && (
            <>
              <button type="button" onClick={() => { locateInTree(menuTarget.id); setMenu(null) }}>
                {t('树上高亮')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const spec = propEntry?.properties.find((item) => item.key === menuTarget.propKey)
                  // 构造型属性存的是构造型名（STRING_LIST），其余引用属性存元素 id。
                  const ids = spec
                    ? (spec.kind === 'STRING_LIST' ? stringList(spec) : referenceIds(spec))
                    : []
                  const next = ids.filter((_, index) => index !== menuTarget.index)
                  void runCommand('UPDATE_PROPERTY', {
                    id: propTargetId,
                    key: menuTarget.propKey,
                    ...(next.length === 0 ? { remove: true } : { value: next }),
                  })
                  setMenu(null)
                }}
              >{t('移除')}</button>
            </>
          )}
          {menuTarget?.kind === 'root' && (
            <>
              <button type="button" onClick={() => openCreate(null)}>{t('在项目根下新建元素…')}</button>
              <button type="button" onClick={() => openDiagramDialog(null)}>{t('在项目根下新建图…')}</button>
            </>
          )}
        </div>
      )}

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
            <p className="modal-sub">{t('按关系方向重排节点坐标：连线少交叉、图面比例接近视口')}</p>
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
                <option value="layered">{t('分层：顺关系方向排，交叉最少')}</option>
                <option value="hubbed">{t('枢纽：中心节点贴边，其余按簇分块')}</option>
                <option value="grouped">{t('分组：按父子归属成块，适合结构图')}</option>
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
              {t('标准 XMI 不承载图类型、图名与坐标；没有侧车时语义完整，但九图布局由服务端重新排布。导入后可通过「撤销」一步回到导入前。')}
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
                <label className="field">
                  <span className="field-head">
                    <TypeIcon code={createType || 'PACKAGE'} size={15} />
                    {t('元素类型（按规范过滤）')}
                  </span>
                  <select
                    value={createType}
                    onChange={(event) => {
                      const info = typeInfo.get(event.target.value)
                      setCreateType(event.target.value)
                      if (info) {
                        setCreateStereotype(info.stereotype)
                        setCreateName(t('新建{label} {count}', { label: pick(info.label, info.labelEn), count: model.elements.length + 1 }))
                      }
                    }}
                  >
                    {createOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {t('«{stereotype}» {label}（{uml}）', { stereotype: option.stereotype, label: pick(option.label, option.labelEn), uml: option.uml })}
                      </option>
                    ))}
                  </select>
                </label>
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
              <DiagramIcon code={diagramDialog.kind} size={18} />
              {t('新建图')}
            </h2>
            <p className="modal-sub">{t('所属：{name}', { name: diagramDialog.ownerName })}</p>
            <label className="field">
              <span>{t('图类型')}</span>
              <select
                value={diagramDialog.kind}
                onChange={(event) => setDiagramDialog({ ...diagramDialog, kind: event.target.value })}
              >
                {specs.map((option) => (
                  <option key={option.code} value={option.code}>{pick(option.label, option.labelEn)}</option>
                ))}
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
