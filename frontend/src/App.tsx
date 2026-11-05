import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  clearSession,
  createProject,
  getContainment,
  getDiagrams,
  getHealth,
  getModel,
  getProjectId,
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
  Health,
  ModelElement,
  ModelSnapshot,
  RelationshipTypeInfo,
  Session,
  WorkspaceDirectoryInfo,
  WorkspaceProject,
} from './types'
import { arrowGeometry, edgePoint, relationshipStyle, shapeOf } from './notation'
import { DiagramIcon, FAMILIES, RelationIcon, TypeIcon, familyOfType } from './icons'
import LoginView from './LoginView'

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

type MenuTarget =
  | { kind: 'element'; id: string }
  | { kind: 'diagram'; id: string }
  | { kind: 'root'; id: null }

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

/** 关系族中文名：组件工具箱「关系」分组内的小节标题。 */
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
  { code: 'trace', label: '追溯', stereotype: 'trace', family: 'requirement' },
  { code: 'satisfy', label: '满足', stereotype: 'satisfy', family: 'requirement' },
  { code: 'generalization', label: '泛化', stereotype: 'generalization', family: 'structure' },
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
  const [health, setHealth] = useState<Health | null>(null)
  const [model, setModel] = useState<ModelSnapshot>(EMPTY_MODEL)
  const [specs, setSpecs] = useState<DiagramSpec[]>([])
  const [containment, setContainment] = useState<ContainmentSpec | null>(null)
  const [activeDiagramId, setActiveDiagramId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [message, setMessage] = useState('正在连接服务端…')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
  const [propsTab, setPropsTab] = useState<'attrs' | 'tags'>('attrs')
  // 空间 / 项目导航：列表收进顶栏项目选择器，完整面板按需展开为左侧抽屉。
  const [workspace, setWorkspace] = useState<WorkspaceDirectoryInfo | null>(null)
  const [openSpaces, setOpenSpaces] = useState<Set<string>>(() => new Set(['personal', 'team']))
  const [activeProjectId, setActiveProjectId] = useState(() => getProjectId())
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [spaceDrawerOpen, setSpaceDrawerOpen] = useState(false)
  const [newProjectDialog, setNewProjectDialog] = useState(false)
  const [newProjectSpace, setNewProjectSpace] = useState('personal')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')

  // 所有 /api 请求都带当前项目头；在渲染期同步，避免切换项目时首帧请求串到旧项目。
  setProjectId(activeProjectId)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)
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
      setMessage((current) => (current === '正在连接服务端…' ? '已同步至服务端' : current))
    } catch (error) {
      setMessage(`连接失败：${errorMessage(error)}`)
    }
  }, [])

  // 元模型目录与项目无关，登录后只加载一次。
  useEffect(() => {
    getDiagrams()
      .then(setSpecs)
      .catch((error: unknown) => setMessage(`图规格加载失败：${errorMessage(error)}`))
    getRelationships()
      .then(setRelationCatalog)
      .catch((error: unknown) => setMessage(`关系目录加载失败：${errorMessage(error)}`))
    getContainment()
      .then(setContainment)
      .catch((error: unknown) => setMessage(`元模型规则加载失败：${errorMessage(error)}`))
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

  useEffect(() => {
    setExpanded((previous) => {
      if (previous.size > 0) {
        return previous
      }
      const next = new Set<string>()
      for (const element of model.elements) {
        if ((childrenByOwner.get(element.id) ?? []).length > 0) {
          next.add(element.id)
        }
      }
      return next
    })
  }, [childrenByOwner, model.elements])

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

  const selectedDiagram = useMemo(
    () => model.diagrams.find((diagram) => diagram.id === selectedDiagramId) ?? null,
    [model.diagrams, selectedDiagramId],
  )

  useEffect(() => {
    setDraftName(selected?.name ?? '')
  }, [selected?.id, selected?.name])

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
    setCreateName(`新建${first.label} ${model.elements.length + 1}`)
    setCreateStereotype(first.stereotype)
  }, [createDialog, createOptions, createType, model.elements.length])

  const runCommand = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    try {
      const patch = await postCommand({
        type,
        payload,
        baseRevision: revisionRef.current,
        clientCmdId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      revisionRef.current = patch.revision
      setMessage(
        `已应用 rev ${patch.revision} · ${patch.affectedIds.length} 个对象受影响 · 校验：${patch.validationDelta}`,
      )
      await refresh()
      return true
    } catch (error) {
      setMessage(`操作失败：${errorMessage(error)}`)
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
      : '模型根'
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
      : '模型根'
    setDiagramDialog({
      ownerId: effective,
      ownerName: owner,
      kind: edit?.kind ?? specs[0]?.code ?? 'bdd',
      name: edit?.name ?? `新建图 ${model.diagrams.length + 1}`,
      editId: edit?.id ?? null,
    })
    setMenu(null)
  }

  const submitCreate = async () => {
    if (!createDialog || !createType || !createName.trim()) {
      setMessage('请填写元素名称并选择类型')
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
      setMessage('请填写图名称并选择类型')
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
      setMessage('请选择关系的两端元素')
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

  const handleRename = () => {
    if (!selected || !draftName.trim()) {
      return
    }
    void runCommand('RENAME_ELEMENT', { id: selected.id, name: draftName.trim() })
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
      setMessage(`已撤销至 rev ${patch.revision}`)
      await refresh()
    } catch (error) {
      setMessage(`撤销失败：${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const handleRedo = useCallback(async () => {
    setBusy(true)
    try {
      const patch = await redo()
      revisionRef.current = patch.revision
      setMessage(`已重做至 rev ${patch.revision}`)
      await refresh()
    } catch (error) {
      setMessage(`重做失败：${errorMessage(error)}`)
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
        setMessage('已退出连线模式')
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
          setMessage('没有可撤销的操作 · Ctrl/⌘ + Z')
        } else {
          void handleUndo()
        }
      } else if ((health?.redoDepth ?? 0) === 0) {
        setMessage('没有可重做的操作 · Ctrl/⌘ + Shift + Z 或 Ctrl + Y')
      } else {
        void handleRedo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo, relationTool, busy, health])

  const addToCurrentDiagram = async (elementId: string) => {
    if (!activeDiagramId) {
      return
    }
    await runCommand('ADD_TO_DIAGRAM', { diagramId: activeDiagramId, elementId })
    setMenu(null)
  }

  const locateInDiagram = (elementId: string) => {
    const diagram = model.diagrams.find((item) => item.elementIds.includes(elementId))
    if (diagram) {
      setActiveDiagramId(diagram.id)
      setSelectedId(elementId)
      setMessage(`已定位到「${diagram.name}」`)
    } else {
      setMessage('该元素尚未加入任何图，可用右键「加入当前图」')
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

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
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
        groups.push({ key: family.key, label: family.label, items })
      }
    }
    return groups
  }, [paletteEntries])

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
        groups.push({ key, label: RELATION_FAMILY_LABELS[key] ?? key, items })
      }
    }
    const grouped = new Set(groups.map((group) => group.key))
    const rest = relationEntries.filter((item) => !grouped.has(item.family))
    if (rest.length > 0) {
      groups.push({ key: 'other', label: '其他', items: rest })
    }
    return groups
  }, [relationEntries])
  const relationLabel = (code: string) => relationInfo.get(code)?.label ?? code

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
    setMessage(`已选择「${relationLabel(code)}」：在画布上依次点击起点与终点（Esc 退出）`)
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
      setMessage(`起点：${model.elements.find((e) => e.id === elementId)?.name ?? elementId}；请点击终点元素`)
      return
    }
    if (relationSource === elementId) {
      setRelationSource(null)
      setMessage('已取消起点，请重新选择起点元素')
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
      setMessage(`已创建 «${relationTool}» 关系，可继续连线或按 Esc 退出`)
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
      name: `新建${info?.label ?? typeCode} ${model.elements.length + 1}`,
      ownerId: activeDiagramObj.ownerId ?? '',
      stereotypes: info?.stereotype ? [info.stereotype] : [],
      diagramId: activeDiagramId,
      x: Math.round(clamp(x, 0, canvas.maxX)),
      y: Math.round(clamp(y, 0, canvas.maxY)),
    }
    const ok = await runCommand('CREATE_ELEMENT', payload)
    if (ok) {
      setSelectedId(id)
      setMessage(`已在 (${payload.x}, ${payload.y}) 放置「${payload.name}」`)
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
      setMessage(`已把「${model.elements.find((e) => e.id === elementId)?.name ?? elementId}」放置在 (${x}, ${y})`)
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
      ?? '个人空间',
    [workspace, activeProjectId],
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
      setMessage(`当前编辑项目：${project.name}`)
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
    setMessage(`已打开项目「${project.name}」· ${spaceLabel}`)
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
      setMessage(`已创建并打开项目「${created.name}」`)
    } catch (error) {
      setMessage(`新建项目失败：${errorMessage(error)}`)
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
    const isOpen = expanded.has(node.ref.id)
    const info = isElement ? typeInfo.get(codeOf(element!.type)) : null
    const isRoot = isProjectRoot(element)
    const isSelected = isElement ? selectedId === element!.id : selectedDiagramId === diagram!.id
    return (
      <div key={`${node.type}:${node.ref.id}`}>
        <div
          className={`tree-row ${node.type}${isSelected ? ' selected' : ''}${isRoot ? ' root-node' : ''}`}
          style={{ paddingLeft: 6 + depth * 15 }}
          draggable={isElement && !isRoot}
          onDragStart={(event) => {
            if (!isElement || isRoot) {
              event.preventDefault()
              return
            }
            event.dataTransfer.setData('text/scofen-element', element!.id)
            event.dataTransfer.effectAllowed = 'link'
          }}
          title={isElement ? `${info?.label ?? element!.type} · 可拖入画布放置` : '图 · 点击切换'}
          onClick={() => {
            if (isElement) {
              setSelectedId(element!.id)
              setSelectedDiagramId(null)
            } else {
              setActiveDiagramId(diagram!.id)
              setSelectedDiagramId(diagram!.id)
              setSelectedId(null)
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
            aria-label={isOpen ? '折叠' : '展开'}
          >
            {children.length > 0 ? (isOpen ? '▾' : '▸') : '·'}
          </button>
          {isElement ? (
            <>
              <TypeIcon code={codeOf(element!.type)} size={16} title={info?.label ?? element!.type} />
              <span className="tree-label">{element!.name}</span>
              {isRoot ? (
                <span className="root-tag" title="项目根节点模型，不可删除">项目根</span>
              ) : (
                <span className="tree-type">{info?.label ?? element!.type}</span>
              )}
            </>
          ) : (
            <>
              <DiagramIcon code={diagram!.kind} size={16} title={specs.find((s) => s.code === diagram!.kind)?.label ?? '图'} />
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <h1>Scofen Modeler Studio</h1>
            <p>One model. Nine views.</p>
          </div>
        </div>

        {/* 空间 / 项目选择器：替代原来的常驻最左列与顶部九图切换条 */}
        <div className="project-picker" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`project-switch ${projectPickerOpen ? 'open' : ''}`}
            onClick={() => setProjectPickerOpen((open) => !open)}
            title="切换空间与项目"
          >
            <span className="pp-space">{currentSpaceLabel}</span>
            <span className="crumb-sep">/</span>
            <TypeIcon code="MODEL" size={14} />
            <strong>{workspace?.currentProjectName ?? projectRoot?.name ?? '未命名项目'}</strong>
            <span className="crumb-tag">当前项目</span>
            <span className="pp-caret">▾</span>
          </button>
          {projectPickerOpen && (
            <div className="project-popover">
              <div className="pp-head">
                <span>工作空间与项目</span>
                <button
                  type="button"
                  onClick={() => { setSpaceDrawerOpen(true); setProjectPickerOpen(false) }}
                >完整面板</button>
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
                        title={`在${space.label}新建项目`}
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
                              ? `${project.diagramCount} 图 · ${project.elementCount} 元素 · rev ${project.revision}`
                              : '尚未打开 · 点击打开'}
                          </span>
                        </span>
                        {project.id === activeProjectId
                          ? <span className="pp-current">已打开</span>
                          : <span className="pp-open">打开</span>}
                      </button>
                    ))}
                  </div>
                ))}
                {!workspace && <p className="hint">正在加载空间目录…</p>}
              </div>
              <div className="pp-foot">
                <span>点击项目即可打开 · 新建后自动打开</span>
                <button
                  type="button"
                  onClick={() => { setSpaceDrawerOpen(true); setProjectPickerOpen(false) }}
                >空间详情</button>
              </div>
            </div>
          )}
        </div>

        <div className="top-actions">
          <span className="pill">SysML 1.6 · 九图</span>
          <button type="button" title="撤销 · Ctrl/⌘ + Z" onClick={() => void handleUndo()} disabled={busy || (health?.undoDepth ?? 0) === 0}>撤销</button>
          <button type="button" title="重做 · Ctrl/⌘ + Shift + Z 或 Ctrl + Y" onClick={() => void handleRedo()} disabled={busy || (health?.redoDepth ?? 0) === 0}>重做</button>
          <div className="user-chip">
            <span className="user-avatar" aria-hidden="true">
              {session.user.username.slice(0, 1).toUpperCase()}
            </span>
            <span className="user-name">{session.user.displayName} · {session.user.username}</span>
            <button type="button" onClick={onLogout} title="退出登录">登出</button>
          </div>
        </div>
      </header>

      <div className="workspace">
        {/* 完整空间面板按需从左侧展开；平时只保留顶栏的项目选择器，不占画布宽度 */}
        {spaceDrawerOpen && (
          <>
            <div className="drawer-scrim" onPointerDown={() => setSpaceDrawerOpen(false)} />
            <aside className="space-drawer" aria-label="空间与项目导航">
          <div className="space-head">
            <span className="space-title">工作空间</span>
            <button
              type="button"
              className="drawer-close"
              title="收起空间面板"
              onClick={() => setSpaceDrawerOpen(false)}
            >×</button>
            <button
              type="button"
              className="space-add"
              title="新建项目"
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
                      {space.owner} · {space.memberCount} 成员
                      <button
                        type="button"
                        className="space-owner-add"
                        title={`在${space.label}新建项目`}
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
                              ? `${project.diagramCount} 图 · ${project.elementCount} 元素 · rev ${project.revision}`
                              : `尚未打开 · ${project.owner}`}
                          </span>
                        </span>
                        {project.current && <span className="space-current-dot" title="当前编辑项目" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!workspace && <p className="hint">正在加载空间目录…</p>}

            {/* 项目详情与目录说明跟随列表一起滚动，不占用项目列表的可视高度 */}
            {selectedProject && (
              <div className="space-detail">
                <div className="space-detail-head">
                  <TypeIcon code={selectedProject.current ? 'MODEL' : 'PACKAGE'} size={16} />
                  <strong>{selectedProject.name}</strong>
                </div>
                <p className="space-detail-desc">{selectedProject.description || '暂无描述'}</p>
                <div className="kv"><span>所属空间</span><code>{workspace?.spaces.find((s) => s.code === selectedProject.spaceCode)?.label ?? '—'}</code></div>
                <div className="kv"><span>负责人</span><code>{selectedProject.owner}</code></div>
                <div className="kv"><span>状态</span><code>{selectedProject.status}</code></div>
                {selectedProject.current ? (
                  <>
                    <div className="kv"><span>图 / 元素</span><code>{selectedProject.diagramCount} / {selectedProject.elementCount}</code></div>
                    <div className="kv"><span>关系 / 修订</span><code>{selectedProject.relationshipCount} / rev {selectedProject.revision}</code></div>
                  </>
                ) : (
                  <p className="space-detail-note">点击项目即可打开并编辑；M0 内存态模型在服务重启后回到初始基线。</p>
                )}
              </div>
            )}
            <div className="space-foot">{workspace?.note ?? '空间目录加载中…'}</div>
          </div>
        </aside>
          </>
        )}

        <div className="left-dock">
        <aside className="tree">
          <div className="tree-head">
            <span className="tree-head-tab active">项目</span>
            <span className="tree-head-tab">图表</span>
            <span className="tree-head-tab">模型库</span>
          </div>
          <div className="panel-title">
            {projectRoot ? `模型浏览器 · ${projectRoot.name}` : '模型浏览器 · 右键操作'}
          </div>
          <div className="browser" onContextMenu={(event) => openMenu(event, { kind: 'root', id: null })}>
            {rootNodes.map((node) => renderTreeNode(node, 0))}
            {rootNodes.length === 0 && <p className="hint">暂无元素，右键空白处新建元素</p>}
            <div className="panel-title">关系</div>
            {model.relationships.map((relation) => (
              <div className="tree-row muted" key={relation.id}>
                «{relation.type}» {model.elements.find((e) => e.id === relation.sourceId)?.name ?? relation.sourceId}
                {' → '}
                {model.elements.find((e) => e.id === relation.targetId)?.name ?? relation.targetId}
              </div>
            ))}
            {model.relationships.length === 0 && <p className="hint">暂无关系</p>}
          </div>

        </aside>

        <aside className="props-dock" aria-label="属性窗口（常驻左下角）">
          <div className="props-grip" aria-hidden="true" />
          <div className="props-head">
            <button
              type="button"
              className={`props-tab ${propsTab === 'attrs' ? 'active' : ''}`}
              onClick={() => setPropsTab('attrs')}
            >属性</button>
            <button
              type="button"
              className={`props-tab ${propsTab === 'tags' ? 'active' : ''}`}
              onClick={() => setPropsTab('tags')}
            >标签</button>
            <span className="props-head-note">常驻 · 左下角</span>
          </div>
          <div className="props-object">
            {selectedDiagram ? (
              <DiagramIcon code={selectedDiagram.kind} size={20} />
            ) : selected ? (
              <TypeIcon code={codeOf(selected.type)} size={20} />
            ) : (
              <span className="props-placeholder" aria-hidden="true">—</span>
            )}
            <span className="props-object-name">
              {selectedDiagram?.name ?? selected?.name ?? '未选择对象'}
            </span>
            <span className="props-object-kind">
              {selectedDiagram
                ? specs.find((s) => s.code === selectedDiagram.kind)?.label ?? '图'
                : selected
                  ? typeInfo.get(codeOf(selected.type))?.label ?? selected.type
                  : ''}
            </span>
          </div>
          {propsTab === 'attrs' ? (
            selectedDiagram ? (
              <>
                <div className="kv"><span>类型</span><code>图 · {specs.find((s) => s.code === selectedDiagram.kind)?.label ?? selectedDiagram.kind}</code></div>
                <label className="field">
                  <span>图名称</span>
                  <input
                    defaultValue={selectedDiagram.name}
                    key={selectedDiagram.id}
                    onBlur={(event) => handleRenameDiagram(selectedDiagram.id, event.target.value)}
                  />
                </label>
                <div className="kv"><span>所有者</span><code>{selectedDiagram.ownerId || projectRoot?.name || '模型根'}</code></div>
                <div className="kv"><span>元素数</span><code>{selectedDiagram.elementIds.length} 个</code></div>
                <div className="kv"><span>ID</span><code>{selectedDiagram.id}</code></div>
              </>
            ) : selected ? (
              <>
                <label className="field">
                  <span>名称</span>
                  <input
                    ref={renameRef}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                </label>
                <div className="kv"><span>ID</span><code>{selected.id}</code></div>
                <div className="kv"><span>类型</span><code>{selected.type}</code></div>
                <div className="kv"><span>构造型</span><code>{selected.stereotypes.join(', ') || '—'}</code></div>
                <div className="kv"><span>所有者</span><code>{selected.ownerId || projectRoot?.name || '模型根'}</code></div>
                <div className="kv"><span>子元素</span><code>{descendants(selected.id).length} 个后代</code></div>
                <button type="button" className="primary" onClick={handleRename} disabled={busy}>提交改名</button>
              </>
            ) : (
              <p className="hint">在左侧模型树或画布中选择一个元素或图</p>
            )
          ) : (
            <div className="tags-panel">
              {selected ? (
                <>
                  <div className="kv"><span>构造型</span><code>{selected.stereotypes.map((s) => `«${s}»`).join(' ') || '—'}</code></div>
                  <div className="kv"><span>语义族</span><code>{FAMILIES.find((f) => f.key === familyOfType(codeOf(selected.type)))?.label ?? '—'}</code></div>
                  <div className="kv"><span>文档</span><code>{selected.documentation || '—'}</code></div>
                  <div className="kv"><span>XMI ID</span><code>{selected.xmiId || '—'}</code></div>
                  {Object.entries(selected.taggedValues).map(([key, value]) => (
                    <div className="kv" key={key}><span>{key}</span><code>{value}</code></div>
                  ))}
                  {Object.keys(selected.taggedValues).length === 0 && <p className="hint">暂无标签值</p>}
                </>
              ) : (
                <p className="hint">选择一个模型元素以查看其构造型、文档与标签值</p>
              )}
            </div>
          )}
          <div className="panel-title">模型概要</div>
          <div className="kv"><span>版本 rev</span><code>{health?.revision ?? model.revision}</code></div>
          <div className="kv"><span>持久化</span><code>{health?.persistence ?? '—'}</code></div>
          <div className="kv"><span>元素 / 关系 / 图</span><code>{model.elements.length} / {model.relationships.length} / {model.diagrams.length}</code></div>
          <div className="validation">{message}</div>
        </aside>
        </div>

        {/* 模型树右侧的垂直组件工具箱：只展示当前图相关元素 + 关系组件（对齐参考截图） */}
        <aside className="toolbox" aria-label="组件工具箱（模型树右侧）">
          <div className="tb-tabs">
            <button
              type="button"
              className={toolboxTab === 'components' ? 'active' : ''}
              onClick={() => setToolboxTab('components')}
            >组件</button>
            <button
              type="button"
              className={toolboxTab === 'styles' ? 'active' : ''}
              onClick={() => setToolboxTab('styles')}
            >样式</button>
            <span className="tb-more" aria-hidden="true">⋮</span>
          </div>
          {toolboxTab === 'components' ? (
            <>
              <div className="tb-current">
                {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={15} />}
                <span className="tb-current-name">{activeSpec?.label ?? '未选择图'}</span>
                <select
                  className="tb-current-select"
                  value={activeDiagramKind}
                  onChange={(event) => setActiveByKind(event.target.value)}
                  title="切换当前图；组件内容随之联动"
                >
                  {specs.map((spec) => (
                    <option key={spec.code} value={spec.code}>{spec.label}</option>
                  ))}
                </select>
              </div>
              <div className="tb-scroll">
                {/* 元素：仅当前图允许的类型，按语义族分小节 */}
                <div className={`tb-group current ${openToolGroups.has('elements') ? 'open' : ''}`}>
                  <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('elements')}>
                    {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={16} />}
                    <span className="tb-group-label">元素 · {activeSpec?.label ?? '当前图'}</span>
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
                              draggable
                              disabled={busy}
                              onDragStart={(event) => event.dataTransfer.setData('text/scofen-type', type.code)}
                              onClick={() =>
                                void createElementFromPalette(
                                  type.code,
                                  canvas.width / 2 - nodeSize.width / 2,
                                  canvas.height / 2 - nodeSize.height / 2,
                                )
                              }
                              title={`«${type.stereotype}» ${type.label} · ${type.uml}｜点击或拖入画布`}
                            >
                              <TypeIcon code={type.code} size={16} />
                              <span className="tb-item-label">{type.label}</span>
                              <span className="tb-item-st">«{type.stereotype}»</span>
                            </button>
                          ))}
                        </div>
                      ))}
                      <p className="tb-tip">仅显示当前图允许的 {paletteEntries.length} 类元素 · 点击 / 拖入画布</p>
                    </div>
                  )}
                </div>

                {/* 关系：当前图规范允许的关系组件，点选后在画布依次点击起点与终点 */}
                <div className={`tb-group current ${openToolGroups.has('relations') ? 'open' : ''}`}>
                  <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('relations')}>
                    <RelationIcon code={relationEntries[0]?.code ?? 'trace'} size={16} />
                    <span className="tb-group-label">关系</span>
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
                              draggable
                              disabled={busy}
                              onDragStart={(event) => event.dataTransfer.setData('text/scofen-relation', rel.code)}
                              onClick={() => activateRelationTool(rel.code)}
                              title={`«${rel.stereotype}» ${rel.label}｜点选后在画布依次点击起点与终点`}
                            >
                              <RelationIcon code={rel.code} size={16} />
                              <span className="tb-item-label">{rel.label}</span>
                              <span className="tb-item-st">«{rel.stereotype}»</span>
                            </button>
                          ))}
                        </div>
                      ))}
                      {relationTool && (
                        <div className="tb-link-hint">
                          <span>连线中 · «{relationLabel(relationTool)}»</span>
                          <button
                            type="button"
                            onClick={() => {
                              setRelationTool(null)
                              setRelationSource(null)
                            }}
                          >退出</button>
                        </div>
                      )}
                      <button type="button" className="tb-item action" onClick={openRelationDialog}>
                        <span className="tb-action-glyph" aria-hidden="true">↔</span>
                        <span className="tb-item-label">关系向导（选两端）…</span>
                      </button>
                      <p className="tb-tip">按当前图规范过滤；选中关系后在画布点起点、再点终点即可连线</p>
                    </div>
                  )}
                </div>

                {/* 通用：与图无关的动作类工具 */}
                <div className={`tb-group ${openToolGroups.has('generic') ? 'open' : ''}`}>
                  <button type="button" className="tb-group-head" onClick={() => toggleToolGroup('generic')}>
                    <span className="tb-action-glyph" aria-hidden="true">◇</span>
                    <span className="tb-group-label">通用</span>
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
                        <span className="tb-item-label">新建元素…</span>
                      </button>
                      <button
                        type="button"
                        className="tb-item action"
                        disabled={busy}
                        onClick={() => openDiagramDialog(null)}
                      >
                        <span className="tb-action-glyph" aria-hidden="true">▧</span>
                        <span className="tb-item-label">新建图…</span>
                      </button>
                      <button type="button" className="tb-item action" onClick={openRelationDialog}>
                        <span className="tb-action-glyph" aria-hidden="true">↔</span>
                        <span className="tb-item-label">新建关系…</span>
                      </button>
                      <button
                        type="button"
                        className="tb-item action"
                        disabled={!selectedId || busy}
                        onClick={() => selectedId && void addToCurrentDiagram(selectedId)}
                      >
                        <span className="tb-action-glyph" aria-hidden="true">＋</span>
                        <span className="tb-item-label">把选中元素加入当前图</span>
                      </button>
                      <p className="tb-tip">新建元素 / 新建图 / 关系向导在此；元素与关系组件随当前图联动。</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="tb-scroll">
              <div className="panel-title">当前图</div>
              <div className="tb-style-head">
                {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={18} />}
                <span>{activeSpec?.label ?? '未选择图'}</span>
              </div>
              <div className="kv"><span>布局器</span><code>{activeSpec?.layout ?? '—'}</code></div>
              <div className="kv"><span>校验分组</span><code>{activeSpec?.validationGroup ?? '—'}</code></div>
              <div className="kv"><span>画布</span><code>{canvas.width}×{canvas.height}</code></div>
              <div className="kv"><span>节点</span><code>{nodeSize.width}×{nodeSize.height}</code></div>
              <div className="panel-title">语义族图例</div>
              {FAMILIES.map((family) => (
                <div className="tb-legend" key={family.key}>
                  <span className="legend-swatch" style={{ background: family.color }} />
                  <span>{family.label}</span>
                </div>
              ))}
              <p className="tb-tip">记法样式由服务端 Notation 对象保存；图形坐标经 WS Patch 广播给所有会话。</p>
            </div>
          )}
          <div className="tb-foot">
            <span>{activeSpec?.label ?? '—'}</span>
            <span>{paletteEntries.length} 元素 · {relationEntries.length} 关系</span>
          </div>
        </aside>

        <main className="canvas">
          <div className="diagram-toolbar">
            <div className="dt-head">
              <span className="dt-kind">
                {activeDiagramKind && <DiagramIcon code={activeDiagramKind} size={15} />}
                {activeSpec?.label ?? '未选择图'}
              </span>
              <span className="dt-name">{activeDiagramObj?.name ?? '—'}</span>
              <div className="dt-actions">
                {activeDiagramObj && (
                  <>
                    <button type="button" onClick={() => openDiagramDialog(activeDiagramObj.ownerId, activeDiagramObj)} disabled={busy}>重命名图</button>
                    <button type="button" onClick={openRelationDialog} disabled={busy}>新建关系</button>
                    <button type="button" onClick={exportSvg} disabled={!activeDiagramObj}>导出 SVG</button>
                  </>
                )}
              </div>
            </div>
            <div className="dt-sub">
              「组件」工具箱已按当前图过滤：<strong>{paletteEntries.length}</strong> 类元素 · <strong>{relationEntries.length}</strong> 类关系
              {relationTool && <span className="dt-linkflag"> · 连线中 «{relationLabel(relationTool)}»（Esc 退出）</span>}
            </div>
          </div>
          <svg
            ref={svgRef}
            className={relationTool ? 'linking' : undefined}
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            role="img"
            aria-label="模型画布，图形可拖拽；连线模式下依次点击起点与终点"
            onPointerDown={(event) => {
              // 连线模式下点击画布空白取消已选起点，点击节点由 handlePointerDown 处理。
              if (relationTool && event.target === event.currentTarget) {
                setRelationSource(null)
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
                当前图暂无元素
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
              return (
                /* 连线画在节点之上保证标签可读，但整体不接收指针事件，避免挡住连线模式下的节点点选。 */
                <g key={relation.id} pointerEvents="none">
                  <line
                    x1={sEdge.x}
                    y1={sEdge.y}
                    x2={tEdge.x}
                    y2={tEdge.y}
                    stroke={style.color}
                    strokeWidth={style.width}
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
                </g>
              )
            })}
          </svg>
          <p className="canvas-hint">拖拽图形可移动位置 · 关系以连线呈现（含类型箭头与标签）· 端口贴附所属块边框 · 坐标由服务端记法对象保存并广播给所有会话</p>
        </main>
      </div>

      <footer className="statusbar">
        <span>已同步至服务端 · rev {health?.revision ?? model.revision} · 在线会话 {health?.onlineSessions ?? 0} · Ctrl/⌘+Z 撤销 / Ctrl+Y 重做</span>
        {relationTool && (
          <span className="link-status">
            连线 «{relationLabel(relationTool)}» · {relationSource ? '点击终点元素' : '点击起点元素'} · Esc 退出
          </span>
        )}
        <span>{health?.status === 'UP' ? '● 在线' : '○ 未连接'} · {health?.persistence ?? '—'}</span>
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
            <span>{menuDiagram ? menuDiagram.name : menuElement ? menuElement.name : '模型根'}</span>
          </div>
          {menuTarget?.kind === 'element' && (
            <>
              <button type="button" onClick={() => openCreate(menuElement!.id)}>新建子元素…</button>
              <button type="button" onClick={() => openDiagramDialog(menuElement!.id)}>在此新建图…</button>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(menuElement!.id)
                  renameRef.current?.focus()
                  setMenu(null)
                }}
              >重命名</button>
              {!menuInDiagram && menuTypeAllowed && activeDiagramId && (
                <button type="button" onClick={() => void addToCurrentDiagram(menuElement!.id)}>加入当前图</button>
              )}
              {menuInDiagram && (
                <button type="button" onClick={() => locateInDiagram(menuElement!.id)}>在图中定位</button>
              )}
              {isProjectRoot(menuElement) ? (
                <button type="button" className="disabled-hint" disabled title="项目根节点模型不可删除">
                  项目根节点 · 不可删除
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
                >删除{menuChildCount > 0 ? `（含 ${menuChildCount} 个后代）` : ''}</button>
              )}
            </>
          )}
          {menuTarget?.kind === 'diagram' && (
            <>
              <button type="button" onClick={() => { setActiveDiagramId(menuDiagram!.id); setSelectedDiagramId(menuDiagram!.id); setMenu(null) }}>在图中定位</button>
              <button
                type="button"
                onClick={() => {
                  openDiagramDialog(menuDiagram!.ownerId, menuDiagram!)
                  setMenu(null)
                }}
              >重命名图</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const id = menuDiagram!.id
                  setMenu(null)
                  void submitDeleteDiagram(id)
                }}
              >删除图</button>
            </>
          )}
          {menuTarget?.kind === 'root' && (
            <>
              <button type="button" onClick={() => openCreate(null)}>在项目根下新建元素…</button>
              <button type="button" onClick={() => openDiagramDialog(null)}>在项目根下新建图…</button>
            </>
          )}
        </div>
      )}

      {newProjectDialog && (
        <div className="modal-overlay" onPointerDown={() => setNewProjectDialog(false)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code="MODEL" size={18} />
              新建项目
            </h2>
            <p className="modal-sub">在指定空间下创建并立即打开项目</p>
            <label className="field">
              <span>所属空间</span>
              <select value={newProjectSpace} onChange={(event) => setNewProjectSpace(event.target.value)}>
                {(workspace?.spaces ?? []).map((space) => (
                  <option key={space.code} value={space.code}>{space.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>项目名称</span>
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="例如：制动系统模型"
              />
            </label>
            <label className="field">
              <span>描述（可选）</span>
              <input
                value={newProjectDesc}
                onChange={(event) => setNewProjectDesc(event.target.value)}
                placeholder="一句话说明项目范围"
              />
            </label>
            <p className="hint">创建后会立即打开该项目并分配独立的内存态模型；服务重启后回到初始基线。</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setNewProjectDialog(false)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !newProjectName.trim()}
                onClick={() => void submitNewProject()}
              >创建</button>
            </div>
          </div>
        </div>
      )}

      {createDialog && (
        <div className="modal-overlay" onPointerDown={() => setCreateDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2 className="modal-title">
              <TypeIcon code={createType || 'PACKAGE'} size={18} />
              新建元素
            </h2>
            <p className="modal-sub">父节点：{createDialog.ownerName}</p>
            {createOptions.length === 0 ? (
              <p className="hint">按元模型规则，该父类型不允许再包含子元素。</p>
            ) : (
              <>
                <label className="field">
                  <span className="field-head">
                    <TypeIcon code={createType || 'PACKAGE'} size={15} />
                    元素类型（按规范过滤）
                  </span>
                  <select
                    value={createType}
                    onChange={(event) => {
                      const info = typeInfo.get(event.target.value)
                      setCreateType(event.target.value)
                      if (info) {
                        setCreateStereotype(info.stereotype)
                        setCreateName(`新建${info.label} ${model.elements.length + 1}`)
                      }
                    }}
                  >
                    {createOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        «{option.stereotype}» {option.label}（{option.uml}）
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>名称（同命名空间内唯一，不区分大小写）</span>
                  <input value={createName} onChange={(event) => setCreateName(event.target.value)} />
                </label>
                <label className="field">
                  <span>构造型</span>
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
                  同时加入当前图（{activeSpec?.label ?? '—'}）
                </label>
                {!canJoinDiagram && (
                  <p className="hint">
                    该元素类型不允许出现在当前图，服务端会拒绝；仅创建到模型树中。
                  </p>
                )}
              </>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setCreateDialog(null)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={busy || createOptions.length === 0 || !createName.trim()}
                onClick={() => void submitCreate()}
              >
                创建
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
              新建图
            </h2>
            <p className="modal-sub">所属：{diagramDialog.ownerName}</p>
            <label className="field">
              <span>图类型</span>
              <select
                value={diagramDialog.kind}
                onChange={(event) => setDiagramDialog({ ...diagramDialog, kind: event.target.value })}
              >
                {specs.map((option) => (
                  <option key={option.code} value={option.code}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>图名称</span>
              <input
                value={diagramDialog.name}
                onChange={(event) => setDiagramDialog({ ...diagramDialog, name: event.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setDiagramDialog(null)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !diagramDialog.name.trim()}
                onClick={() => void submitDiagram()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {relationDialog && (
        <div className="modal-overlay" onPointerDown={() => setRelationDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2>新建关系</h2>
            <p className="modal-sub">
              在「{activeSpec?.label ?? '当前图'}」中建立语义关系 · 类型按当前图规范过滤
            </p>
            <label className="field">
              <span>源元素</span>
              <select
                value={relationDialog.sourceId}
                onChange={(event) => setRelationDialog({ ...relationDialog, sourceId: event.target.value })}
              >
                <option value="">— 选择源 —</option>
                {model.elements.map((element) => (
                  <option key={element.id} value={element.id}>{element.name}（{element.type}）</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>目标元素</span>
              <select
                value={relationDialog.targetId}
                onChange={(event) => setRelationDialog({ ...relationDialog, targetId: event.target.value })}
              >
                <option value="">— 选择目标 —</option>
                {model.elements.map((element) => (
                  <option key={element.id} value={element.id}>{element.name}（{element.type}）</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>关系类型</span>
              <select
                value={relationDialog.type}
                onChange={(event) => setRelationDialog({ ...relationDialog, type: event.target.value })}
              >
                {(relationEntries.length > 0 ? relationEntries : allRelations).map((rel) => (
                  <option key={rel.code} value={rel.code}>{rel.label}（«{rel.code}»）</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setRelationDialog(null)}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !relationDialog.sourceId || !relationDialog.targetId}
                onClick={() => void submitRelation()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div className="modal-overlay" onPointerDown={() => setDeleteDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2>删除元素</h2>
            <p className="modal-sub">
              确认删除「{deleteDialog.name}」？
              {deleteDialog.count > 0 && ` 将级联删除 ${deleteDialog.count} 个后代元素、相关关系与图形记法。`}
            </p>
            <p className="hint">服务端以单条原子命令完成，所有在线会话同步；可用「撤销」恢复整棵子树。</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDeleteDialog(null)}>取消</button>
              <button type="button" className="primary danger" disabled={busy} onClick={() => void submitDelete()}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
