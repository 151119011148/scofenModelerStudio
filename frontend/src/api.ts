import type {
  CommandRequest,
  ContainmentSpec,
  DiagramSpec,
  Health,
  ModelSnapshot,
  Patch,
  RelationshipTypeInfo,
  WorkspaceDirectoryInfo,
} from './types'

// Vite 构建时注入的 base（默认 `/`，子路径部署时为 `/scofen/modelerStudio/`）。
// 保持 API 与页面在同一前缀下，Nginx 只需剥掉一层前缀即可反代。
const BASE = import.meta.env.BASE_URL

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export const getHealth = () =>
  request<Health>(`${BASE}api/health`, { headers: { 'X-Scofen-Session': 'web-ui' } })
export const getModel = () => request<ModelSnapshot>(`${BASE}api/model`)
export const getDiagrams = () => request<DiagramSpec[]>(`${BASE}api/metamodel/diagrams`)
export const getRelationships = () =>
  request<RelationshipTypeInfo[]>(`${BASE}api/metamodel/relationships`)
export const getContainment = () => request<ContainmentSpec>(`${BASE}api/metamodel/containment`)
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
