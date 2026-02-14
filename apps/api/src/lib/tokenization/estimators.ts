/**
 * Token estimation and accurate counting functions.
 * Simplified stub for the API server -- falls back to character-based estimation.
 */

import { createLogger } from '@sim/logger'

const logger = createLogger('TokenizationEstimators')

/**
 * Get accurate token count for text.
 * Falls back to a character-based heuristic (~4 chars per token).
 */
export function getAccurateTokenCount(text: string, _modelName = 'text-embedding-3-small'): number {
  if (!text || text.length === 0) {
    return 0
  }

  return Math.ceil(text.length / 4)
}
