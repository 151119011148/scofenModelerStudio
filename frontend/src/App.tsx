import { useCallback, useEffect, useMemo, useState } from 'react'
import { getDiagrams, getHealth, getModel, postCommand, undo } from './api'
import type { DiagramSpec, Health, ModelSnapshot } from './types'

const EMPTY_MODEL: ModelSnapshot = {
  revision: 0,
  elements: [],
  relationships: [],
  diagrams: [],
  notations: [],
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [model, setModel] = useState<ModelSnapshot>(EMPTY_MODEL)
  const [specs, setSpecs] = useState<DiagramSpec[]>([])
  const [activeDiagram, setActiveDiagram] = useState('bdd')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [message, setMessage] = useState('正在连接服务端…')
  const [busy, setBusy] = useState(false)

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

  const positions = useMemo(
    () =>
      visibleElements.map((element, index) => ({
        element,
        x: 36 + (index % 3) * 196,
        y: 36 + Math.floor(index / 3) * 128,
      })),
    [visibleElements],
  )

  const positionById = useMemo(
    () => new Map(positions.map((item) => [item.element.id, item])),
    [positions],
  )

  const runCommand = async (type: string, payload: Record<string, unknown>) => {
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
    } catch (error) {
      setMessage(`操作失败：${errorMessage(error)}`)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleRename = () => {
    if (!selected || !draftName.trim()) {
      return
    }
    void runCommand('RENAME_ELEMENT', { id: selected.id, name: draftName.trim() })
  }

  const handleCreate = () => {
    const id = `e-${Date.now()}`
    void runCommand('CREATE_ELEMENT', {
      id,
      type: 'Block',
      name: `新建模块 ${model.elements.length + 1}`,
      ownerId: selected?.ownerId ?? '',
    })
    setSelectedId(id)
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
          <span className="pill">XMI 2.5.1</span>
          <button type="button" onClick={handleCreate} disabled={busy}>新建元素</button>
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
        <aside className="tree">
          <div className="panel-title">模型浏览器</div>
          <div className="tree-row root">车载动力系统</div>
          {model.elements.map((element) => (
            <button
              key={element.id}
              type="button"
              className={`tree-row ${selectedId === element.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(element.id)}
            >
              <span className="dot" />{element.name}
            </button>
          ))}
          <div className="panel-title">关系</div>
          {model.relationships.map((relation) => (
            <div className="tree-row muted" key={relation.id}>
              «{relation.type}» {relation.sourceId} → {relation.targetId}
            </div>
          ))}
        </aside>

        <main className="canvas">
          <svg viewBox="0 0 640 420" role="img" aria-label="模型画布">
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
                  x1={from.x + 156}
                  y1={from.y + 34}
                  x2={to.x}
                  y2={to.y + 34}
                  stroke="#8a95a3"
                  strokeWidth="1.2"
                  markerEnd="url(#arrow)"
                />
              )
            })}
            {positions.map(({ element, x, y }) => (
              <g key={element.id} onClick={() => setSelectedId(element.id)} className="node">
                <rect
                  x={x}
                  y={y}
                  width="156"
                  height="68"
                  rx="8"
                  fill={selectedId === element.id ? '#e9f0fc' : '#ffffff'}
                  stroke={selectedId === element.id ? '#2b5cb8' : '#cbd3dd'}
                  strokeWidth={selectedId === element.id ? 2 : 1}
                />
                <text x={x + 12} y={y + 24} className="node-type">«{element.type}»</text>
                <text x={x + 12} y={y + 46} className="node-name">{element.name}</text>
              </g>
            ))}
            {positions.length === 0 && (
              <text x="320" y="200" textAnchor="middle" className="empty">当前图暂无元素</text>
            )}
          </svg>
        </main>

        <aside className="panel">
          <div className="panel-title">属性</div>
          {selected ? (
            <>
              <label className="field">
                <span>名称</span>
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
              </label>
              <div className="kv"><span>ID</span><code>{selected.id}</code></div>
              <div className="kv"><span>类型</span><code>{selected.type}</code></div>
              <div className="kv"><span>所有者</span><code>{selected.ownerId || '—'}</code></div>
              <button type="button" className="primary" onClick={handleRename} disabled={busy}>提交改名</button>
            </>
          ) : (
            <p className="hint">在左侧或画布中选择一个元素</p>
          )}
          <div className="panel-title">一致性校验</div>
          <div className="validation">{message}</div>
          <p className="hint">改名后所有引用该 id 的图与在线会话会同步更新——模型是唯一事实源，图只是视图。</p>
        </aside>
      </div>

      <footer className="statusbar">
        <span>已同步至服务端 · rev {health?.revision ?? model.revision} · 在线会话 {health?.onlineSessions ?? 0}</span>
        <span>{health?.status === 'UP' ? '● 在线' : '○ 未连接'} · {health?.persistence ?? '—'}</span>
      </footer>
    </div>
  )
}
