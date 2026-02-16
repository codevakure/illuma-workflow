/**
 * Integration Marketplace Service
 *
 * Standalone service that owns all integration manifest JSON files
 * and serves them via a registry API. Both the API server and web app
 * consume manifests from this service.
 *
 * Default port: 3002
 */

import { serve } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { createLogger } from '@/lib/logger'
import { apiKeyAuth } from '@/middleware/api-key'
import { initializeManifests, resolveIntegrationsDir } from '@/manifest-loader'
import { openApiSpec } from '@/openapi'
import { executeRoutes } from '@/routes/execute'
import { registryRoutes } from '@/routes/registry'
import { uiRoutes } from '@/routes/ui'
import { docsRoutes } from '@/routes/docs'
import { loadHandlers, getHandlerCount } from '@/handler-loader'
import { manifestRegistry } from '@/manifest-loader'

const log = createLogger('Marketplace')

const app = new Hono()

// Middleware
app.use('*', honoLogger())
app.use(
  '*',
  cors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3001,http://localhost:3000').split(','),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Marketplace-Key'],
  })
)

// API key authentication
app.use('/api/marketplace/*', apiKeyAuth)

// Mount routes
app.route('/api/marketplace', registryRoutes)
app.route('/api/marketplace', executeRoutes)

// OpenAPI spec + Swagger UI
app.get('/openapi.json', (c) => c.json(openApiSpec))
app.get('/api-docs', swaggerUI({ url: '/openapi.json' }))

// Marketplace UI and documentation portal
app.route('/ui', uiRoutes)
app.route('/docs', docsRoutes)

// Root health check
app.get('/', (c) => {
  return c.json({
    service: 'sim-marketplace',
    version: '0.0.1',
    ui: '/ui',
    docs: '/docs',
    apiDocs: '/api-docs',
    openapi: '/openapi.json',
  })
})

// Initialize manifests at startup
initializeManifests()

// Load handlers from integration directories
async function initializeHandlers(): Promise<void> {
  try {
    const toolIdMappings = manifestRegistry.getToolIdMappings()
    const integrationsDir = manifestRegistry.getAllIntegrations().length > 0
      ? resolveIntegrationsDir()
      : ''

    if (integrationsDir) {
      await loadHandlers(integrationsDir, toolIdMappings)
      log.info(`Loaded ${getHandlerCount()} handlers`)
    }
  } catch (error) {
    log.error('Failed to initialize handlers', error)
  }
}

initializeHandlers()

// Start server
const port = Number(process.env.MARKETPLACE_PORT || 3002)

log.info(`Starting marketplace service on port ${port}`)

serve({
  fetch: app.fetch,
  port,
})

log.info(`Marketplace service running at http://localhost:${port}`)

export { app }
