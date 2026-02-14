/**
 * Tool registry — powered by the Integration Marketplace manifests.
 *
 * All tools are fetched from the API registry store and adapted from manifest
 * JSON to ToolConfig objects. Tool execution happens server-side via the
 * tool-proxy; this registry provides metadata for parameter schemas,
 * validation, and UI rendering.
 */

import { createLogger } from '@sim/logger'
import { useRegistryStore } from '@/stores/registry/store'
import type { ManifestTool } from '@/stores/registry/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ToolRegistry')

let _cache: Record<string, ToolConfig> | null = null

/**
 * Adapts a ManifestTool (JSON) to a ToolConfig (runtime).
 * The web app does not execute tools directly — execution goes through the
 * API tool-proxy. The request fields are stubs that route to the proxy.
 */
function adaptManifestTool(manifest: ManifestTool): ToolConfig {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    params: manifest.params as ToolConfig['params'],
    outputs: manifest.outputs as ToolConfig['outputs'],
    request: {
      url: `/api/tools/proxy/${manifest.id}`,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
    },
  }
}

function ensureRegistry(): Record<string, ToolConfig> {
  if (_cache) return _cache

  const store = useRegistryStore.getState()
  if (!store.isLoaded) {
    return {}
  }

  _cache = {}
  const manifestTools = Object.values(store.tools)

  for (const manifest of manifestTools) {
    try {
      _cache[manifest.id] = adaptManifestTool(manifest)
    } catch (error) {
      logger.warn(`Failed to adapt tool manifest: ${manifest.id}`, { error })
    }
  }

  logger.info('Tool registry built from manifests', { count: Object.keys(_cache).length })
  return _cache
}

/** Invalidate the cache when the registry store updates */
useRegistryStore.subscribe((state, prevState) => {
  if (state.isLoaded && !prevState.isLoaded) {
    _cache = null
  }
})

export const tools: Record<string, ToolConfig> = new Proxy({} as Record<string, ToolConfig>, {
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
