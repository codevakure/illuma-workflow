import { useQuery, keepPreviousData } from '@tanstack/react-query'

export interface LogsParams {
  workspaceId?: string
  level?: string
  workflowIds?: string
  folderIds?: string
  triggers?: string
  startDate?: string
  endDate?: string
  search?: string
  workflowName?: string
  executionId?: string
  costOperator?: string
  costValue?: string
  durationOperator?: string
  durationValue?: string
  details?: 'basic' | 'full'
  limit?: number
  offset?: number
}

export interface WorkflowLog {
  id: string
  workflowId: string | null
  executionId: string
  level: string
  trigger: string
  startedAt: string | null
  endedAt: string | null
  totalDurationMs: number | null
  createdAt: string
  cost: Record<string, unknown> | null
  executionData: Record<string, unknown> | null
  files: unknown[] | null
  workflow?: { id: string; name: string; folderId?: string | null } | null
}

export interface LogsResponse {
  data: WorkflowLog[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface LogStats {
  workflows: Array<{
    workflowId: string
    workflowName: string
    segments: Array<{ timestamp: string; totalExecutions: number; successfulExecutions: number; avgDurationMs: number }>
    overallSuccessRate: number
    totalExecutions: number
    totalSuccessful: number
  }>
  aggregateSegments: Array<{ timestamp: string; totalExecutions: number; successfulExecutions: number; avgDurationMs: number }>
  totalRuns: number
  totalErrors: number
  avgLatency: number
  timeBounds: { start: string; end: string }
  segmentMs: number
}

export interface ExecutionDetail {
  executionId: string
  workflowId: string | null
  workflowState: Record<string, unknown> | null
  childWorkflowSnapshots: Record<string, unknown>
  executionMetadata: {
    trigger: string
    startedAt: string | null
    endedAt: string | null
    totalDurationMs: number | null
    cost: Record<string, unknown> | null
  }
}

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (params: LogsParams) => [...logKeys.lists(), params] as const,
  stats: (params: LogsParams) => [...logKeys.all, 'stats', params] as const,
  execution: (executionId: string) => [...logKeys.all, 'execution', executionId] as const,
  triggers: (workspaceId: string) => [...logKeys.all, 'triggers', workspaceId] as const,
}

async function fetchLogs(params: LogsParams): Promise<LogsResponse> {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value))
    }
  })
  const res = await fetch(`/api/logs?${searchParams.toString()}`)
  if (!res.ok) throw new Error('Failed to fetch logs')
  return res.json()
}

async function fetchLogStats(params: LogsParams & { segmentCount?: number }): Promise<LogStats> {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value))
    }
  })
  const res = await fetch(`/api/logs/stats?${searchParams.toString()}`)
  if (!res.ok) throw new Error('Failed to fetch log stats')
  return res.json()
}

async function fetchExecutionDetail(executionId: string): Promise<ExecutionDetail> {
  const res = await fetch(`/api/logs/execution/${executionId}`)
  if (!res.ok) throw new Error('Failed to fetch execution detail')
  return res.json()
}

async function fetchTriggers(workspaceId: string): Promise<{ triggers: string[]; count: number }> {
  const res = await fetch(`/api/logs/triggers?workspaceId=${workspaceId}`)
  if (!res.ok) throw new Error('Failed to fetch triggers')
  return res.json()
}

export function useLogs(params: LogsParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: logKeys.list(params),
    queryFn: () => fetchLogs(params),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useLogStats(params: LogsParams & { segmentCount?: number }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: logKeys.stats(params),
    queryFn: () => fetchLogStats(params),
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  })
}

export function useExecutionDetail(executionId?: string) {
  return useQuery({
    queryKey: logKeys.execution(executionId ?? ''),
    queryFn: () => fetchExecutionDetail(executionId!),
    enabled: Boolean(executionId),
    staleTime: 60_000,
  })
}

export function useLogTriggers(workspaceId?: string) {
  return useQuery({
    queryKey: logKeys.triggers(workspaceId ?? ''),
    queryFn: () => fetchTriggers(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
}
