import type { ModelSnapshot, ValidationReport } from './types'

export interface ProjectGrant {
  role: string
  canView: boolean
  canEdit: boolean
  canImport: boolean
  canExport: boolean
  canReview: boolean
  canManage: boolean
}

export interface ObjectTarget {
  type: 'element' | 'relationship' | 'diagram'
  id: string
  label?: string
}

export interface ObjectLink {
  project: string
  target?: ObjectTarget
  baseline?: string
}

export interface ViewSettings {
  scopeId: string
  query: string
  mode: string
  sort: string
  columns: string[]
  rowType: string
  columnType: string
  relationType: string
  swapped: boolean
  missing: string
}

export interface SavedView {
  id: string
  name: string
  kind: string
  settings: ViewSettings
}

export interface Review {
  id: string
  target: ObjectTarget
  revision: number
  status: 'open' | 'resolved'
  messages: { author: string; authorName: string; text: string; at: string }[]
  updatedBy: string
  updatedAt: string
}

export interface Evidence {
  revision: number
  requirementId: string
  testId: string
  result: 'pass' | 'fail'
  source: string
  actor?: string
  at?: string
}

export interface BaselineInfo {
  id: string
  name: string
  revision: number
  author: string
  at: string
  notes: string
  comparedTo: string
}

export interface Difference {
  type: ObjectTarget['type']
  id: string
  label: string
  action: 'add' | 'remove' | 'update'
  field: string
  before: unknown
  after: unknown
}

export interface Baseline {
  info: BaselineInfo
  snapshot: ModelSnapshot
  validation: ValidationReport
  changes: Difference[]
  reviews: Review[]
  evidence: Evidence[]
}

export interface ProjectOverview {
  grant: ProjectGrant
  views: SavedView[]
  members: { username: string; role: string; inherited: boolean }[]
  reviews: Review[]
  baselines: BaselineInfo[]
  restorations: { id: string; baselineId: string; fromRevision: number; revision: number; author: string; at: string }[]
}

export interface TraceResult {
  nodes: { target: ObjectTarget; depth: number; path: { sourceId: string; targetId: string; type: string; inferred: boolean }[] }[]
  truncated: boolean
}

export interface ImportInput {
  baseRevision: number
  source: string
  ownerId: string
  rows: { line: number; externalId: string; parentId: string | null; name: string; text: string | null; status: string | null }[]
}

export interface ImportPreview {
  revision: number
  rows: { line: number; externalId: string; action: 'create' | 'update' | 'unchanged' | 'error'; message: string }[]
  creates: number
  updates: number
  unchanged: number
  errors: number
}

export interface MatrixLink { type?: string; sourceId?: string; targetId?: string; removeId?: string }

export function readObjectLink(): ObjectLink | undefined {
  const params = new URLSearchParams(window.location.search)
  const project = params.get('project')
  const type = params.get('kind')
  const id = params.get('object')
  if (!project || !/^[a-zA-Z0-9_-]{1,64}$/.test(project)) return undefined
  return { project, baseline: params.get('baseline') || undefined,
    target: id && (type === 'element' || type === 'diagram' || type === 'relationship') ? { id, type } : undefined }
}

export function projectLink(project: string, target?: ObjectTarget, baseline?: string): string {
  const url = new URL(window.location.pathname, window.location.origin)
  url.searchParams.set('project', project)
  if (target) {
    url.searchParams.set('kind', target.type)
    url.searchParams.set('object', target.id)
  }
  if (baseline) url.searchParams.set('baseline', baseline)
  return url.toString()
}

export function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
