import { Hono } from 'hono'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createLogger } from '@sim/logger'
import { db } from '@sim/db'
import { templates, templateStars, templateCreators } from '@sim/db/schema'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('TemplateRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET /api/templates
 * List templates with pagination, search, and filtering
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  const search = c.req.query('search')
  const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined
  const workflowId = c.req.query('workflowId')
  const includeAllStatuses = c.req.query('includeAllStatuses') === 'true'
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
  const offset = Number(c.req.query('offset')) || 0

  try {
    const conditions = []

    // By default only show approved templates, unless includeAllStatuses or specific status
    if (status) {
      conditions.push(eq(templates.status, status))
    } else if (!includeAllStatuses) {
      conditions.push(eq(templates.status, 'approved'))
    }

    if (workflowId) {
      conditions.push(eq(templates.workflowId, workflowId))
    }

    if (search) {
      conditions.push(
        or(
          ilike(templates.name, `%${search}%`),
          sql`${templates.tags}::text ILIKE ${'%' + search + '%'}`
        )!
      )
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(templates)
        .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
        .where(whereClause)
        .orderBy(desc(templates.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(templates)
        .where(whereClause),
    ])

    const total = Number(countResult[0]?.count ?? 0)

    // Check which templates the user has starred
    let starredSet = new Set<string>()
    if (userId && rows.length > 0) {
      const templateIds = rows.map((r) => r.templates.id)
      const stars = await db
        .select({ templateId: templateStars.templateId })
        .from(templateStars)
        .where(
          and(
            eq(templateStars.userId, userId),
            sql`${templateStars.templateId} IN (${sql.join(
              templateIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        )
      starredSet = new Set(stars.map((s) => s.templateId))
    }

    const data = rows.map((row) => ({
      ...row.templates,
      creator: row.template_creators ?? undefined,
      isStarred: starredSet.has(row.templates.id),
    }))

    return c.json({
      data,
      pagination: {
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    logger.error('Error listing templates', error)
    return c.json({
      data: [],
      pagination: { total: 0, limit, offset, page: 1, totalPages: 0 },
    })
  }
})

/**
 * GET /api/templates/:id
 * Get a single template by ID
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c)
  const templateId = c.req.param('id')

  try {
    const rows = await db
      .select()
      .from(templates)
      .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
      .where(eq(templates.id, templateId))
      .limit(1)

    if (rows.length === 0) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // Check if starred
    let isStarred = false
    if (userId) {
      const star = await db
        .select()
        .from(templateStars)
        .where(
          and(eq(templateStars.userId, userId), eq(templateStars.templateId, templateId))
        )
        .limit(1)
      isStarred = star.length > 0
    }

    // Increment views
    await db
      .update(templates)
      .set({ views: sql`${templates.views} + 1` })
      .where(eq(templates.id, templateId))

    return c.json({
      data: {
        ...rows[0].templates,
        creator: rows[0].template_creators ?? undefined,
        isStarred,
      },
    })
  } catch (error) {
    logger.error('Error fetching template', error)
    return c.json({ error: 'Failed to fetch template' }, 500)
  }
})

/**
 * POST /api/templates
 * Create a new template
 */
app.post('/', async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()

  const { workflowId, name, details, creatorId, tags } = body

  if (!workflowId || !name) {
    return c.json({ error: 'workflowId and name are required' }, 400)
  }

  try {
    const id = nanoid()
    const now = new Date()

    await db.insert(templates).values({
      id,
      workflowId,
      name,
      details: details ?? null,
      creatorId: creatorId ?? null,
      tags: tags ?? [],
      requiredCredentials: [],
      state: {},
      status: 'pending',
      views: 0,
      stars: 0,
      createdAt: now,
      updatedAt: now,
    })

    const [created] = await db.select().from(templates).where(eq(templates.id, id)).limit(1)

    return c.json({ data: created }, 201)
  } catch (error) {
    logger.error('Error creating template', error)
    return c.json({ error: 'Failed to create template' }, 500)
  }
})

/**
 * PUT /api/templates/:id
 * Update a template
 */
app.put('/:id', async (c) => {
  const templateId = c.req.param('id')
  const body = await c.req.json()

  const { name, details, creatorId, tags, updateState } = body

  try {
    const [existing] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1)
    if (!existing) {
      return c.json({ error: 'Template not found' }, 404)
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (name !== undefined) updates.name = name
    if (details !== undefined) updates.details = details
    if (creatorId !== undefined) updates.creatorId = creatorId
    if (tags !== undefined) updates.tags = tags

    await db.update(templates).set(updates).where(eq(templates.id, templateId))

    const [updated] = await db
      .select()
      .from(templates)
      .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
      .where(eq(templates.id, templateId))
      .limit(1)

    return c.json({
      data: {
        ...updated.templates,
        creator: updated.template_creators ?? undefined,
      },
    })
  } catch (error) {
    logger.error('Error updating template', error)
    return c.json({ error: 'Failed to update template' }, 500)
  }
})

/**
 * DELETE /api/templates/:id
 * Delete a template
 */
app.delete('/:id', async (c) => {
  const templateId = c.req.param('id')

  try {
    const [existing] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1)
    if (!existing) {
      return c.json({ error: 'Template not found' }, 404)
    }

    await db.delete(templates).where(eq(templates.id, templateId))

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error deleting template', error)
    return c.json({ error: 'Failed to delete template' }, 500)
  }
})

/**
 * POST /api/templates/:id/star
 * Star a template
 */
app.post('/:id/star', async (c) => {
  const userId = getUserId(c)
  const templateId = c.req.param('id')

  try {
    // Check if already starred
    const existing = await db
      .select()
      .from(templateStars)
      .where(and(eq(templateStars.userId, userId), eq(templateStars.templateId, templateId)))
      .limit(1)

    if (existing.length > 0) {
      return c.json({ success: true, message: 'Already starred' })
    }

    await db.insert(templateStars).values({
      id: nanoid(),
      userId,
      templateId,
      starredAt: new Date(),
      createdAt: new Date(),
    })

    // Increment star count
    await db
      .update(templates)
      .set({ stars: sql`${templates.stars} + 1` })
      .where(eq(templates.id, templateId))

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error starring template', error)
    return c.json({ error: 'Failed to star template' }, 500)
  }
})

/**
 * DELETE /api/templates/:id/star
 * Unstar a template
 */
app.delete('/:id/star', async (c) => {
  const userId = getUserId(c)
  const templateId = c.req.param('id')

  try {
    const existing = await db
      .select()
      .from(templateStars)
      .where(and(eq(templateStars.userId, userId), eq(templateStars.templateId, templateId)))
      .limit(1)

    if (existing.length === 0) {
      return c.json({ success: true, message: 'Not starred' })
    }

    await db
      .delete(templateStars)
      .where(and(eq(templateStars.userId, userId), eq(templateStars.templateId, templateId)))

    // Decrement star count
    await db
      .update(templates)
      .set({ stars: sql`GREATEST(${templates.stars} - 1, 0)` })
      .where(eq(templates.id, templateId))

    return c.json({ success: true })
  } catch (error) {
    logger.error('Error unstarring template', error)
    return c.json({ error: 'Failed to unstar template' }, 500)
  }
})

export { app as templateRoutes }
