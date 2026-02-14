import { randomUUID } from 'crypto'
import { Hono } from 'hono'
import { db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('ResumeRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET /api/resume/:workflowId/:executionId
 * Get paused execution detail.
 */
app.get('/:workflowId/:executionId', async (c) => {
  const workflowId = c.req.param('workflowId')
  const executionId = c.req.param('executionId')

  const [workflowRecord] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    return c.json({ error: 'Workflow not found' }, 404)
  }

  try {
    const detail = await PauseResumeManager.getPausedExecutionDetail({
      workflowId,
      executionId,
    })

    if (!detail) {
      return c.json({ error: 'Paused execution not found' }, 404)
    }

    return c.json(detail)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load paused execution detail'
    logger.error('Failed to load paused execution detail', {
      workflowId,
      executionId,
      error,
    })
    return c.json({ error: message }, 500)
  }
})

/**
 * POST /api/resume/:workflowId/:executionId/:contextId
 * Resume a paused execution with optional input.
 */
app.post('/:workflowId/:executionId/:contextId', async (c) => {
  const workflowId = c.req.param('workflowId')
  const executionId = c.req.param('executionId')
  const contextId = c.req.param('contextId')

  const [workflowRecord] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    return c.json({ error: 'Workflow not found' }, 404)
  }

  let payload: Record<string, unknown> = {}
  try {
    payload = await c.req.json()
  } catch {
    payload = {}
  }

  const resumeInput = payload?.input ?? payload ?? {}
  const userId = workflowRecord.userId ?? ''
  const resumeExecutionId = randomUUID()
  const requestId = generateRequestId()

  logger.info(`[${requestId}] Preprocessing resume execution`, {
    workflowId,
    parentExecutionId: executionId,
    resumeExecutionId,
    userId,
  })

  const preprocessResult = await preprocessExecution({
    workflowId,
    userId,
    triggerType: 'manual',
    executionId: resumeExecutionId,
    requestId,
    checkRateLimit: false,
    checkDeployment: false,
    skipUsageLimits: true,
    workspaceId: workflowRecord.workspaceId || undefined,
    isResumeContext: true,
  })

  if (!preprocessResult.success) {
    logger.warn(`[${requestId}] Preprocessing failed for resume`, {
      workflowId,
      parentExecutionId: executionId,
      error: preprocessResult.error?.message,
      statusCode: preprocessResult.error?.statusCode,
    })

    return c.json(
      {
        error:
          preprocessResult.error?.message ||
          'Failed to validate resume execution. Please try again.',
      },
      (preprocessResult.error?.statusCode || 400) as 400
    )
  }

  logger.info(`[${requestId}] Preprocessing passed, proceeding with resume`, {
    workflowId,
    parentExecutionId: executionId,
    resumeExecutionId,
    actorUserId: preprocessResult.actorUserId,
  })

  try {
    const enqueueResult = await PauseResumeManager.enqueueOrStartResume({
      executionId,
      contextId,
      resumeInput,
      userId,
    })

    if (enqueueResult.status === 'queued') {
      return c.json({
        status: 'queued',
        executionId: enqueueResult.resumeExecutionId,
        queuePosition: enqueueResult.queuePosition,
        message: 'Resume queued. It will run after current resumes finish.',
      })
    }

    PauseResumeManager.startResumeExecution({
      resumeEntryId: enqueueResult.resumeEntryId,
      resumeExecutionId: enqueueResult.resumeExecutionId,
      pausedExecution: enqueueResult.pausedExecution,
      contextId: enqueueResult.contextId,
      resumeInput: enqueueResult.resumeInput,
      userId: enqueueResult.userId,
    }).catch((error) => {
      logger.error('Failed to start resume execution', {
        workflowId,
        parentExecutionId: executionId,
        resumeExecutionId: enqueueResult.resumeExecutionId,
        error,
      })
    })

    return c.json({
      status: 'started',
      executionId: enqueueResult.resumeExecutionId,
      message: 'Resume execution started.',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to queue resume request'
    logger.error('Resume request failed', {
      workflowId,
      executionId,
      contextId,
      error,
    })
    return c.json({ error: message }, 400)
  }
})

/**
 * GET /api/resume/:workflowId/:executionId/:contextId
 * Get pause context detail.
 */
app.get('/:workflowId/:executionId/:contextId', async (c) => {
  const workflowId = c.req.param('workflowId')
  const executionId = c.req.param('executionId')
  const contextId = c.req.param('contextId')

  try {
    const detail = await PauseResumeManager.getPauseContextDetail({
      workflowId,
      executionId,
      contextId,
    })

    if (!detail) {
      return c.json({ error: 'Pause context not found' }, 404)
    }

    return c.json(detail)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load pause context detail'
    logger.error('Failed to load pause context detail', {
      workflowId,
      executionId,
      contextId,
      error,
    })
    return c.json({ error: message }, 500)
  }
})

export { app as resumeRoutes }
