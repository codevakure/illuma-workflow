/**
 * Selector registry stub for the API server.
 */

import type { SelectorKey } from '@/hooks/selectors/types'

interface SelectorOption {
  id: string
  label: string
}

interface FetchByIdParams {
  key: SelectorKey
  context: Record<string, unknown>
  detailId: string
}

interface FetchListParams {
  key: SelectorKey
  context: Record<string, unknown>
}

interface SelectorDefinition {
  fetchById?: (params: FetchByIdParams) => Promise<SelectorOption | null>
  fetchList: (params: FetchListParams) => Promise<SelectorOption[]>
}

/**
 * Gets the selector definition for a given key.
 */
export function getSelectorDefinition(_key: SelectorKey): SelectorDefinition {
  return {
    fetchById: async () => null,
    fetchList: async () => [],
  }
}
