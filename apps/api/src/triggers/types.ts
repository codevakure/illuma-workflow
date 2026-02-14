export interface TriggerOutput {
  type?: string
  description?: string
  [key: string]: TriggerOutput | string | undefined
}

/** Minimal icon component type that accepts React components or string stubs */
type IconComponent = string | ((props: { className?: string }) => unknown)

export interface TriggerConfig {
  id: string
  name: string
  provider: string
  description: string
  version: string

  /** Optional icon component for UI display */
  icon?: IconComponent

  /** Subblocks define the UI and configuration (same as blocks) */
  subBlocks: import('@/blocks/types').SubBlockConfig[]

  // Define the structure of data this trigger outputs to workflows
  outputs: Record<string, TriggerOutput>

  // Webhook configuration (for most triggers)
  webhook?: {
    method?: 'POST' | 'GET' | 'PUT' | 'DELETE'
    headers?: Record<string, string>
  }
}

export interface TriggerRegistry {
  [triggerId: string]: TriggerConfig
}

export interface TriggerInstance {
  id: string
  triggerId: string
  blockId: string
  workflowId: string
  config: Record<string, any>
  webhookPath?: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
