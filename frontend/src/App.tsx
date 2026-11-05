import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { getContainment, getDiagrams, getHealth, getModel, postCommand, redo, undo } from './api'
import type {
  ContainmentSpec,
  Diagram,
  DiagramSpec,
  ElementTypeInfo,
  Health,
  ModelElement,
  ModelSnapshot,
} from './types'
import { arrowGeometry, edgePoint, relationshipStyle, shapeOf } from './notation'

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

const RELATION_TYPES = [
  'satisfy',
  'verify',
  'allocate',
  'generalization',
  'dependency',
  'trace',
  'refine',
  'include',
]

export default function App() {
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

  const svgRef = useRef<SVGSVGElement | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextHealth, nextModel] = await Promise.all([getHealth(), getModel()])
      setHealth(nextHealth)
      setModel(nextModel)
      setMessage((current) => (current === '正在连接服务端…' ? '已同步至服务端' : current))
    } catch (error) {
      setMessage(`连接失败：${errorMessage(error)}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
    getDiagrams()
      .then(setSpecs)
      .catch((error: unknown) => setMessage(`图规格加载失败：${errorMessage(error)}`))
    getContainment()
      .then(setContainment)
      .catch((error: unknown) => setMessage(`元模型规则加载失败：${errorMessage(error)}`))
  }, [refresh])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${protocol}//${window.location.host}${import.meta.env.BASE_URL}ws/patches`,
    )
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
  }, [refresh])

  useEffect(() => {
    if (!menu) {
      return
    }
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

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
        baseRevision: model.revision,
        clientCmdId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
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

  const openCreate = (ownerId: string | null) => {
    const owner = ownerId
      ? model.elements.find((element) => element.id === ownerId)?.name ?? ownerId
      : '模型根'
    setCreateDialog({ ownerId, ownerName: owner })
    setCreateType('')
    setCreateName('')
    setCreateStereotype('')
    setJoinDiagram(true)
    setMenu(null)
  }

  const openDiagramDialog = (ownerId: string | null, edit?: Diagram) => {
    const owner = ownerId
      ? model.elements.find((element) => element.id === ownerId)?.name ?? ownerId
      : '模型根'
    setDiagramDialog({
      ownerId,
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

  const handleUndo = async () => {
    setBusy(true)
    try {
      const patch = await undo()
      setMessage(`已撤销至 rev ${patch.revision}`)
      await refresh()
    } catch (error) {
      setMessage(`撤销失败：${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleRedo = async () => {
    setBusy(true)
    try {
      const patch = await redo()
      setMessage(`已重做至 rev ${patch.revision}`)
      await refresh()
    } catch (error) {
      setMessage(`重做失败：${errorMessage(error)}`)
    } finally {
      setBusy(false)
    }
  }

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

  // 每张图允许放置的元素类型（来自后端元模型注册表），作为图工具箱的“可拖放元素”清单。
  const paletteEntries = useMemo<ElementTypeInfo[]>(() => {
    if (!activeSpec) {
      return []
    }
    return (activeSpec.allowedTypes ?? [])
      .map((code) => typeInfo.get(code))
      .filter((item): item is ElementTypeInfo => item !== undefined)
  }, [activeSpec, typeInfo])

  // 从工具箱创建元素：owner 取当前图的语义宿主（块/交互/活动等），并加入当前图，
  // 再移动到放置坐标。符合 SysML 规范——元素挂在模型元素下，图只引用承载它。
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
    }
    const ok = await runCommand('CREATE_ELEMENT', payload)
    if (ok) {
      setSelectedId(id)
      await runCommand('MOVE_NOTATION', {
        diagramId: activeDiagramId,
        elementId: id,
        x: Math.round(clamp(x, 0, canvas.maxX)),
        y: Math.round(clamp(y, 0, canvas.maxY)),
      })
    }
  }

  const handleCanvasDrop = (event: ReactDragEvent<SVGSVGElement>) => {
    event.preventDefault()
    const code = event.dataTransfer.getData('text/scofen-type')
    if (!code) {
      return
    }
    const point = toSvgPoint(event.clientX, event.clientY)
    void createElementFromPalette(code, point.x, point.y)
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
    const isSelected = isElement ? selectedId === element!.id : selectedDiagramId === diagram!.id
    return (
      <div key={`${node.type}:${node.ref.id}`}>
        <div
          className={`tree-row ${node.type}${isSelected ? ' selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 15 }}
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
              <span className="type-badge">{info?.label ?? element!.type}</span>
              <span className="tree-label">{element!.name}</span>
            </>
          ) : (
            <>
              <span className="type-badge diagram-badge">图</span>
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
    const isPort = shape === 'port'
    const bw = isPort ? 26 : w
    const bh = isPort ? 26 : h
    const bx = isPort ? x + w / 2 - 13 : x
    const by = isPort ? y + h / 2 - 13 : y
    const children = (childrenByOwner.get(element.id) ?? []).map((child) => child.name)
    const fill = selected ? '#e9f0fc' : '#ffffff'
    const stroke = selected ? '#2b5cb8' : '#cbd3dd'
    const strokeW = selected ? 2 : 1
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
      <g className={`node ${drag?.elementId === element.id && drag.moved ? 'dragging' : ''}`} onPointerDown={onDown}>
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
        <div className="top-actions">
          <span className="pill">SysML 1.6 · 九图</span>
          <span className="pill">模型树 · 规范校验</span>
          <button type="button" onClick={() => openCreate(null)} disabled={busy}>新建根元素</button>
          <button type="button" onClick={() => openDiagramDialog(null)} disabled={busy}>新建图</button>
          <button type="button" onClick={() => void handleUndo()} disabled={busy || (health?.undoDepth ?? 0) === 0}>撤销</button>
          <button type="button" onClick={() => void handleRedo()} disabled={busy || (health?.redoDepth ?? 0) === 0}>重做</button>
        </div>
      </header>

      <nav className="tabs" aria-label="图类型">
        {specs.map((spec) => (
          <button
            key={spec.code}
            type="button"
            className={activeDiagramKind === spec.code ? 'active' : ''}
            onClick={() => setActiveByKind(spec.code)}
            title={`${spec.label} · ${spec.layout}`}
          >
            {spec.label}
          </button>
        ))}
      </nav>

      <div className="workspace">
        <aside className="tree">
          <div className="panel-title">模型浏览器 · 右键操作</div>
          <div className="browser">
            {rootNodes.map((node) => renderTreeNode(node, 0))}
            {rootNodes.length === 0 && <p className="hint">暂无元素，右键空白处新建根元素</p>}
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

        <aside className="props-dock" aria-label="属性窗口（常驻）">
          <div className="panel-title">属性</div>
          {selectedDiagram ? (
            <>
              <div className="kv"><span>类型</span><code>图 · {activeSpec?.label ?? selectedDiagram.kind}</code></div>
              <label className="field">
                <span>图名称</span>
                <input
                  defaultValue={selectedDiagram.name}
                  key={selectedDiagram.id}
                  onBlur={(event) => handleRenameDiagram(selectedDiagram.id, event.target.value)}
                />
              </label>
              <div className="kv"><span>所有者</span><code>{selectedDiagram.ownerId || '模型根'}</code></div>
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
              <div className="kv"><span>所有者</span><code>{selected.ownerId || '模型根'}</code></div>
              <div className="kv"><span>子元素</span><code>{descendants(selected.id).length} 个后代</code></div>
              <button type="button" className="primary" onClick={handleRename} disabled={busy}>提交改名</button>
            </>
          ) : (
            <p className="hint">在左侧模型树或画布中选择一个元素或图</p>
          )}
          <div className="panel-title">模型概要</div>
          <div className="kv"><span>版本 rev</span><code>{health?.revision ?? model.revision}</code></div>
          <div className="kv"><span>持久化</span><code>{health?.persistence ?? '—'}</code></div>
          <div className="kv"><span>元素 / 关系 / 图</span><code>{model.elements.length} / {model.relationships.length} / {model.diagrams.length}</code></div>
          <div className="validation">{message}</div>
        </aside>

        <main className="canvas">
          <div className="diagram-toolbar">
            <div className="dt-head">
              <span className="dt-kind">{activeSpec?.label ?? '未选择图'}</span>
              <span className="dt-name">{activeDiagramObj?.name ?? '—'}</span>
              <div className="dt-actions">
                {activeDiagramObj && (
                  <>
                    <button type="button" onClick={() => openDiagramDialog(activeDiagramObj.ownerId, activeDiagramObj)} disabled={busy}>重命名图</button>
                    <button type="button" onClick={() => setRelationDialog({ sourceId: selectedId ?? '', targetId: '', type: RELATION_TYPES[0] })} disabled={busy}>新建关系</button>
                    <button type="button" onClick={exportSvg} disabled={!activeDiagramObj}>导出 SVG</button>
                  </>
                )}
              </div>
            </div>
            {paletteEntries.length > 0 && (
              <div className="dt-palette" onDragOver={(event) => event.preventDefault()}>
                <span className="dt-palette-label">本图可放置</span>
                {paletteEntries.map((type) => (
                  <button
                    key={type.code}
                    type="button"
                    className="palette-chip"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/scofen-type', type.code)}
                    onClick={() =>
                      void createElementFromPalette(
                        type.code,
                        canvas.width / 2 - nodeSize.width / 2,
                        canvas.height / 2 - nodeSize.height / 2,
                      )
                    }
                    disabled={busy}
                    title={`点击或拖拽到画布以新建「${type.label}」（${type.stereotype}）`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            role="img"
            aria-label="模型画布，图形可拖拽"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDragOver={(event) => event.preventDefault()}
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
              />
            ))}
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
                <g key={relation.id}>
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
            {positions.map(({ element, x, y, w, h }) => renderNode(element, x, y, w, h))}
            {positions.length === 0 && (
              <text x={canvas.width / 2} y={canvas.height / 2} textAnchor="middle" className="empty">
                当前图暂无元素
              </text>
            )}
          </svg>
          <p className="canvas-hint">拖拽图形可移动位置 · 关系以连线呈现（含类型箭头与标签）· 端口贴附所属块边框 · 坐标由服务端记法对象保存并广播给所有会话</p>
        </main>
      </div>

      <footer className="statusbar">
        <span>已同步至服务端 · rev {health?.revision ?? model.revision} · 在线会话 {health?.onlineSessions ?? 0}</span>
        <span>{health?.status === 'UP' ? '● 在线' : '○ 未连接'} · {health?.persistence ?? '—'}</span>
      </footer>

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="menu-title">
            {menuDiagram ? menuDiagram.name : menuElement ? menuElement.name : '模型根'}
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
              <button type="button" onClick={() => openCreate(null)}>新建根元素…</button>
              <button type="button" onClick={() => openDiagramDialog(null)}>新建图…</button>
            </>
          )}
        </div>
      )}

      {createDialog && (
        <div className="modal-overlay" onPointerDown={() => setCreateDialog(null)}>
          <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
            <h2>新建元素</h2>
            <p className="modal-sub">父节点：{createDialog.ownerName}</p>
            {createOptions.length === 0 ? (
              <p className="hint">按元模型规则，该父类型不允许再包含子元素。</p>
            ) : (
              <>
                <label className="field">
                  <span>元素类型（按规范过滤）</span>
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
            <h2>新建图</h2>
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
            <p className="modal-sub">在当前图中建立两个元素之间的语义关系</p>
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
                {RELATION_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
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
