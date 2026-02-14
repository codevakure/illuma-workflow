import { Hono } from 'hono'
import { z } from 'zod'
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '../../middleware/auth'

const logger = createLogger('WorkflowOperationRoutes')

let db: any
let workflow: any
let workflowBlocks: any
let workflowEdges: any
let workflowSubflows: any
let chat: any
let form: any
let useInMemory = false
let dbInitialized = false

async function initDb() {
  try {
    const dbModule = await import('@sim/db')
    db = dbModule.db
    workflow = dbModule.workflow
    workflowBlocks = dbModule.workflowBlocks
    workflowEdges = dbModule.workflowEdges
    workflowSubflows = dbModule.workflowSubflows
    chat = dbModule.chat
    form = dbModule.form

    await db.select().from(workflow).limit(1)
    logger.info('Database connection established for workflow operations')
    return true
  } catch (error) {
    logger.warn('Database not available for workflow operations, using in-memory:', error)
    useInMemory = true
    return false
  }
}

async function ensureInit() {
  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }
}

const app = new Hono<{ Variables: AuthContext }>()

const DuplicateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  color: z.string().optional(),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
})

/**
 * POST /:id/duplicate
 * Duplicate a workflow. Loads the source workflow with all its blocks, edges,
 * and subflows, then creates a new workflow with new UUIDs for everything.
 */
app.post('/:id/duplicate', async (c) => {
  const sourceWorkflowId = c.req.param('id')
  const userId = getUserId(c)
  await ensureInit()

  logger.info('Duplicate workflow request', { sourceWorkflowId, userId })

  try {
    const body = await c.req.json()
    const parsed = DuplicateWorkflowSchema.parse(body)

    if (useInMemory) {
      const newId = crypto.randomUUID()
      const now = new Date()
      return c.json(
        {
          id: newId,
          name: parsed.name,
          description: parsed.description || null,
          color: parsed.color || '#3972F6',
          workspaceId: parsed.workspaceId || null,
          folderId: parsed.folderId || null,
          createdAt: now,
          updatedAt: now,
        },
        201
      )
    }

    const { eq } = await import('drizzle-orm')

    // Load source workflow
    const [sourceWorkflow] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, sourceWorkflowId))
      .limit(1)

    if (!sourceWorkflow) {
      return c.json({ error: 'Source workflow not found' }, 404)
    }

    if (sourceWorkflow.userId !== userId && !sourceWorkflow.workspaceId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Load blocks, edges, and subflows from the source workflow
    const [sourceBlocks, sourceEdges, sourceSubflows] = await Promise.all([
      db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, sourceWorkflowId)),
      db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, sourceWorkflowId)),
      db.select().from(workflowSubflows).where(eq(workflowSubflows.workflowId, sourceWorkflowId)),
    ])

    const newWorkflowId = crypto.randomUUID()
    const now = new Date()

    // Build a mapping from old block IDs to new block IDs
    const blockIdMap = new Map<string, string>()
    for (const block of sourceBlocks) {
      blockIdMap.set(block.id, crypto.randomUUID())
    }

    await db.transaction(async (tx: any) => {
      // Create new workflow record
      await tx.insert(workflow).values({
        id: newWorkflowId,
        userId,
        workspaceId: parsed.workspaceId || sourceWorkflow.workspaceId || null,
        folderId: parsed.folderId !== undefined ? parsed.folderId : sourceWorkflow.folderId,
        sortOrder: 0,
        name: parsed.name,
        description: parsed.description ?? sourceWorkflow.description,
        color: parsed.color || sourceWorkflow.color,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        runCount: 0,
        variables: sourceWorkflow.variables || {},
      })

      // Copy blocks with new IDs
      if (sourceBlocks.length > 0) {
        await tx.insert(workflowBlocks).values(
          sourceBlocks.map((block: any) => ({
            id: blockIdMap.get(block.id)!,
            workflowId: newWorkflowId,
            type: block.type,
            name: block.name,
            positionX: block.positionX,
            positionY: block.positionY,
            subBlocks: block.subBlocks,
            outputs: block.outputs,
            enabled: block.enabled,
            horizontalHandles: block.horizontalHandles,
            isWide: block.isWide,
            advancedMode: block.advancedMode,
            triggerMode: block.triggerMode,
            locked: false,
            height: block.height,
            data: block.data,
            createdAt: now,
            updatedAt: now,
          }))
        )
      }

      // Copy edges with new IDs and updated source/target references
      if (sourceEdges.length > 0) {
        await tx.insert(workflowEdges).values(
          sourceEdges.map((edge: any) => ({
            id: crypto.randomUUID(),
            workflowId: newWorkflowId,
            sourceBlockId: blockIdMap.get(edge.sourceBlockId) || edge.sourceBlockId,
            targetBlockId: blockIdMap.get(edge.targetBlockId) || edge.targetBlockId,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            createdAt: now,
          }))
        )
      }

      // Copy subflows with updated node references
      if (sourceSubflows.length > 0) {
        await tx.insert(workflowSubflows).values(
          sourceSubflows.map((subflow: any) => {
            const config = subflow.config as { nodes?: string[] }
            const updatedNodes = (config.nodes || []).map(
              (nodeId: string) => blockIdMap.get(nodeId) || nodeId
            )
            return {
              id: crypto.randomUUID(),
              workflowId: newWorkflowId,
              type: subflow.type,
              config: { ...config, nodes: updatedNodes },
              createdAt: now,
              updatedAt: now,
            }
          })
        )
      }
    })

    logger.info('Workflow duplicated successfully', {
      sourceWorkflowId,
      newWorkflowId,
    })

    return c.json(
      {
        id: newWorkflowId,
        name: parsed.name,
        description: parsed.description ?? sourceWorkflow.description,
        color: parsed.color || sourceWorkflow.color,
        workspaceId: parsed.workspaceId || sourceWorkflow.workspaceId,
        folderId: parsed.folderId !== undefined ? parsed.folderId : sourceWorkflow.folderId,
        createdAt: now,
        updatedAt: now,
      },
      201
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400)
    }
    logger.error('Error duplicating workflow', { sourceWorkflowId, error })
    return c.json({ error: 'Failed to duplicate workflow' }, 500)
  }
})

/**
 * POST /:id/autolayout
 * Auto-layout blocks in a workflow. Currently a stub that returns success.
 */
app.post('/:id/autolayout', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)

  logger.info('Auto-layout workflow request', { workflowId, userId })

  return c.json({ success: true, layout: {} })
})

/**
 * GET /:id/chat/status
 * Check the chat deployment status for a workflow.
 */
app.get('/:id/chat/status', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)
  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ isDeployed: false, deployment: null })
    }

    const { eq } = await import('drizzle-orm')

    const [chatDeployment] = await db
      .select()
      .from(chat)
      .where(eq(chat.workflowId, workflowId))
      .limit(1)

    if (!chatDeployment) {
      return c.json({ isDeployed: false, deployment: null })
    }

    return c.json({
      isDeployed: chatDeployment.isActive ?? false,
      deployment: {
        id: chatDeployment.id,
        identifier: chatDeployment.identifier,
        title: chatDeployment.title,
        description: chatDeployment.description,
        isActive: chatDeployment.isActive,
        authType: chatDeployment.authType,
        createdAt: chatDeployment.createdAt,
        updatedAt: chatDeployment.updatedAt,
      },
    })
  } catch (error) {
    logger.error('Error getting chat deployment status', { workflowId, error })
    return c.json({ isDeployed: false, deployment: null })
  }
})

/**
 * GET /:id/form/status
 * Check the form deployment status for a workflow.
 */
app.get('/:id/form/status', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)
  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ isDeployed: false, form: null })
    }

    const { eq } = await import('drizzle-orm')

    const [formDeployment] = await db
      .select()
      .from(form)
      .where(eq(form.workflowId, workflowId))
      .limit(1)

    if (!formDeployment) {
      return c.json({ isDeployed: false, form: null })
    }

    return c.json({
      isDeployed: formDeployment.isActive ?? false,
      form: {
        id: formDeployment.id,
        identifier: formDeployment.identifier,
        title: formDeployment.title,
        description: formDeployment.description,
        isActive: formDeployment.isActive,
        authType: formDeployment.authType,
        showBranding: formDeployment.showBranding,
        createdAt: formDeployment.createdAt,
        updatedAt: formDeployment.updatedAt,
      },
    })
  } catch (error) {
    logger.error('Error getting form deployment status', { workflowId, error })
    return c.json({ isDeployed: false, form: null })
  }
})

/**
 * GET /:id/paused
 * List paused executions for a workflow.
 */
app.get('/:id/paused', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)

  return c.json({ executions: [] })
})

export { app as workflowOperationRoutes }
