import crypto from 'node:crypto'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { eq, and, desc } from 'drizzle-orm'
import { createLogger } from '@sim/logger'
import { db } from '@sim/db'
import {
  apiKey,
  a2aAgent,
  workflow,
  workflowDeploymentVersion,
  customTools,
} from '@sim/db/schema'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('StubRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * Masks an API key value, showing only the first 8 and last 4 characters.
 */
function maskApiKey(key: string): string {
  if (key.length <= 12) {
    return `${key.slice(0, 4)}${'*'.repeat(Math.max(key.length - 4, 0))}`
  }
  return `${key.slice(0, 8)}${'*'.repeat(key.length - 12)}${key.slice(-4)}`
}

// ---------------------------------------------------------------------------
// Custom Tools
// ---------------------------------------------------------------------------

/**
 * GET /api/tools/custom
 */
app.get('/tools/custom', async (c) => {
  const userId = getUserId(c)

  try {
    const tools = await db
      .select()
      .from(customTools)
      .where(eq(customTools.userId, userId))
    return c.json({ tools })
  } catch (error) {
    logger.error('Error listing custom tools', error)
    return c.json({ tools: [] })
  }
})

// ---------------------------------------------------------------------------
// User / Super-user
// ---------------------------------------------------------------------------

/**
 * GET /api/user/super-user
 */
app.get('/user/super-user', (_c) => {
  return _c.json({ isSuperUser: false })
})

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

/**
 * GET /api/users/me/api-keys
 */
app.get('/users/me/api-keys', async (c) => {
  const userId = getUserId(c)

  try {
    const keys = await db
      .select()
      .from(apiKey)
      .where(eq(apiKey.userId, userId))

    const masked = keys.map((k) => ({
      ...k,
      key: maskApiKey(k.key),
    }))

    return c.json({ apiKeys: masked })
  } catch (error) {
    logger.error('Error listing API keys', error)
    return c.json({ apiKeys: [] })
  }
})

/**
 * POST /api/users/me/api-keys
 */
app.post('/users/me/api-keys', async (c) => {
  const userId = getUserId(c)

  try {
    const body = await c.req.json<{ name?: string }>()
    const name = body?.name?.trim()

    if (!name) {
      return c.json({ error: 'Name is required' }, 400)
    }

    const id = crypto.randomUUID()
    const rawKey = `sim_${crypto.randomUUID().replace(/-/g, '')}`

    const [created] = await db
      .insert(apiKey)
      .values({
        id,
        userId,
        name,
        key: rawKey,
        type: 'personal',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    return c.json({
      apiKey: {
        id: created.id,
        name: created.name,
        key: rawKey,
        createdAt: created.createdAt,
      },
    })
  } catch (error) {
    logger.error('Error creating API key', error)
    return c.json({ error: 'Failed to create API key' }, 500)
  }
})

/**
 * DELETE /api/users/me/api-keys/:id
 */
app.delete('/users/me/api-keys/:id', async (c) => {
  const userId = getUserId(c)
  const keyId = c.req.param('id')

  try {
    await db
      .delete(apiKey)
      .where(and(eq(apiKey.id, keyId), eq(apiKey.userId, userId)))

    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting API key ${keyId}`, error)
    return c.json({ error: 'Failed to delete API key' }, 500)
  }
})

// ---------------------------------------------------------------------------
// A2A Agents
// ---------------------------------------------------------------------------

/**
 * GET /api/a2a/agents
 */
app.get('/a2a/agents', async (c) => {
  const workspaceId = c.req.query('workspaceId')

  try {
    if (!workspaceId) {
      return c.json({ agents: [] })
    }

    const agents = await db
      .select()
      .from(a2aAgent)
      .where(eq(a2aAgent.workspaceId, workspaceId))

    return c.json({ agents })
  } catch (error) {
    logger.error('Error listing A2A agents', error)
    return c.json({ agents: [] })
  }
})

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * GET /api/notifications
 */
app.get('/notifications', (_c) => {
  return _c.json({ notifications: [] })
})

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * GET /api/status
 */
app.get('/status', (_c) => {
  return _c.json({ status: 'ok' })
})

// ---------------------------------------------------------------------------
// Workflow Status / Deployments / Variables
// ---------------------------------------------------------------------------

/**
 * GET /api/workflows/:id/status
 */
app.get('/workflows/:id/status', async (c) => {
  const workflowId = c.req.param('id')

  try {
    const [w] = await db
      .select({ isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    return c.json({ isDeployed: w?.isDeployed ?? false })
  } catch (error) {
    logger.error(`Error getting workflow ${workflowId} status`, error)
    return c.json({ isDeployed: false })
  }
})

/**
 * GET /api/workflows/:id/deployments
 */
app.get('/workflows/:id/deployments', async (c) => {
  const workflowId = c.req.param('id')

  try {
    const deployments = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
      .orderBy(desc(workflowDeploymentVersion.version))

    return c.json({ deployments })
  } catch (error) {
    logger.error(`Error getting deployments for workflow ${workflowId}`, error)
    return c.json({ deployments: [] })
  }
})

/**
 * PUT /api/workflows/reorder
 */
app.put('/workflows/reorder', (_c) => {
  return _c.json({ success: true })
})

/**
 * GET /api/workflows/:id/variables
 */
app.get('/workflows/:id/variables', async (c) => {
  const workflowId = c.req.param('id')

  try {
    const [w] = await db
      .select({ variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    return c.json({ variables: w?.variables ?? [] })
  } catch (error) {
    logger.error(`Error getting workflow ${workflowId} variables`, error)
    return c.json({ variables: [] })
  }
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

/**
 * GET /api/billing
 */
app.get('/billing', (_c) => {
  return _c.json({ billing: { plan: 'free', status: 'active' } })
})

/**
 * GET /api/billing/credits
 */
app.get('/billing/credits', (_c) => {
  return _c.json({ credits: 0, balance: 0 })
})

/**
 * GET /api/billing/portal
 */
app.get('/billing/portal', (_c) => {
  return _c.json({ url: null })
})

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * GET /api/usage
 */
app.get('/usage', (_c) => {
  return _c.json({ usage: { totalRuns: 0, totalCost: 0 } })
})

/**
 * GET /api/users/me/usage-limits
 */
app.get('/users/me/usage-limits', (_c) => {
  return _c.json({
    limits: { maxRuns: -1, maxCost: -1 },
    usage: { totalRuns: 0, totalCost: 0 },
  })
})

// ---------------------------------------------------------------------------
// Wand (AI Copilot)
// ---------------------------------------------------------------------------

/**
 * POST /api/wand
 *
 * Forwards a prompt to OpenAI chat completions (gpt-4o).
 * Supports both streaming (SSE) and non-streaming modes.
 */
app.post('/wand', async (c) => {
  const openaiKey = process.env.OPENAI_API_KEY
  const azureKey = process.env.AZURE_OPENAI_API_KEY
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o'

  if (!openaiKey && !azureKey) {
    return c.json(
      { error: 'Wand feature requires OpenAI API key configuration' },
      501
    )
  }

  try {
    const body = await c.req.json<{
      prompt?: string
      systemPrompt?: string
      stream?: boolean
      history?: Array<{ role: string; content: string }>
    }>()

    if (!body?.prompt) {
      return c.json({ error: 'prompt is required' }, 400)
    }

    const messages: Array<{ role: string; content: string }> = []

    if (body.systemPrompt) {
      messages.push({ role: 'system', content: body.systemPrompt })
    }

    if (body.history && Array.isArray(body.history)) {
      messages.push(...body.history)
    }

    messages.push({ role: 'user', content: body.prompt })

    let url: string
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (azureKey && azureEndpoint) {
      url = `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=2024-02-01`
      headers['api-key'] = azureKey
    } else {
      url = 'https://api.openai.com/v1/chat/completions'
      headers['Authorization'] = `Bearer ${openaiKey}`
    }

    const payload = {
      model: 'gpt-4o',
      messages,
      stream: body.stream ?? false,
    }

    if (!body.stream) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('OpenAI API error', { status: response.status, body: errorText })
        return c.json({ error: 'OpenAI API request failed' }, 502)
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
      }

      return c.json({ result: data.choices[0]?.message?.content ?? null })
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok || !response.body) {
      const errorText = await response.text()
      logger.error('OpenAI streaming API error', { status: response.status, body: errorText })
      return c.json({ error: 'OpenAI API streaming request failed' }, 502)
    }

    return streamSSE(c, async (stream) => {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const chunk = trimmed.slice(6)
            if (chunk === '[DONE]') {
              await stream.writeSSE({ data: '[DONE]' })
              return
            }

            try {
              const parsed = JSON.parse(chunk) as {
                choices: Array<{ delta: { content?: string } }>
              }
              const content = parsed.choices[0]?.delta?.content
              if (content) {
                await stream.writeSSE({ data: content })
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    })
  } catch (error) {
    logger.error('Error in wand endpoint', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export { app as stubRoutes }
