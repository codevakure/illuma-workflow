import { Hono } from 'hono'
import { getAllModelIds } from '../providers/helpers'
import type { AuthContext } from '../middleware/auth'

const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET /api/providers/base/models
 * List available base models.
 */
app.get('/base/models', (c) => {
  return c.json({ models: getAllModelIds() })
})

/**
 * GET /api/providers/ollama/models
 * List available Ollama models
 */
app.get('/ollama/models', (c) => {
  return c.json({ models: [] })
})

/**
 * GET /api/providers/vllm/models
 * List available vLLM models
 */
app.get('/vllm/models', (c) => {
  return c.json({ models: [] })
})

/**
 * GET /api/providers/openrouter/models
 * List available OpenRouter models
 */
app.get('/openrouter/models', (c) => {
  return c.json({ models: [] })
})

export { app as providerRoutes }
