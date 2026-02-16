/**
 * Block enhancements — runtime-only JavaScript properties that cannot be
 * expressed in JSON manifests.
 *
 * Each enhancement is keyed by block type and provides a partial SubBlockConfig
 * overlay. When the manifest adapter builds a BlockConfig, it merges these
 * enhancements onto the corresponding subBlocks and tools config.
 *
 * This is the bridge between declarative JSON manifests and the runtime
 * features that require store access, dynamic functions, or React components.
 */

import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import {
  getBaseModelProviders,
  getHostedModels,
  getMaxTemperature,
  getProviderIcon,
  getReasoningEffortValuesForModel,
  getThinkingLevelsForModel,
  getVerbosityValuesForModel,
  MODELS_WITH_DEEP_RESEARCH,
  MODELS_WITH_REASONING_EFFORT,
  MODELS_WITH_THINKING,
  MODELS_WITH_VERBOSITY,
  MODELS_WITHOUT_MEMORY,
  providers,
  supportsTemperature,
} from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'

/**
 * Enhancement definition for a single block type.
 */
interface BlockEnhancement {
  /** Partial overrides for subBlocks, keyed by subBlock id */
  subBlocks?: Record<string, Partial<SubBlockConfig>>
  /** Override for tools.config.tool — replaces the manifest-derived function */
  toolResolver?: (params: Record<string, unknown>) => string
  /** Override for tools.config.params */
  paramsTransform?: (params: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Returns all model options from all providers, for use in combobox options.
 */
function getModelOptions(): { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }[] {
  const providersState = useProvidersStore.getState()
  const baseModels = providersState.providers.base.models
  const ollamaModels = providersState.providers.ollama.models
  const vllmModels = providersState.providers.vllm.models
  const openrouterModels = providersState.providers.openrouter.models
  const allModels = Array.from(
    new Set([...baseModels, ...ollamaModels, ...vllmModels, ...openrouterModels])
  )

  return allModels.map((model) => {
    const icon = getProviderIcon(model)
    return { label: model, id: model, ...(icon && { icon }) }
  })
}

/**
 * Tool resolver for LLM-based blocks (agent, evaluator, router).
 * Maps model name to provider tool ID via getBaseModelProviders().
 */
function llmToolResolver(params: Record<string, unknown>): string {
  const model = (params.model as string) || 'claude-sonnet-4-5'
  if (!model) throw new Error('No model selected')
  const tool = getBaseModelProviders()[model]
  if (!tool) throw new Error(`Invalid model selected: ${model}`)
  return tool
}

/**
 * Creates a fetchOptions function for model-dependent dropdown options.
 */
function createModelDependentFetchOptions(
  getValues: (model: string) => string[] | null,
  defaultOptions: Array<{ label: string; id: string }>
): (blockId: string, subBlockId: string) => Promise<Array<{ label: string; id: string }>> {
  return async (blockId: string) => {
    const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
    const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId) return defaultOptions

    const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
    const blockValues = workflowValues?.[blockId]
    const modelValue = blockValues?.model as string
    if (!modelValue) return defaultOptions

    const validOptions = getValues(modelValue)
    if (!validOptions) return defaultOptions

    return [defaultOptions[0], ...validOptions.map((opt) => ({ label: opt, id: opt }))]
  }
}

/**
 * Resolves `@@` condition references to actual model arrays.
 * Called by the manifest adapter when it encounters condition values starting with `@@`.
 */
export function resolveConditionReference(ref: string): string[] | undefined {
  switch (ref) {
    case '@@vertex.models':
      return providers.vertex.models
    case '@@bedrock.models':
      return providers.bedrock.models
    case '@@azure-openai.models':
      return providers['azure-openai'].models
    case '@@azure-openai+azure-anthropic.models':
      return [...providers['azure-openai'].models, ...providers['azure-anthropic'].models]
    case '@@MODELS_WITH_REASONING_EFFORT':
      return MODELS_WITH_REASONING_EFFORT
    case '@@MODELS_WITH_VERBOSITY':
      return MODELS_WITH_VERBOSITY
    case '@@MODELS_WITH_THINKING':
      return MODELS_WITH_THINKING
    case '@@MODELS_WITH_DEEP_RESEARCH':
      return MODELS_WITH_DEEP_RESEARCH
    case '@@MODELS_WITHOUT_MEMORY':
      return MODELS_WITHOUT_MEMORY
    default: {
      // Handle "@@hostedModels+vertex+bedrock" pattern
      if (ref.startsWith('@@hostedModels')) {
        // Used for apiKey condition: NOT hosted + vertex + bedrock models
        return [
          ...getHostedModels(),
          ...providers.vertex.models,
          ...providers.bedrock.models,
        ]
      }
      return undefined
    }
  }
}

// ---------------------------------------------------------------------------
// Gmail / Outlook trigger label/folder fetchers
// ---------------------------------------------------------------------------

const GMAIL_SYSTEM_LABELS = [
  { id: 'INBOX', label: 'Inbox' },
  { id: 'SENT', label: 'Sent' },
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'SPAM', label: 'Spam' },
  { id: 'TRASH', label: 'Trash' },
  { id: 'STARRED', label: 'Starred' },
  { id: 'IMPORTANT', label: 'Important' },
  { id: 'UNREAD', label: 'Unread' },
  { id: 'CATEGORY_PERSONAL', label: 'Category: Personal' },
  { id: 'CATEGORY_SOCIAL', label: 'Category: Social' },
  { id: 'CATEGORY_PROMOTIONS', label: 'Category: Promotions' },
  { id: 'CATEGORY_UPDATES', label: 'Category: Updates' },
  { id: 'CATEGORY_FORUMS', label: 'Category: Forums' },
]

const OUTLOOK_SYSTEM_FOLDERS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'sentitems', label: 'Sent Items' },
  { id: 'deleteditems', label: 'Deleted Items' },
  { id: 'junkemail', label: 'Junk Email' },
  { id: 'archive', label: 'Archive' },
  { id: 'outbox', label: 'Outbox' },
]

/**
 * Creates a fetchOptions function for credential-dependent dropdowns
 * (e.g. Gmail labels, Outlook folders).
 */
function createCredentialDependentFetchOptions(
  credentialSubBlockId: string,
  apiEndpoint: string,
  responseKey: string,
  mapItem: (item: { id: string; name: string }) => { id: string; label: string },
  fallbackOptions: Array<{ id: string; label: string }>
): (blockId: string, subBlockId: string) => Promise<Array<{ label: string; id: string }>> {
  return async (blockId: string) => {
    const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
    const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId) return fallbackOptions

    const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
    const blockValues = workflowValues?.[blockId]
    const credentialId = blockValues?.[credentialSubBlockId] as string | null
    if (!credentialId) throw new Error('No credential selected')

    try {
      const response = await fetch(`${apiEndpoint}?credentialId=${credentialId}`)
      if (!response.ok) throw new Error(`Failed to fetch from ${apiEndpoint}`)
      const data = await response.json()
      const items = data[responseKey]
      if (items && Array.isArray(items)) {
        return items.map(mapItem)
      }
      return fallbackOptions
    } catch {
      return fallbackOptions
    }
  }
}

// ---------------------------------------------------------------------------
// IMAP mailbox fetcher
// ---------------------------------------------------------------------------

/**
 * Creates a fetchOptions function for IMAP mailboxes.
 * Unlike credential-dependent fetchers, IMAP uses connection params (host, port, etc.)
 * sent via POST to fetch available mailboxes.
 */
function createImapMailboxFetchOptions(): (
  blockId: string,
  subBlockId: string
) => Promise<Array<{ label: string; id: string }>> {
  const fallback = [{ id: 'INBOX', label: 'INBOX' }]

  return async (blockId: string) => {
    const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
    const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId) return fallback

    const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
    const blockValues = workflowValues?.[blockId]

    const host = blockValues?.host as string
    const username = blockValues?.username as string
    const password = blockValues?.password as string
    if (!host || !username || !password) throw new Error('IMAP connection details required')

    const port = Number(blockValues?.port ?? 993)
    const secure = blockValues?.secure !== false
    const rejectUnauthorized = blockValues?.rejectUnauthorized !== false

    try {
      const response = await fetch('/api/tools/imap/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, secure, rejectUnauthorized, username, password }),
      })
      if (!response.ok) throw new Error('Failed to fetch IMAP mailboxes')
      const data = await response.json()
      if (data.mailboxes && Array.isArray(data.mailboxes)) {
        return data.mailboxes.map((mb: { path: string; name: string }) => ({
          id: mb.path,
          label: mb.name,
        }))
      }
      return fallback
    } catch {
      return fallback
    }
  }
}

// ---------------------------------------------------------------------------
// Webflow site/collection fetchers
// ---------------------------------------------------------------------------

/**
 * Creates a fetchOptions function for Webflow sites (OAuth credential-dependent, POST).
 */
function createWebflowSiteFetchOptions(): (
  blockId: string,
  subBlockId: string
) => Promise<Array<{ label: string; id: string }>> {
  return async (blockId: string) => {
    const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
    const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId) return []

    const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
    const blockValues = workflowValues?.[blockId]
    const credentialId = blockValues?.triggerCredentials as string | null
    if (!credentialId) throw new Error('No credential selected')

    try {
      const response = await fetch('/api/tools/webflow/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialId }),
      })
      if (!response.ok) throw new Error('Failed to fetch Webflow sites')
      const data = await response.json()
      if (data.sites && Array.isArray(data.sites)) {
        return data.sites.map((site: { id: string; name: string }) => ({
          id: site.id,
          label: site.name,
        }))
      }
      return []
    } catch {
      return []
    }
  }
}

/**
 * Creates a fetchOptions function for Webflow collections (depends on credential + site).
 */
function createWebflowCollectionFetchOptions(): (
  blockId: string,
  subBlockId: string
) => Promise<Array<{ label: string; id: string }>> {
  return async (blockId: string) => {
    const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
    const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (!activeWorkflowId) return []

    const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
    const blockValues = workflowValues?.[blockId]
    const credentialId = blockValues?.triggerCredentials as string | null
    const siteId = blockValues?.triggerSiteId as string | null
    if (!credentialId || !siteId) throw new Error('Credential and site selection required')

    try {
      const response = await fetch('/api/tools/webflow/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialId, siteId }),
      })
      if (!response.ok) throw new Error('Failed to fetch Webflow collections')
      const data = await response.json()
      if (data.collections && Array.isArray(data.collections)) {
        return data.collections.map((col: { id: string; name: string }) => ({
          id: col.id,
          label: col.name,
        }))
      }
      return []
    } catch {
      return []
    }
  }
}

/**
 * Registry of block enhancements keyed by block type.
 */
const BLOCK_ENHANCEMENTS: Record<string, BlockEnhancement> = {
  agent: {
    toolResolver: llmToolResolver,
    subBlocks: {
      model: {
        options: getModelOptions,
      },
      reasoningEffort: {
        fetchOptions: createModelDependentFetchOptions(
          getReasoningEffortValuesForModel,
          [
            { label: 'auto', id: 'auto' },
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        ),
      },
      verbosity: {
        fetchOptions: createModelDependentFetchOptions(
          getVerbosityValuesForModel,
          [
            { label: 'auto', id: 'auto' },
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        ),
      },
      thinkingLevel: {
        fetchOptions: createModelDependentFetchOptions(
          getThinkingLevelsForModel,
          [
            { label: 'none', id: 'none' },
            { label: 'minimal', id: 'minimal' },
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
            { label: 'max', id: 'max' },
          ]
        ),
      },
      temperature: {
        condition: () => ({
          field: 'model',
          value: (() => {
            const allModels = Object.keys(getBaseModelProviders())
            return allModels.filter(
              (model) => supportsTemperature(model) && getMaxTemperature(model) !== undefined
            )
          })(),
        }),
      },
    },
  },

  evaluator: {
    toolResolver: llmToolResolver,
  },

  router: {
    toolResolver: llmToolResolver,
  },

  router_v2: {
    toolResolver: llmToolResolver,
  },

  mcp: {
    toolResolver: (params: Record<string, unknown>) => {
      const serverId = params.server as string
      const toolName = params.tool as string
      if (!serverId || !toolName) return 'mcp-dynamic'
      const cleanToolName = toolName.startsWith(`${serverId}_`)
        ? toolName.slice(serverId.length + 1)
        : toolName
      return `mcp_${serverId}_${cleanToolName}`
    },
  },

  gmail: {
    subBlocks: {
      triggerLabelIds: {
        fetchOptions: createCredentialDependentFetchOptions(
          'triggerCredentials',
          '/api/tools/gmail/labels',
          'labels',
          (label: { id: string; name: string }) => ({ id: label.id, label: label.name }),
          GMAIL_SYSTEM_LABELS
        ),
      },
    },
  },

  outlook: {
    subBlocks: {
      triggerFolderIds: {
        fetchOptions: createCredentialDependentFetchOptions(
          'triggerCredentials',
          '/api/tools/outlook/folders',
          'folders',
          (folder: { id: string; name: string }) => ({ id: folder.id, label: folder.name }),
          OUTLOOK_SYSTEM_FOLDERS
        ),
      },
    },
  },

  imap: {
    subBlocks: {
      mailbox: {
        fetchOptions: createImapMailboxFetchOptions(),
      },
    },
  },

  webflow: {
    subBlocks: {
      triggerSiteId: {
        fetchOptions: createWebflowSiteFetchOptions(),
      },
      triggerCollectionId: {
        fetchOptions: createWebflowCollectionFetchOptions(),
      },
    },
  },

  google_books: {
    paramsTransform: (params: Record<string, unknown>) => {
      const { operation, ...rest } = params

      let maxResults: number | undefined
      if (rest.maxResults) {
        maxResults = Number.parseInt(rest.maxResults as string, 10)
        if (Number.isNaN(maxResults)) maxResults = undefined
      }

      let startIndex: number | undefined
      if (rest.startIndex) {
        startIndex = Number.parseInt(rest.startIndex as string, 10)
        if (Number.isNaN(startIndex)) startIndex = undefined
      }

      return {
        ...rest,
        maxResults,
        startIndex,
        filter: (rest.filter as string) || undefined,
        printType: (rest.printType as string) || undefined,
        orderBy: (rest.orderBy as string) || undefined,
        projection: (rest.projection as string) || undefined,
      }
    },
  },
}

/**
 * Applies enhancements to a manifest-adapted BlockConfig.
 * Merges runtime-only JavaScript properties onto the static JSON-derived config.
 *
 * Also applies generic enhancements:
 * - Any combobox subBlock with id "model" and no options gets the provider model options
 */
export function applyBlockEnhancements(config: BlockConfig): BlockConfig {
  const enhancement = BLOCK_ENHANCEMENTS[config.type]

  const result = { ...config }

  // Apply block-specific tool resolver override
  if (enhancement?.toolResolver) {
    result.tools = {
      ...result.tools,
      config: {
        ...result.tools.config,
        tool: enhancement.toolResolver,
      },
    }
  }

  // Apply block-specific params transform override
  if (enhancement?.paramsTransform) {
    result.tools = {
      ...result.tools,
      config: {
        ...result.tools.config,
        tool: result.tools.config?.tool ?? (() => ''),
        params: enhancement.paramsTransform,
      },
    }
  }

  // Apply subBlock enhancements (block-specific + generic)
  result.subBlocks = result.subBlocks.map((sub) => {
    let enhanced = sub

    // Block-specific subBlock enhancement
    const subEnhancement = enhancement?.subBlocks?.[sub.id]
    if (subEnhancement) {
      enhanced = { ...enhanced, ...subEnhancement }
    }

    // Generic: inject model options for any combobox with id "model" that lacks options
    if (sub.id === 'model' && sub.type === 'combobox' && !enhanced.options) {
      enhanced = { ...enhanced, options: getModelOptions }
    }

    return enhanced
  })

  return result
}
