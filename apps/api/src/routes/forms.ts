import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { db, form, workflow } from '@sim/db'
import { eq } from 'drizzle-orm'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('FormRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * POST /
 * Create a new form deployment for a workflow.
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
      showBranding,
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
      .select({ id: form.id })
      .from(form)
      .where(eq(form.identifier, identifier))
      .limit(1)

    if (existing) {
      return c.json({ error: 'Identifier already in use' }, 409)
    }

    const formId = crypto.randomUUID()
    const now = new Date()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5173'

    await db.insert(form).values({
      id: formId,
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
      showBranding: showBranding ?? true,
      createdAt: now,
      updatedAt: now,
    })

    logger.info('Form deployment created', { formId, workflowId, identifier })

    return c.json({
      id: formId,
      formUrl: `${baseUrl}/form/${identifier}`,
    })
  } catch (error) {
    logger.error('Error creating form deployment', { error })
    return c.json({ error: 'Failed to create form deployment' }, 500)
  }
})

/**
 * GET /validate
 * Check if a form identifier is available.
 */
app.get('/validate', async (c) => {
  const identifier = c.req.query('identifier')

  if (!identifier) {
    return c.json({ available: false, error: 'Identifier is required' })
  }

  try {
    const [existing] = await db
      .select({ id: form.id })
      .from(form)
      .where(eq(form.identifier, identifier))
      .limit(1)

    return c.json({ available: !existing })
  } catch (error) {
    logger.error('Error validating form identifier', { error })
    return c.json({ available: false, error: 'Validation failed' })
  }
})

/**
 * GET /manage/:formId
 * Get form deployment details.
 */
app.get('/manage/:formId', async (c) => {
  const formId = c.req.param('formId')

  try {
    const [formData] = await db
      .select()
      .from(form)
      .where(eq(form.id, formId))
      .limit(1)

    if (!formData) {
      return c.json({ error: 'Form not found' }, 404)
    }

    return c.json({
      form: {
        id: formData.id,
        identifier: formData.identifier,
        title: formData.title,
        description: formData.description,
        customizations: formData.customizations,
        authType: formData.authType,
        hasPassword: Boolean(formData.password),
        allowedEmails: formData.allowedEmails,
        showBranding: formData.showBranding,
        isActive: formData.isActive,
      },
    })
  } catch (error) {
    logger.error('Error getting form details', { formId, error })
    return c.json({ error: 'Failed to get form details' }, 500)
  }
})

/**
 * PATCH /manage/:formId
 * Update a form deployment.
 */
app.patch('/manage/:formId', async (c) => {
  const formId = c.req.param('formId')

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
      showBranding,
      isActive,
    } = body

    const [formData] = await db
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1)

    if (!formData) {
      return c.json({ error: 'Form not found' }, 404)
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (identifier !== undefined) updates.identifier = identifier
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (customizations !== undefined) updates.customizations = customizations
    if (authType !== undefined) updates.authType = authType
    if (password !== undefined) updates.password = password
    if (allowedEmails !== undefined) updates.allowedEmails = allowedEmails
    if (showBranding !== undefined) updates.showBranding = showBranding
    if (isActive !== undefined) updates.isActive = isActive

    await db.update(form).set(updates).where(eq(form.id, formId))

    logger.info('Form deployment updated', { formId })

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error updating form deployment', { formId, error })
    return c.json({ error: 'Failed to update form deployment' }, 500)
  }
})

/**
 * DELETE /manage/:formId
 * Delete a form deployment.
 */
app.delete('/manage/:formId', async (c) => {
  const formId = c.req.param('formId')

  try {
    const [formData] = await db
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1)

    if (!formData) {
      return c.json({ error: 'Form not found' }, 404)
    }

    await db.delete(form).where(eq(form.id, formId))

    logger.info('Form deployment deleted', { formId })

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error deleting form deployment', { formId, error })
    return c.json({ error: 'Failed to delete form deployment' }, 500)
  }
})

export { app as formRoutes }
