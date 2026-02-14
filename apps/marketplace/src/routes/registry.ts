/**
 * Registry routes for the Integration Marketplace.
 * Serves block, tool, trigger, and integration manifests.
 */

import { Hono } from 'hono'
import { manifestRegistry } from '@/manifest-loader'

const app = new Hono()

/**
 * GET /integrations
 * Returns all integration manifests.
 */
app.get('/integrations', (c) => {
  const integrations = manifestRegistry.getAllIntegrations()
  return c.json({ integrations })
})

/**
 * GET /integrations/:id
 * Returns a single integration manifest.
 */
app.get('/integrations/:id', (c) => {
  const id = c.req.param('id')
  const integration = manifestRegistry.getIntegration(id)
  if (!integration) {
    return c.json({ error: `Integration "${id}" not found` }, 404)
  }
  return c.json({ integration })
})

/**
 * GET /blocks
 * Returns all block manifests (for web toolbar/palette).
 * Supports ?category= filter.
 */
app.get('/blocks', (c) => {
  const category = c.req.query('category')
  let blocks = manifestRegistry.getAllBlocks()
  if (category) {
    blocks = blocks.filter((b) => b.category === category)
  }
  return c.json({ blocks })
})

/**
 * GET /blocks/:type
 * Returns a single block manifest by type.
 */
app.get('/blocks/:type', (c) => {
  const type = c.req.param('type')
  const block = manifestRegistry.getBlock(type)
  if (!block) {
    return c.json({ error: `Block type "${type}" not found` }, 404)
  }
  return c.json({ block })
})

/**
 * GET /tools
 * Returns all tool manifests.
 * Supports ?executionMode= filter.
 */
app.get('/tools', (c) => {
  const mode = c.req.query('executionMode')
  let tools = manifestRegistry.getAllTools()
  if (mode) {
    tools = tools.filter((t) => t.executionMode === mode)
  }
  return c.json({ tools })
})

/**
 * GET /tools/:id
 * Returns a single tool manifest by ID.
 */
app.get('/tools/:id', (c) => {
  const id = c.req.param('id')
  const tool = manifestRegistry.getTool(id)
  if (!tool) {
    return c.json({ error: `Tool "${id}" not found` }, 404)
  }
  return c.json({ tool })
})

/**
 * GET /triggers
 * Returns all trigger manifests.
 */
app.get('/triggers', (c) => {
  const triggers = manifestRegistry.getAllTriggers()
  return c.json({ triggers })
})

/**
 * GET /triggers/:provider
 * Returns a single trigger manifest by provider.
 */
app.get('/triggers/:provider', (c) => {
  const provider = c.req.param('provider')
  const trigger = manifestRegistry.getTrigger(provider)
  if (!trigger) {
    return c.json({ error: `Trigger for provider "${provider}" not found` }, 404)
  }
  return c.json({ trigger })
})

/**
 * GET /stats
 * Returns counts of loaded manifests for monitoring.
 */
app.get('/stats', (c) => {
  return c.json(manifestRegistry.stats())
})

/**
 * GET /health
 * Health check endpoint.
 */
app.get('/health', (c) => {
  const stats = manifestRegistry.stats()
  return c.json({
    status: 'ok',
    service: 'marketplace',
    ...stats,
  })
})

export { app as registryRoutes }
