import { createLogger } from '@sim/logger'
import { useQuery } from '@tanstack/react-query'
import type {
  ManifestBlock,
  ManifestIntegration,
  ManifestTool,
} from '@/stores/registry/types'

const logger = createLogger('RegistryQuery')

export const registryKeys = {
  all: ['registry'] as const,
  integrations: () => [...registryKeys.all, 'integrations'] as const,
  blocks: () => [...registryKeys.all, 'blocks'] as const,
  block: (type: string) => [...registryKeys.blocks(), type] as const,
  tools: () => [...registryKeys.all, 'tools'] as const,
  tool: (id: string) => [...registryKeys.tools(), id] as const,
}

async function fetchIntegrations(): Promise<ManifestIntegration[]> {
  const response = await fetch('/api/registry/integrations')
  if (!response.ok) {
    logger.warn('Failed to fetch integrations', {
      status: response.status,
      statusText: response.statusText,
    })
    throw new Error('Failed to fetch integrations')
  }
  const data = await response.json()
  return data.integrations || []
}

async function fetchBlocks(): Promise<ManifestBlock[]> {
  const response = await fetch('/api/registry/blocks')
  if (!response.ok) {
    logger.warn('Failed to fetch blocks', {
      status: response.status,
      statusText: response.statusText,
    })
    throw new Error('Failed to fetch blocks')
  }
  const data = await response.json()
  return data.blocks || []
}

async function fetchBlock(type: string): Promise<ManifestBlock> {
  const response = await fetch(`/api/registry/blocks/${type}`)
  if (!response.ok) {
    throw new Error(`Block "${type}" not found`)
  }
  const data = await response.json()
  return data.block
}

async function fetchTools(): Promise<ManifestTool[]> {
  const response = await fetch('/api/registry/tools')
  if (!response.ok) {
    throw new Error('Failed to fetch tools')
  }
  const data = await response.json()
  return data.tools || []
}

async function fetchTool(id: string): Promise<ManifestTool> {
  const response = await fetch(`/api/registry/tools/${id}`)
  if (!response.ok) {
    throw new Error(`Tool "${id}" not found`)
  }
  const data = await response.json()
  return data.tool
}

/**
 * Fetches all integration manifests from the registry API.
 * Stale time of 5 minutes since manifests rarely change at runtime.
 */
export function useIntegrations() {
  return useQuery({
    queryKey: registryKeys.integrations(),
    queryFn: fetchIntegrations,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Fetches all block manifests from the registry API.
 */
export function useBlockRegistry() {
  return useQuery({
    queryKey: registryKeys.blocks(),
    queryFn: fetchBlocks,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Fetches a single block manifest by type.
 */
export function useBlockManifest(type: string) {
  return useQuery({
    queryKey: registryKeys.block(type),
    queryFn: () => fetchBlock(type),
    enabled: Boolean(type),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Fetches all tool manifests from the registry API.
 */
export function useToolRegistry() {
  return useQuery({
    queryKey: registryKeys.tools(),
    queryFn: fetchTools,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Fetches a single tool manifest by ID.
 */
export function useToolManifest(id: string) {
  return useQuery({
    queryKey: registryKeys.tool(id),
    queryFn: () => fetchTool(id),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  })
}
