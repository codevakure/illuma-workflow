/**
 * API key authentication middleware for the marketplace service.
 *
 * Requires a valid MARKETPLACE_API_KEY header on all registry endpoints.
 * The health endpoint is excluded to allow monitoring without auth.
 */

import type { Context, Next } from 'hono'
import { createLogger } from '@/lib/logger'

const logger = createLogger('ApiKeyAuth')

const MARKETPLACE_API_KEY = process.env.MARKETPLACE_API_KEY || ''

/**
 * Validates the X-Marketplace-Key header against the configured API key.
 * Skips auth if no MARKETPLACE_API_KEY is configured (development mode).
 */
export async function apiKeyAuth(c: Context, next: Next) {
  // Skip auth if no key is configured (local development)
  if (!MARKETPLACE_API_KEY) {
    return next()
  }

  // Skip auth for health check
  if (c.req.path.endsWith('/health')) {
    return next()
  }

  const providedKey = c.req.header('X-Marketplace-Key')

  if (!providedKey) {
    logger.warn('Missing API key', { path: c.req.path })
    return c.json({ error: 'Missing X-Marketplace-Key header' }, 401)
  }

  if (providedKey !== MARKETPLACE_API_KEY) {
    logger.warn('Invalid API key', { path: c.req.path })
    return c.json({ error: 'Invalid API key' }, 403)
  }

  return next()
}
