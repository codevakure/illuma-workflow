import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { db, memory } from '@sim/db'
import { eq, and, isNull, like } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('MemoryRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET /api/memory
 * Lists memory entries for a workspace, optionally filtered by a search query.
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const searchQuery = c.req.query('query')
  const limit = parseInt(c.req.query('limit') || '50', 10)

  if (!workspaceId) {
    return c.json({ success: false, error: { message: 'workspaceId parameter is required' } }, 400)
  }

  try {
    const conditions = [isNull(memory.deletedAt), eq(memory.workspaceId, workspaceId)]

    if (searchQuery) {
      conditions.push(like(memory.key, `%${searchQuery}%`))
    }

    const results = await db
      .select()
      .from(memory)
      .where(and(...conditions))
      .orderBy(memory.createdAt)
      .limit(limit)

    const memories = results.map((mem) => ({
      conversationId: mem.key,
      data: mem.data,
    }))

    logger.info(`Found ${memories.length} memories for workspace ${workspaceId}`)
    return c.json({ success: true, data: { memories } })
  } catch (error) {
    logger.error('Error listing memories', error)
    return c.json({ success: false, error: { message: 'Failed to list memories' } }, 500)
  }
})

/**
 * POST /api/memory
 * Creates or updates a memory entry using upsert on (workspaceId, key).
 */
app.post('/', async (c) => {
  const userId = getUserId(c)

  try {
    const body = await c.req.json()
    const { key, data, workspaceId } = body

    if (!key) {
      return c.json({ success: false, error: { message: 'Memory key is required' } }, 400)
    }
    if (!data) {
      return c.json({ success: false, error: { message: 'Memory data is required' } }, 400)
    }
    if (!workspaceId) {
      return c.json({ success: false, error: { message: 'workspaceId is required' } }, 400)
    }

    // Validate message format
    const dataToValidate = Array.isArray(data) ? data : [data]
    for (const msg of dataToValidate) {
      if (!msg || typeof msg !== 'object' || !msg.role || !msg.content) {
        return c.json(
          { success: false, error: { message: 'Memory requires messages with role and content' } },
          400
        )
      }
      if (!['user', 'assistant', 'system'].includes(msg.role)) {
        return c.json(
          { success: false, error: { message: 'Message role must be user, assistant, or system' } },
          400
        )
      }
    }

    const initialData = Array.isArray(data) ? data : [data]
    const now = new Date()
    const id = `mem_${crypto.randomUUID().replace(/-/g, '')}`

    await db
      .insert(memory)
      .values({
        id,
        workspaceId,
        key,
        data: initialData,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workspaceId, memory.key],
        set: {
          data: sql`${memory.data} || ${JSON.stringify(initialData)}::jsonb`,
          updatedAt: now,
        },
      })

    logger.info(`Memory operation successful: ${key} for workspace ${workspaceId}`)

    // Retrieve the memory after upsert
    const [memoryRecord] = await db
      .select()
      .from(memory)
      .where(
        and(eq(memory.key, key), eq(memory.workspaceId, workspaceId), isNull(memory.deletedAt))
      )
      .limit(1)

    if (!memoryRecord) {
      return c.json(
        { success: false, error: { message: 'Failed to retrieve memory after creation/update' } },
        500
      )
    }

    return c.json({
      success: true,
      data: { conversationId: memoryRecord.key, data: memoryRecord.data },
    })
  } catch (error: unknown) {
    const dbError = error as { code?: string; message?: string }
    if (dbError.code === '23505') {
      return c.json(
        { success: false, error: { message: 'Memory with this key already exists' } },
        409
      )
    }
    logger.error('Error creating/updating memory', error)
    return c.json(
      { success: false, error: { message: dbError.message || 'Failed to create memory' } },
      500
    )
  }
})

/**
 * DELETE /api/memory
 * Deletes memory entries matching key and workspaceId.
 */
app.delete('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  const key = c.req.query('key')

  if (!workspaceId) {
    return c.json({ success: false, error: { message: 'workspaceId parameter is required' } }, 400)
  }
  if (!key) {
    return c.json({ success: false, error: { message: 'key parameter is required' } }, 400)
  }

  try {
    const result = await db
      .delete(memory)
      .where(and(eq(memory.key, key), eq(memory.workspaceId, workspaceId)))
      .returning({ id: memory.id })

    const deletedCount = result.length

    logger.info(`Deleted ${deletedCount} memories for workspace ${workspaceId}`)
    return c.json({
      success: true,
      data: {
        message:
          deletedCount > 0
            ? `Successfully deleted ${deletedCount} memories`
            : 'No memories found matching the criteria',
        deletedCount,
      },
    })
  } catch (error) {
    logger.error('Error deleting memories', error)
    return c.json({ success: false, error: { message: 'Failed to delete memories' } }, 500)
  }
})

export { app as memoryRoutes }
