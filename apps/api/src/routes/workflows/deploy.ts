import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import {
  db,
  workflow,
  workflowBlocks,
  workflowEdges,
  workflowSubflows,
  workflowDeploymentVersion,
} from '@sim/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { getUserId, type AuthContext } from '../../middleware/auth'

const logger = createLogger('DeployRoute')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * Helper to verify workflow access.
 */
async function verifyWorkflowAccess(workflowId: string, userId: string) {
  const [workflowData] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowData) {
    return { error: 'Workflow not found', status: 404 as const }
  }

  if (workflowData.userId !== userId && !workflowData.workspaceId) {
    return { error: 'Access denied', status: 403 as const }
  }

  return { data: workflowData }
}

/**
 * Helper to load normalized workflow state from DB tables.
 */
async function loadWorkflowState(workflowId: string, workflowData: { variables?: unknown }) {
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

  const edgesArray = edges.map((e) => ({
    id: e.id,
    source: e.sourceBlockId,
    target: e.targetBlockId,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }))

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

  return {
    blocks: blocksRecord,
    edges: edgesArray,
    loops: loopsRecord,
    parallels: parallelsRecord,
    variables: workflowData.variables || {},
    lastSaved: Date.now(),
  }
}

/**
 * GET /:id/deploy
 *
 * Get deployment info for a workflow.
 * Returns isDeployed, deployedAt, apiKey, and needsRedeployment.
 */
app.get('/:id/deploy', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)

  try {
    const result = await verifyWorkflowAccess(workflowId, userId)
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }

    const workflowData = result.data

    return c.json({
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt,
      apiKey: null,
      needsRedeployment: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get deployment info'
    logger.error('Error getting deployment info', { workflowId, error: message })
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /:id/deploy
 *
 * Deploy a workflow. Loads the current workflow state from normalized tables,
 * creates a deployment version record, and marks the workflow as deployed.
 */
app.post('/:id/deploy', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)

  logger.info('Deploy workflow request', { workflowId, userId })

  try {
    const result = await verifyWorkflowAccess(workflowId, userId)
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }

    const workflowData = result.data
    const currentState = await loadWorkflowState(workflowId, workflowData)
    const now = new Date()

    await db.transaction(async (tx) => {
      // Get next version number
      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql`COALESCE(MAX("version"), 0)` })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      const nextVersion = Number(maxVersion) + 1

      // Deactivate all existing versions
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      // Create new deployment version
      await tx.insert(workflowDeploymentVersion).values({
        id: crypto.randomUUID(),
        workflowId,
        version: nextVersion,
        state: currentState,
        isActive: true,
        createdBy: userId,
        createdAt: now,
      })

      // Mark workflow as deployed
      await tx
        .update(workflow)
        .set({ isDeployed: true, deployedAt: now })
        .where(eq(workflow.id, workflowId))
    })

    logger.info('Workflow deployed successfully', { workflowId })

    return c.json({
      success: true,
      isDeployed: true,
      deployedAt: now,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy workflow'
    logger.error('Error deploying workflow', { workflowId, error: message })
    return c.json({ error: message }, 500)
  }
})

/**
 * DELETE /:id/deploy
 *
 * Undeploy a workflow. Deactivates all deployment versions and
 * marks the workflow as not deployed.
 */
app.delete('/:id/deploy', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)

  logger.info('Undeploy workflow request', { workflowId, userId })

  try {
    const result = await verifyWorkflowAccess(workflowId, userId)
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }

    await db.transaction(async (tx) => {
      // Deactivate all deployment versions
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      // Mark workflow as not deployed
      await tx
        .update(workflow)
        .set({ isDeployed: false, deployedAt: null })
        .where(eq(workflow.id, workflowId))
    })

    logger.info('Workflow undeployed successfully', { workflowId })

    return c.json({ success: true, isDeployed: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to undeploy workflow'
    logger.error('Error undeploying workflow', { workflowId, error: message })
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /:id/deployed
 *
 * Get the deployed workflow state by querying the latest active deployment version.
 */
app.get('/:id/deployed', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)

  try {
    const result = await verifyWorkflowAccess(workflowId, userId)
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }

    const [activeVersion] = await db
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        state: workflowDeploymentVersion.state,
        createdAt: workflowDeploymentVersion.createdAt,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (!activeVersion) {
      return c.json({ error: 'Workflow not deployed' }, 404)
    }

    return c.json({
      success: true,
      deployedState: activeVersion.state,
      deploymentVersionId: activeVersion.id,
      version: activeVersion.version,
      createdAt: activeVersion.createdAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get deployed state'
    logger.error('Error getting deployed state', { workflowId, error: message })
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /:id/deployments
 *
 * List all deployment versions for a workflow.
 */
app.get('/:id/deployments', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)

  try {
    const result = await verifyWorkflowAccess(workflowId, userId)
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }

    const versions = await db
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        name: workflowDeploymentVersion.name,
        description: workflowDeploymentVersion.description,
        isActive: workflowDeploymentVersion.isActive,
        createdAt: workflowDeploymentVersion.createdAt,
        createdBy: workflowDeploymentVersion.createdBy,
      })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
      .orderBy(desc(workflowDeploymentVersion.createdAt))

    return c.json({ versions })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list deployment versions'
    logger.error('Error listing deployment versions', { workflowId, error: message })
    return c.json({ error: message }, 500)
  }
})

/**
 * GET /:id/deployments/:version/state
 *
 * Get the state snapshot for a specific deployment version.
 */
app.get('/:id/deployments/:version/state', async (c) => {
  const workflowId = c.req.param('id')
  const versionNum = Number(c.req.param('version'))
  const userId = getUserId(c)

  try {
    const result = await verifyWorkflowAccess(workflowId, userId)
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }

    const [versionData] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .limit(1)

    if (!versionData) {
      return c.json({ error: 'Deployment version not found' }, 404)
    }

    return c.json({
      state: versionData.state,
      version: versionData.version,
      isActive: versionData.isActive,
      createdAt: versionData.createdAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get deployment version state'
    logger.error('Error getting deployment version state', { workflowId, error: message })
    return c.json({ error: message }, 500)
  }
})

/**
 * PATCH /:id/deployments/:version
 *
 * Update a deployment version's name/description, or activate it.
 * When isActive=true is sent, deactivates all other versions and promotes this one.
 */
app.patch('/:id/deployments/:version', async (c) => {
  const workflowId = c.req.param('id')
  const versionNum = Number(c.req.param('version'))
  const userId = getUserId(c)

  try {
    const result = await verifyWorkflowAccess(workflowId, userId)
    if ('error' in result) {
      return c.json({ error: result.error }, result.status)
    }

    const body = await c.req.json()
    const { name, description, isActive } = body

    // Find the target version
    const [versionData] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.version, versionNum)
        )
      )
      .limit(1)

    if (!versionData) {
      return c.json({ error: 'Deployment version not found' }, 404)
    }

    // If activating this version (promoting)
    if (isActive === true) {
      const now = new Date()

      await db.transaction(async (tx) => {
        // Deactivate all versions for this workflow
        await tx
          .update(workflowDeploymentVersion)
          .set({ isActive: false })
          .where(eq(workflowDeploymentVersion.workflowId, workflowId))

        // Activate the target version
        await tx
          .update(workflowDeploymentVersion)
          .set({ isActive: true })
          .where(eq(workflowDeploymentVersion.id, versionData.id))

        // Update workflow deployed status
        await tx
          .update(workflow)
          .set({ isDeployed: true, deployedAt: now })
          .where(eq(workflow.id, workflowId))
      })

      logger.info('Deployment version activated', { workflowId, version: versionNum })

      return c.json({
        success: true,
        isActive: true,
        deployedAt: now,
      })
    }

    // Otherwise just update name/description
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description

    if (Object.keys(updates).length > 0) {
      await db
        .update(workflowDeploymentVersion)
        .set(updates)
        .where(eq(workflowDeploymentVersion.id, versionData.id))
    }

    logger.info('Deployment version updated', { workflowId, version: versionNum })

    return c.json({
      name: name !== undefined ? name : versionData.name,
      description: description !== undefined ? description : versionData.description,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update deployment version'
    logger.error('Error updating deployment version', { workflowId, error: message })
    return c.json({ error: message }, 500)
  }
})

export { app as deployRoutes }
