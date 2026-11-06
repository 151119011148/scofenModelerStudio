import type {
  AdminRole,
  AdminUser,
  AuthUser,
  CommandRequest,
  ContainmentSpec,
  DiagramSpec,
  ExtensionCatalog,
  Health,
  ModelSnapshot,
  Patch,
  PropertyCatalogInfo,
  RelationshipTypeInfo,
  Session,
  WorkspaceDirectoryInfo,
} from './types'

// Vite 构建时注入的 base（默认 `/`，子路径部署时为 `/scofen/modelerStudio/`）。
// 保持 API 与页面在同一前缀下，Nginx 只需剥掉一层前缀即可反代。
const BASE = import.meta.env.BASE_URL

const TOKEN_KEY = 'scofen.modeler.token'
const USER_KEY = 'scofen.modeler.user'
const PROJECT_KEY = 'scofen.modeler.project'
export const DEFAULT_PROJECT_ID = 'project-vehicle'

/** 当前打开的项目。所有 /api 请求都带这个头，服务端据此路由到独立模型运行时。 */
let activeProjectId = localStorage.getItem(PROJECT_KEY) ?? DEFAULT_PROJECT_ID
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
      'Content-Type': 'application/json',
      'X-Scofen-Project': activeProjectId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    // 登录接口自己的 401 是「账号密码错」，不能当成会话过期处理。
    if (response.status === 401 && !path.includes('api/auth/login')) {
      clearSession()
      onUnauthorized?.()
    }
    throw new Error(body.message ?? `HTTP ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
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
  request<Health>(`${BASE}api/health`, { headers: { 'X-Scofen-Session': 'web-ui' } })
export const getModel = () => request<ModelSnapshot>(`${BASE}api/model`)
export const getDiagrams = () => request<DiagramSpec[]>(`${BASE}api/metamodel/diagrams`)
export const getRelationships = () =>
  request<RelationshipTypeInfo[]>(`${BASE}api/metamodel/relationships`)
export const getContainment = () => request<ContainmentSpec>(`${BASE}api/metamodel/containment`)
export const getProperties = () =>
  request<PropertyCatalogInfo>(`${BASE}api/metamodel/properties`)
export const getExtensionPackages = () =>
  request<ExtensionCatalog>(`${BASE}api/metamodel/extension`)
export const getWorkspaces = () => request<WorkspaceDirectoryInfo>(`${BASE}api/workspaces`)
export const createProject = (payload: { spaceCode: string; name: string; description: string }) =>
  request<{ id: string; name: string; spaceCode: string }>(`${BASE}api/workspaces/projects`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': 'web-ui' },
    body: JSON.stringify(payload),
  })

export const postCommand = (command: CommandRequest) =>
  request<Patch>(`${BASE}api/commands`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': 'web-ui' },
    body: JSON.stringify(command),
  })

export const undo = () =>
  request<Patch>(`${BASE}api/commands/undo`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': 'web-ui' },
  })

export const redo = () =>
  request<Patch>(`${BASE}api/commands/redo`, {
    method: 'POST',
    headers: { 'X-Scofen-Session': 'web-ui' },
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
