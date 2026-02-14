/**
 * Log filter type definitions.
 */

export type TimeRange =
  | 'Past 30 minutes'
  | 'Past hour'
  | 'Past 6 hours'
  | 'Past 12 hours'
  | 'Past 24 hours'
  | 'Past 3 days'
  | 'Past 7 days'
  | 'Past 14 days'
  | 'Past 30 days'
  | 'All time'
  | 'Custom range'

export const CORE_TRIGGER_TYPES = [
  'manual',
  'api',
  'schedule',
  'chat',
  'webhook',
  'mcp',
  'a2a',
] as const

export type CoreTriggerType = (typeof CORE_TRIGGER_TYPES)[number]

export type TriggerType = CoreTriggerType | 'all' | (string & {})

export type LogLevel =
  | 'error'
  | 'info'
  | 'running'
  | 'pending'
  | 'cancelled'
  | 'all'
  | (string & {})

export interface CostMetadata {
  models?: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens?: {
        input?: number
        output?: number
        prompt?: number
        completion?: number
        total?: number
      }
    }
  >
  input?: number
  output?: number
  total?: number
  tokens?: {
    input?: number
    output?: number
    prompt?: number
    completion?: number
    total?: number
  }
  pricing?: {
    input: number
    output: number
    cachedInput?: number
    updatedAt: string
  }
}

export interface ToolCall {
  name: string
  duration: number
  startTime: string
  endTime: string
  status: 'success' | 'error'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
}

export interface ToolCallMetadata {
  toolCalls?: ToolCall[]
}

export interface TokenInfo {
  input?: number
  output?: number
  total?: number
  prompt?: number
  completion?: number
}

export interface ProviderTiming {
  duration: number
  startTime: string
  endTime: string
  segments: Array<{
    type: string
    name?: string
    startTime: string | number
    endTime: string | number
    duration: number
  }>
}

export interface TraceSpan {
  id: string
  name: string
  type: string
  duration: number
  startTime: string
  endTime: string
  children?: TraceSpan[]
  toolCalls?: ToolCall[]
  status?: 'success' | 'error'
  tokens?: number | TokenInfo
  relativeStartMs?: number
  blockId?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  model?: string
  cost?: {
    input?: number
    output?: number
    total?: number
  }
  providerTiming?: ProviderTiming
}

export interface WorkflowData {
  id: string
  name: string
  description: string | null
  color: string
  state: unknown
}

export interface WorkflowLog {
  id: string
  workflowId: string | null
  executionId?: string | null
  deploymentVersion?: number | null
  deploymentVersionName?: string | null
  level: string
  status?: string | null
  duration: string | null
  trigger: string | null
  createdAt: string
  workflow?: WorkflowData | null
  files?: Array<{
    id: string
    name: string
    size: number
    type: string
    url: string
    key: string
    uploadedAt: string
    expiresAt: string
    storageProvider?: 's3' | 'blob' | 'local'
    bucketName?: string
  }>
  cost?: CostMetadata
  hasPendingPause?: boolean
  executionData?: ToolCallMetadata & {
    traceSpans?: TraceSpan[]
    totalDuration?: number
    blockInput?: Record<string, unknown>
    enhanced?: boolean
    blockExecutions?: Array<{
      id: string
      blockId: string
      blockName: string
      blockType: string
      startedAt: string
      endedAt: string
      durationMs: number
      status: 'success' | 'error' | 'skipped'
      errorMessage?: string
      errorStackTrace?: string
      inputData: unknown
      outputData: unknown
      cost?: CostMetadata
      metadata: Record<string, unknown>
    }>
  }
}

export interface LogsResponse {
  data: WorkflowLog[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
