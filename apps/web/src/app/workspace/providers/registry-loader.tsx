'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useIntegrations } from '@/hooks/queries/registry'
import { useRegistryStore } from '@/stores/registry/store'

const logger = createLogger('RegistryLoader')

/**
 * Syncs integration manifests from React Query into the registry Zustand store.
 * Renders nothing — just loads data on mount.
 */
export function RegistryLoader() {
  const { data: integrations, error } = useIntegrations()
  const isLoaded = useRegistryStore((state) => state.isLoaded)

  useEffect(() => {
    if (!integrations || isLoaded) return

    const blocks: Record<string, import('@/stores/registry/types').ManifestBlock> = {}
    const tools: Record<string, import('@/stores/registry/types').ManifestTool> = {}

    for (const integration of integrations) {
      if (integration.block) {
        blocks[integration.block.type] = integration.block
      }
      for (const tool of integration.tools) {
        tools[tool.id] = tool
      }
    }

    logger.info('Registry synced from API', {
      blocks: Object.keys(blocks).length,
      tools: Object.keys(tools).length,
    })

    useRegistryStore.setState({
      blocks,
      tools,
      isLoaded: true,
      isLoading: false,
      error: null,
    })
  }, [integrations, isLoaded])

  useEffect(() => {
    if (error) {
      logger.error('Failed to load registry', error)
    }
  }, [error])

  return null
}
