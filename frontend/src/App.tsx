import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  clearSession,
  createProject,
  getContainment,
  getDiagrams,
  getExtensionPackages,
  getHealth,
  getModel,
  getProjectId,
  getProperties,
  getRelationships,
  getWorkspaces,
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
import { arrowGeometry, edgePoint, relationshipStyle, shapeOf } from './notation'
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

const FALLBACK_CANVAS = { maxX: 480, maxY: 340, width: 640, height: 420 }
const FALLBACK_NODE = { width: 168, height: 84 }
const ROOT_KEY = '__root__'
/** 画布缩放边界：低于 40% 看不清记法、高于 250% 只为对位，两侧都不需要。 */
const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.5

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

/** 状态栏消息：存词条与变量，渲染时翻译，切换语言后历史消息同步重译。 */
interface MessageState {
  key: string
  vars?: Record<string, unknown>
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

type TreeNode =
  | { type: 'element'; ref: ModelElement }
  | { type: 'diagram'; ref: Diagram }

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
  { code: 'trace', label: '追溯', labelEn: 'Trace', stereotype: 'trace', family: 'requirement' },
  { code: 'satisfy', label: '满足', labelEn: 'Satisfy', stereotype: 'satisfy', family: 'requirement' },
  { code: 'generalization', label: '泛化', labelEn: 'Generalization', stereotype: 'generalization', family: 'structure' },
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
  const [createType, setCreateType] = useState('')
  const [createName, setCreateName] = useState('')
  const [createStereotype, setCreateStereotype] = useState('')
  const [joinDiagram, setJoinDiagram] = useState(true)
  const [drag, setDrag] = useState<DragState | null>(null)
  // 右侧垂直工具箱：组件内容只跟当前图相关（元素 + 关系 + 通用），参考 EA / StarUML。
  const [toolboxTab, setToolboxTab] = useState<'components' | 'styles'>('components')
  const [openToolGroups, setOpenToolGroups] = useState<Set<string>>(
    () => new Set(['elements', 'relations', 'generic']),
  )
  const [relationCatalog, setRelationCatalog] = useState<RelationshipTypeInfo[]>([])
  // 连线工具：选中关系组件后在画布上依次点击起点、终点创建关系。
  const [relationTool, setRelationTool] = useState<string | null>(null)
  const [relationSource, setRelationSource] = useState<string | null>(null)
  const [propsTab, setPropsTab] = useState<'attrs' | 'tags' | 'relations' | 'notation'>('attrs')
  // 属性窗口：UML 2.5.1 / SysML 1.6 元属性目录由服务端下发，三档只影响展示数量。
  const [propCatalog, setPropCatalog] = useState<PropertyCatalogInfo | null>(null)
  const [propView, setPropView] = useState<PropertyView>('STANDARD')
  const [collapsedPropGroups, setCollapsedPropGroups] = useState<Set<string>>(() => new Set())
  // 引用型属性：正在编辑的引用项（属性 key + 目标元素 id），用于展开内联选择器。
  const [refEditing, setRefEditing] = useState<{ key: string; index: number } | null>(null)
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
  // 通用扩展包清单：SysML / UML 的元类与构造型随项目提供，模型树默认折叠它们。
  const [extensionPackages, setExtensionPackages] = useState<ExtensionPackageInfo[]>([])
  const [extensionCatalogReady, setExtensionCatalogReady] = useState(false)
  const [openSpaces, setOpenSpaces] = useState<Set<string>>(() => new Set(['personal', 'team']))
  const [activeProjectId, setActiveProjectId] = useState(() => getProjectId())
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [spaceDrawerOpen, setSpaceDrawerOpen] = useState(false)
  const [newProjectDialog, setNewProjectDialog] = useState(false)
  const [newProjectSpace, setNewProjectSpace] = useState('personal')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  // ── 桌面建模器式外壳：菜单栏 / 文档标签 / 左栏三视图 / 缩放状态栏 ──
  /** 已打开的文档标签（图 + 对象），顺序即标签顺序。 */
  const [tabs, setTabs] = useState<DocTab[]>([])
  /** 左栏视图：项目（包树）/ 图表（按图类型）/ 模型库（扩展包与元类构造型）。 */
  const [leftTab, setLeftTab] = useState<'project' | 'charts' | 'library'>('project')
  const [treeFilter, setTreeFilter] = useState('')
  /** 模型树里的「关系」节点默认收起：几十条连线平铺会把元素树挤没。 */
  const [relationsOpen, setRelationsOpen] = useState(false)
  /** 工具箱是否收成图标条：窄屏下把宽度还给画布。 */
  const [toolboxCollapsed, setToolboxCollapsed] = useState(false)
  /** 当前展开的顶级菜单名（null 表示全部收起）。 */
  const [menubarOpen, setMenubarOpen] = useState<string | null>(null)
  /** 画布缩放与平移：viewBox 只取其中一块视口，pointer 坐标由 getScreenCTM 自动换算。 */
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panDrag, setPanDrag] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  // 所有 /api 请求都带当前项目头；在渲染期同步，避免切换项目时首帧请求串到旧项目。
  setProjectId(activeProjectId)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)
  const menubarRef = useRef<HTMLElement | null>(null)
  // 命令的 baseRevision 必须取「最新已知 revision」而非渲染闭包里的 model.revision：
  // 同一次事件里连续发两条命令时，state 尚未更新，旧值会触发 409 乐观锁冲突。
  const revisionRef = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const [nextHealth, nextModel, nextWorkspace] = await Promise.all([
        getHealth(),
        getModel(),
        // 空间目录里的当前项目统计随 WS Patch 一起刷新；目录接口失败不阻断模型加载。
        getWorkspaces().catch(() => null),
      ])
      revisionRef.current = nextModel.revision
      setHealth(nextHealth)
      setModel(nextModel)
      if (nextWorkspace) {
        setWorkspace(nextWorkspace)
      }
      setMessage((current) => (current.key === '正在连接服务端…' ? { key: '已同步至服务端' } : current))
    } catch (error) {
      say('连接失败：{error}', { error: errorMessage(error) })
    }
  }, [])

  // 元模型目录与项目无关，登录后只加载一次。
  useEffect(() => {
    getDiagrams()
      .then(setSpecs)
      .catch((error: unknown) => say('图规格加载失败：{error}', { error: errorMessage(error) }))
    getRelationships()
      .then(setRelationCatalog)
      .catch((error: unknown) => say('关系目录加载失败：{error}', { error: errorMessage(error) }))
    getContainment()
      .then(setContainment)
      .catch((error: unknown) => say('元模型规则加载失败：{error}', { error: errorMessage(error) }))
    getProperties()
      .then(setPropCatalog)
      .catch((error: unknown) => say('属性目录加载失败：{error}', { error: errorMessage(error) }))
    // 通用扩展包清单：用于在模型树里识别并折叠系统提供的公共内容。
    getExtensionPackages()
      .then((catalog) => setExtensionPackages(catalog.packages ?? []))
      .catch(() => setExtensionPackages([]))
      .finally(() => setExtensionCatalogReady(true))
  }, [])

  // 首次进入与每次「打开项目」都重新拉取该项目的权威快照。
  useEffect(() => {
    void refresh()
  }, [refresh, activeProjectId])

  useEffect(() => {
    const socket = new WebSocket(patchSocketUrl())
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
    return () => socket.close()
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
    setOpenToolGroups(new Set(['elements', 'relations', 'generic']))
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

  const codeOf = useCallback(
    (type: string) =>
      (containment?.types ?? []).find(
        (item) =>
          item.code.toLowerCase() === type.toLowerCase() ||
          item.uml.toLowerCase() === type.toLowerCase(),
      )?.code ?? type,
    [containment],
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

  const childrenByOwner = useMemo(() => {
    const map = new Map<string, ModelElement[]>()
    for (const element of model.elements) {
      const key = ownerKey(element.ownerId)
      const list = map.get(key) ?? []
      list.push(element)
      map.set(key, list)
    }
    return map
  }, [model.elements])

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
    const ids = new Set(model.elements.map((element) => element.id))
    const orphans = model.elements.filter(
      (element) => element.ownerId && !ids.has(element.ownerId),
    )
    return [...(childrenByOwner.get(ROOT_KEY) ?? []), ...orphans]
  }, [childrenByOwner, model.elements])

  const rootNodes = useMemo<TreeNode[]>(() => {
    const nodes: TreeNode[] = rootElements.map((ref) => ({ type: 'element', ref }))
    for (const ref of diagramsByOwner.get(ROOT_KEY) ?? []) {
      nodes.push({ type: 'diagram', ref })
    }
    return nodes
  }, [rootElements, diagramsByOwner])

  // 项目根：顶层且类型为 Model 的唯一节点。所有「新建」入口默认落到它下面，
  // 避免出现第二个顶层节点；删除由服务端 ValidationEngine 兜底拒绝。
  const projectRoot = useMemo(
    () => rootElements.find((element) => codeOf(element.type) === 'MODEL') ?? null,
    [rootElements, codeOf],
  )
  const projectRootId = projectRoot?.id ?? null
  const isProjectRoot = useCallback(
    (element: ModelElement | null) =>
      !!element && !element.ownerId && codeOf(element.type) === 'MODEL',
    [codeOf],
  )

  // 扩展包元素 id 集合：模型树默认不展开它们，避免上百个元类淹没用户模型。
  const extensionPackageIds = useMemo(
    () => new Set(extensionPackages.map((item) => item.id)),
    [extensionPackages],
  )
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

  useEffect(() => {
    // 扩展包清单未就绪前不做自动展开：否则一百多个元类会先把树铺满再被折叠。
    if (!extensionCatalogReady) {
      return
    }
    setExpanded((previous) => {
      if (previous.size > 0) {
        return previous
      }
      const next = new Set<string>()
      for (const element of model.elements) {
        if (extensionPackageIds.has(element.id)) {
          continue
        }
        if ((childrenByOwner.get(element.id) ?? []).length > 0) {
          next.add(element.id)
        }
      }
      return next
    })
  }, [childrenByOwner, model.elements, extensionCatalogReady, extensionPackageIds])

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
    for (const element of model.elements) {
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
  }, [treeFilter, model.elements, model.diagrams, elementById])

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

  /** 模型库视图：通用扩展包（SysML / UML）及其元类、构造型数量。 */
  const libraryPackages = useMemo(() => {
    const roots = extensionPackages.filter((item) => (item.kind ?? 'PROFILE') === 'PROFILE')
    return roots.map((pkg) => {
      let metaclasses = 0
      let stereotypes = 0
      for (const element of model.elements) {
        let cursor: ModelElement | undefined = element
        let inside = false
        while (cursor) {
          if (cursor.id === pkg.id) {
            inside = true
            break
          }
          cursor = cursor.ownerId ? elementById.get(cursor.ownerId) : undefined
        }
        if (!inside) {
          continue
        }
        const code = codeOf(element.type)
        if (code === 'METACLASS') {
          metaclasses += 1
        } else if (code === 'STEREOTYPE') {
          stereotypes += 1
        }
      }
      return { pkg, metaclasses, stereotypes }
    })
  }, [extensionPackages, model.elements, elementById, codeOf])

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
    const filtered = propEntry.properties.filter((spec) =>
      propView === 'ALL'
        ? true
        : propView === 'EXPERT'
          ? spec.level !== 'DERIVED'
          : spec.level === 'STANDARD')
    const groups = new Map<string, PropertySpec[]>()
    for (const spec of filtered) {
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
  }, [propEntry, propCatalog, propView, locale])
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
        <span className="rel-link-other">{direction === 'out' ? '→' : '←'} {other?.name ?? otherId}</span>
      </button>
    )
  }

  /** 画布视口：zoom 收窄取样范围、pan 平移原点；指针坐标由 getScreenCTM 自动换算。 */
  const viewBox = `${pan.x} ${pan.y} ${canvas.width / zoom} ${canvas.height / zoom}`

  const applyZoom = useCallback((next: number) => {
    if (!Number.isFinite(next)) {
      return
    }
    setZoom(clamp(Number(next.toFixed(3)), ZOOM_MIN, ZOOM_MAX))
  }, [])

  const fitCanvas = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

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
          return selectedRelation.ownerId ?? projectRoot?.name ?? t('模型根')
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
  const commitProperty = (spec: PropertySpec, rawInput: string) => {
    if (!propTargetId || !spec.editable) {
      return
    }
    const raw = rawInput.trim()
    if (raw === propertyText(spec).trim()) {
      return
    }
    if (raw === '') {
      void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, remove: true })
      return
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
      }
      return
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
          return
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
          return
        }
        value = parsed
        break
      }
      case 'ENUM':
        if (!spec.options.includes(raw)) {
          say('「{label}」只能取：{options}', { label: pick(spec.label, spec.labelEn), options: spec.options.join(' / ') })
          return
        }
        break
      default:
        break
    }
    void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, value })
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
        <button type="button" className="prop-link" onClick={() => setRefPicker(null)}>{t('取消')}</button>
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
        <button type="button" className="prop-link" onClick={() => setRefPicker(null)}>{t('取消')}</button>
      </div>
    )
  }

  /**
   * 数组型属性的编辑：chip 标签 + 内联增删。
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

  const renderPropertyRow = (spec: PropertySpec): ReactNode => {
    if (!propTargetId) {
      return null
    }
    // 派生属性本就只读；无编辑权限时全部属性降级为只读。
    const readOnly = !spec.editable || !canEdit
    const readOnlyNote = !spec.editable ? t(' · 只读') : (canEdit ? '' : t(' · 当前角色只读'))
    const title = t('{metaclass} · {umlName} · {spec}{readOnly}', { metaclass: pick(spec.metaclassLabel, spec.metaclassLabelEn), umlName: spec.umlName, spec: spec.spec, readOnly: readOnlyNote })
    const value = propertyText(spec)
    let control: ReactNode
    if (readOnly) {
      control = <code className="prop-static">{derivedText(spec.key)}</code>
    } else if (spec.kind === 'BOOLEAN') {
      control = (
        <select
          value={value === '' ? '' : value === 'true' ? 'true' : 'false'}
          onChange={(event) => commitProperty(spec, event.target.value)}
        >
          <option value="">{t('未设置')}</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )
    } else if (spec.kind === 'ENUM') {
      control = (
        <select value={value} onChange={(event) => commitProperty(spec, event.target.value)}>
          <option value="">{t('未设置')}</option>
          {spec.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      )
    } else if (spec.kind === 'TEXT') {
      control = (
        <textarea
          rows={2}
          key={`${propTargetId}:${spec.key}:${value}`}
          defaultValue={value}
          onBlur={(event) => commitProperty(spec, event.target.value)}
        />
      )
    } else if (spec.kind === 'REFERENCE_LIST' || spec.kind === 'STRING_LIST') {
      // 只有「引用型列表指向元模型 / 表达式」才按普通文本编辑（metaclassReference、
      // metamodelReference、icon 等），其余列表一律 chip 化——STRING_LIST 的
      // referencesElement 恒为 false，不能拿它当「是否 chip 化」的开关。
      control = spec.kind === 'REFERENCE_LIST' && spec.referencesElement === false
        ? (
          <input
            key={`${propTargetId}:${spec.key}:${value}`}
            defaultValue={value}
            onBlur={(event) => commitProperty(spec, event.target.value)}
          />
        )
        : renderListEditor(spec)
    } else if (spec.kind === 'REFERENCE') {
      if (spec.referencesElement === false) {
        control = (
          <input
            key={`${propTargetId}:${spec.key}:${value}`}
            defaultValue={value}
            onBlur={(event) => commitProperty(spec, event.target.value)}
          />
        )
      } else {
        const ids = referenceIds(spec)
        const current = ids[0] ?? ''
        control = (
          <div className="prop-ref-editor">
            {current
              ? renderReferenceCard(spec, current, 0)
              : <span className="prop-ref-missing">{t('未设置')}</span>}
            {refPicker?.key === spec.key ? (
              renderReferencePicker(spec, (elementId) => {
                void runCommand('UPDATE_PROPERTY', { id: propTargetId, key: spec.key, value: elementId })
                setRefPicker(null)
              })
            ) : (
              <button
                type="button"
                className="prop-link"
                onClick={() => { setRefSearch(''); setRefPicker({ key: spec.key, index: 0 }) }}
              >{current ? t('更换') : t('选择引用')}</button>
            )}
          </div>
        )
      }
    } else {
      control = (
        <input
          ref={spec.key === 'name' ? renameRef : undefined}
          key={`${propTargetId}:${spec.key}:${value}`}
          defaultValue={value}
          placeholder="—"
          onBlur={(event) => commitProperty(spec, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      )
    }
    return (
      <div className={`prop-row${readOnly ? ' readonly' : ''}`} key={spec.key} title={title}>
        <span className="prop-label">
          {pick(spec.label, spec.labelEn)}
          {readOnly && <em>{t('只读')}</em>}
        </span>
        <div className="prop-value">{control}</div>
      </div>
    )
  }

  const visibleElements = useMemo(() => {
    if (!activeDiagramObj) {
      return model.elements
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
      const baseX = notation?.x ?? 36 + (index % 3) * 196
      const baseY = notation?.y ?? 36 + Math.floor(index / 3) * 128
      const active = drag?.elementId === element.id ? drag : null
      return {
        element,
        x: active?.x ?? baseX,
        y: active?.y ?? baseY,
        w: notation?.width ?? nodeSize.width,
        h: notation?.height ?? nodeSize.height,
      }
    })
  }, [visibleElements, model.notations, activeDiagramId, drag, nodeSize.width, nodeSize.height])

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

  // 空白处的「新建」一律落到项目根 Model 下，保证模型树始终只有一个根。
  const openCreate = (ownerId: string | null) => {
    const effective = ownerId ?? projectRootId
    const owner = effective
      ? model.elements.find((element) => element.id === effective)?.name ?? effective
      : t('模型根')
    setCreateDialog({ ownerId: effective, ownerName: owner })
    setCreateType('')
    setCreateName('')
    setCreateStereotype('')
    setJoinDiagram(true)
    setMenu(null)
  }

  const openDiagramDialog = (ownerId: string | null, edit?: Diagram) => {
    const effective = ownerId ?? projectRootId
    const owner = effective
      ? model.elements.find((element) => element.id === effective)?.name ?? effective
      : t('模型根')
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
    const ok = await runCommand('CREATE_DIAGRAM', {
      id,
      kind: diagramDialog.kind,
      name: diagramDialog.name.trim(),
      ownerId: diagramDialog.ownerId ?? '',
      elementIds: [],
    })
    if (ok) {
      setActiveDiagramId(id)
      setSelectedDiagramId(id)
      setDiagramDialog(null)
    }
  }

  const submitRelation = async () => {
    if (!relationDialog || !relationDialog.sourceId || !relationDialog.targetId) {
      say('请选择关系的两端元素')
      return
    }
    const id = `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const ok = await runCommand('CREATE_RELATIONSHIP', {
      id,
      type: relationDialog.type,
      sourceId: relationDialog.sourceId,
      targetId: relationDialog.targetId,
      diagramId: activeDiagramId,
    })
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
   * 全局快捷键：Ctrl/⌘+Z 撤销、Ctrl/⌘+Shift+Z 或 Ctrl+Y 重做、Esc 退出连线模式。
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
      if (event.key === 'Escape' && relationTool) {
        setRelationTool(null)
        setRelationSource(null)
        say('已退出连线模式')
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
  }, [handleUndo, handleRedo, relationTool, busy, health])

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
   * 「树上高亮」：把模型树定位到指定元素——展开它的祖先链、选中它，并滚动到可视区。
   *
   * <p>祖先链按 ownerId 逐级上溯（含图节点：元素也可能只出现在某张图的节点列表里，
   * 此时把那张图也展开），保证目标行确实渲染在树上。</p>
   */
  const locateInTree = (elementId: string) => {
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
    setSelectedId(elementId)
    setSelectedDiagramId(null)
    setTreeLocateId(elementId)
    const target = elementById.get(elementId)
    say('已在模型树中定位「{name}」', { name: target?.name ?? elementId })
    // 展开是异步渲染，等一帧再滚动，避免目标行尚未挂载。
    window.setTimeout(() => {
      document
        .querySelector(`[data-tree-id="${CSS.escape(elementId)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
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

  /** 滚轮以光标为锚点缩放：光标下的模型点保持不动，缩放后不会丢掉正在看的目标。 */
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
    setPan({
      x: anchor.x - (anchor.x - pan.x) * ratio,
      y: anchor.y - (anchor.y - pan.y) * ratio,
    })
    setZoom(Number(next.toFixed(3)))
  }, [zoom, pan])

  // 滚轮监听必须是非 passive 的原生监听：React 的 onWheel 走被动通道，preventDefault 无效。
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAtCursor(event.clientX, event.clientY, event.deltaY)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomAtCursor])

  /** 中键或 Shift+左键拖动平移视口；普通左键仍用于选择图形。 */
  const handleCanvasPanStart = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 1 && !(event.button === 0 && event.shiftKey)) {
      return
    }
    event.preventDefault()
    // 捕获指针：拖到画布外再松手也能正常结束平移，不会卡在 panning 状态。
    event.currentTarget.setPointerCapture(event.pointerId)
    setPanDrag({ startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y })
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panDrag) {
      // 屏幕像素换算成模型单位：视口宽度 = canvas.width / zoom，铺满 svg 的实际像素宽度。
      const rect = svgRef.current?.getBoundingClientRect()
      const perPixel = rect && rect.width > 0 ? (canvas.width / zoom) / rect.width : 1 / zoom
      setPan({
        x: panDrag.panX - (event.clientX - panDrag.startX) * perPixel,
        y: panDrag.panY - (event.clientY - panDrag.startY) * perPixel,
      })
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
    if (panDrag) {
      setPanDrag(null)
      return
    }
    if (!drag) {
      return
    }
    const finished = drag
    setDrag(null)
    if (finished.moved && activeDiagramId) {
      void runCommand('MOVE_NOTATION', {
        diagramId: activeDiagramId,
        elementId: finished.elementId,
        x: Math.round(finished.x),
        y: Math.round(finished.y),
      })
    }
  }

  // 组件工具箱只显示「当前图」允许的元素与关系，清单全部来自后端 MetamodelRegistry，
  // 不再把九大图的分组一次性堆在面板里（参考 EA / StarUML 的按图联动工具箱）。
  const paletteEntries = useMemo<ElementTypeInfo[]>(
    () => (activeSpec?.allowedTypes ?? [])
      .map((code) => typeInfo.get(code))
      .filter((item): item is ElementTypeInfo => item !== undefined),
    [activeSpec, typeInfo],
  )
  const elementGroups = useMemo(() => {
    const groups: { key: string; label: string; items: ElementTypeInfo[] }[] = []
    for (const family of FAMILIES) {
      const items = paletteEntries.filter((item) => familyOfType(item.code) === family.key)
      if (items.length > 0) {
        groups.push({ key: family.key, label: pick(family.label, family.labelEn), items })
      }
    }
    return groups
  }, [paletteEntries, locale])

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
  const relationLabel = (code: string) => {
    const info = relationInfo.get(code)
    return info ? pick(info.label, info.labelEn) : code
  }

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
    setRelationSource(null)
    say('已选择「{relation}」：在画布上依次点击起点与终点（Esc 退出）', { relation: relationLabel(code) })
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
    if (!relationSource) {
      setRelationSource(elementId)
      say('起点：{name}；请点击终点元素', { name: model.elements.find((e) => e.id === elementId)?.name ?? elementId })
      return
    }
    if (relationSource === elementId) {
      setRelationSource(null)
      say('已取消起点，请重新选择起点元素')
      return
    }
    const id = `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const ok = await runCommand('CREATE_RELATIONSHIP', {
      id,
      type: relationTool,
      sourceId: relationSource,
      targetId: elementId,
      diagramId: activeDiagramId,
    })
    if (ok) {
      setRelationSource(null)
      say('已创建 «{relation}» 关系，可继续连线或按 Esc 退出', { relation: relationTool })
    }
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
    setExpanded(new Set())
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

  const renderTreeNode = (node: TreeNode, depth: number): ReactNode => {
    // 筛选态下只渲染命中项与它们的祖先链，其余整棵子树跳过。
    if (treeFilterHits && !treeFilterHits.has(node.ref.id)) {
      return null
    }
    const isElement = node.type === 'element'
    const element = isElement ? node.ref : null
    const diagram = !isElement ? (node.ref as Diagram) : null
    const children: TreeNode[] = isElement
      ? [
          ...(childrenByOwner.get(element!.id) ?? []).map((ref) => ({ type: 'element', ref }) as TreeNode),
          ...(diagramsByOwner.get(element!.id) ?? []).map((ref) => ({ type: 'diagram', ref }) as TreeNode),
        ]
      : (model.elements
          .filter((e) => diagram!.elementIds.includes(e.id))
          .map((ref) => ({ type: 'element', ref }) as TreeNode))
    const isOpen = treeFilterHits ? true : expanded.has(node.ref.id)
    const info = isElement ? typeInfo.get(codeOf(element!.type)) : null
    const isRoot = isProjectRoot(element)
    // 顶层扩展包：系统提供的公共内容，树上标「通用」以便与用户自己的模型区分。
    const isExtensionRoot = isElement && extensionRootIds.has(element!.id)
    const isSelected = isElement ? selectedId === element!.id : selectedDiagramId === diagram!.id
    // 「树上高亮」的目标行：短暂高亮，便于用户在树上一眼看到定位结果。
    const isLocated = treeLocateId === node.ref.id
    return (
      <div key={`${node.type}:${node.ref.id}`}>
        <div
          className={`tree-row ${node.type}${isSelected ? ' selected' : ''}${isRoot ? ' root-node' : ''}${!isElement && treeDropTarget === diagram!.id ? ' drop-target' : ''}${isLocated ? ' located' : ''}`}
          data-tree-id={node.ref.id}
          style={{ paddingLeft: 6 + depth * 15 }}
          draggable={isElement && !isRoot && canEdit}
          onDragStart={(event) => {
            if (!isElement || isRoot) {
              event.preventDefault()
              return
            }
            event.dataTransfer.setData('text/scofen-element', element!.id)
            event.dataTransfer.effectAllowed = 'link'
          }}
          onDragOver={(event) => {
            // 图节点接收模型树里的元素：先建引用（记法），不复制模型元素。
            if (isElement || !event.dataTransfer.types.includes('text/scofen-element')) {
              return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'link'
            if (treeDropTarget !== diagram!.id) {
              setTreeDropTarget(diagram!.id)
            }
          }}
          onDragLeave={() => {
            if (!isElement) {
              setTreeDropTarget((current) => (current === diagram!.id ? null : current))
            }
          }}
          onDrop={(event) => {
            if (isElement) {
              return
            }
            event.preventDefault()
            setTreeDropTarget(null)
            const droppedId = event.dataTransfer.getData('text/scofen-element')
            if (droppedId) {
              void addElementToDiagram(diagram!.id, droppedId)
            }
          }}
          title={isElement ? t('{label} · 可拖入画布或图节点', { label: pick(info?.label, info?.labelEn) ?? element!.type }) : t('图 · 点击切换 · 可接收拖入的元素')}
          onClick={() => {
            if (isElement) {
              setSelectedId(element!.id)
              setSelectedDiagramId(null)
            } else {
              setActiveDiagramId(diagram!.id)
              setSelectedDiagramId(diagram!.id)
              setSelectedId(null)
              openTab({ kind: 'diagram', id: diagram!.id })
            }
          }}
          onDoubleClick={() => {
            // 双击元素：在标签条里开一个对象页签，像桌面建模器那样双击进属性。
            if (isElement) {
              openTab({ kind: 'element', id: element!.id })
            }
          }}
          onContextMenu={(event) =>
            openMenu(event, isElement ? { kind: 'element', id: element!.id } : { kind: 'diagram', id: diagram!.id })
          }
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              if (isElement) {
                setSelectedId(element!.id)
              } else {
                setActiveDiagramId(diagram!.id)
                setSelectedDiagramId(diagram!.id)
              }
            }
          }}
        >
          <button
            type="button"
            className={`twisty ${children.length === 0 ? 'leaf' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              if (children.length > 0) {
                toggleExpanded(node.ref.id)
              }
            }}
            aria-label={isOpen ? t('折叠') : t('展开')}
          >
            {children.length > 0 ? (isOpen ? '▾' : '▸') : '·'}
          </button>
          {isElement ? (
            <>
              <TypeIcon code={codeOf(element!.type)} size={16} title={typeLabel(element!.type)} />
              <span className="tree-label">{element!.name}</span>
              {isRoot ? (
                <span className="root-tag" title={t('项目根节点模型，不可删除')}>{t('项目根')}</span>
              ) : isExtensionRoot ? (
                <span
                  className="root-tag extension-tag"
                  title={t('通用扩展包：SysML / UML 的元类与构造型随项目提供')}
                >
                  {t('通用')}
                </span>
              ) : (
                <span className="tree-type">{typeLabel(element!.type)}</span>
              )}
            </>
          ) : (
            <>
              <DiagramIcon code={diagram!.kind} size={16} title={diagramLabel(diagram!.kind)} />
              <span className="tree-label">{diagram!.name}</span>
              <span className="child-count">{diagram!.elementIds.length}</span>
            </>
          )}
        </div>
        {isOpen &&
          children.map((child) => renderTreeNode(child, depth + 1))}
      </div>
    )
  }

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
    const bw = isPort ? 26 : w
    const bh = isPort ? 26 : h
    const bx = isPort ? x + w / 2 - 13 : x
    const by = isPort ? y + h / 2 - 13 : y
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
      case 'action':
      case 'control':
      case 'object':
        shapeSvg = (
          <rect
            x={bx}
            y={by}
            width={bw}
            height={bh}
            rx={shape === 'action' ? 22 : 8}
            fill={shape === 'control' ? '#eef6ff' : fill}
            stroke={stroke}
            strokeWidth={strokeW}
          />
        )
        break
      default:
        shapeSvg = <rect x={bx} y={by} width={bw} height={bh} rx={8} fill={fill} stroke={stroke} strokeWidth={strokeW} />
    }

    const showText = !isPort && shape !== 'pseudostate' && shape !== 'actor'
    const showLabel = shape === 'actor' || shape === 'pseudostate'
    const showCompartment =
      !isPort && (shape === 'block' || shape === 'frame' || shape === 'requirement' || shape === 'package') && children.length > 0

    return (
      <g
        className={`node ${drag?.elementId === element.id && drag.moved ? 'dragging' : ''} ${isLinkSource ? 'link-source' : ''}`}
        onPointerDown={onDown}
      >
        {shapeSvg}
        {showText && (
          <>
            <text x={bx + 12} y={by + 22} className="node-type">«{info?.uml ?? element.type}»</text>
            <text x={bx + 12} y={by + 42} className="node-name">{element.name}</text>
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

  // ── 顶部菜单栏：把原先散落在顶栏与画布工具条里的命令收进 8 个菜单 ──
  const renameSelection = () => {
    if (selected) {
      setPropsTab('attrs')
      window.setTimeout(() => renameRef.current?.focus(), 30)
      return
    }
    if (selectedDiagram) {
      openDiagramDialog(selectedDiagram.ownerId, selectedDiagram)
    }
  }

  const deleteSelection = () => {
    if (selected) {
      if (isProjectRoot(selected)) {
        say('项目根节点模型不可删除')
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
        { label: '重新拉取模型快照', run: () => void refresh() },
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
          run: () => say('Ctrl/⌘+Z 撤销 · Ctrl+Y 重做 · 滚轮缩放 · Shift+拖动平移画布 · Esc 退出连线'),
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
            <TypeIcon code="MODEL" size={14} />
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
                      <button
                        type="button"
                        key={project.id}
                        className={`pp-project ${project.id === activeProjectId ? 'active' : ''}`}
                        onClick={() => openProject(project)}
                        title={`${project.name} · ${project.description || project.status}`}
                      >
                        <TypeIcon code="MODEL" size={15} />
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

      <div className={`workspace ${toolboxCollapsed ? 'toolbox-collapsed' : ''}`}>
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
                      <button
                        type="button"
                        key={project.id}
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

        <div className="left-dock">
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
            <span className="tree-head-count">{model.elements.length}</span>
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
                <button type="button" onClick={() => setTreeFilter('')} title={t('清除筛选')}>×</button>
              )}
            </div>
          ) : (
            <div className="panel-title">
              {leftTab === 'charts'
                ? t('按图类型分组 · 共 {count} 张', { count: model.diagrams.length })
                : t('通用扩展包 · 元类与构造型')}
            </div>
          )}
          <div className="browser" onContextMenu={(event) => openMenu(event, { kind: 'root', id: null })}>
            {leftTab === 'charts' ? (
              <>
                {diagramsByKind.map(([kind, list]) => (
                  <section className="chart-group" key={kind}>
                    <div className="chart-group-head">
                      <DiagramIcon code={kind} size={14} />
                      <span>{diagramLabel(kind)}</span>
                      <span className="chart-group-count">{list.length}</span>
                    </div>
                    {list.map((diagram) => (
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
                {libraryPackages.map(({ pkg, metaclasses, stereotypes }) => (
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
                      <span className="chart-row-count">{metaclasses} / {stereotypes}</span>
                    </button>
                    <p className="chart-group-note">
                      {t('元类 {metaclasses} · 构造型 {stereotypes}', { metaclasses, stereotypes })}
                    </p>
                  </section>
                ))}
                {libraryPackages.length === 0 && <p className="hint">{t('扩展包清单加载中…')}</p>}
                <p className="browser-note">
                  {t('扩展包随项目提供、整体不可删；包内元类与构造型可增删。')}
                </p>
              </>
            ) : (
              <>
            {rootNodes.map((node) => renderTreeNode(node, 0))}
            {rootNodes.length === 0 && <p className="hint">{t('暂无元素，右键空白处新建元素')}</p>}
            {treeFilterHits && treeFilterHits.size === 0 && (
              <p className="hint">{t('没有匹配「{keyword}」的元素或图', { keyword: treeFilter })}</p>
            )}
            <div className="browser-foot">
              <span>{t('{elements} 元素 · {diagrams} 图', { elements: model.elements.length, diagrams: model.diagrams.length })}</span>
              <span>{t('{count} 关系', { count: model.relationships.length })}</span>
            </div>
            <button
              type="button"
              className={`tree-row relation-toggle ${relationsOpen ? 'open' : ''}`}
              onClick={() => setRelationsOpen((previous) => !previous)}
            >
              <span className="twisty">{relationsOpen ? '▾' : '▸'}</span>
              <RelationIcon code="trace" size={15} />
              <span className="tree-label">{t('关系')}</span>
              <span className="child-count">{model.relationships.length}</span>
            </button>
            {relationsOpen && (
            <div className="relation-list">
            {model.relationships.map((relation) => {
              const source = model.elements.find((item) => item.id === relation.sourceId)
              const target = model.elements.find((item) => item.id === relation.targetId)
              const active = selectedRelationId === relation.id
              return (
                <div
                  className={`tree-row relation${active ? ' selected' : ''}`}
                  key={relation.id}
                  role="button"
                  tabIndex={0}
                  title={t('{relation}：{source} → {target}｜点击查看 / 编辑关系属性', { relation: relationLabel(relation.type), source: source?.name ?? relation.sourceId, target: target?.name ?? relation.targetId })}
                  onClick={() => {
                    setSelectedRelationId(relation.id)
                    setSelectedId(null)
                    setSelectedDiagramId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedRelationId(relation.id)
                      setSelectedId(null)
                      setSelectedDiagramId(null)
                    }
                  }}
                >
                  <RelationIcon code={relation.type} size={15} />
                  <span className="tree-label">{relation.name?.trim() || `«${relation.type}»`}</span>
                  <span className="tree-type">{relationLabel(relation.type)}</span>
                </div>
              )
            })}
            {model.relationships.length === 0 && <p className="hint">{t('暂无关系')}</p>}
            </div>
            )}
              </>
            )}
          </div>

        </aside>

        <aside className="props-dock" aria-label={t('属性窗口（常驻左下角）')}>
          <div className="props-grip" aria-hidden="true" />
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
                <div className="kv"><span>{t('所有者')}</span><code>{selectedDiagram.ownerId || projectRoot?.name || t('模型根')}</code></div>
                <div className="kv"><span>{t('元素数')}</span><code>{t('{count} 个', { count: selectedDiagram.elementIds.length })}</code></div>
                <div className="kv"><span>ID</span><code>{selectedDiagram.id}</code></div>
              </>
            ) : (selected || selectedRelation) ? (
              <>
                <div className="prop-view-switch" role="tablist" aria-label={t('属性档位')}>
                  {(propCatalog?.levels ?? [
                    { code: 'STANDARD' as PropertyView, label: t('标准'), description: t('最常用属性') },
                    { code: 'EXPERT' as PropertyView, label: t('专家'), description: t('规范扩展属性') },
                    { code: 'ALL' as PropertyView, label: t('全部'), description: t('含派生只读属性') },
                  ]).map((level) => (
                    <button
                      key={level.code}
                      type="button"
                      role="tab"
                      aria-selected={propView === level.code}
                      className={propView === level.code ? 'active' : ''}
                      title={level.description}
                      onClick={() => setPropView(level.code)}
                    >
                      {pick(level.label, level.labelEn)}
                      <span>{propViewCount(level.code)}</span>
                    </button>
                  ))}
                </div>
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
                    <p className="hint">{t('该类型暂无属性定义（属性目录加载中或服务端未登记）')}</p>
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
              {propsTab === 'attrs' && (selected || selectedRelation)
                ? t('共 {count} 项', { count: propVisibleCount })
                : selectedDiagram
                  ? t('图 · {count} 元素', { count: selectedDiagram.elementIds.length })
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
                {/* 元素：仅当前图允许的类型，按语义族分小节 */}
                <div className={`tb-group current ${openToolGroups.has('elements') ? 'open' : ''}`}>
                  <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('elements')}>
                    {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={16} />}
                    <span className="tb-group-label">{t('元素 · {label}', { label: activeSpec ? pick(activeSpec.label, activeSpec.labelEn) : t('当前图') })}</span>
                    <span className="tb-count">{paletteEntries.length}</span>
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
                      <p className="tb-tip">{t('仅显示当前图允许的 {count} 类元素 · 点击 / 拖入画布', { count: paletteEntries.length })}</p>
                    </div>
                  )}
                </div>

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
                      {relationGroups.map((group) => (
                        <div className="tb-sect" key={group.key}>
                          <div className="tb-sect-label">{group.label}</div>
                          {group.items.map((rel) => (
                            <button
                              key={rel.code}
                              type="button"
                              className={`tb-item relation ${relationTool === rel.code ? 'tool-active' : ''}`}
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
                      ))}
                      {relationTool && (
                        <div className="tb-link-hint">
                          <span>{t('连线中 · «{relation}»', { relation: relationLabel(relationTool) })}</span>
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
                {relationTool && <span className="dt-linkflag">{t(' · 连线中 «{relation}»（Esc 退出）', { relation: relationLabel(relationTool) })}</span>}
              </span>
            </div>
          </div>
          <svg
            ref={svgRef}
            className={`${relationTool ? 'linking' : ''}${panDrag ? ' panning' : ''}`.trim() || undefined}
            viewBox={viewBox}
            role="img"
            aria-label={t('模型画布，图形可拖拽；连线模式下依次点击起点与终点')}
            onPointerDown={(event) => {
              // 中键 / Shift+左键先进入平移，其余落在空白处才清空选择。
              handleCanvasPanStart(event)
              if (event.target !== event.currentTarget) {
                return
              }
              // 连线模式下点击画布空白取消已选起点；普通模式点击空白取消关系选择。
              if (relationTool) {
                setRelationSource(null)
              } else {
                setSelectedRelationId(null)
              }
            }}
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
            {positions.map(({ element, x, y, w, h }) => renderNode(element, x, y, w, h))}
            {positions.length === 0 && (
              <text x={canvas.width / 2} y={canvas.height / 2} textAnchor="middle" className="empty">
                {t('当前图暂无元素')}
              </text>
            )}
            {model.relationships.map((relation) => {
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
              const sEdge = edgePoint(sc.x, sc.y, fw, fh, tc.x, tc.y)
              const tEdge = edgePoint(tc.x, tc.y, tw, th, sc.x, sc.y)
              const style = relationshipStyle(relation.type)
              const arrow = arrowGeometry(sEdge.x, sEdge.y, tEdge.x, tEdge.y)
              const midX = (sEdge.x + tEdge.x) / 2
              const midY = (sEdge.y + tEdge.y) / 2
              const isSelected = selectedRelationId === relation.id
              const sourceName = from.element.name
              const targetName = to.element.name
              return (
                /*
                 * 连线画在节点之上保证标签可读。容器整体不接收指针事件，只有末尾一条
                 * 透明加粗线接收命中（pointerEvents="stroke"），这样关系可以点选，
                 * 又不会在连线模式下挡住节点点选。
                 */
                <g key={relation.id} pointerEvents="none">
                  {isSelected && (
                    <line
                      x1={sEdge.x}
                      y1={sEdge.y}
                      x2={tEdge.x}
                      y2={tEdge.y}
                      stroke="#2b5cb8"
                      strokeWidth={(style.width ?? 1.4) + 7}
                      strokeOpacity={0.18}
                      strokeLinecap="round"
                    />
                  )}
                  <line
                    x1={sEdge.x}
                    y1={sEdge.y}
                    x2={tEdge.x}
                    y2={tEdge.y}
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
                  <line
                    x1={sEdge.x}
                    y1={sEdge.y}
                    x2={tEdge.x}
                    y2={tEdge.y}
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
                      setSelectedRelationId(relation.id)
                      setSelectedId(null)
                      setSelectedDiagramId(null)
                    }}
                  >
                    <title>
                      {relation.name?.trim() || `«${relation.type}» ${relationLabel(relation.type)}`}
                      {'：'}{sourceName} → {targetName}{t('｜点击查看 / 编辑关系属性')}
                    </title>
                  </line>
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
              {t('连线 «{relation}» · {hint} · Esc 退出', { relation: relationLabel(relationTool), hint: relationSource ? t('点击终点元素') : t('点击起点元素') })}
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
            {menuTarget?.kind === 'root' && projectRoot && <TypeIcon code="MODEL" size={16} />}
            <span>{menuDiagram ? menuDiagram.name : menuElement ? menuElement.name : t('模型根')}</span>
          </div>
          {menuTarget?.kind === 'element' && (
            <>
              <button type="button" onClick={() => openCreate(menuElement!.id)}>{t('新建子元素…')}</button>
              <button type="button" onClick={() => openDiagramDialog(menuElement!.id)}>{t('在此新建图…')}</button>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(menuElement!.id)
                  renameRef.current?.focus()
                  setMenu(null)
                }}
              >{t('重命名')}</button>
              {!menuInDiagram && menuTypeAllowed && activeDiagramId && (
                <button type="button" onClick={() => void addToCurrentDiagram(menuElement!.id)}>{t('加入当前图')}</button>
              )}
              {menuInDiagram && (
                <button type="button" onClick={() => locateInDiagram(menuElement!.id)}>{t('在图中定位')}</button>
              )}
              {isProjectRoot(menuElement) ? (
                <button type="button" className="disabled-hint" disabled title={t('项目根节点模型不可删除')}>
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

      {newProjectDialog && (
        <div className="modal-overlay" onPointerDown={() => setNewProjectDialog(false)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code="MODEL" size={18} />
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

      {createDialog && (
        <div className="modal-overlay" onPointerDown={() => setCreateDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code={createType || 'PACKAGE'} size={18} />
              {t('新建元素')}
            </h2>
            <p className="modal-sub">{t('父节点：{name}', { name: createDialog.ownerName })}</p>
            {createOptions.length === 0 ? (
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
                disabled={busy || createOptions.length === 0 || !createName.trim()}
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
