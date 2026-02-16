/**
 * Adapter layer that converts BlockManifest (JSON) to BlockConfig (runtime).
 *
 * This bridges the gap between the static JSON manifest schema served by the
 * marketplace and the runtime BlockConfig interface used by the executor,
 * serializer, and UI components.
 */

import type { BlockManifest, SubBlockSchema, SubBlockCondition } from '@/integrations/types'
import type { BlockConfig, SubBlockConfig, OutputFieldDefinition, PrimitiveValueType } from '@/blocks/types'

/**
 * Converts a manifest template expression like "slack_{{operation}}" into
 * a function `(params) => string` that evaluates the expression at runtime.
 */
function createToolSelector(expression: string): (params: Record<string, any>) => string {
  if (!expression.includes('{{')) {
    return () => expression
  }
  return (params: Record<string, any>) =>
    expression.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''))
}

/**
 * Converts SubBlockSchema (manifest JSON) to SubBlockConfig (runtime).
 * SubBlockConfig is a superset — we populate required fields and leave
 * runtime-only fields (fetchOptions, wandConfig, etc.) unset.
 */
function adaptSubBlock(schema: SubBlockSchema): SubBlockConfig {
  const config: SubBlockConfig = {
    id: schema.id,
    type: schema.type as SubBlockConfig['type'],
    title: schema.title,
    placeholder: schema.placeholder,
    password: schema.password,
    mode: schema.mode as SubBlockConfig['mode'],
    canonicalParamId: schema.canonicalParamId,
    min: schema.min,
    max: schema.max,
    step: schema.step,
    language: schema.language as SubBlockConfig['language'],
  }

  if (schema.default !== undefined) {
    config.defaultValue = schema.default as SubBlockConfig['defaultValue']
  }

  if (schema.required !== undefined) {
    if (typeof schema.required === 'boolean') {
      config.required = schema.required
    } else {
      config.required = adaptCondition(schema.required)
    }
  }

  if (schema.condition) {
    config.condition = adaptCondition(schema.condition)
  }

  if (schema.dependsOn) {
    config.dependsOn = schema.dependsOn
  }

  if (schema.options) {
    config.options = schema.options.map((opt) => {
      if (typeof opt === 'string') {
        return { label: opt, id: opt }
      }
      return { label: opt.label, id: opt.value }
    })
  }

  if (schema.columns) {
    config.columns = schema.columns.map((col) =>
      typeof col === 'string' ? col : col.key
    )
  }

  if (schema.description) config.description = schema.description
  if (schema.hidden) config.hidden = schema.hidden
  if (schema.rows !== undefined) config.rows = schema.rows
  if (schema.multiSelect) config.multiSelect = schema.multiSelect
  if (schema.searchable) config.searchable = schema.searchable

  return config
}

/**
 * Converts SubBlockCondition (manifest) to the runtime condition format.
 */
function adaptCondition(cond: SubBlockCondition): SubBlockConfig['condition'] {
  const result: NonNullable<SubBlockConfig['condition']> & object = {
    field: cond.field,
    value: cond.value as string | number | boolean | Array<string | number | boolean>,
  }
  if (cond.not) {
    result.not = true
  }
  if (cond.and) {
    result.and = {
      field: cond.and.field,
      value: cond.and.value as string | number | boolean | Array<string | number | boolean>,
      not: cond.and.not,
    }
  }
  return result
}

/**
 * Converts a BlockManifest to a BlockConfig.
 */
export function adaptBlockManifest(manifest: BlockManifest): BlockConfig {
  const subBlocks = manifest.subBlocks.map(adaptSubBlock)

  const outputs: Record<string, OutputFieldDefinition> = {}
  if (manifest.outputs) {
    for (const [key, def] of Object.entries(manifest.outputs)) {
      outputs[key] = def.description
        ? { type: def.type as PrimitiveValueType, description: def.description }
        : (def.type as PrimitiveValueType)
    }
  }

  const inputs: BlockConfig['inputs'] = {}
  if (manifest.inputs) {
    for (const [key, def] of Object.entries(manifest.inputs)) {
      inputs[key] = {
        type: def.type as any,
        description: def.description,
      }
    }
  }

  const toolConfig: BlockConfig['tools'] = {
    access: manifest.tools.access,
  }

  if (manifest.tools.config?.tool) {
    toolConfig.config = {
      tool: createToolSelector(manifest.tools.config.tool),
    }
  }

  return {
    type: manifest.type,
    name: manifest.name,
    description: manifest.description,
    longDescription: manifest.longDescription,
    docsLink: manifest.docsLink,
    category: manifest.category,
    bgColor: manifest.bgColor,
    icon: manifest.icon,
    authMode: manifest.authMode as BlockConfig['authMode'],
    hideFromToolbar: manifest.hideFromToolbar,
    triggerAllowed: manifest.triggerAllowed,
    triggers: manifest.triggers,
    bestPractices: manifest.bestPractices,
    subBlocks,
    tools: toolConfig,
    inputs,
    outputs,
  }
}
