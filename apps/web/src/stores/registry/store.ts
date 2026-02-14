import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import type {
  ManifestBlock,
  ManifestIntegration,
  ManifestTool,
  RegistryStore,
} from '@/stores/registry/types'

const logger = createLogger('RegistryStore')

const initialState = {
  blocks: {} as Record<string, ManifestBlock>,
  tools: {} as Record<string, ManifestTool>,
  isLoaded: false,
  isLoading: false,
  error: null as string | null,
}

export const useRegistryStore = create<RegistryStore>()((set, get) => ({
  ...initialState,

  loadRegistry: async () => {
    if (get().isLoaded || get().isLoading) return

    try {
      set({ isLoading: true, error: null })

      const response = await fetch('/api/registry/integrations')
      if (!response.ok) {
        throw new Error(`Failed to load registry: ${response.statusText}`)
      }

      const { integrations } = (await response.json()) as {
        integrations: ManifestIntegration[]
      }

      const blocks: Record<string, ManifestBlock> = {}
      const tools: Record<string, ManifestTool> = {}

      for (const integration of integrations) {
        if (integration.block) {
          blocks[integration.block.type] = integration.block
        }
        for (const tool of integration.tools) {
          tools[tool.id] = tool
        }
      }

      logger.info('Registry loaded', {
        blocks: Object.keys(blocks).length,
        tools: Object.keys(tools).length,
      })

      set({ blocks, tools, isLoaded: true, isLoading: false })
    } catch (error) {
      logger.error('Failed to load registry', { error })
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  getManifestBlock: (type: string) => {
    return get().blocks[type]
  },

  getManifestTool: (id: string) => {
    return get().tools[id]
  },

  hasManifestBlock: (type: string) => {
    return type in get().blocks
  },

  getAllManifestBlocks: () => {
    return Object.values(get().blocks)
  },

  reset: () => {
    set(initialState)
  },
}))
