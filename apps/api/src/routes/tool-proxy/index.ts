import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import type { AuthContext } from '@/middleware/auth'
import { getDedicatedHandler } from '@/routes/tool-proxy/handler-registry'
import { handleGenericProxy } from '@/routes/tool-proxy/generic-handler'

const logger = createLogger('ToolProxy')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * POST /api/tool-proxy/:service/:action
 * Catch-all tool proxy dispatcher. Routes requests to dedicated handlers
 * (for complex tools like Slack, Gmail, databases) or falls through to the
 * generic handler (which reads ToolConfig and forwards the request).
 */
app.post('/:service/:action', async (c) => {
  const service = c.req.param('service')
  const action = c.req.param('action')
  const routeKey = `${service}/${action}`

  try {
    const body = await c.req.json()

    // Check for a dedicated handler first
    const dedicatedHandler = getDedicatedHandler(service, action)
    if (dedicatedHandler) {
      logger.info(`Dispatching to dedicated handler: ${routeKey}`)
      const result = await dedicatedHandler(body, c)
      return c.json(result, result.success === false ? 400 : 200)
    }

    // Fall through to generic proxy handler
    logger.info(`Dispatching to generic proxy handler: ${routeKey}`)
    const result = await handleGenericProxy(service, action, body, c)
    return c.json(result, result.success === false ? 400 : 200)
  } catch (error) {
    logger.error(`Error in tool proxy ${routeKey}:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return c.json({ success: false, error: errorMessage }, 500)
  }
})

/**
 * POST /api/tool-proxy/:service (single-level paths)
 * Handles routes like /api/tools/search, /api/tools/thinking
 */
app.post('/:service', async (c) => {
  const service = c.req.param('service')

  try {
    const body = await c.req.json()

    const dedicatedHandler = getDedicatedHandler(service)
    if (dedicatedHandler) {
      logger.info(`Dispatching to dedicated handler: ${service}`)
      const result = await dedicatedHandler(body, c)
      return c.json(result, result.success === false ? 400 : 200)
    }

    // Fall through to generic proxy handler
    const result = await handleGenericProxy(service, undefined, body, c)
    return c.json(result, result.success === false ? 400 : 200)
  } catch (error) {
    logger.error(`Error in tool proxy ${service}:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return c.json({ success: false, error: errorMessage }, 500)
  }
})

export { app as toolProxyRoutes }
