import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '@sim/db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getUserId, type AuthContext } from '../../middleware/auth'

const logger = createLogger('WorkflowStateRoutes')

const app = new Hono<{ Variables: AuthContext }>()

const BlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  subBlocks: z.record(z.unknown()).optional().default({}),
  outputs: z.record(z.unknown()).optional().default({}),
  enabled: z.boolean().optional().default(true),
  horizontalHandles: z.boolean().optional().default(true),
  isWide: z.boolean().optional().default(false),
  advancedMode: z.boolean().optional().default(false),
  triggerMode: z.boolean().optional().default(false),
  locked: z.boolean().optional().default(false),
  height: z.number().optional().default(0),
  data: z.record(z.unknown()).optional().default({}),
})

const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
})

const LoopSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
})

const ParallelSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
})

const StateSchema = z.object({
  blocks: z.record(BlockSchema),
  edges: z.array(EdgeSchema),
  loops: z.record(LoopSchema).optional().default({}),
  parallels: z.record(ParallelSchema).optional().default({}),
})

/**
 * POST /api/workflows/:id/state
 * Sync workflow state to database
 */
app.post('/:id/state', async (c) => {
  const userId = getUserId(c)
  const workflowId = c.req.param('id')

  try {
    // Verify workflow exists and user has access
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

    const body = await c.req.json()
    const state = StateSchema.parse(body)

    // Use a transaction for atomic updates
    await db.transaction(async (tx) => {
      // Delete existing state
      await Promise.all([
        tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
        tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
        tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
      ])

      const now = new Date()

      // Insert blocks
      const blocks = Object.values(state.blocks)
      if (blocks.length > 0) {
        await tx.insert(workflowBlocks).values(
          blocks.map((block) => ({
            id: block.id,
            workflowId,
            type: block.type,
            name: block.name,
            positionX: String(block.position.x),
            positionY: String(block.position.y),
            subBlocks: block.subBlocks,
            outputs: block.outputs,
            enabled: block.enabled,
            horizontalHandles: block.horizontalHandles,
            isWide: block.isWide,
            advancedMode: block.advancedMode,
            triggerMode: block.triggerMode,
            locked: block.locked,
            height: String(block.height),
            data: block.data,
            createdAt: now,
            updatedAt: now,
          }))
        )
      }

      // Insert edges
      if (state.edges.length > 0) {
        await tx.insert(workflowEdges).values(
          state.edges.map((edge) => ({
            id: edge.id,
            workflowId,
            sourceBlockId: edge.source,
            targetBlockId: edge.target,
            sourceHandle: edge.sourceHandle || null,
            targetHandle: edge.targetHandle || null,
            createdAt: now,
          }))
        )
      }

      // Insert loops as subflows
      const loops = Object.values(state.loops)
      if (loops.length > 0) {
        await tx.insert(workflowSubflows).values(
          loops.map((loop) => ({
            id: loop.id,
            workflowId,
            type: 'loop',
            config: { nodes: loop.nodes },
            createdAt: now,
            updatedAt: now,
          }))
        )
      }

      // Insert parallels as subflows
      const parallels = Object.values(state.parallels)
      if (parallels.length > 0) {
        await tx.insert(workflowSubflows).values(
          parallels.map((parallel) => ({
            id: parallel.id,
            workflowId,
            type: 'parallel',
            config: { nodes: parallel.nodes },
            createdAt: now,
            updatedAt: now,
          }))
        )
      }

      // Update workflow lastSynced
      await tx.update(workflow).set({ lastSynced: now, updatedAt: now }).where(eq(workflow.id, workflowId))
    })

    logger.info(`Synced state for workflow ${workflowId}: ${Object.keys(state.blocks).length} blocks, ${state.edges.length} edges`)

    return c.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid state data', details: error.errors }, 400)
    }
    logger.error(`Error syncing workflow ${workflowId} state`, error)
    return c.json({ error: 'Failed to sync workflow state' }, 500)
  }
})

export { app as workflowStateRoutes }
