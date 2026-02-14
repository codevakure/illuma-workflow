import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getUserId, type AuthContext } from '@/middleware/auth'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import {
  type ExecutionEvent,
  encodeSSEEvent,
  createSSECallbacks,
} from '@/lib/workflows/executor/execution-events'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, IterationContext } from '@/executor/execution/types'
import type { StreamingExecution } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { processInputFileFields } from '@/lib/execution/files'
import { Serializer } from '@/serializer'
import { CORE_TRIGGER_TYPES, type CoreTriggerType } from '@/stores/logs/filters/types'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'
import type { Edge } from '@/types/reactflow'

const logger = createLogger('ExecuteRoute')

const app = new Hono<{ Variables: AuthContext }>()

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

const ExecuteWorkflowSchema = z.object({
  selectedOutputs: z.array(z.string()).optional().default([]),
  triggerType: z.enum(CORE_TRIGGER_TYPES).optional(),
  stream: z.boolean().optional(),
  useDraftState: z.boolean().optional(),
  input: z.any().optional(),
  isClientSession: z.boolean().optional(),
  includeFileBase64: z.boolean().optional().default(true),
  base64MaxBytes: z.number().int().positive().optional(),
  workflowStateOverride: z
    .object({
      blocks: z.record(z.any()),
      edges: z.array(z.any()),
      loops: z.record(z.any()).optional(),
      parallels: z.record(z.any()).optional(),
    })
    .optional(),
  stopAfterBlockId: z.string().optional(),
  runFromBlock: z
    .object({
      startBlockId: z.string().min(1, 'Start block ID is required'),
      sourceSnapshot: z.object({
        blockStates: z.record(z.any()),
        executedBlocks: z.array(z.string()),
        blockLogs: z.array(z.any()),
        decisions: z.object({
          router: z.record(z.string()),
          condition: z.record(z.string()),
        }),
        completedLoops: z.array(z.string()),
        loopExecutions: z.record(z.any()).optional(),
        parallelExecutions: z.record(z.any()).optional(),
        parallelBlockMapping: z.record(z.any()).optional(),
        activeExecutionPath: z.array(z.string()),
      }),
    })
    .optional(),
})

/**
 * POST /api/workflows/:id/execute
 *
 * Execute a workflow using executeWorkflowCore with SSE streaming response.
 * This mirrors the legacy Next.js execute route, going through the full
 * execution pipeline (preprocessing, env var loading, subblock merging, etc.).
 */
app.post('/:id/execute', async (c) => {
  const workflowId = c.req.param('id')
  const userId = getUserId(c)
  const requestId = uuidv4().slice(0, 8)

  logger.info(`[${requestId}] Execute workflow request`, { workflowId, userId })

  let body: Record<string, unknown>
  try {
    const text = await c.req.text()
    if (text) {
      body = JSON.parse(text)
    } else {
      body = {}
    }
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const validation = ExecuteWorkflowSchema.safeParse(body)
  if (!validation.success) {
    logger.warn(`[${requestId}] Invalid request body`, { errors: validation.error.errors })
    return c.json(
      {
        error: 'Invalid request body',
        details: validation.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
      400
    )
  }

  const {
    selectedOutputs,
    triggerType: triggerTypeParam,
    stream: streamParam,
    useDraftState,
    input: validatedInput,
    isClientSession = false,
    includeFileBase64,
    base64MaxBytes,
    workflowStateOverride,
    stopAfterBlockId,
    runFromBlock,
  } = validation.data

  const input = validatedInput
  const shouldUseDraftState = useDraftState ?? true
  const triggerType: CoreTriggerType = triggerTypeParam || 'manual'
  const enableSSE = streamParam === true || c.req.header('X-Stream-Response') === 'true'
  const executionId = uuidv4()

  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

  // Preprocess: validate workflow, check rate limits, billing, deployment
  const preprocessResult = await preprocessExecution({
    workflowId,
    userId,
    triggerType,
    executionId,
    requestId,
    checkDeployment: !shouldUseDraftState,
    loggingSession,
    useDraftState: shouldUseDraftState,
  })

  if (!preprocessResult.success) {
    return c.json(
      { error: preprocessResult.error!.message },
      preprocessResult.error!.statusCode as 400 | 404 | 429 | 500
    )
  }

  const actorUserId = preprocessResult.actorUserId!
  const workflow = preprocessResult.workflowRecord!

  if (!workflow.workspaceId) {
    logger.error(`[${requestId}] Workflow ${workflowId} has no workspaceId`)
    return c.json({ error: 'Workflow has no associated workspace' }, 500)
  }
  const workspaceId = workflow.workspaceId

  logger.info(`[${requestId}] Preprocessing passed`, { workflowId, actorUserId, workspaceId })

  // Load workflow state
  let cachedWorkflowData: {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, Loop>
    parallels: Record<string, Parallel>
    deploymentVersionId?: string
    variables?: Record<string, unknown>
  } | null = null

  let processedInput = input
  try {
    const workflowData = shouldUseDraftState
      ? await loadWorkflowFromNormalizedTables(workflowId)
      : await loadDeployedWorkflowState(workflowId)

    if (workflowData) {
      const deployedVariables =
        !shouldUseDraftState && 'variables' in workflowData
          ? (workflowData as Record<string, unknown>).variables
          : undefined

      cachedWorkflowData = {
        blocks: workflowData.blocks as Record<string, BlockState>,
        edges: workflowData.edges as Edge[],
        loops: (workflowData.loops || {}) as Record<string, Loop>,
        parallels: (workflowData.parallels || {}) as Record<string, Parallel>,
        deploymentVersionId:
          !shouldUseDraftState && 'deploymentVersionId' in workflowData
            ? (workflowData.deploymentVersionId as string)
            : undefined,
        variables: deployedVariables as Record<string, unknown> | undefined,
      }

      // Process input file fields
      const serializedWorkflow = new Serializer().serializeWorkflow(
        workflowData.blocks as Record<string, BlockState>,
        workflowData.edges as Edge[],
        workflowData.loops as Record<string, Loop>,
        workflowData.parallels as Record<string, Parallel>,
        false
      )

      const executionContext = { workspaceId, workflowId, executionId }

      processedInput = await processInputFileFields(
        input,
        serializedWorkflow.blocks,
        executionContext,
        requestId,
        actorUserId
      )
    }
  } catch (fileError) {
    logger.error(`[${requestId}] Failed to process input file fields`, { error: fileError })
    return c.json(
      {
        error: `File processing failed: ${fileError instanceof Error ? fileError.message : 'Unable to process input files'}`,
      },
      400
    )
  }

  const effectiveWorkflowStateOverride =
    workflowStateOverride || cachedWorkflowData || undefined

  // Build execution metadata
  const metadata: ExecutionMetadata = {
    requestId,
    executionId,
    workflowId,
    workspaceId,
    userId: actorUserId,
    sessionUserId: isClientSession ? userId : undefined,
    workflowUserId: workflow.userId,
    triggerType,
    useDraftState: shouldUseDraftState,
    startTime: new Date().toISOString(),
    isClientSession,
    workflowStateOverride: effectiveWorkflowStateOverride,
  }

  const executionVariables = cachedWorkflowData?.variables ?? workflow.variables ?? {}

  const snapshot = new ExecutionSnapshot(
    metadata,
    workflow,
    processedInput,
    executionVariables,
    selectedOutputs
  )

  if (!enableSSE) {
    // Non-streaming execution via executeWorkflowCore
    try {
      const result = await executeWorkflowCore({
        snapshot,
        callbacks: {},
        loggingSession,
        includeFileBase64,
        base64MaxBytes,
        stopAfterBlockId,
        runFromBlock,
      })

      if (result.status === 'paused') {
        if (result.snapshotSeed) {
          try {
            await PauseResumeManager.persistPauseResult({
              workflowId,
              executionId,
              pausePoints: result.pausePoints || [],
              snapshotSeed: result.snapshotSeed,
              executorUserId: result.metadata?.userId,
            })
          } catch (pauseError) {
            logger.error(`[${requestId}] Failed to persist pause result`, { error: pauseError })
          }
        }
      } else {
        await PauseResumeManager.processQueuedResumes(executionId)
      }

      return c.json({
        success: result.success,
        executionId,
        output: result.output,
        error: result.error,
        metadata: result.metadata
          ? {
              duration: result.metadata.duration,
              startTime: result.metadata.startTime,
              endTime: result.metadata.endTime,
            }
          : undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed'
      logger.error(`[${requestId}] Non-SSE execution failed`, { error: message })

      const executionResult = hasExecutionResult(error) ? error.executionResult : undefined

      return c.json(
        {
          success: false,
          output: executionResult?.output,
          error: executionResult?.error || message,
          executionId,
        },
        500
      )
    }
  }

  // Streaming SSE execution via executeWorkflowCore
  const encoder = new TextEncoder()
  let isStreamClosed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { sendEvent, onBlockStart, onBlockComplete, onStream } = createSSECallbacks({
        executionId,
        workflowId,
        controller,
        isStreamClosed: () => isStreamClosed,
        setStreamClosed: () => {
          isStreamClosed = true
        },
      })

      try {
        sendEvent({
          type: 'execution:started',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { startTime: new Date().toISOString() },
        })

        const result = await executeWorkflowCore({
          snapshot,
          callbacks: {
            onBlockStart,
            onBlockComplete,
            onStream,
          },
          loggingSession,
          includeFileBase64,
          base64MaxBytes,
          stopAfterBlockId,
          runFromBlock,
        })

        if (result.status === 'paused') {
          if (result.snapshotSeed) {
            try {
              await PauseResumeManager.persistPauseResult({
                workflowId,
                executionId,
                pausePoints: result.pausePoints || [],
                snapshotSeed: result.snapshotSeed,
                executorUserId: result.metadata?.userId,
              })
            } catch (pauseError) {
              logger.error(`[${requestId}] Failed to persist pause result`, { error: pauseError })
            }
          }
        } else {
          await PauseResumeManager.processQueuedResumes(executionId)
        }

        if (result.status === 'cancelled') {
          sendEvent({
            type: 'execution:cancelled',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: { duration: result.metadata?.duration || 0 },
          })
          return
        }

        sendEvent({
          type: 'execution:completed',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: {
            success: result.success,
            output: result.output,
            duration: result.metadata?.duration || 0,
            startTime: result.metadata?.startTime || new Date().toISOString(),
            endTime: result.metadata?.endTime || new Date().toISOString(),
          },
        })
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error(`[${requestId}] SSE execution failed`, { error: errorMessage })

        const executionResult = hasExecutionResult(error) ? error.executionResult : undefined
        const { traceSpans, totalDuration } = executionResult
          ? buildTraceSpans(executionResult)
          : { traceSpans: [], totalDuration: 0 }

        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: totalDuration || executionResult?.metadata?.duration,
          error: { message: errorMessage },
          traceSpans,
        })

        sendEvent({
          type: 'execution:error',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: {
            error: executionResult?.error || errorMessage,
            duration: executionResult?.metadata?.duration || 0,
          },
        })
      } finally {
        if (!isStreamClosed) {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {}
        }
      }
    },
    cancel() {
      isStreamClosed = true
      logger.info(`[${requestId}] Client aborted SSE stream`)
    },
  })

  return new Response(stream, {
    headers: {
      ...SSE_HEADERS,
      'X-Execution-Id': executionId,
    },
  })
})

/**
 * POST /api/workflows/:id/log
 *
 * Persist execution logs (stub for now).
 */
app.post('/:id/log', async (c) => {
  const workflowId = c.req.param('id')
  logger.info('Persisting logs for workflow', { workflowId })
  return c.json({ success: true })
})

/**
 * POST /api/workflows/:id/executions/:executionId/cancel
 *
 * Cancel a running execution (stub).
 */
app.post('/:id/executions/:executionId/cancel', async (c) => {
  const workflowId = c.req.param('id')
  const executionId = c.req.param('executionId')
  logger.info('Cancel execution', { workflowId, executionId })
  return c.json({ success: true })
})

export { app as executeRoutes }
