/**
 * Trigger API — backed by manifest registry.
 *
 * Reads trigger data from TriggerManifest (JSON manifests) instead of
 * hardcoded TypeScript trigger definitions. The manifest-adapter converts
 * TriggerManifest → TriggerConfig so all consumers see the same interface.
 */

import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/trigger-utils'
import type { SubBlockConfig } from '@/blocks/types'
import { manifestRegistry } from '@/integrations/manifest-loader'
import { adaptTriggerManifest } from '@/triggers/manifest-adapter'
import type { TriggerConfig } from '@/triggers/types'

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
 * Gets a trigger config by ID from the manifest registry.
 * Converts TriggerManifest → TriggerConfig, injects samplePayload, namespaces subBlock IDs.
 */
export function getTrigger(triggerId: string): TriggerConfig {
  const manifest = manifestRegistry.getTriggerById(triggerId)
  if (!manifest) {
    throw new Error(`Trigger not found: ${triggerId}`)
  }

  const trigger = adaptTriggerManifest(manifest)

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
  return manifestRegistry
    .getTriggersForProvider(provider)
    .map((m) => getTrigger(m.id))
}

export function getAllTriggers(): TriggerConfig[] {
  return manifestRegistry
    .getAllTriggers()
    .map((m) => getTrigger(m.id))
}

export function getTriggerIds(): string[] {
  return manifestRegistry.getAllTriggers().map((m) => m.id)
}

export function isTriggerValid(triggerId: string): boolean {
  return manifestRegistry.getTriggerById(triggerId) !== undefined
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
