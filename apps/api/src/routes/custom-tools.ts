import crypto from 'node:crypto'
import { Hono } from 'hono'
import { db } from '@sim/db'
import { customTools } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { desc, eq, or } from 'drizzle-orm'
import { getUserId, type AuthContext } from '@/middleware/auth'

const logger = createLogger('CustomToolRoutes')
const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET / - List custom tools
 *
 * Query params:
 *   - workspaceId (optional): filter by workspace
 *   - workflowId (optional): unused, reserved for future filtering
 *
 * Returns workspace-scoped tools plus legacy user-scoped tools.
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')

  try {
    const conditions = []
    if (workspaceId) {
      conditions.push(eq(customTools.workspaceId, workspaceId))
    }
    // Also include user-scoped tools (legacy)
    conditions.push(eq(customTools.userId, userId))

    const tools = await db
      .select()
      .from(customTools)
      .where(or(...conditions))
      .orderBy(desc(customTools.createdAt))

    return c.json({ tools })
  } catch (error) {
    logger.error('Error listing custom tools', error)
    return c.json({ tools: [] })
  }
})

/**
 * POST / - Upsert custom tools
 *
 * Body: { workspaceId: string, tools: Array<{ id?, schema, title, description }> }
 *
 * If a tool has an `id`, it will be updated. Otherwise a new tool is created.
 */
app.post('/', async (c) => {
  const userId = getUserId(c)

  try {
    const body = await c.req.json()
    const { workspaceId, tools: toolsData } = body

    if (!workspaceId || !toolsData || !Array.isArray(toolsData)) {
      return c.json({ error: 'workspaceId and tools array required' }, 400)
    }

    const results = []
    for (const tool of toolsData) {
      if (tool.id) {
        // Update existing
        const [updated] = await db
          .update(customTools)
          .set({
            schema: tool.schema,
            title: tool.title,
            code: tool.code ?? '',
            updatedAt: new Date(),
          })
          .where(eq(customTools.id, tool.id))
          .returning()
        if (updated) results.push(updated)
      } else {
        // Create new
        const [created] = await db
          .insert(customTools)
          .values({
            id: crypto.randomUUID(),
            userId,
            workspaceId,
            schema: tool.schema,
            title: tool.title,
            code: tool.code ?? '',
          })
          .returning()
        if (created) results.push(created)
      }
    }

    return c.json({ tools: results })
  } catch (error) {
    logger.error('Error upserting custom tools', error)
    return c.json({ error: 'Failed to save custom tools' }, 500)
  }
})

/**
 * DELETE / - Delete a custom tool
 *
 * Query params:
 *   - id (required): the tool ID to delete
 *   - workspaceId (optional): reserved for future scoping
 */
app.delete('/', async (c) => {
  const userId = getUserId(c)
  const id = c.req.query('id')

  if (!id) {
    return c.json({ error: 'Tool ID required' }, 400)
  }

  try {
    await db.delete(customTools).where(eq(customTools.id, id))
    logger.info(`Deleted custom tool ${id} for user ${userId}`)
    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting custom tool ${id}`, error)
    return c.json({ error: 'Failed to delete custom tool' }, 500)
  }
})

export { app as customToolRoutes }
