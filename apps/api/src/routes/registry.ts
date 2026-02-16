/**
 * Registry routes — provider definitions are served locally; marketplace
 * integration/block/tool/trigger data is proxied from the standalone
 * marketplace service.
 */

import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { PROVIDER_DEFINITIONS } from '@/providers/definitions'
import { getModelPricing, getModelCapabilities } from '@/providers/helpers'
import { manifestRegistry } from '@/integrations/manifest-loader'
import type { AuthContext } from '@/middleware/auth'

const logger = createLogger('RegistryRoutes')

const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'http://localhost:3002'
const MARKETPLACE_API_KEY = process.env.MARKETPLACE_API_KEY || ''

const app = new Hono<{ Variables: AuthContext }>()

// ---------------------------------------------------------------------------
// Provider registry (served locally — no marketplace dependency)
// ---------------------------------------------------------------------------

app.get('/providers', (c) => {
  return c.json({ providers: PROVIDER_DEFINITIONS })
})

app.get('/providers/:id', (c) => {
  const id = c.req.param('id')
  const provider = PROVIDER_DEFINITIONS[id]
  if (!provider) {
    return c.json({ error: `Provider "${id}" not found` }, 404)
  }
  return c.json({ provider })
})

app.get('/models/:id/pricing', (c) => {
  const id = c.req.param('id')
  const pricing = getModelPricing(id)
  if (!pricing) {
    return c.json({ error: `Pricing not found for model "${id}"` }, 404)
  }
  return c.json({ pricing })
})

app.get('/models/:id/capabilities', (c) => {
  const id = c.req.param('id')
  const capabilities = getModelCapabilities(id)
  if (!capabilities) {
    return c.json({ error: `Capabilities not found for model "${id}"` }, 404)
  }
  return c.json({ capabilities })
})

// ---------------------------------------------------------------------------
// Marketplace proxy — forward integration/block/tool/trigger queries to the
// marketplace service. Falls back to local manifest registry if marketplace
// is unreachable.
// ---------------------------------------------------------------------------

/**
 * Proxies a request to the marketplace service.
 * Falls back to local data if marketplace is down.
 */
async function proxyToMarketplace(path: string): Promise<Response | null> {
  try {
    const url = `${MARKETPLACE_URL}/api/marketplace${path}`
    const headers: Record<string, string> = {}
    if (MARKETPLACE_API_KEY) {
      headers['X-Marketplace-Key'] = MARKETPLACE_API_KEY
    }
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(3000),
    })
    if (response.ok) {
      return response
    }
    logger.warn('Marketplace returned non-OK status', { path, status: response.status })
    return null
  } catch (error) {
    logger.debug('Marketplace unreachable, falling back to local registry', { path })
    return null
  }
}

// ---------------------------------------------------------------------------
// Aggregated routes — combine API-local core blocks with marketplace tools.
// Core blocks and triggers are always served from the local manifest registry.
// Tool integrations are fetched from the marketplace, with local fallback.
// ---------------------------------------------------------------------------

app.get('/integrations', (c) => {
  // Serve all integrations from the local manifest registry.
  // Core blocks are loaded from API's blocks/manifests/ directory.
  // Tool integrations are loaded from marketplace's integrations/ directory
  // (only those with handler.ts files, so we only serve migrated tools).
  return c.json({ integrations: manifestRegistry.getAllIntegrations() })
})

app.get('/integrations/:id', async (c) => {
  const id = c.req.param('id')
  // Core integrations: always serve locally (no marketplace proxy needed)
  if (manifestRegistry.isCoreIntegration(id)) {
    const integration = manifestRegistry.getIntegration(id)
    return c.json({ integration })
  }
  // Tool integrations: try marketplace first
  const remote = await proxyToMarketplace(`/integrations/${id}`)
  if (remote) {
    const data = await remote.json()
    return c.json(data)
  }
  const local = manifestRegistry.getIntegration(id)
  if (local) {
    return c.json({ integration: local })
  }
  return c.json({ error: `Integration "${id}" not found` }, 404)
})

app.get('/blocks', (c) => {
  const category = c.req.query('category')
  let blocks = manifestRegistry.getAllBlocks()
  if (category) {
    blocks = blocks.filter((b) => b.category === category)
  }
  return c.json({ blocks })
})

app.get('/blocks/:type', async (c) => {
  const type = c.req.param('type')
  // Check local first (core blocks always available locally)
  const block = manifestRegistry.getBlock(type)
  if (block && manifestRegistry.isCoreIntegration(type)) {
    return c.json({ block })
  }
  // Tool blocks: try marketplace
  const remote = await proxyToMarketplace(`/blocks/${type}`)
  if (remote) {
    const data = await remote.json()
    return c.json(data)
  }
  if (block) {
    return c.json({ block })
  }
  return c.json({ error: `Block type "${type}" not found` }, 404)
})

app.get('/tools', async (c) => {
  const mode = c.req.query('executionMode')
  const qs = mode ? `?executionMode=${mode}` : ''
  const remote = await proxyToMarketplace(`/tools${qs}`)
  if (remote) {
    const data = await remote.json()
    return c.json(data)
  }
  let tools = manifestRegistry.getAllTools()
  if (mode) {
    tools = tools.filter((t) => t.executionMode === mode)
  }
  return c.json({ tools })
})

app.get('/tools/:id', async (c) => {
  const id = c.req.param('id')
  const remote = await proxyToMarketplace(`/tools/${id}`)
  if (remote) {
    const data = await remote.json()
    return c.json(data)
  }
  const tool = manifestRegistry.getTool(id)
  if (!tool) {
    return c.json({ error: `Tool "${id}" not found` }, 404)
  }
  return c.json({ tool })
})

// Triggers: always served locally (trigger config is in core/trigger manifests)
app.get('/triggers', (c) => {
  return c.json({ triggers: manifestRegistry.getAllTriggers() })
})

app.get('/triggers/:provider', (c) => {
  const provider = c.req.param('provider')
  const trigger = manifestRegistry.getTrigger(provider)
  if (!trigger) {
    return c.json({ error: `Trigger for provider "${provider}" not found` }, 404)
  }
  return c.json({ trigger })
})

app.get('/stats', async (c) => {
  const remote = await proxyToMarketplace('/stats')
  if (remote) {
    const data = await remote.json()
    // Merge stats: add local core/trigger counts
    const localStats = manifestRegistry.stats()
    return c.json({
      ...data,
      coreBlocks: localStats.blocks,
      localTriggers: localStats.triggers,
    })
  }
  return c.json(manifestRegistry.stats())
})

export { app as registryRoutes }
