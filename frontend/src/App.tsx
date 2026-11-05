import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { getContainment, getDiagrams, getHealth, getModel, postCommand, undo } from './api'
import type {
  ContainmentSpec,
  DiagramSpec,
  ElementTypeInfo,
  Health,
  ModelElement,
  ModelSnapshot,
} from './types'

const EMPTY_MODEL: ModelSnapshot = {
  revision: 0,
  elements: [],
  relationships: [],
  diagrams: [],
  notations: [],
}

const FALLBACK_CANVAS = { maxX: 480, maxY: 340, width: 640, height: 420 }
const FALLBACK_NODE = { width: 156, height: 68 }
const ROOT_KEY = '__root__'

interface ContextMenuState {
  x: number
  y: number
  elementId: string | null
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

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [model, setModel] = useState<ModelSnapshot>(EMPTY_MODEL)
  const [specs, setSpecs] = useState<DiagramSpec[]>([])
  const [containment, setContainment] = useState<ContainmentSpec | null>(null)
  const [activeDiagram, setActiveDiagram] = useState('bdd')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [message, setMessage] = useState('正在连接服务端…')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null)
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
  const activeSpec = useMemo(
    () => specs.find((spec) => spec.code === activeDiagram) ?? null,
    [specs, activeDiagram],
  )
  const activeDiagramId = useMemo(
    () => model.diagrams.find((item) => item.kind === activeDiagram)?.id ?? '',
    [model.diagrams, activeDiagram],
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

  const rootElements = useMemo(() => {
    const ids = new Set(model.elements.map((element) => element.id))
    const orphans = model.elements.filter(
      (element) => element.ownerId && !ids.has(element.ownerId),
    )
    return [...(childrenByOwner.get(ROOT_KEY) ?? []), ...orphans]
  }, [childrenByOwner, model.elements])

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

  useEffect(() => {
    setDraftName(selected?.name ?? '')
  }, [selected?.id, selected?.name])

  const visibleElements = useMemo(() => {
    const diagram = model.diagrams.find((item) => item.kind === activeDiagram)
    if (!diagram) {
      return model.elements
    }
    const ids = new Set(diagram.elementIds)
    return model.elements.filter((element) => ids.has(element.id))
  }, [model.elements, model.diagrams, activeDiagram])

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

  const openMenu = (event: ReactMouseEvent, elementId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.min(event.clientY, window.innerHeight - 280),
      elementId,
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

  const handleRename = () => {
    if (!selected || !draftName.trim()) {
      return
    }
    void runCommand('RENAME_ELEMENT', { id: selected.id, name: draftName.trim() })
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
      setActiveDiagram(diagram.kind)
      setSelectedId(elementId)
      setMessage(`已定位到「${diagram.name}」`)
    } else {
      setMessage('该元素尚未加入任何图，可用右键「加入当前图」')
    }
    setMenu(null)
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

  const renderTreeNode = (element: ModelElement, depth: number): ReactNode => {
    const children = childrenByOwner.get(element.id) ?? []
    const isOpen = expanded.has(element.id)
    const info = typeInfo.get(codeOf(element.type))
    return (
      <div key={element.id}>
        <div
          className={`tree-row ${selectedId === element.id ? 'selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 15 }}
          onClick={() => setSelectedId(element.id)}
          onContextMenu={(event) => openMenu(event, element.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              setSelectedId(element.id)
            }
          }}
        >
          <button
            type="button"
            className={`twisty ${children.length === 0 ? 'leaf' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              if (children.length > 0) {
                toggleExpanded(element.id)
              }
            }}
            aria-label={isOpen ? '折叠' : '展开'}
          >
            {children.length > 0 ? (isOpen ? '▾' : '▸') : '·'}
          </button>
          <span className="type-badge">{info?.label ?? element.type}</span>
          <span className="tree-label">{element.name}</span>
          {children.length > 0 && <span className="child-count">{children.length}</span>}
        </div>
        {isOpen && children.map((child) => renderTreeNode(child, depth + 1))}
      </div>
    )
  }

  const menuElement = menu?.elementId
    ? model.elements.find((element) => element.id === menu.elementId) ?? null
    : null
  const menuChildCount = menuElement ? descendants(menuElement.id).length : 0
  const menuInDiagram = menuElement
    ? model.diagrams.some((diagram) => diagram.elementIds.includes(menuElement.id))
    : false
  const menuTypeAllowed = menuElement
    ? (activeSpec?.allowedTypes.includes(codeOf(menuElement.type)) ?? false)
    : false

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
          <button type="button" onClick={() => void handleUndo()} disabled={busy}>撤销</button>
        </div>
      </header>

      <nav className="tabs" aria-label="图类型">
        {specs.map((spec) => (
          <button
            key={spec.code}
            type="button"
            className={activeDiagram === spec.code ? 'active' : ''}
            onClick={() => setActiveDiagram(spec.code)}
            title={`${spec.label} · ${spec.layout}`}
          >
            {spec.label}
          </button>
        ))}
      </nav>

      <div className="workspace">
        <aside
          className="tree"
          onContextMenu={(event) => {
            const target = event.target as HTMLElement
            if (!target.closest('.tree-row')) {
              openMenu(event, null)
            }
          }}
        >
          <div className="panel-title">模型浏览器 · 右键操作</div>
          {rootElements.map((element) => renderTreeNode(element, 0))}
          {rootElements.length === 0 && <p className="hint">暂无元素，右键此处新建根元素</p>}
          <div className="panel-title">关系</div>
          {model.relationships.map((relation) => (
            <div className="tree-row muted" key={relation.id}>
              «{relation.type}» {relation.sourceId} → {relation.targetId}
            </div>
          ))}
          {model.relationships.length === 0 && <p className="hint">暂无关系</p>}
        </aside>

        <main className="canvas">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            role="img"
            aria-label="模型画布，图形可拖拽"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M2 1L8 5L2 9" fill="none" stroke="#8a95a3" strokeWidth="1.5" />
              </marker>
            </defs>
            {model.relationships.map((relation) => {
              const from = positionById.get(relation.sourceId)
              const to = positionById.get(relation.targetId)
              if (!from || !to) {
                return null
              }
              return (
                <line
                  key={relation.id}
                  x1={from.x + from.w}
                  y1={from.y + from.h / 2}
                  x2={to.x}
                  y2={to.y + to.h / 2}
                  stroke="#8a95a3"
                  strokeWidth="1.2"
                  markerEnd="url(#arrow)"
                />
              )
            })}
            {positions.map(({ element, x, y, w, h }) => (
              <g
                key={element.id}
                className={`node ${drag?.elementId === element.id && drag.moved ? 'dragging' : ''}`}
                onPointerDown={(event) => handlePointerDown(event, element, x, y)}
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx="8"
                  fill={selectedId === element.id ? '#e9f0fc' : '#ffffff'}
                  stroke={selectedId === element.id ? '#2b5cb8' : '#cbd3dd'}
                  strokeWidth={selectedId === element.id ? 2 : 1}
                />
                <text x={x + 12} y={y + 24} className="node-type">
                  «{typeInfo.get(codeOf(element.type))?.uml ?? element.type}»
                </text>
                <text x={x + 12} y={y + 46} className="node-name">{element.name}</text>
              </g>
            ))}
            {positions.length === 0 && (
              <text x={canvas.width / 2} y={canvas.height / 2} textAnchor="middle" className="empty">
                当前图暂无元素
              </text>
            )}
          </svg>
          <p className="canvas-hint">拖拽图形可移动位置 · 坐标由服务端记法对象保存并广播给所有会话</p>
        </main>

        <aside className="panel">
          <div className="panel-title">属性</div>
          {selected ? (
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
            <p className="hint">在左侧模型树或画布中选择一个元素</p>
          )}
          <div className="panel-title">一致性校验</div>
          <div className="validation">{message}</div>
          <p className="hint">
            右键模型树可新增 / 删除元素；服务端按 SysML 1.6 所有权规则、命名唯一性与图的类型约束校验。
            删除父节点会级联删除整棵子树，可用「撤销」恢复。
          </p>
        </aside>
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
          <div className="menu-title">{menuElement ? menuElement.name : '模型根'}</div>
          <button type="button" onClick={() => openCreate(menu.elementId)}>
            新建子元素…
          </button>
          {menuElement && (
            <button
              type="button"
              onClick={() => {
                setSelectedId(menuElement.id)
                renameRef.current?.focus()
                setMenu(null)
              }}
            >
              重命名
            </button>
          )}
          {menuElement && !menuInDiagram && menuTypeAllowed && activeDiagramId && (
            <button type="button" onClick={() => void addToCurrentDiagram(menuElement.id)}>
              加入当前图
            </button>
          )}
          {menuElement && menuInDiagram && (
            <button type="button" onClick={() => locateInDiagram(menuElement.id)}>
              在图中定位
            </button>
          )}
          {menuElement && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                setDeleteDialog({
                  elementId: menuElement.id,
                  name: menuElement.name,
                  count: menuChildCount,
                })
                setMenu(null)
              }}
            >
              删除{menuChildCount > 0 ? `（含 ${menuChildCount} 个后代）` : ''}
            </button>
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
