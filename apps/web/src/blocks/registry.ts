/**
 * Block registry — powered by the Integration Marketplace manifests.
 *
 * All blocks are fetched from the API registry and adapted from JSON manifests
 * to runtime BlockConfig objects. No local TypeScript block definitions needed.
 */

import { createLogger } from '@sim/logger'
import { adaptManifestToBlockConfig } from '@/lib/registry/manifest-adapter'
import { useRegistryStore } from '@/stores/registry/store'
import type { BlockConfig } from '@/blocks/types'

const logger = createLogger('BlockRegistry')

let _cache: Record<string, BlockConfig> | null = null

function ensureRegistry(): Record<string, BlockConfig> {
  if (_cache) return _cache

  const store = useRegistryStore.getState()
  if (!store.isLoaded) {
    return {}
  }

  _cache = {}
  const manifestBlocks = store.getAllManifestBlocks()

  for (const manifest of manifestBlocks) {
    try {
      _cache[manifest.type] = adaptManifestToBlockConfig(manifest)
    } catch (error) {
      logger.warn(`Failed to adapt block manifest: ${manifest.type}`, { error })
    }
  }

  logger.info('Block registry built from manifests', { count: Object.keys(_cache).length })
  return _cache
}

/** Invalidate the cache when the registry store updates */
useRegistryStore.subscribe((state, prevState) => {
  if (state.isLoaded && !prevState.isLoaded) {
    _cache = null
  }
})

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
