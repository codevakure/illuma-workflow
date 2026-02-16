/**
 * Trigger API — backed by registry store data fetched from the API.
 *
 * Reads trigger data from ManifestTrigger (JSON manifests served via
 * /api/registry/integrations) and converts to TriggerConfig so all
 * consumers see the same interface.
 */

import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/trigger-utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { ManifestTrigger } from '@/stores/registry/types'
import type { TriggerConfig, TriggerOutput } from '@/triggers/types'

/**
 * IDs that should NOT be namespaced because they are shared across triggers
 * or are the control mechanism for trigger selection
 */
const SHARED_SUBBLOCK_IDS = new Set(['selectedTriggerId'])

/**
 * Checks if a subBlock is display-only (not user-editable).
 * Display-only subBlocks should be namespaced to avoid conflicts when
 * multiple triggers show different content for the same conceptual field.
 */
function isDisplayOnlySubBlock(subBlock: SubBlockConfig): boolean {
  if (subBlock.type === 'text') {
    return true
  }
  if (subBlock.readOnly === true) {
    return true
  }
  return false
}

/**
 * Namespaces a subBlock ID with the trigger ID to avoid conflicts when
 * multiple triggers are merged into a single block.
 */
function namespaceSubBlockId(subBlock: SubBlockConfig, triggerId: string): SubBlockConfig {
  if (SHARED_SUBBLOCK_IDS.has(subBlock.id)) {
    return subBlock
  }
  if (!isDisplayOnlySubBlock(subBlock)) {
    return subBlock
  }
  const condition =
    typeof subBlock.condition === 'function' ? subBlock.condition() : subBlock.condition
  if (condition?.field === 'selectedTriggerId') {
    return {
      ...subBlock,
      id: `${subBlock.id}_${triggerId}`,
    }
  }
  return subBlock
}

/**
 * Converts a ManifestTrigger (JSON) to a TriggerConfig (runtime).
 */
function adaptManifestTrigger(manifest: ManifestTrigger): TriggerConfig {
  const subBlocks: SubBlockConfig[] = []

  if (manifest.credentials?.length) {
    for (const cred of manifest.credentials) {
      subBlocks.push({
        id: cred.id,
        title: cred.label,
        type: 'short-input',
        password: cred.type === 'password',
        required: cred.required,
        placeholder: cred.placeholder,
        description: cred.description,
        mode: 'trigger',
        condition: {
          field: 'selectedTriggerId',
          value: manifest.id,
        },
      })
    }
  }

  if (manifest.instructions) {
    subBlocks.push({
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text' as SubBlockConfig['type'],
      hideFromPreview: true,
      defaultValue: manifest.instructions,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: manifest.id,
      },
    })
  }

  const outputs: Record<string, TriggerOutput> = {}
  if (manifest.outputs) {
    for (const [key, def] of Object.entries(manifest.outputs)) {
      outputs[key] = {
        type: def.type,
        description: def.description,
      }
    }
  }

  return {
    id: manifest.id,
    name: manifest.name,
    provider: manifest.provider,
    description: manifest.description || '',
    version: manifest.version || '1.0.0',
    subBlocks,
    outputs,
    webhook: manifest.webhook
      ? { method: manifest.webhook.method as TriggerConfig['webhook'] extends { method?: infer M } ? M : never }
      : undefined,
  }
}

/**
 * Cache of trigger manifests indexed by trigger ID.
 * Populated when integrations are loaded from the API.
 */
const _triggerCache = new Map<string, ManifestTrigger>()
let _triggerCacheVersion = 0
let _integrationVersion = 0

/**
 * Populates the trigger cache from raw integration data.
 * Called by the registry store after loading integrations.
 */
export function populateTriggerCache(integrations: Array<{ triggers?: ManifestTrigger[] }>): void {
  _triggerCache.clear()
  for (const integration of integrations) {
    for (const trigger of integration.triggers ?? []) {
      _triggerCache.set(trigger.id, trigger)
    }
  }
  _integrationVersion++
  _triggerCacheVersion = _integrationVersion
}

/**
 * Gets a trigger config by ID from the trigger cache.
 * Converts ManifestTrigger → TriggerConfig, injects samplePayload, namespaces subBlock IDs.
 */
export function getTrigger(triggerId: string): TriggerConfig {
  const manifest = _triggerCache.get(triggerId)
  if (!manifest) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }

  const trigger = adaptManifestTrigger(manifest)

  // Clone and filter out deprecated trigger-save subblocks
  const subBlocks = trigger.subBlocks
    .filter((subBlock) => subBlock.id !== 'triggerSave' && subBlock.type !== 'trigger-save')
    .map((subBlock) => namespaceSubBlockId(subBlock, triggerId))

  const clonedTrigger = { ...trigger, subBlocks }

  // Inject samplePayload for webhooks/pollers with condition
  if (trigger.webhook || trigger.id.includes('webhook') || trigger.id.includes('poller')) {
    const samplePayloadExists = clonedTrigger.subBlocks.some(
      (sb) => sb.id === 'samplePayload' || sb.id === `samplePayload_${triggerId}`
    )

    if (!samplePayloadExists && trigger.outputs) {
      const mockPayload = generateMockPayloadFromOutputsDefinition(trigger.outputs)
      const generatedPayload = JSON.stringify(mockPayload, null, 2)

      const samplePayloadSubBlock: SubBlockConfig = {
        id: `samplePayload_${triggerId}`,
        title: 'Event Payload Example',
        type: 'code',
        language: 'json',
        defaultValue: generatedPayload,
        readOnly: true,
        collapsible: true,
        defaultCollapsed: true,
        hideFromPreview: true,
        mode: 'trigger',
        condition: {
          field: 'selectedTriggerId',
          value: trigger.id,
        },
      }

      clonedTrigger.subBlocks.push(samplePayloadSubBlock)
    }
  }

  return clonedTrigger
}

export function getTriggersByProvider(provider: string): TriggerConfig[] {
  const results: TriggerConfig[] = []
  for (const [id, manifest] of _triggerCache) {
    if (manifest.provider === provider) {
      results.push(getTrigger(id))
    }
  }
  return results
}

export function getAllTriggers(): TriggerConfig[] {
  return Array.from(_triggerCache.keys()).map((id) => getTrigger(id))
}

export function getTriggerIds(): string[] {
  return Array.from(_triggerCache.keys())
}

export function isTriggerValid(triggerId: string): boolean {
  return _triggerCache.has(triggerId)
}

export type { TriggerConfig, TriggerRegistry } from '@/triggers/types'

/**
 * Options for building trigger subBlocks
 */
export interface BuildTriggerSubBlocksOptions {
  triggerId: string
  triggerOptions: Array<{ label: string; id: string }>
  includeDropdown?: boolean
  setupInstructions: string
  extraFields?: SubBlockConfig[]
  webhookPlaceholder?: string
}

/**
 * Generic builder for trigger subBlocks.
 * Creates a consistent structure: [dropdown?] -> webhookUrl -> extraFields -> save -> instructions
 */
export function buildTriggerSubBlocks(options: BuildTriggerSubBlocksOptions): SubBlockConfig[] {
  const {
    triggerId,
    triggerOptions,
    includeDropdown = false,
    setupInstructions,
    extraFields = [],
    webhookPlaceholder = 'Webhook URL will be generated',
  } = options

  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: triggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  blocks.push({
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    useWebhookUrl: true,
    placeholder: webhookPlaceholder,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  if (extraFields.length > 0) {
    blocks.push(...extraFields)
  }

  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: setupInstructions,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}
