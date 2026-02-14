/**
 * Shared types between frontend and backend
 */

export interface Workflow {
  id: string
  userId: string
  workspaceId: string | null
  folderId: string | null
  name: string
  description: string
  color: string
  sortOrder: number
  isDeployed: boolean
  deployedAt?: Date | null
  runCount: number
  variables: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  lastSynced: Date
}

export interface WorkflowState {
  blocks: Record<string, Block>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  deploymentStatuses: Record<string, unknown>
  lastSaved: number
  isDeployed: boolean
  deployedAt?: Date | null
  metadata: {
    name: string
    description: string
  }
}

export interface Block {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface Loop {
  id: string
  nodes: string[]
}

export interface Parallel {
  id: string
  nodes: string[]
}

export interface User {
  id: string
  email?: string
  name?: string
  image?: string
}

export interface ApiResponse<T> {
  data?: T
  error?: string
  code?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
