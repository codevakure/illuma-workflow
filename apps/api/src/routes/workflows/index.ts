import { Hono } from 'hono'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '../../middleware/auth'

const logger = createLogger('WorkflowRoutes')

const app = new Hono<{ Variables: AuthContext }>()

// In-memory store for development/testing when DB is not available
const inMemoryStore = new Map<string, Workflow>()
let useInMemory = false

interface Workflow {
  id: string
  userId: string
  workspaceId: string | null
  folderId: string | null
  name: string
  description: string | null
  color: string
  sortOrder: number
  isDeployed: boolean
  deployedAt: Date | null
  runCount: number
  variables: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  lastSynced: Date
}

// Try to import db, fall back to in-memory if not available
let db: any
let workflow: any
let workflowBlocks: any
let workflowEdges: any
let workflowSubflows: any

async function initDb() {
  try {
    const dbModule = await import('@sim/db')
    db = dbModule.db
    workflow = dbModule.workflow
    workflowBlocks = dbModule.workflowBlocks
    workflowEdges = dbModule.workflowEdges
    workflowSubflows = dbModule.workflowSubflows

    // Test connection
    const { eq } = await import('drizzle-orm')
    await db.select().from(workflow).limit(1)
    logger.info('Database connection established')
    return true
  } catch (error) {
    logger.warn('Database not available, using in-memory store:', error)
    useInMemory = true
    return false
  }
}

// Initialize on first request
let dbInitialized = false

const CreateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  color: z.string().optional().default('#3972F6'),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

/**
 * GET /api/workflows
 * List workflows for the authenticated user
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')

  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }

  try {
    if (useInMemory) {
      // In-memory mode
      const workflows = Array.from(inMemoryStore.values()).filter((w) => {
        if (workspaceId) return w.workspaceId === workspaceId
        return w.userId === userId
      })
      logger.info(`Listed ${workflows.length} workflows for user ${userId} (in-memory)`)
      return c.json({ data: workflows })
    }

    // Database mode
    const { asc, eq } = await import('drizzle-orm')
    const orderByClause = [asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id)]

    let workflows
    if (workspaceId) {
      workflows = await db
        .select()
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))
        .orderBy(...orderByClause)
    } else {
      workflows = await db
        .select()
        .from(workflow)
        .where(eq(workflow.userId, userId))
        .orderBy(...orderByClause)
    }

    logger.info(`Listed ${workflows.length} workflows for user ${userId}`)
    return c.json({ data: workflows })
  } catch (error) {
    logger.error('Error listing workflows', error)
    return c.json({ error: 'Failed to list workflows' }, 500)
  }
})

/**
 * POST /api/workflows
 * Create a new workflow
 */
app.post('/', async (c) => {
  const userId = getUserId(c)

  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }

  try {
    const body = await c.req.json()
    const parsed = CreateWorkflowSchema.parse(body)

    const workflowId = crypto.randomUUID()
    const now = new Date()

    if (useInMemory) {
      // In-memory mode
      const newWorkflow: Workflow = {
        id: workflowId,
        userId,
        workspaceId: parsed.workspaceId || null,
        folderId: parsed.folderId || null,
        sortOrder: parsed.sortOrder ?? 0,
        name: parsed.name,
        description: parsed.description,
        color: parsed.color,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        deployedAt: null,
        runCount: 0,
        variables: {},
      }
      inMemoryStore.set(workflowId, newWorkflow)
      logger.info(`Created workflow ${workflowId} for user ${userId} (in-memory)`)
      return c.json(newWorkflow, 201)
    }

    // Database mode
    const { and, eq, isNull, min } = await import('drizzle-orm')

    let sortOrder = parsed.sortOrder
    if (sortOrder === undefined) {
      const folderCondition = parsed.folderId
        ? eq(workflow.folderId, parsed.folderId)
        : isNull(workflow.folderId)

      const [minResult] = await db
        .select({ minOrder: min(workflow.sortOrder) })
        .from(workflow)
        .where(
          parsed.workspaceId
            ? and(eq(workflow.workspaceId, parsed.workspaceId), folderCondition)
            : and(eq(workflow.userId, userId), folderCondition)
        )

      sortOrder = (minResult?.minOrder ?? 1) - 1
    }

    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId: parsed.workspaceId || null,
      folderId: parsed.folderId || null,
      sortOrder,
      name: parsed.name,
      description: parsed.description,
      color: parsed.color,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })

    logger.info(`Created workflow ${workflowId} for user ${userId}`)

    return c.json(
      {
        id: workflowId,
        name: parsed.name,
        description: parsed.description,
        color: parsed.color,
        workspaceId: parsed.workspaceId,
        folderId: parsed.folderId,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      },
      201
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400)
    }
    logger.error('Error creating workflow', error)
    return c.json({ error: 'Failed to create workflow' }, 500)
  }
})

/**
 * GET /api/workflows/:id
 * Get a single workflow by ID with its state
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c)
  const workflowId = c.req.param('id')

  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }

  try {
    if (useInMemory) {
      const workflowData = inMemoryStore.get(workflowId)
      if (!workflowData) {
        return c.json({ error: 'Workflow not found' }, 404)
      }
      if (workflowData.userId !== userId && !workflowData.workspaceId) {
        return c.json({ error: 'Access denied' }, 403)
      }
      return c.json({
        data: {
          ...workflowData,
          state: {
            blocks: {},
            edges: [],
            loops: {},
            parallels: {},
            deploymentStatuses: {},
            lastSaved: Date.now(),
            isDeployed: workflowData.isDeployed,
            deployedAt: workflowData.deployedAt,
            metadata: {
              name: workflowData.name,
              description: workflowData.description,
            },
          },
          variables: workflowData.variables || {},
        },
      })
    }

    // Database mode
    const { eq } = await import('drizzle-orm')

    const [workflowData] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData) {
      return c.json({ error: 'Workflow not found' }, 404)
    }

    if (workflowData.userId !== userId && !workflowData.workspaceId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Load state from normalized tables
    const [blocks, edges, subflows] = await Promise.all([
      db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
      db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
      db.select().from(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
    ])

    const blocksRecord: Record<string, unknown> = {}
    for (const block of blocks) {
      blocksRecord[block.id] = {
        id: block.id,
        type: block.type,
        name: block.name,
        position: { x: Number(block.positionX), y: Number(block.positionY) },
        subBlocks: block.subBlocks,
        outputs: block.outputs,
        enabled: block.enabled,
        horizontalHandles: block.horizontalHandles,
        isWide: block.isWide,
        advancedMode: block.advancedMode,
        triggerMode: block.triggerMode,
        locked: block.locked,
        height: Number(block.height),
        data: block.data,
      }
    }

    const loopsRecord: Record<string, unknown> = {}
    const parallelsRecord: Record<string, unknown> = {}
    for (const subflow of subflows) {
      const config = subflow.config as { nodes?: string[] }
      if (subflow.type === 'loop') {
        loopsRecord[subflow.id] = { id: subflow.id, nodes: config.nodes || [] }
      } else if (subflow.type === 'parallel') {
        parallelsRecord[subflow.id] = { id: subflow.id, nodes: config.nodes || [] }
      }
    }

    logger.info(`Loaded workflow ${workflowId} for user ${userId}`)

    return c.json({
      data: {
        ...workflowData,
        state: {
          blocks: blocksRecord,
          edges: edges.map((e: any) => ({
            id: e.id,
            source: e.sourceBlockId,
            target: e.targetBlockId,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
          loops: loopsRecord,
          parallels: parallelsRecord,
          deploymentStatuses: {},
          lastSaved: Date.now(),
          isDeployed: workflowData.isDeployed,
          deployedAt: workflowData.deployedAt,
          metadata: {
            name: workflowData.name,
            description: workflowData.description,
          },
        },
        variables: workflowData.variables || {},
      },
    })
  } catch (error) {
    logger.error(`Error loading workflow ${workflowId}`, error)
    return c.json({ error: 'Failed to load workflow' }, 500)
  }
})

/**
 * PUT /api/workflows/:id
 * Update workflow metadata
 */
app.put('/:id', async (c) => {
  const userId = getUserId(c)
  const workflowId = c.req.param('id')

  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }

  try {
    const body = await c.req.json()
    const updates = UpdateWorkflowSchema.parse(body)

    if (useInMemory) {
      const workflowData = inMemoryStore.get(workflowId)
      if (!workflowData) {
        return c.json({ error: 'Workflow not found' }, 404)
      }
      if (workflowData.userId !== userId) {
        return c.json({ error: 'Access denied' }, 403)
      }
      const updated = {
        ...workflowData,
        ...updates,
        updatedAt: new Date(),
      }
      inMemoryStore.set(workflowId, updated)
      return c.json({ workflow: updated })
    }

    const { eq } = await import('drizzle-orm')

    const [workflowData] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData) {
      return c.json({ error: 'Workflow not found' }, 404)
    }

    if (workflowData.userId !== userId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.color !== undefined) updateData.color = updates.color
    if (updates.folderId !== undefined) updateData.folderId = updates.folderId
    if (updates.sortOrder !== undefined) updateData.sortOrder = updates.sortOrder

    const [updatedWorkflow] = await db
      .update(workflow)
      .set(updateData)
      .where(eq(workflow.id, workflowId))
      .returning()

    logger.info(`Updated workflow ${workflowId}`)

    return c.json({ workflow: updatedWorkflow })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400)
    }
    logger.error(`Error updating workflow ${workflowId}`, error)
    return c.json({ error: 'Failed to update workflow' }, 500)
  }
})

/**
 * DELETE /api/workflows/:id
 * Delete a workflow
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const workflowId = c.req.param('id')

  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }

  try {
    if (useInMemory) {
      const workflowData = inMemoryStore.get(workflowId)
      if (!workflowData) {
        return c.json({ error: 'Workflow not found' }, 404)
      }
      if (workflowData.userId !== userId) {
        return c.json({ error: 'Access denied' }, 403)
      }
      inMemoryStore.delete(workflowId)
      logger.info(`Deleted workflow ${workflowId} (in-memory)`)
      return c.json({ success: true })
    }

    const { eq } = await import('drizzle-orm')

    const [workflowData] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData) {
      return c.json({ error: 'Workflow not found' }, 404)
    }

    if (workflowData.userId !== userId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    await db.delete(workflow).where(eq(workflow.id, workflowId))

    logger.info(`Deleted workflow ${workflowId}`)

    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting workflow ${workflowId}`, error)
    return c.json({ error: 'Failed to delete workflow' }, 500)
  }
})

export { app as workflowRoutes }
