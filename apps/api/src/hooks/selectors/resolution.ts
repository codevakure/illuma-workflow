/**
 * Selector resolution stub for the API server.
 */

import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorKey } from '@/hooks/selectors/types'

interface SelectorResolution {
  key: SelectorKey
}

/**
 * Resolves the selector for a given subBlock configuration.
 */
export function resolveSelectorForSubBlock(
  _subBlockConfig: SubBlockConfig,
  _context: Record<string, unknown>
): SelectorResolution | null {
  return null
}
