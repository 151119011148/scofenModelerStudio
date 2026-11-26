import type {
  AdminRole,
  AdminUser,
  AuthUser,
  CommandRequest,
  ContainmentSpec,
  CustomizationCatalog,
  DiagramSpec,
  ExtensionCatalog,
  Health,
  ModelSnapshot,
  Patch,
  PropertyCatalogInfo,
  RelationshipTypeInfo,
  Session,
  StyleCatalog,
  ValidationReport,
  WorkspaceDirectoryInfo,
} from './types'
import { readObjectLink, requestId } from './projectWorkflow'
import type { Baseline, BaselineInfo, Difference, Evidence, ImportInput, ImportPreview, MatrixLink, ObjectTarget,
  ProjectOverview, Review, SavedView, TraceResult } from './projectWorkflow'

// Vite 构建时注入的 base（默认 `/`，子路径部署时为 `/scofen/modelerStudio/`）。
// 保持 API 与页面在同一前缀下，Nginx 只需剥掉一层前缀即可反代。
const BASE = import.meta.env.BASE_URL

const TOKEN_KEY = 'scofen.modeler.token'
const USER_KEY = 'scofen.modeler.user'
const PROJECT_KEY = 'scofen.modeler.project'
export const DEFAULT_PROJECT_ID = 'project-vehicle'

/** 当前打开的项目。所有 /api 请求都带这个头，服务端据此路由到独立模型运行时。 */
let activeProjectId = readObjectLink()?.project ?? localStorage.getItem(PROJECT_KEY) ?? DEFAULT_PROJECT_ID
const WEB_SESSION = requestId()
export const getProjectId = () => activeProjectId
export function setProjectId(id: string) {
  activeProjectId = id || DEFAULT_PROJECT_ID
  localStorage.setItem(PROJECT_KEY, activeProjectId)
}

/* ---------------- 会话存储（仿 scofenDoc） ---------------- */

export function loadSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY)
  const raw = localStorage.getItem(USER_KEY)
  if (!token || !raw) return null
  try {
    return { token, user: JSON.parse(raw) as AuthUser }
  } catch {
    return null
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(TOKEN_KEY, session.token)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      'X-Scofen-Project': activeProjectId,
      'X-Scofen-Session': WEB_SESSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
    // 登录接口自己的 401 是「账号密码错」，不能当成会话过期处理。
    if (response.status === 401 && !path.includes('api/auth/login')) {
      clearSession()
      onUnauthorized?.()
    }
    // 后端统一错误体含 message；error 作兜底，避免只显示「HTTP 400」让人以为功能无响应。
    throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`)
  }
  const text = await response.text()
  return text ? JSON.parse(text) as T : undefined as T
}

export const login = (username: string, password: string) =>
  request<Session>(`${BASE}api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
export const me = () => request<AuthUser & { error?: string }>(`${BASE}api/auth/me`)
export const logout = () => request<void>(`${BASE}api/auth/logout`, { method: 'POST' })

/** 浏览器 WebSocket 不能带自定义头，登录态放在握手 URL 的 query 上。 */
export function patchSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  return `${protocol}//${window.location.host}${BASE}ws/patches`
    + `?token=${encodeURIComponent(token)}&project=${encodeURIComponent(activeProjectId)}`
}

export const getHealth = () =>
  request<Health>(`${BASE}api/health`)
export const getModel = () => request<ModelSnapshot>(`${BASE}api/model`)
/** 全量校验报告：结构问题 + 需求覆盖矩阵，服务端权威计算。 */
export const getValidation = () => request<ValidationReport>(`${BASE}api/validation`)
export const getDiagrams = () => request<DiagramSpec[]>(`${BASE}api/metamodel/diagrams`)
/** 用户定制目录：自定义图类型 + 属性字典（按项目实时解析）。 */
export const getCustomization = () => request<CustomizationCatalog>(`${BASE}api/metamodel/customization`)
export const getRelationships = () =>
  request<RelationshipTypeInfo[]>(`${BASE}api/metamodel/relationships`)
export const getContainment = () => request<ContainmentSpec>(`${BASE}api/metamodel/containment`)
export const getProperties = () =>
  request<PropertyCatalogInfo>(`${BASE}api/metamodel/properties`)
export const getExtensionPackages = () =>
  request<ExtensionCatalog>(`${BASE}api/metamodel/extension`)
export const getStyleCatalog = () => request<StyleCatalog>(`${BASE}api/metamodel/styles`)
export const getWorkspaces = () => request<WorkspaceDirectoryInfo>(`${BASE}api/workspaces`)

export function projectApi(project: string) {
  const call = <T>(path: string, init?: RequestInit) => request<T>(`${BASE}api/project/${path}`, {
    ...init, headers: { 'X-Scofen-Project': project },
  })
  const send = <T>(path: string, method: string, data: object) => call<T>(path, { method, body: JSON.stringify(data) })
  return {
    overview: () => call<ProjectOverview>('overview'),
    changeMember: (username: string, role: string | null) => send<void>('members', 'PUT', { username, role }),
    saveView: (view: SavedView) => send<SavedView>('views', 'PUT', view),
    deleteView: (id: string) => call<void>(`views/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    upload: (file: File) => {
      const data = new FormData()
      data.append('file', file)
      return call<{ headers: string[]; rows: string[][] }>('import/file', { method: 'POST', body: data })
    },
    preview: (input: ImportInput) => send<ImportPreview>('import/preview', 'POST', input),
    commit: (input: ImportInput) => send<ImportPreview>('import/commit', 'POST', input),
    matrix: (revision: number, links: MatrixLink[]) => send<{ revision: number }>('matrix', 'POST', { revision, links, requestId: requestId() }),
    trace: (id: string, depth: number, direction: string, types: string[]) => call<TraceResult>(`trace?${new URLSearchParams({
      id, direction, depth: String(depth), ...(types.length ? { types: types.join(',') } : {}),
    })}`),
    review: (target: ObjectTarget, text: string, revision: number) => send<Review>('reviews', 'POST', { ...target, text, revision }),
    reply: (id: string, operation: string, text: string) => send<Review>(`reviews/${encodeURIComponent(id)}`, 'POST', { operation, text }),
    recordEvidence: (evidence: Evidence) => send<Evidence>('evidence', 'PUT', evidence),
    publish: (name: string, notes: string, revision: number) => send<BaselineInfo>('baselines', 'POST', { name, notes, revision }),
    baseline: (id: string) => call<Baseline>(`baselines/${encodeURIComponent(id)}`),
    diff: (id: string, from: string) => call<Difference[]>(`baselines/${encodeURIComponent(id)}/diff?${new URLSearchParams({ from })}`),
    restore: (id: string, revision: number) => send<{ revision: number }>(`baselines/${encodeURIComponent(id)}/restore`, 'POST', {
      revision, requestId: requestId(),
    }),
  }
}
export const createProject = (payload: { spaceCode: string; name: string; description: string }) =>
  request<{ id: string; name: string; spaceCode: string }>(`${BASE}api/workspaces/projects`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': WEB_SESSION },
    body: JSON.stringify(payload),
  })

/** 删除项目：目录项与运行时一起移除，落库快照由外键级联清理。 */
export const deleteProject = (id: string) =>
  request<{ id: string; name: string; spaceCode: string }>(
    `${BASE}api/workspaces/projects/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: { 'X-Scofen-Session': WEB_SESSION } },
  )

export const postCommand = (command: CommandRequest) =>
  request<Patch>(`${BASE}api/commands`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': WEB_SESSION },
    body: JSON.stringify(command),
  })

export const undo = () =>
  request<Patch>(`${BASE}api/commands/undo`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': WEB_SESSION },
  })

export const redo = () =>
  request<Patch>(`${BASE}api/commands/redo`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': WEB_SESSION },
  })

/* ---------------- 用户与角色管理（需要 user.manage / role.manage） ---------------- */

export const getAdminUsers = () =>
  request<{ users: AdminUser[] }>(`${BASE}api/admin/users`)
export const saveAdminUser = (payload: {
  username: string
  displayName?: string
  password?: string
  enabled?: boolean
  roles?: string[]
}) =>
  request<{ username: string }>(`${BASE}api/admin/users`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const deleteAdminUser = (username: string) =>
  request<{ username: string }>(`${BASE}api/admin/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  })
export const getAdminRoles = () =>
  request<{ roles: AdminRole[] }>(`${BASE}api/admin/roles`)
export const getAdminPermissions = () =>
  request<{ permissions: { code: string; label: string }[] }>(`${BASE}api/admin/permissions`)
export const saveAdminRole = (payload: {
  code: string
  name?: string
  description?: string
  permissions?: string[]
}) =>
  request<{ code: string }>(`${BASE}api/admin/roles`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

/* ---------------- XMI 交换 ---------------- */

/**
 * 下载服务端生成的交换文件。
 *
 * <p>不用 {@code window.open} 直链：接口需要 Bearer 令牌与项目头，
 * 直链会被 401 拦下。这里显式带上凭据取回文本，再由前端触发下载。</p>
 */
async function downloadText(path: string, filename: string): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const response = await fetch(path, {
    headers: {
      'X-Scofen-Project': activeProjectId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `HTTP ${response.status}`)
  }
  const text = await response.text()
  const blob = new Blob([text], { type: response.headers.get('content-type') ?? 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 导出标准 UML 2.5.1 XMI 语义文件（.xmi）。 */
export const exportXmi = () => downloadText(`${BASE}api/exchange/xmi`, 'model.xmi')

/** 导出布局侧车（.di.json）：图类型、图名与全部记号坐标。 */
export const exportSidecar = () => downloadText(`${BASE}api/exchange/xmi.di.json`, 'model.di.json')

/** 导出无损自有格式（.scofen.json）。 */
export const exportNative = () => downloadText(`${BASE}api/exchange/scofen.json`, 'model.scofen.json')

/** 导入：整包替换当前项目。侧车可缺省，缺省时由服务端重排九图。 */
export const importXmi = (payload: { semantic: string; sidecar?: string }) =>
  request<Patch>(`${BASE}api/exchange/xmi`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': WEB_SESSION },
    body: JSON.stringify(payload),
  })

/** 侧车概览：图数、记号数与图种类，用于导入前提示用户。 */
export const getSidecarPreview = () =>
  request<{
    format: string
    version: number
    diagramCount: number
    notationCount: number
    kinds: string[]
    expectedKinds: number
  }>(`${BASE}api/exchange/sidecar/preview`)
