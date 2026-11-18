/**
 * 本地沙箱灌数：把一份模型快照里挑几张图（含父链）在本地 jar 里重建，
 * 让 auto-layout-e2e.mjs 在真实 UI 上跑线上同款数据，不碰线上项目。
 *
 * 快照来自 `GET /api/model`（线上项目导出后存成 JSON），默认落在 /tmp/mbse/mdesign_payload_final.json。
 *
 * 用法（口令与端口都从环境变量走，脚本里不留明文）：
 *   APP_URL=http://127.0.0.1:18095/ SCOFEN_PASSWORD='<临时口令>' \
 *     node local-seed.mjs '需求图-D1,用例图-D7,活动图-注册验证'
 * 末行打印 `PROJECT_ID=`，e2e 脚本按项目名「自动排布实测」自行查找，不需要传。
 */
import { readFileSync } from 'node:fs'

const APP = (process.env.APP_URL ?? 'http://127.0.0.1:18095/').replace(/\/$/, '') + '/'
const PASSWORD = process.env.SCOFEN_PASSWORD ?? ''
const SNAPSHOT = process.env.SCOFEN_SNAPSHOT ?? '/tmp/mbse/mdesign_payload_final.json'
const PROJECT_NAME = process.env.SCOFEN_PROJECT_NAME ?? '自动排布实测'
const FILTER = (process.argv[2] ?? '需求图-D1,用例图-D7,活动图-注册验证').split(',').filter(Boolean)

const payload = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const elementsById = new Map(payload.elements.map((e) => [e.id, e]))
const wanted = payload.diagrams.filter((d) => FILTER.some((key) => d.name.includes(key)))
if (wanted.length === 0) throw new Error('没匹配到图：' + FILTER.join(','))

// 需要的元素 = 图上的元素 + 各自父链 + 图自己的宿主链
const keep = new Set()
const chain = (id) => {
  let cursor = id
  const guard = new Set()
  while (cursor && elementsById.has(cursor) && !guard.has(cursor)) {
    guard.add(cursor)
    if (keep.has(cursor)) break
    cursor = elementsById.get(cursor).ownerId
  }
  cursor = id
  while (cursor && elementsById.has(cursor)) {
    keep.add(cursor)
    cursor = elementsById.get(cursor).ownerId
  }
}
for (const diagram of wanted) {
  for (const id of diagram.elementIds) chain(id)
  if (diagram.ownerId) chain(diagram.ownerId)
}

function depthOf(id) {
  let depth = 0
  let cursor = elementsById.get(id).ownerId
  while (cursor && elementsById.has(cursor) && cursor !== id) {
    depth += 1
    cursor = elementsById.get(cursor).ownerId
  }
  return depth
}
const elements = [...keep]
  .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))
  .map((id) => elementsById.get(id))
  // model-root 由服务端自动建，不能重复创建
  .filter((element) => element.id !== 'model-root')
const relationships = payload.relationships.filter((r) => keep.has(r.sourceId) && keep.has(r.targetId))
const notations = payload.notations.filter((n) => wanted.some((d) => d.id === n.diagramId))

const headers = { 'Content-Type': 'application/json', 'X-Scofen-Session': 'web-ui' }
async function api(path, init = {}) {
  const response = await fetch(APP + path, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${path} → HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`)
  }
  return body
}

const session = await api('api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'scofen', password: PASSWORD }),
})
const auth = { Authorization: `Bearer ${session.token}` }
const directory = await api('api/workspaces', { headers: auth })
const spaces = directory.spaces ?? directory
const space = spaces.find((item) => item.kind === 'personal') ?? spaces[0]
const project = await api('api/workspaces/projects', {
  method: 'POST',
  headers: { ...auth, 'X-Scofen-Project': space.code },
  body: JSON.stringify({
    spaceCode: space.code, name: PROJECT_NAME,
    description: '本地沙箱：验证自动排布与适应窗口',
  }),
})
const scoped = { ...auth, 'X-Scofen-Project': project.id }
console.log('项目', project.id, '· 元素', elements.length, '· 关系', relationships.length,
  '· 图', wanted.length, '· 记法', notations.length)

let revision = 0
async function cmd(type, commandPayload) {
  const patch = await api('api/commands', {
    method: 'POST',
    headers: scoped,
    body: JSON.stringify({ type, payload: commandPayload, baseRevision: revision, clientCmdId: `${type}-${revision}` }),
  })
  revision = patch.revision
  return patch
}

const root = await api('api/model', { headers: scoped })
const rootId = (root.elements ?? []).find((e) => !e.ownerId)?.id ?? 'model-root'
console.log('服务端根元素', rootId, 'rev', root.revision)
revision = root.revision

// 快照里的父链顶到 model-root，本地换成真实根 id
const mapOwner = (id) => (!id || id === 'model-root' ? rootId : id)
const created = new Set([rootId])
for (const element of elements) {
  if (created.has(element.id)) continue
  await cmd('CREATE_ELEMENT', {
    id: element.id,
    type: element.type,
    name: element.name,
    ownerId: mapOwner(element.ownerId),
    documentation: element.documentation ?? '',
  })
  created.add(element.id)
}
for (const diagram of wanted) {
  await cmd('CREATE_DIAGRAM', {
    id: diagram.id, kind: diagram.kind, name: diagram.name,
    ownerId: mapOwner(diagram.ownerId),
    elementIds: diagram.elementIds.filter((id) => created.has(id)),
  })
}
for (const relation of relationships) {
  if (!created.has(relation.sourceId) || !created.has(relation.targetId)) continue
  await cmd('CREATE_RELATIONSHIP', {
    id: relation.id, type: relation.type, sourceId: relation.sourceId, targetId: relation.targetId,
    name: relation.name ?? '', documentation: relation.documentation ?? '',
    ownerId: relation.ownerId && created.has(relation.ownerId) ? relation.ownerId : undefined,
  })
}
// 用快照原坐标铺一遍「排布前」的图面：这样 UI 上看到的就是线上现在的样子。
// 快照可能带重复记法（同一图同一元素多条），SET_NOTATIONS 整批拒绝重复，先按后者去重。
const seenNotation = new Set()
const items = notations
  .filter((n) => created.has(n.elementId) && wanted.some((d) => d.id === n.diagramId))
  .filter((n) => {
    const key = `${n.diagramId}|${n.elementId}`
    if (seenNotation.has(key)) return false
    seenNotation.add(key)
    return true
  })
  .map((n) => ({ diagramId: n.diagramId, elementId: n.elementId, x: n.x, y: n.y }))
for (let index = 0; index < items.length; index += 1000) {
  await cmd('SET_NOTATIONS', { items: items.slice(index, index + 1000) })
}
// ── 语义排布场景（不依赖快照，本地造）：验证 satisfy 需求置顶与泛化父在上 ──
// 故意把初始坐标摆成成对重叠，让「排布后零重叠」也有活干。
// 结构图只放 3 个节点：父块 A 与同层参照 C1 是一层、子块 B 是下一层——
// 层内超过 2 个节点会被「拆段」打散主轴对齐，断言就不成立了。
const sem = {
  reqR: 'sem-req-r', reqR2: 'sem-req-r2', impl: 'sem-impl-b', parent: 'sem-parent-a',
  peer: 'sem-peer-c1',
}
for (const [id, type, name, ownerId] of [
  [sem.reqR, 'Requirement', '语义需求R', rootId],
  [sem.reqR2, 'Requirement', '语义需求R2', rootId],
  [sem.impl, 'Block', '语义实现块B', rootId],
  [sem.parent, 'Block', '语义父块A', rootId],
  [sem.peer, 'Block', '语义同层块C1', rootId],
]) {
  if (!created.has(id)) {
    await cmd('CREATE_ELEMENT', { id, type, name, ownerId, documentation: '' })
    created.add(id)
  }
}
// UML 方向：satisfy 从实现指向需求；generalization 从子指向父。
await cmd('CREATE_RELATIONSHIP', {
  id: 'sem-rel-satisfy', type: 'satisfy', sourceId: sem.impl, targetId: sem.reqR,
  name: '', documentation: '', ownerId: rootId,
})
await cmd('CREATE_RELATIONSHIP', {
  id: 'sem-rel-gen', type: 'generalization', sourceId: sem.impl, targetId: sem.parent,
  name: '', documentation: '', ownerId: rootId,
})
await cmd('CREATE_DIAGRAM', {
  id: 'sem-diagram-req', kind: 'req', name: '语义排布-追溯',
  ownerId: rootId, elementIds: [sem.reqR, sem.reqR2, sem.impl],
})
await cmd('CREATE_DIAGRAM', {
  id: 'sem-diagram-bdd', kind: 'bdd', name: '语义排布-结构',
  ownerId: rootId,
  elementIds: [sem.parent, sem.impl, sem.peer],
})
await cmd('SET_NOTATIONS', { items: [
  { diagramId: 'sem-diagram-req', elementId: sem.reqR, x: 60, y: 60 },
  { diagramId: 'sem-diagram-req', elementId: sem.reqR2, x: 380, y: 60 },
  { diagramId: 'sem-diagram-req', elementId: sem.impl, x: 60, y: 60 },
  { diagramId: 'sem-diagram-bdd', elementId: sem.parent, x: 40, y: 40 },
  { diagramId: 'sem-diagram-bdd', elementId: sem.impl, x: 40, y: 40 },
  { diagramId: 'sem-diagram-bdd', elementId: sem.peer, x: 330, y: 330 },
] })

// ── 排布交叉实测（不依赖快照，本地造）：链式结构锁定分层，交叉边提供排布前的交叉量 ──
// 3 列 × 10 层：列内 derive 链把层号钉死（derive 无 satisfy/泛化的方向倾斜）；
// 种子坐标故意把 B 列上下颠倒，A_i→B_{i+1} 的交叉边排布前两两相交；
// 分层排布后应归零交叉、零重叠，且 10 层高度超过视口触发适应窗口（缩放 < 100%）。
const CROSS_ROWS = 10
const CROSS_COLS = ['a', 'b', 'c']
const crossIds = []
for (const col of CROSS_COLS) {
  for (let i = 1; i <= CROSS_ROWS; i++) crossIds.push(`xnode-${col}-${i}`)
}
for (const [id, name] of crossIds.map((id) => [id, '交叉' + id.slice(6).toUpperCase().replace('-', '列').replace('-', '层')])) {
  if (!created.has(id)) {
    await cmd('CREATE_ELEMENT', { id, type: 'Requirement', name, ownerId: rootId, documentation: '' })
    created.add(id)
  }
}
for (const col of CROSS_COLS) {
  for (let i = 1; i < CROSS_ROWS; i++) {
    await cmd('CREATE_RELATIONSHIP', {
      id: `xrel-${col}-${i}`, type: 'deriveReqt', sourceId: `xnode-${col}-${i}`, targetId: `xnode-${col}-${i + 1}`,
      name: '', documentation: '', ownerId: rootId,
    })
  }
}
for (let i = 1; i < CROSS_ROWS; i++) {
  await cmd('CREATE_RELATIONSHIP', {
    id: `xrel-x-${i}`, type: 'deriveReqt', sourceId: `xnode-a-${i}`, targetId: `xnode-b-${i + 1}`,
    name: '', documentation: '', ownerId: rootId,
  })
}
await cmd('CREATE_DIAGRAM', {
  id: 'x-diagram-cross', kind: 'req', name: '排布交叉实测',
  ownerId: rootId, elementIds: crossIds,
})
const xSeedItems = []
for (let i = 1; i <= CROSS_ROWS; i++) {
  xSeedItems.push({ diagramId: 'x-diagram-cross', elementId: `xnode-a-${i}`, x: 60, y: 60 + i * 120 })
  xSeedItems.push({ diagramId: 'x-diagram-cross', elementId: `xnode-b-${i}`, x: 460, y: 60 + (CROSS_ROWS - i) * 120 })
  xSeedItems.push({ diagramId: 'x-diagram-cross', elementId: `xnode-c-${i}`, x: 860, y: 60 + i * 120 })
}
await cmd('SET_NOTATIONS', { items: xSeedItems })

const final = await api('api/model', { headers: scoped })
console.log('灌数完成 rev', final.revision,
  '· 元素', final.elements.length, '· 关系', final.relationships.length,
  '· 图', final.diagrams.length, '· 记法', final.notations.length)
console.log('PROJECT_ID=' + project.id)
