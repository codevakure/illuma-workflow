import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { db, chat, workflow } from '@sim/db'
import { eq } from 'drizzle-orm'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('ChatRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * POST /
 * Create a new chat deployment for a workflow.
 */
app.post('/', async (c) => {
  const userId = getUserId(c)

  try {
    const body = await c.req.json()
    const {
      workflowId,
      identifier,
      title,
      description,
      customizations,
      authType,
      password,
      allowedEmails,
      outputConfigs,
    } = body

    if (!workflowId || !identifier || !title) {
      return c.json({ error: 'workflowId, identifier, and title are required' }, 400)
    }

    // Verify workflow exists
    const [workflowData] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData) {
      return c.json({ error: 'Workflow not found' }, 404)
    }

    // Check identifier uniqueness
    const [existing] = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)

    if (existing) {
      return c.json({ error: 'Identifier already in use' }, 409)
    }

    const chatId = crypto.randomUUID()
    const now = new Date()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173'

    await db.insert(chat).values({
      id: chatId,
      workflowId,
      userId,
      identifier,
      title,
      description: description || null,
      isActive: true,
      customizations: customizations || {},
      authType: authType || 'public',
      password: password || null,
      allowedEmails: allowedEmails || [],
      outputConfigs: outputConfigs || [],
      createdAt: now,
      updatedAt: now,
    })

    logger.info('Chat deployment created', { chatId, workflowId, identifier })

    return c.json({
      chatUrl: `${baseUrl}/chat/${identifier}`,
      chatId,
    })
  } catch (error) {
    logger.error('Error creating chat deployment', { error })
    return c.json({ error: 'Failed to create chat deployment' }, 500)
  }
})

/**
 * GET /validate
 * Check if a chat identifier is available.
 */
app.get('/validate', async (c) => {
  const identifier = c.req.query('identifier')

  if (!identifier) {
    return c.json({ available: false, error: 'Identifier is required' })
  }

  try {
    const [existing] = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)

    return c.json({ available: !existing })
  } catch (error) {
    logger.error('Error validating chat identifier', { error })
    return c.json({ available: false, error: 'Validation failed' })
  }
})

/**
 * GET /manage/:chatId
 * Get chat deployment details.
 */
app.get('/manage/:chatId', async (c) => {
  const chatId = c.req.param('chatId')

  try {
    const [chatData] = await db
      .select()
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1)

    if (!chatData) {
      return c.json({ error: 'Chat not found' }, 404)
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173'

    return c.json({
      id: chatData.id,
      identifier: chatData.identifier,
      title: chatData.title,
      description: chatData.description,
      authType: chatData.authType,
      allowedEmails: chatData.allowedEmails,
      outputConfigs: chatData.outputConfigs,
      customizations: chatData.customizations,
      isActive: chatData.isActive,
      chatUrl: `${baseUrl}/chat/${chatData.identifier}`,
      hasPassword: Boolean(chatData.password),
    })
  } catch (error) {
    logger.error('Error getting chat details', { chatId, error })
    return c.json({ error: 'Failed to get chat details' }, 500)
  }
})

/**
 * PATCH /manage/:chatId
 * Update a chat deployment.
 */
app.patch('/manage/:chatId', async (c) => {
  const chatId = c.req.param('chatId')

  try {
    const body = await c.req.json()
    const {
      identifier,
      title,
      description,
      customizations,
      authType,
      password,
      allowedEmails,
      outputConfigs,
    } = body

    const [chatData] = await db
      .select()
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1)

    if (!chatData) {
      return c.json({ error: 'Chat not found' }, 404)
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (identifier !== undefined) updates.identifier = identifier
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (customizations !== undefined) updates.customizations = customizations
    if (authType !== undefined) updates.authType = authType
    if (password !== undefined) updates.password = password
    if (allowedEmails !== undefined) updates.allowedEmails = allowedEmails
    if (outputConfigs !== undefined) updates.outputConfigs = outputConfigs

    await db.update(chat).set(updates).where(eq(chat.id, chatId))

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173'
    const finalIdentifier = identifier || chatData.identifier

    logger.info('Chat deployment updated', { chatId })

    return c.json({
      chatUrl: `${baseUrl}/chat/${finalIdentifier}`,
      chatId,
    })
  } catch (error) {
    logger.error('Error updating chat deployment', { chatId, error })
    return c.json({ error: 'Failed to update chat deployment' }, 500)
  }
})

/**
 * DELETE /manage/:chatId
 * Delete a chat deployment.
 */
app.delete('/manage/:chatId', async (c) => {
  const chatId = c.req.param('chatId')

  try {
    const [chatData] = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1)

    if (!chatData) {
      return c.json({ error: 'Chat not found' }, 404)
    }

    await db.delete(chat).where(eq(chat.id, chatId))

    logger.info('Chat deployment deleted', { chatId })

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error deleting chat deployment', { chatId, error })
    return c.json({ error: 'Failed to delete chat deployment' }, 500)
  }
})

export { app as chatRoutes }
