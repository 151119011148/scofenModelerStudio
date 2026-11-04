import type { CommandRequest, DiagramSpec, Health, ModelSnapshot, Patch } from './types'

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

export const getHealth = () => request<Health>('/api/health')
export const getModel = () => request<ModelSnapshot>('/api/model')
export const getDiagrams = () => request<DiagramSpec[]>('/api/metamodel/diagrams')

export const postCommand = (command: CommandRequest) =>
  request<Patch>('/api/commands', {
    method: 'POST',
    headers: { 'X-Scofen-Session': 'web-ui' },
    body: JSON.stringify(command),
  })

export const undo = () =>
  request<Patch>('/api/commands/undo', {
    method: 'POST',
    headers: { 'X-Scofen-Session': 'web-ui' },
  })
