import { serve } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { initializeManifests } from './integrations/manifest-loader'
import { seedDevSession } from './lib/auth/dev-seed'
import { authMiddleware } from './middleware/auth'
import { oauthCallbackRoutes } from './routes/oauth-callback'
import { authRoutes } from './routes/auth'
import { chatPublicRoutes } from './routes/chat-public'
import { chatRoutes } from './routes/chat'
import { copilotRoutes } from './routes/copilot'
import { credentialSetRoutes } from './routes/credential-sets'
import { customToolRoutes } from './routes/custom-tools'
import { environmentRoutes } from './routes/environment'
import { fileRoutes } from './routes/files'
import { folderRoutes } from './routes/folders'
import { formPublicRoutes } from './routes/form-public'
import { formRoutes } from './routes/forms'
import { functionRoutes } from './routes/function/execute'
import { guardrailRoutes } from './routes/guardrails'
import { knowledgeRoutes } from './routes/knowledge'
import { logRoutes } from './routes/logs'
import { mcpRoutes } from './routes/mcp'
import { memoryRoutes } from './routes/memory'
import { providerRoutes } from './routes/providers'
import { registryRoutes } from './routes/registry'
import { resumeRoutes } from './routes/resume'
import { scheduleRoutes } from './routes/schedules'
import { stubRoutes } from './routes/stubs'
import { templateRoutes } from './routes/templates'
import { toolRoutes } from './routes/tools'
import { userRoutes } from './routes/users'
import { webhookRoutes, webhookTriggerRoutes } from './routes/webhooks'
import { workflowRoutes } from './routes/workflows'
import { deployRoutes } from './routes/workflows/deploy'
import { executeRoutes } from './routes/workflows/execute'
import { workflowOperationRoutes } from './routes/workflows/operations'
import { workflowStateRoutes } from './routes/workflows/state'
import { workspaceRoutes } from './routes/workspaces'

const app = new Hono()

// Global middleware
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
    credentials: true,
  })
)

// OpenAPI spec + Swagger UI
app.get('/openapi.json', async (c) => {
  const { openApiSpec } = await import('./openapi')
  return c.json(openApiSpec)
})
app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// Health check (no auth)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Public routes (no auth required)
app.route('/api/webhooks', webhookTriggerRoutes)
app.route('/api/chat', chatPublicRoutes)
app.route('/api/form', formPublicRoutes)

// OAuth2 callback (public — browser redirected here by OAuth provider)
app.route('/api/auth/oauth2', oauthCallbackRoutes)

// API routes (with auth)
const api = new Hono()
api.use('*', authMiddleware)
api.route('/workflows', workflowRoutes)
api.route('/workflows', executeRoutes)
api.route('/workflows', workflowStateRoutes)
api.route('/workspaces', workspaceRoutes)
api.route('/users', userRoutes)
api.route('/providers', providerRoutes)
api.route('/folders', folderRoutes)
api.route('/environment', environmentRoutes)
api.route('/auth', authRoutes)
api.route('/templates', templateRoutes)
api.route('/registry', registryRoutes)
api.route('/workflows', deployRoutes)
api.route('/workflows', workflowOperationRoutes)
api.route('/logs', logRoutes)
api.route('/credential-sets', credentialSetRoutes)
api.route('/memory', memoryRoutes)
api.route('/chat', chatRoutes)
api.route('/form', formRoutes)
api.route('/mcp', mcpRoutes)
api.route('/copilot', copilotRoutes)
api.route('/tools/custom', customToolRoutes)
api.route('/tools', toolRoutes)
api.route('/webhooks', webhookRoutes)
api.route('/resume', resumeRoutes)
api.route('/function', functionRoutes)
api.route('/guardrails', guardrailRoutes)
api.route('/schedules', scheduleRoutes)
api.route('/files', fileRoutes)
api.route('/knowledge', knowledgeRoutes)
// Stubs last — catch-all for remaining endpoints
api.route('/', stubRoutes)

app.route('/api', api)

// 404 handler
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

// Initialize integration manifests
initializeManifests()

// Seed dev session for OAuth testing
seedDevSession().catch(console.error)

const port = Number(process.env.PORT) || 3001

console.log(`Starting API server on port ${port}...`)

serve({
  fetch: app.fetch,
  port,
})

console.log(`API server running at http://localhost:${port}`)
