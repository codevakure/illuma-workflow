/**
 * Integration Marketplace manifest types.
 *
 * These types define the JSON manifest schema that serves as the single
 * source of truth for all tool, block, and trigger definitions. Each
 * integration provides a `manifest.json` file conforming to these types.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type SubBlockType =
  | 'dropdown'
  | 'short-input'
  | 'long-input'
  | 'code'
  | 'slider'
  | 'switch'
  | 'file-selector'
  | 'file-upload'
  | 'checkbox-list'
  | 'radio-group'
  | 'color-picker'
  | 'table'
  | 'eval-input'
  | 'tool-input'
  | 'date-picker'
  | 'time-picker'
  | 'oauth-account'
  | 'credential-selector'

export type AuthMode = 'oauth' | 'api_key' | 'bot_token' | 'none'

export type OutputType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'file'
  | 'file[]'
  | 'array'
  | 'object'

export type ParameterVisibility = 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden'

export type ExecutionMode = 'direct' | 'proxy' | 'sandbox'

// ---------------------------------------------------------------------------
// Condition (show/hide SubBlocks based on other field values)
// ---------------------------------------------------------------------------

export interface SubBlockCondition {
  field: string
  value?: string | string[]
  not?: boolean
  and?: SubBlockCondition
}

// ---------------------------------------------------------------------------
// SubBlock schema (form fields in the config panel)
// ---------------------------------------------------------------------------

export interface SubBlockSchema {
  id: string
  type: SubBlockType
  title: string
  required?: boolean | SubBlockCondition
  placeholder?: string
  default?: unknown
  password?: boolean
  condition?: SubBlockCondition
  dependsOn?: string[] | { all?: string[]; any?: string[] }
  mode?: 'basic' | 'advanced' | 'both' | 'trigger'
  canonicalParamId?: string

  /** For dropdowns */
  options?: Array<string | { value: string; label: string }>

  /** For sliders */
  min?: number
  max?: number
  step?: number

  /** For code blocks */
  language?: string

  /** For tables */
  columns?: Array<{ key: string; label: string }>

  /** Layout hint */
  layout?: 'full' | 'half'
}

// ---------------------------------------------------------------------------
// Parameter definition (tool input parameters)
// ---------------------------------------------------------------------------

export interface ParamDef {
  type: string
  required?: boolean
  default?: unknown
  description?: string
  visibility?: ParameterVisibility
  enum?: string[]
  items?: {
    type: string
    description?: string
    properties?: Record<string, { type: string; description?: string }>
  }
}

// ---------------------------------------------------------------------------
// Output definition
// ---------------------------------------------------------------------------

export interface OutputDef {
  type: OutputType
  description?: string
  optional?: boolean
  properties?: Record<string, OutputDef>
  items?: {
    type: OutputType
    description?: string
    properties?: Record<string, OutputDef>
  }
}

// ---------------------------------------------------------------------------
// Tool manifest
// ---------------------------------------------------------------------------

export interface DirectRequestSpec {
  url: string
  method: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  query?: Record<string, string>
}

export interface DirectResponseSpec {
  outputMapping: Record<string, string>
}

export interface ProxySpec {
  handler: string
  operation: string
}

export interface ToolManifest {
  id: string
  name: string
  description: string
  version: string
  executionMode: ExecutionMode
  params: Record<string, ParamDef>
  outputs?: Record<string, OutputDef>

  /** For executionMode: "direct" */
  request?: DirectRequestSpec
  response?: DirectResponseSpec

  /** For executionMode: "proxy" */
  proxy?: ProxySpec

  /** For executionMode: "sandbox" */
  codeModule?: string

  /** OAuth configuration */
  oauth?: {
    required: boolean
    provider: string
    requiredScopes?: string[]
  }

  /** Error extractor key */
  errorExtractor?: string
}

// ---------------------------------------------------------------------------
// Block manifest (UI definition for the workflow canvas)
// ---------------------------------------------------------------------------

export interface BlockManifest {
  type: string
  name: string
  description: string
  longDescription?: string
  docsLink?: string
  category: 'tools' | 'triggers' | 'blocks'
  bgColor: string
  icon: string
  authMode?: AuthMode
  hideFromToolbar?: boolean
  deprecated?: boolean

  /** For blocks with multiple operations */
  operations?: Array<{
    value: string
    label: string
    toolId: string
  }>

  subBlocks: SubBlockSchema[]

  /** Tool wiring */
  tools: {
    access: string[]
    config: {
      /** Static tool ID or parameter-based lookup expression e.g. "{{operation}}" */
      tool: string
    }
  }

  inputs: Record<string, { type: OutputType; description?: string; required?: boolean }>
  outputs: Record<string, { type: OutputType; description?: string }>

  /** Trigger configuration */
  triggerAllowed?: boolean
  triggers?: {
    enabled: boolean
    available: string[]
  }
}

// ---------------------------------------------------------------------------
// Trigger manifest
// ---------------------------------------------------------------------------

export interface CredentialField {
  id: string
  label: string
  type: 'string' | 'password'
  required: boolean
  description?: string
  placeholder?: string
}

export type AuthSpec =
  | { type: 'hmac'; headerName: string; secretField: string; algorithm: string }
  | { type: 'bearer'; headerName: string; secretField: string }
  | { type: 'custom'; handler: string }

export interface TriggerManifest {
  id: string
  name: string
  provider: string
  webhook?: {
    method?: string
  }
  credentials: CredentialField[]
  auth?: AuthSpec
  instructions?: string
  outputs: Record<string, { type: OutputType; description?: string }>
}

// ---------------------------------------------------------------------------
// Integration manifest (top-level, one per integration)
// ---------------------------------------------------------------------------

export interface IntegrationManifest {
  id: string
  name: string
  version: string
  description?: string
  icon: string

  block: BlockManifest
  tools: ToolManifest[]
  trigger?: TriggerManifest
}
