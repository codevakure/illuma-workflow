import { Hono } from 'hono'
import type { HandlerContext } from '../../sdk/types'
import { getHandlerForTool } from '../handler-loader'
import { executeOperation, validateCredentials } from '../handler-runtime'
import { createLogger } from '../lib/logger'
import { manifestRegistry } from '../manifest-loader'

const logger = createLogger('execute-routes')

export const executeRoutes = new Hono()

/**
 * POST /tools/:toolId/execute
 * Execute a tool operation with provided params and context.
 */
executeRoutes.post('/tools/:toolId/execute', async (c) => {
  const { toolId } = c.req.param()

  const handler = getHandlerForTool(toolId)
  if (!handler) {
    return c.json({ success: false, output: {}, error: `No handler found for tool: ${toolId}` }, 404)
  }

  let body: { params?: Record<string, unknown>; context?: Partial<HandlerContext> }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, output: {}, error: 'Invalid JSON body' }, 400)
  }

  const params = body.params ?? {}
  const ctx: HandlerContext = {
    requestId: body.context?.requestId ?? `mkt-${Date.now()}`,
    accessToken: body.context?.accessToken,
    apiKey: body.context?.apiKey,
    workspaceId: body.context?.workspaceId,
    workflowId: body.context?.workflowId,
  }

  const startTime = Date.now()
  const result = await executeOperation(toolId, params, ctx)
  const duration = Date.now() - startTime

  logger.info(`Executed ${toolId} in ${duration}ms`, { requestId: ctx.requestId })

  return c.json({ ...result, timing: { startedAt: new Date(startTime).toISOString(), duration } })
})

/**
 * POST /tools/:toolId/test
 * Test a tool operation with sample params (for marketplace UI testing).
 */
executeRoutes.post('/tools/:toolId/test', async (c) => {
  const { toolId } = c.req.param()

  const handler = getHandlerForTool(toolId)
  if (!handler) {
    return c.json({ success: false, output: {}, error: `No handler found for tool: ${toolId}` }, 404)
  }

  let body: { params?: Record<string, unknown>; credentials?: Record<string, unknown> } = {}
  try {
    body = await c.req.json()
  } catch {
    // Allow empty body for testing
  }

  const params = body.params ?? {}
  const ctx: HandlerContext = {
    requestId: `test-${Date.now()}`,
    apiKey: (body.credentials?.apiKey as string) ?? undefined,
    accessToken: (body.credentials?.accessToken as string) ?? undefined,
  }

  const startTime = Date.now()
  const result = await executeOperation(toolId, params, ctx)
  const duration = Date.now() - startTime

  return c.json({ ...result, timing: { startedAt: new Date(startTime).toISOString(), duration } })
})

/**
 * POST /tools/:toolId/validate
 * Validate credentials for a tool.
 */
executeRoutes.post('/tools/:toolId/validate', async (c) => {
  const { toolId } = c.req.param()

  let body: { credentials?: Record<string, unknown> } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ valid: false, error: 'Invalid JSON body' }, 400)
  }

  const result = await validateCredentials(toolId, body.credentials ?? {})
  return c.json(result)
})

/**
 * GET /tools/:toolId/schema
 * Get the param and output schema for a tool.
 */
executeRoutes.get('/tools/:toolId/schema', (c) => {
  const { toolId } = c.req.param()

  const tool = manifestRegistry.getTool(toolId)
  if (!tool) {
    return c.json({ error: `Tool not found: ${toolId}` }, 404)
  }

  return c.json({
    toolId: tool.id,
    name: tool.name,
    params: tool.params ?? {},
    outputs: tool.outputs ?? {},
  })
})
