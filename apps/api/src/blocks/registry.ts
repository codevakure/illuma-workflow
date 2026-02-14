/**
 * Block registry — powered by the Integration Marketplace manifests.
 *
 * All blocks (both integration blocks like slack/github and core workflow
 * blocks like starter/agent/condition) are loaded from JSON manifests in
 * the marketplace. No TypeScript block definition files needed.
 */

import { createLogger } from '@sim/logger'
import { manifestRegistry } from '@/integrations/manifest-loader'
import { adaptBlockManifest } from '@/blocks/manifest-adapter'
import type { BlockConfig } from '@/blocks/types'

const logger = createLogger('BlockRegistry')

let _registry: Record<string, BlockConfig> | null = null

function ensureRegistry(): Record<string, BlockConfig> {
  if (_registry) return _registry

  _registry = {}
  const manifests = manifestRegistry.getAllBlocks()

  for (const manifest of manifests) {
    try {
      _registry[manifest.type] = adaptBlockManifest(manifest)
    } catch (error) {
      logger.warn(`Failed to adapt block manifest: ${manifest.type}`, { error })
    }
  }

  logger.info('Block registry built from manifests', { count: Object.keys(_registry).length })
  return _registry
}

export const registry: Record<string, BlockConfig> = new Proxy({} as Record<string, BlockConfig>, {
  get(_target, prop: string) {
    return ensureRegistry()[prop]
  },
  has(_target, prop: string) {
    return prop in ensureRegistry()
  },
  ownKeys() {
    return Object.keys(ensureRegistry())
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const reg = ensureRegistry()
    if (prop in reg) {
      return { configurable: true, enumerable: true, value: reg[prop] }
    }
    return undefined
  },
})

export const getBlock = (type: string): BlockConfig | undefined => {
  const reg = ensureRegistry()
  if (reg[type]) {
    return reg[type]
  }
  const normalized = type.replace(/-/g, '_')
  return reg[normalized]
}

export const getLatestBlock = (baseType: string): BlockConfig | undefined => {
  const reg = ensureRegistry()
  const normalized = baseType.replace(/-/g, '_')

  const versionedKeys = Object.keys(reg).filter((key) => {
    const match = key.match(new RegExp(`^${normalized}_v(\\d+)$`))
    return match !== null
  })

  if (versionedKeys.length > 0) {
    const sorted = versionedKeys.sort((a, b) => {
      const versionA = Number.parseInt(a.match(/_v(\d+)$/)?.[1] || '0', 10)
      const versionB = Number.parseInt(b.match(/_v(\d+)$/)?.[1] || '0', 10)
      return versionB - versionA
    })
    return reg[sorted[0]]
  }

  return reg[normalized]
}

export const getBlockByToolName = (toolName: string): BlockConfig | undefined => {
  return Object.values(ensureRegistry()).find((block) => block.tools?.access?.includes(toolName))
}

export const getBlocksByCategory = (category: 'blocks' | 'tools' | 'triggers'): BlockConfig[] =>
  Object.values(ensureRegistry()).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(ensureRegistry())

export const isValidBlockType = (type: string): type is string => {
  const reg = ensureRegistry()
  return type in reg || type.replace(/-/g, '_') in reg
}

export const getAllBlocks = (): BlockConfig[] => Object.values(ensureRegistry())
