/**
 * Adapter layer that converts TriggerManifest (JSON) to TriggerConfig (runtime).
 */

import type { TriggerManifest } from '@/integrations/types'
import type { TriggerConfig } from '@/triggers/types'
import type { SubBlockConfig } from '@/blocks/types'

/**
 * Converts a TriggerManifest to a TriggerConfig.
 */
export function adaptTriggerManifest(manifest: TriggerManifest): TriggerConfig {
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
      id: `triggerInstructions`,
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

  const outputs: Record<string, any> = {}
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
    description: '',
    version: '1.0.0',
    subBlocks,
    outputs,
    webhook: manifest.webhook
      ? { method: manifest.webhook.method as TriggerConfig['webhook'] extends { method?: infer M } ? M : never }
      : undefined,
  }
}
