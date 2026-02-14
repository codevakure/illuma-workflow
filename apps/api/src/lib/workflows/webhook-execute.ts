/**
 * Webhook execution bridge module.
 *
 * Dynamically imported by processor.ts to execute webhook-triggered workflows.
 * Loads the deployed workflow state, formats the webhook input, creates an
 * ExecutionSnapshot, and runs the workflow via executeWorkflowCore.
 */
import { db } from '@sim/db'
import { webhook as webhookTable, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils.server'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'

const logger = createLogger('WebhookExecution')

export interface WebhookExecutionPayload {
  webhookId: string
  workflowId: string
  userId: string
  provider: string
  body: Record<string, unknown>
  headers: Record<string, string>
  path: string
  blockId?: string
  credentialId?: string
  credentialAccountUserId?: string
}

/**
 * Executes a webhook-triggered workflow.
 * Called inline (fire-and-forget) from the webhook processor since sim-v2
 * does not yet have a background job queue.
 */
export async function executeWebhookWorkflow(payload: WebhookExecutionPayload): Promise<void> {
  const executionId = uuidv4()
  const requestId = `wh-exec-${executionId.slice(0, 8)}`

  logger.info(`[${requestId}] Starting webhook execution`, {
    webhookId: payload.webhookId,
    workflowId: payload.workflowId,
    provider: payload.provider,
  })

  const loggingSession = new LoggingSession(
    payload.workflowId,
    executionId,
    payload.provider || 'webhook',
    requestId
  )

  try {
    const [wf] = await db
      .select({
        id: workflowTable.id,
        userId: workflowTable.userId,
        workspaceId: workflowTable.workspaceId,
      })
      .from(workflowTable)
      .where(eq(workflowTable.id, payload.workflowId))
      .limit(1)

    if (!wf) {
      logger.error(`[${requestId}] Workflow not found: ${payload.workflowId}`)
      await loggingSession.markAsFailed('Workflow not found')
      return
    }

    if (!wf.workspaceId) {
      logger.error(`[${requestId}] Workflow ${payload.workflowId} has no workspaceId`)
      await loggingSession.markAsFailed('Workflow has no workspace')
      return
    }

    const deployedData = await loadDeployedWorkflowState(payload.workflowId)

    if (!deployedData) {
      logger.error(`[${requestId}] No deployed state found for workflow ${payload.workflowId}`)
      await loggingSession.markAsFailed('No deployed workflow state')
      return
    }

    const { blocks, edges, loops, parallels, deploymentVersionId, variables } = deployedData

    let triggerInput: unknown

    if (payload.provider === 'airtable') {
      const [wh] = await db
        .select()
        .from(webhookTable)
        .where(eq(webhookTable.id, payload.webhookId))
        .limit(1)

      const changes = await fetchAndProcessAirtablePayloads(
        wh || {},
        wf,
        requestId
      )

      if (!changes) {
        logger.info(`[${requestId}] No Airtable changes to process, skipping execution`)
        return
      }

      triggerInput = changes
    } else if (payload.provider === 'whatsapp') {
      const body = payload.body as Record<string, unknown>
      const entry = body?.entry as Array<Record<string, unknown>> | undefined
      const changes = entry?.[0]?.changes as Array<Record<string, unknown>> | undefined
      const value = changes?.[0]?.value as Record<string, unknown> | undefined
      const messages = value?.messages as unknown[] | undefined

      if (!messages || messages.length === 0) {
        logger.info(`[${requestId}] No WhatsApp messages in payload, skipping execution`)
        return
      }

      const [wh] = await db
        .select()
        .from(webhookTable)
        .where(eq(webhookTable.id, payload.webhookId))
        .limit(1)

      triggerInput = await formatWebhookInput(
        wh || {},
        { ...wf, state: { blocks, edges } },
        payload.body,
        new Request('https://placeholder', {
          method: 'POST',
          headers: new Headers(payload.headers),
        })
      )
    } else {
      const [wh] = await db
        .select()
        .from(webhookTable)
        .where(eq(webhookTable.id, payload.webhookId))
        .limit(1)

      triggerInput = await formatWebhookInput(
        wh || {},
        { ...wf, state: { blocks, edges } },
        payload.body,
        new Request('https://placeholder', {
          method: 'POST',
          headers: new Headers(payload.headers),
        })
      )
    }

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId: payload.workflowId,
      workspaceId: wf.workspaceId,
      userId: payload.userId,
      workflowUserId: wf.userId,
      triggerType: payload.provider || 'webhook',
      triggerBlockId: payload.blockId,
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
      credentialAccountUserId: payload.credentialAccountUserId,
      workflowStateOverride: {
        blocks,
        edges,
        loops,
        parallels,
        deploymentVersionId,
      },
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      { id: wf.id, userId: wf.userId, workspaceId: wf.workspaceId, variables: variables || {} },
      triggerInput,
      variables || {},
      []
    )

    const timeoutMs = 5 * 60 * 1000
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const result = await executeWorkflowCore({
        snapshot,
        callbacks: {},
        loggingSession,
        includeFileBase64: true,
        abortSignal: controller.signal,
      })

      if (result.status === 'paused') {
        if (result.snapshotSeed) {
          await PauseResumeManager.persistPauseResult({
            workflowId: payload.workflowId,
            executionId,
            pausePoints: result.pausePoints || [],
            snapshotSeed: result.snapshotSeed,
            executorUserId: result.metadata?.userId,
          })
        } else {
          logger.error(`[${requestId}] Missing snapshot seed for paused execution`)
          await loggingSession.markAsFailed('Missing snapshot seed for paused execution')
        }
      } else {
        await PauseResumeManager.processQueuedResumes(executionId)
      }

      logger.info(`[${requestId}] Webhook execution completed`, {
        status: result.status,
        executionId,
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`[${requestId}] Webhook execution failed:`, {
      error: message,
      webhookId: payload.webhookId,
      workflowId: payload.workflowId,
    })

    try {
      await loggingSession.markAsFailed(message)
    } catch (logErr) {
      logger.error(`[${requestId}] Failed to log execution failure`, logErr)
    }
  }
}
