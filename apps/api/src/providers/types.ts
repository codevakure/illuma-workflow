/**
 * Provider and model type definitions for the API.
 * Pure data types -- no React or runtime dependencies.
 *
 * Combines the model-definition types (used by definitions.ts / helpers.ts)
 * with the executor types (ProviderRequest, ProviderResponse, ProviderConfig)
 * that provider subdirectories depend on.
 */

import type { StreamingExecution } from '@/executor/types'

// ---------------------------------------------------------------------------
// Provider ID
// ---------------------------------------------------------------------------

export type ProviderId =
  | 'openai'
  | 'azure-openai'
  | 'anthropic'
  | 'azure-anthropic'
  | 'google'
  | 'vertex'
  | 'deepseek'
  | 'xai'
  | 'cerebras'
  | 'groq'
  | 'mistral'
  | 'ollama'
  | 'openrouter'
  | 'vllm'
  | 'bedrock'

// ---------------------------------------------------------------------------
// Model definition types (used by definitions.ts / helpers.ts)
// ---------------------------------------------------------------------------

export interface ModelPricing {
  input: number
  cachedInput?: number
  output: number
  updatedAt: string
}

export type ModelPricingMap = Record<string, ModelPricing>

export interface ModelCapabilities {
  temperature?: { min: number; max: number }
  toolUsageControl?: boolean
  computerUse?: boolean
  nativeStructuredOutputs?: boolean
  maxOutputTokens?: { max: number; default: number }
  reasoningEffort?: { values: string[] }
  verbosity?: { values: string[] }
  thinking?: { levels: string[]; default?: string }
}

export interface ModelDefinition {
  id: string
  pricing: ModelPricing
  capabilities: ModelCapabilities
  contextWindow?: number
}

export interface ProviderDefinition {
  id: string
  name: string
  description: string
  models: ModelDefinition[]
  defaultModel: string
  modelPatternStrings?: string[]
  iconId?: string
  capabilities?: ModelCapabilities
  contextInformationAvailable?: boolean
}

// ---------------------------------------------------------------------------
// Token / response types (used by provider executors)
// ---------------------------------------------------------------------------

export interface TokenInfo {
  input?: number
  output?: number
  total?: number
}

export interface TransformedResponse {
  content: string
  tokens?: TokenInfo
}

// ---------------------------------------------------------------------------
// Provider executor config
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: string
  name: string
  description: string
  version: string
  models: string[]
  defaultModel: string
  initialize?: () => Promise<void>
  executeRequest: (
    request: ProviderRequest
  ) => Promise<ProviderResponse | ReadableStream<any> | StreamingExecution>
}

// ---------------------------------------------------------------------------
// Function call / tool types
// ---------------------------------------------------------------------------

export interface FunctionCallResponse {
  name: string
  arguments: Record<string, any>
  startTime?: string
  endTime?: string
  duration?: number
  result?: Record<string, any>
  output?: Record<string, any>
  input?: Record<string, any>
}

export interface TimeSegment {
  type: 'model' | 'tool'
  name: string
  startTime: number
  endTime: number
  duration: number
}

// ---------------------------------------------------------------------------
// Provider response
// ---------------------------------------------------------------------------

export interface ProviderResponse {
  content: string
  model: string
  tokens?: {
    input?: number
    output?: number
    total?: number
  }
  toolCalls?: FunctionCallResponse[]
  toolResults?: any[]
  timing?: {
    startTime: string
    endTime: string
    duration: number
    modelTime?: number
    toolsTime?: number
    firstResponseTime?: number
    iterations?: number
    timeSegments?: TimeSegment[]
  }
  cost?: {
    input: number
    output: number
    total: number
    pricing: ModelPricing
  }
}

// ---------------------------------------------------------------------------
// Tool usage control
// ---------------------------------------------------------------------------

export type ToolUsageControl = 'auto' | 'force' | 'none'

export interface ProviderToolConfig {
  id: string
  name: string
  description: string
  params: Record<string, any>
  parameters: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
  usageControl?: ToolUsageControl
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool'
  content: string | null
  name?: string
  function_call?: {
    name: string
    arguments: string
  }
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

// ---------------------------------------------------------------------------
// Provider request
// ---------------------------------------------------------------------------

export interface ProviderRequest {
  model: string
  systemPrompt?: string
  context?: string
  tools?: ProviderToolConfig[]
  temperature?: number
  maxTokens?: number
  apiKey?: string
  messages?: Message[]
  responseFormat?: {
    name: string
    schema: any
    strict?: boolean
  }
  local_execution?: boolean
  workflowId?: string
  workspaceId?: string
  chatId?: string
  userId?: string
  stream?: boolean
  streamToolCalls?: boolean
  environmentVariables?: Record<string, string>
  workflowVariables?: Record<string, any>
  blockData?: Record<string, any>
  blockNameMapping?: Record<string, string>
  isCopilotRequest?: boolean
  isBYOK?: boolean
  azureEndpoint?: string
  azureApiVersion?: string
  vertexProject?: string
  vertexLocation?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
  reasoningEffort?: string
  verbosity?: string
  thinkingLevel?: string
  isDeployedContext?: boolean
}

export const providers: Record<string, ProviderConfig> = {}
