import { Hono } from 'hono'
import { db } from '@sim/db'
import { workflow, workflowDeploymentVersion, workflowSchedule } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, lt, lte, not, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getUserId, type AuthContext } from '@/middleware/auth'
import { verifyCronAuth } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import {
  type BlockState,
  calculateNextRunTime as calculateNextTime,
  getScheduleTimeValues,
  getSubBlockValue,
  validateCronExpression,
} from '@/lib/workflows/schedules/utils'
import { blockExistsInDeployment, loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'
import { Cron } from 'croner'
import { v4 as uuidv4 } from 'uuid'

const logger = createLogger('ScheduleRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET /api/schedules
 * Get schedule information for a workflow.
 * Query params: workflowId (required), blockId (optional)
 */
app.get('/', async (c) => {
  const requestId = generateRequestId()
  const workflowId = c.req.query('workflowId')
  const blockId = c.req.query('blockId')

  try {
    const userId = getUserId(c)

    if (!workflowId) {
      return c.json({ error: 'Missing workflowId parameter' }, 400)
    }

    const [workflowRecord] = await db
      .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return c.json({ error: 'Workflow not found' }, 404)
    }

    let isAuthorized = workflowRecord.userId === userId

    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission !== null
    }

    if (!isAuthorized) {
      return c.json({ error: 'Not authorized to view this workflow' }, 403)
    }

    logger.info(`[${requestId}] Getting schedule for workflow ${workflowId}`)

    const conditions = [eq(workflowSchedule.workflowId, workflowId)]
    if (blockId) {
      conditions.push(eq(workflowSchedule.blockId, blockId))
    }

    const schedule = await db
      .select({ schedule: workflowSchedule })
      .from(workflowSchedule)
      .leftJoin(
        workflowDeploymentVersion,
        and(
          eq(workflowDeploymentVersion.workflowId, workflowSchedule.workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .where(
        and(
          ...conditions,
          or(
            eq(workflowSchedule.deploymentVersionId, workflowDeploymentVersion.id),
            and(
              isNull(workflowDeploymentVersion.id),
              isNull(workflowSchedule.deploymentVersionId)
            )
          )
        )
      )
      .limit(1)

    if (schedule.length === 0) {
      return c.json(
        { schedule: null },
        200,
        { 'Cache-Control': 'no-store, max-age=0' }
      )
    }

    const scheduleData = schedule[0].schedule
    const isDisabled = scheduleData.status === 'disabled'
    const hasFailures = scheduleData.failedCount > 0

    return c.json(
      {
        schedule: scheduleData,
        isDisabled,
        hasFailures,
        canBeReactivated: isDisabled,
      },
      200,
      { 'Cache-Control': 'no-store, max-age=0' }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving workflow schedule`, error)
    return c.json({ error: 'Failed to retrieve workflow schedule' }, 500)
  }
})

/**
 * Payload describing a single due schedule to execute.
 */
interface ScheduleExecutionPayload {
  scheduleId: string
  workflowId: string
  blockId?: string
  cronExpression?: string
  lastRanAt?: string
  failedCount: number
  now: string
  scheduledFor?: string
}

/**
 * Apply a partial update to a workflow schedule record.
 */
async function applyScheduleUpdate(
  scheduleId: string,
  updates: Partial<typeof workflowSchedule.$inferInsert>,
  requestId: string,
  context: string,
  successLog?: string
) {
  try {
    await db.update(workflowSchedule).set(updates).where(eq(workflowSchedule.id, scheduleId))
    if (successLog) {
      logger.debug(`[${requestId}] ${successLog}`)
    }
  } catch (error) {
    logger.error(`[${requestId}] ${context}`, error)
  }
}

/**
 * Calculate the next run time from the deployed workflow state.
 */
function calculateNextRunTime(
  schedule: { cronExpression?: string; lastRanAt?: string },
  blocks: Record<string, BlockState>
): Date {
  const scheduleBlock = Object.values(blocks).find(
    (block) => block.type === 'starter' || block.type === 'schedule'
  )
  if (!scheduleBlock) throw new Error('No starter or schedule block found')

  const scheduleType = getSubBlockValue(scheduleBlock, 'scheduleType')
  const scheduleValues = getScheduleTimeValues(scheduleBlock)
  const timezone = scheduleValues.timezone || 'UTC'

  if (schedule.cronExpression) {
    const cron = new Cron(schedule.cronExpression, { timezone })
    const nextDate = cron.nextRun()
    if (!nextDate) throw new Error('Invalid cron expression or no future occurrences')
    return nextDate
  }

  return calculateNextTime(scheduleType, scheduleValues)
}

/**
 * Calculate the next run time from the deployed workflow for a given payload.
 * Returns null when the deployed state cannot be loaded.
 */
async function calculateNextRunFromDeployment(
  payload: ScheduleExecutionPayload,
  requestId: string
): Promise<Date | null> {
  try {
    const deployedData = await loadDeployedWorkflowState(payload.workflowId)
    return calculateNextRunTime(payload, deployedData.blocks as Record<string, BlockState>)
  } catch (error) {
    logger.warn(
      `[${requestId}] Unable to calculate nextRunAt for schedule ${payload.scheduleId}`,
      error
    )
    return null
  }
}

/**
 * Determine the next run time after an error: try deployed state first, then fall back to +24h.
 */
async function determineNextRunAfterError(
  payload: ScheduleExecutionPayload,
  now: Date,
  requestId: string
): Promise<Date> {
  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    if (workflowRecord?.isDeployed) {
      const nextRunAt = await calculateNextRunFromDeployment(payload, requestId)
      if (nextRunAt) {
        return nextRunAt
      }
    }
  } catch (workflowError) {
    logger.error(
      `[${requestId}] Error retrieving workflow for next run calculation`,
      workflowError
    )
  }

  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
}

/**
 * Execute a single scheduled workflow inline (fire-and-forget).
 *
 * Since sim-v2 does not have Trigger.dev or a job queue, execution is performed
 * directly in-process. The function handles success/failure bookkeeping on the
 * schedule record, including incrementing the failure counter and disabling the
 * schedule after MAX_CONSECUTIVE_FAILURES.
 */
async function executeScheduleInline(payload: ScheduleExecutionPayload): Promise<void> {
  const executionId = uuidv4()
  const requestId = executionId.slice(0, 8)
  const now = new Date(payload.now)

  logger.info(`[${requestId}] Starting inline schedule execution`, {
    scheduleId: payload.scheduleId,
    workflowId: payload.workflowId,
    executionId,
  })

  try {
    const [workflowRecord] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow not found, disabling schedule`)
      await applyScheduleUpdate(
        payload.scheduleId,
        {
          updatedAt: now,
          lastQueuedAt: null,
          status: 'disabled',
        },
        requestId,
        `Failed to disable schedule ${payload.scheduleId} after missing workflow`,
        `Disabled schedule ${payload.scheduleId} because the workflow no longer exists`
      )
      return
    }

    if (!workflowRecord.isDeployed) {
      logger.warn(`[${requestId}] Workflow is not deployed, disabling schedule`)
      await applyScheduleUpdate(
        payload.scheduleId,
        {
          updatedAt: now,
          lastQueuedAt: null,
          status: 'disabled',
        },
        requestId,
        `Failed to disable schedule ${payload.scheduleId} after undeployed workflow`,
        `Disabled schedule ${payload.scheduleId} because the workflow is not deployed`
      )
      return
    }

    const deployedData = await loadDeployedWorkflowState(payload.workflowId)
    const blocks = deployedData.blocks as Record<string, BlockState>

    if (payload.blockId) {
      const blockExists = await blockExistsInDeployment(payload.workflowId, payload.blockId)
      if (!blockExists) {
        logger.warn(
          `[${requestId}] Schedule trigger block ${payload.blockId} not found in deployed workflow ${payload.workflowId}. Skipping execution.`
        )
        const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : now
        await applyScheduleUpdate(
          payload.scheduleId,
          {
            updatedAt: now,
            lastQueuedAt: null,
            nextRunAt: scheduledFor,
          },
          requestId,
          `Failed to release schedule ${payload.scheduleId} after skip`
        )
        return
      }
    }

    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      throw new Error(`Workflow ${payload.workflowId} has no associated workspace`)
    }

    logger.info(`[${requestId}] Executing scheduled workflow ${payload.workflowId}`)

    // Execute the workflow using the DAG executor
    const { Serializer } = await import('@/serializer')
    const { DAGExecutor } = await import('@/executor/execution/executor')

    const serializer = new Serializer()
    const serializedWorkflow = serializer.serializeWorkflow(
      blocks as any,
      deployedData.edges,
      deployedData.loops,
      deployedData.parallels,
      true
    )

    const executor = new DAGExecutor({
      workflow: serializedWorkflow,
      envVarValues: {},
      workflowInput: {
        _context: { workflowId: payload.workflowId },
      },
      workflowVariables: (workflowRecord.variables || {}) as Record<string, unknown>,
      contextExtensions: {
        executionId,
        userId: workflowRecord.userId,
        workspaceId,
        isDeployedContext: true,
        selectedOutputs: [],
        edges: deployedData.edges.map((e: { source: string; target: string }) => ({
          source: e.source,
          target: e.target,
        })),
      },
    })

    const result = await executor.execute(payload.workflowId)

    if (result.success) {
      logger.info(`[${requestId}] Workflow ${payload.workflowId} executed successfully`)

      const nextRunAt = calculateNextRunTime(payload, blocks)

      await applyScheduleUpdate(
        payload.scheduleId,
        {
          lastRanAt: now,
          updatedAt: now,
          nextRunAt,
          failedCount: 0,
          lastQueuedAt: null,
        },
        requestId,
        `Error updating schedule ${payload.scheduleId} after success`,
        `Updated next run time for workflow ${payload.workflowId} to ${nextRunAt.toISOString()}`
      )
      return
    }

    logger.warn(`[${requestId}] Workflow ${payload.workflowId} execution failed`)

    const newFailedCount = (payload.failedCount || 0) + 1
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES
    if (shouldDisable) {
      logger.warn(
        `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      )
    }

    const nextRunAt = calculateNextRunTime(payload, blocks)

    await applyScheduleUpdate(
      payload.scheduleId,
      {
        updatedAt: now,
        nextRunAt,
        failedCount: newFailedCount,
        lastFailedAt: now,
        status: shouldDisable ? 'disabled' : 'active',
      },
      requestId,
      `Error updating schedule ${payload.scheduleId} after failure`,
      `Updated schedule ${payload.scheduleId} after failure`
    )
  } catch (error: unknown) {
    logger.error(
      `[${requestId}] Error executing scheduled workflow ${payload.workflowId}`,
      error
    )

    const nextRunAt = await determineNextRunAfterError(payload, now, requestId)
    const newFailedCount = (payload.failedCount || 0) + 1
    const shouldDisable = newFailedCount >= MAX_CONSECUTIVE_FAILURES

    if (shouldDisable) {
      logger.warn(
        `[${requestId}] Disabling schedule for workflow ${payload.workflowId} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      )
    }

    await applyScheduleUpdate(
      payload.scheduleId,
      {
        updatedAt: now,
        nextRunAt,
        failedCount: newFailedCount,
        lastFailedAt: now,
        status: shouldDisable ? 'disabled' : 'active',
      },
      requestId,
      `Error updating schedule ${payload.scheduleId} after execution error`,
      `Updated schedule ${payload.scheduleId} after execution error`
    )
  }
}

/**
 * GET /api/schedules/execute
 * Execute all due scheduled workflows (called by an external cron trigger).
 * Requires CRON_SECRET authentication via Bearer token.
 */
app.get('/execute', async (c) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Scheduled execution triggered at ${new Date().toISOString()}`)

  const authError = verifyCronAuth(c.req.raw, 'Schedule execution')
  if (authError) {
    return authError
  }

  const queuedAt = new Date()

  try {
    const dueSchedules = await db
      .update(workflowSchedule)
      .set({
        lastQueuedAt: queuedAt,
        updatedAt: queuedAt,
      })
      .where(
        and(
          lte(workflowSchedule.nextRunAt, queuedAt),
          not(eq(workflowSchedule.status, 'disabled')),
          or(
            isNull(workflowSchedule.lastQueuedAt),
            lt(workflowSchedule.lastQueuedAt, workflowSchedule.nextRunAt)
          ),
          sql`${workflowSchedule.deploymentVersionId} = (select ${workflowDeploymentVersion.id} from ${workflowDeploymentVersion} where ${workflowDeploymentVersion.workflowId} = ${workflowSchedule.workflowId} and ${workflowDeploymentVersion.isActive} = true)`
        )
      )
      .returning({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        blockId: workflowSchedule.blockId,
        cronExpression: workflowSchedule.cronExpression,
        lastRanAt: workflowSchedule.lastRanAt,
        failedCount: workflowSchedule.failedCount,
        nextRunAt: workflowSchedule.nextRunAt,
        lastQueuedAt: workflowSchedule.lastQueuedAt,
      })

    logger.debug(`[${requestId}] Successfully queried schedules: ${dueSchedules.length} found`)
    logger.info(`[${requestId}] Processing ${dueSchedules.length} due scheduled workflows`)

    const executionPromises = dueSchedules.map(async (schedule) => {
      const queueTime = schedule.lastQueuedAt ?? queuedAt

      const payload: ScheduleExecutionPayload = {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        blockId: schedule.blockId || undefined,
        cronExpression: schedule.cronExpression || undefined,
        lastRanAt: schedule.lastRanAt?.toISOString(),
        failedCount: schedule.failedCount || 0,
        now: queueTime.toISOString(),
        scheduledFor: schedule.nextRunAt?.toISOString(),
      }

      try {
        logger.info(
          `[${requestId}] Firing inline schedule execution for workflow ${schedule.workflowId}`
        )

        // Fire-and-forget: do not await, let execution run in the background
        void executeScheduleInline(payload).catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error)
          logger.error(
            `[${requestId}] Schedule execution failed for workflow ${schedule.workflowId}`,
            { error: errorMessage }
          )
        })
      } catch (error) {
        logger.error(
          `[${requestId}] Failed to launch schedule execution for workflow ${schedule.workflowId}`,
          error
        )
      }
    })

    await Promise.allSettled(executionPromises)

    logger.info(`[${requestId}] Launched ${dueSchedules.length} schedule executions`)

    return c.json({
      message: 'Scheduled workflow executions processed',
      executedCount: dueSchedules.length,
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`[${requestId}] Error in scheduled execution handler`, error)
    return c.json({ error: errorMessage }, 500)
  }
})

/**
 * Zod schema for the PUT /:id reactivation request body.
 */
const scheduleUpdateSchema = z.object({
  action: z.literal('reactivate'),
})

/**
 * PUT /api/schedules/:id
 * Reactivate a disabled schedule.
 */
app.put('/:id', async (c) => {
  const requestId = generateRequestId()

  try {
    const scheduleId = c.req.param('id')
    logger.debug(`[${requestId}] Reactivating schedule with ID: ${scheduleId}`)

    const userId = getUserId(c)

    const body = await c.req.json()
    const validation = scheduleUpdateSchema.safeParse(body)

    if (!validation.success) {
      return c.json({ error: 'Invalid request body' }, 400)
    }

    const [schedule] = await db
      .select({
        id: workflowSchedule.id,
        workflowId: workflowSchedule.workflowId,
        status: workflowSchedule.status,
        cronExpression: workflowSchedule.cronExpression,
        timezone: workflowSchedule.timezone,
      })
      .from(workflowSchedule)
      .where(eq(workflowSchedule.id, scheduleId))
      .limit(1)

    if (!schedule) {
      logger.warn(`[${requestId}] Schedule not found: ${scheduleId}`)
      return c.json({ error: 'Schedule not found' }, 404)
    }

    const [workflowRecord] = await db
      .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, schedule.workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow not found for schedule: ${scheduleId}`)
      return c.json({ error: 'Workflow not found' }, 404)
    }

    let isAuthorized = workflowRecord.userId === userId

    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission === 'write' || userPermission === 'admin'
    }

    if (!isAuthorized) {
      logger.warn(
        `[${requestId}] User not authorized to modify this schedule: ${scheduleId}`
      )
      return c.json({ error: 'Not authorized to modify this schedule' }, 403)
    }

    if (schedule.status === 'active') {
      return c.json({ message: 'Schedule is already active' }, 200)
    }

    if (!schedule.cronExpression) {
      logger.error(`[${requestId}] Schedule has no cron expression: ${scheduleId}`)
      return c.json({ error: 'Schedule has no cron expression' }, 400)
    }

    const cronResult = validateCronExpression(
      schedule.cronExpression,
      schedule.timezone || 'UTC'
    )
    if (!cronResult.isValid || !cronResult.nextRun) {
      logger.error(`[${requestId}] Invalid cron expression for schedule: ${scheduleId}`)
      return c.json({ error: 'Schedule has invalid cron expression' }, 400)
    }

    const now = new Date()
    const nextRunAt = cronResult.nextRun

    await db
      .update(workflowSchedule)
      .set({
        status: 'active',
        failedCount: 0,
        updatedAt: now,
        nextRunAt,
      })
      .where(eq(workflowSchedule.id, scheduleId))

    logger.info(`[${requestId}] Reactivated schedule: ${scheduleId}`)

    return c.json({
      message: 'Schedule activated successfully',
      nextRunAt,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating schedule`, error)
    return c.json({ error: 'Failed to update schedule' }, 500)
  }
})

export { app as scheduleRoutes }
