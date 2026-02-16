import type { SVGProps } from 'react'
import type { BlockConfig } from '@/blocks/types'

/**
 * Manifest-backed block definition as returned by the registry API.
 * This is the JSON representation; icon is a string ID, not a component.
 */
export interface ManifestBlock {
  type: string
  name: string
  description: string
  longDescription?: string
  docsLink?: string
  category: 'tools' | 'triggers' | 'blocks'
  bgColor: string
  icon: string
  iconSvg?: string
  authMode?: 'oauth' | 'api_key' | 'bot_token' | 'none'
  hideFromToolbar?: boolean
  operations?: Array<{ value: string; label: string; toolId: string }>
  subBlocks: ManifestSubBlock[]
  tools: {
    access: string[]
    config: { tool: string }
  }
  inputs: Record<string, { type: string; description?: string; required?: boolean }>
  outputs: Record<string, { type: string; description?: string }>
  triggerAllowed?: boolean
  triggers?: { enabled: boolean; available: string[] }
  bestPractices?: string
}

export interface ManifestSubBlock {
  id: string
  type: string
  title: string
  required?: boolean | Record<string, unknown>
  placeholder?: string
  default?: unknown
  password?: boolean
  condition?: Record<string, unknown> | string
  dependsOn?: string[] | Record<string, string[]>
  mode?: string
  canonicalParamId?: string
  options?: Array<string | { value: string; label: string }>
  min?: number
  max?: number
  step?: number
  language?: string
  columns?: Array<{ key: string; label: string }>
  layout?: string
  description?: string
  hidden?: boolean
  rows?: number
  multiSelect?: boolean
  searchable?: boolean
  /** Whether to use the auto-generated webhook URL (trigger mode) */
  useWebhookUrl?: boolean
  /** Show a copy-to-clipboard button */
  showCopyButton?: boolean
  /** Make the input read-only */
  readOnly?: boolean
  /** Trigger ID for trigger-save subblocks */
  triggerId?: string
  /** Hide from workflow block preview */
  hideFromPreview?: boolean
  /** Whether the section can be collapsed */
  collapsible?: boolean
  /** Whether the section is collapsed by default */
  defaultCollapsed?: boolean
  /** Whether connections can be dropped onto this input */
  connectionDroppable?: boolean
  /** OAuth service ID */
  serviceId?: string
  /** Required OAuth scopes */
  requiredScopes?: string[]
  /** Wand AI-assist configuration */
  wandConfig?: {
    enabled?: boolean
    prompt: string
    generationType?: string
    placeholder?: string
    maintainHistory?: boolean
  }
}

export interface ManifestTool {
  id: string
  name: string
  description: string
  version: string
  executionMode: 'direct' | 'proxy' | 'sandbox'
  params: Record<string, ManifestParam>
  outputs?: Record<string, { type: string; description?: string }>
}

export interface ManifestParam {
  type: string
  required?: boolean
  default?: unknown
  description?: string
  visibility?: string
  enum?: string[]
}

export interface ManifestCredential {
  id: string
  label: string
  type: 'password' | 'text'
  required?: boolean
  placeholder?: string
  description?: string
}

export interface ManifestTrigger {
  id: string
  name: string
  provider: string
  description?: string
  version?: string
  webhook?: { method?: string }
  credentials?: ManifestCredential[]
  instructions?: string
  outputs: Record<string, { type: string; description?: string; properties?: Record<string, unknown>; items?: unknown }>
}

export interface ManifestIntegration {
  id: string
  name: string
  version: string
  description?: string
  icon: string
  block: ManifestBlock
  tools: ManifestTool[]
  triggers?: ManifestTrigger[]
}

export interface RegistryState {
  blocks: Record<string, ManifestBlock>
  tools: Record<string, ManifestTool>
  isLoaded: boolean
  isLoading: boolean
  error: string | null
}

export interface RegistryStore extends RegistryState {
  loadRegistry: () => Promise<void>
  getManifestBlock: (type: string) => ManifestBlock | undefined
  getManifestTool: (id: string) => ManifestTool | undefined
  hasManifestBlock: (type: string) => boolean
  getAllManifestBlocks: () => ManifestBlock[]
  reset: () => void
}
