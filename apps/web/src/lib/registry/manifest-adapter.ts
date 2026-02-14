/**
 * Adapts a manifest block definition (JSON) to a BlockConfig (TypeScript object
 * with React components and functions). This bridge allows manifest-backed
 * blocks to be used by all existing consumers without modification.
 */

import { resolveIcon } from '@/lib/registry/icon-resolver'
import { applyBlockEnhancements, resolveConditionReference } from '@/lib/registry/block-enhancements'
import type { ManifestBlock, ManifestSubBlock } from '@/stores/registry/types'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

/**
 * Converts a manifest block (JSON) to a full BlockConfig,
 * then applies runtime enhancements for block types that need them.
 *
 * Key transformations:
 * - icon string -> React component via resolveIcon()
 * - tools.config.tool string -> function that interpolates params
 * - authMode string -> AuthMode enum value
 * - options { value, label } -> { id, label } (SubBlockConfig format)
 * - @@reference conditions -> resolved model arrays
 * - Block enhancements -> runtime functions (options, fetchOptions, toolResolver)
 */
export function adaptManifestToBlockConfig(manifest: ManifestBlock): BlockConfig {
  const baseConfig: BlockConfig = {
    type: manifest.type,
    name: manifest.name,
    description: manifest.description,
    longDescription: manifest.longDescription,
    docsLink: manifest.docsLink,
    category: manifest.category,
    bgColor: manifest.bgColor,
    icon: resolveIcon(manifest.icon),
    hideFromToolbar: manifest.hideFromToolbar,
    authMode: adaptAuthMode(manifest.authMode),
    subBlocks: manifest.subBlocks.map(adaptSubBlock),
    tools: {
      access: manifest.tools.access,
      config: {
        tool: createToolResolver(manifest.tools.config.tool),
      },
    },
    inputs: manifest.inputs as BlockConfig['inputs'],
    outputs: manifest.outputs as BlockConfig['outputs'],
    triggerAllowed: manifest.triggerAllowed,
    triggers: manifest.triggers,
  }

  // Apply runtime enhancements (dynamic options, fetchOptions, tool resolvers)
  return applyBlockEnhancements(baseConfig)
}

function adaptAuthMode(mode?: string): AuthMode | undefined {
  switch (mode) {
    case 'oauth':
      return AuthMode.OAuth
    case 'api_key':
      return AuthMode.ApiKey
    case 'bot_token':
      return AuthMode.BotToken
    default:
      return undefined
  }
}

/**
 * Converts manifest options format ({ value, label }) to SubBlockConfig format ({ id, label }).
 */
function adaptOptions(
  options: ManifestSubBlock['options']
): SubBlockConfig['options'] | undefined {
  if (!options) return undefined

  return options.map((opt) => {
    if (typeof opt === 'string') {
      return { label: opt, id: opt }
    }
    return { label: opt.label, id: opt.value }
  })
}

/**
 * Resolves condition values that contain `@@` references to actual model arrays.
 * Non-@@-referenced conditions are passed through unchanged.
 */
function resolveConditionValue(
  condition: Record<string, unknown>
): SubBlockConfig['condition'] | undefined {
  if (!condition) return undefined

  // If condition is a string (shouldn't happen with proper manifests), skip it
  if (typeof condition !== 'object') return undefined

  const resolved = { ...condition } as Record<string, unknown>

  // Resolve @@reference in the 'value' field
  if (typeof resolved.value === 'string' && (resolved.value as string).startsWith('@@')) {
    const modelArray = resolveConditionReference(resolved.value as string)
    if (modelArray) {
      resolved.value = modelArray
    } else {
      // Unresolvable reference — return undefined to hide the subBlock
      return undefined
    }
  }

  // Resolve @@reference in nested 'and' condition
  if (resolved.and && typeof resolved.and === 'object') {
    const andCondition = { ...(resolved.and as Record<string, unknown>) }
    if (typeof andCondition.value === 'string' && (andCondition.value as string).startsWith('@@')) {
      const modelArray = resolveConditionReference(andCondition.value as string)
      if (modelArray) {
        andCondition.value = modelArray
      }
    }
    resolved.and = andCondition
  }

  return resolved as SubBlockConfig['condition']
}

function adaptSubBlock(sub: ManifestSubBlock): SubBlockConfig {
  const config: SubBlockConfig = {
    id: sub.id,
    type: sub.type as SubBlockConfig['type'],
    title: sub.title,
    placeholder: sub.placeholder,
    password: sub.password,
  }

  if (sub.required !== undefined) {
    config.required = sub.required as SubBlockConfig['required']
  }

  if (sub.default !== undefined) {
    config.defaultValue = sub.default as SubBlockConfig['defaultValue']
  }

  if (sub.condition) {
    if (typeof sub.condition === 'object') {
      const resolved = resolveConditionValue(sub.condition as Record<string, unknown>)
      if (resolved) {
        config.condition = resolved
      }
      // If resolved is undefined (unresolvable @@ref), omit the condition
      // which means the subBlock will always be visible — better than crashing
    }
    // String conditions (like old @@dynamic) are silently ignored
  }

  if (sub.dependsOn) {
    config.dependsOn = sub.dependsOn as SubBlockConfig['dependsOn']
  }

  if (sub.mode) {
    config.mode = sub.mode as SubBlockConfig['mode']
  }

  if (sub.canonicalParamId) {
    config.canonicalParamId = sub.canonicalParamId
  }

  if (sub.options) {
    config.options = adaptOptions(sub.options)
  }

  if (sub.language) {
    config.language = sub.language as SubBlockConfig['language']
  }

  if (sub.columns) {
    config.columns = sub.columns.map((col) =>
      typeof col === 'string' ? col : col.key
    )
  }

  if (sub.layout) {
    // layout is not a standard SubBlockConfig prop but some manifests include it
  }

  if (sub.min !== undefined) config.min = sub.min
  if (sub.max !== undefined) config.max = sub.max
  if (sub.step !== undefined) config.step = sub.step

  return config
}

/**
 * Creates a tool resolver function from a manifest tool config string.
 *
 * Supports patterns:
 * - Static string: "duckduckgo_search" -> () => "duckduckgo_search"
 * - Template: "tavily_{{operation}}" -> (params) => "tavily_" + params.operation
 * - Pure template: "{{operation}}" -> (params) => params.operation
 * - "@@enhanced" -> placeholder, will be overridden by block enhancements
 */
function createToolResolver(toolSpec: string): (params: Record<string, unknown>) => string {
  // @@enhanced means this block's tool resolver is provided by enhancements
  if (toolSpec === '@@enhanced' || toolSpec.startsWith('@@dynamic')) {
    return () => ''
  }

  if (!toolSpec.includes('{{')) {
    return () => toolSpec
  }

  return (params: Record<string, unknown>) => {
    return toolSpec.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      return String(params[key] || '')
    })
  }
}
