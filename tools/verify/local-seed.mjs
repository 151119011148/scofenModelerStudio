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
const items = notations
  .filter((n) => created.has(n.elementId) && wanted.some((d) => d.id === n.diagramId))
  .map((n) => ({ diagramId: n.diagramId, elementId: n.elementId, x: n.x, y: n.y }))
for (let index = 0; index < items.length; index += 1000) {
  await cmd('SET_NOTATIONS', { items: items.slice(index, index + 1000) })
}
const final = await api('api/model', { headers: scoped })
console.log('灌数完成 rev', final.revision,
  '· 元素', final.elements.length, '· 关系', final.relationships.length,
  '· 图', final.diagrams.length, '· 记法', final.notations.length)
console.log('PROJECT_ID=' + project.id)
