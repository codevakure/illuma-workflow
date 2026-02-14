import { Hono } from 'hono'
import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getUserId, type AuthContext } from '@/middleware/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { validateInteger } from '@/lib/core/security/input-validation'
import { PlatformEvents } from '@/lib/core/telemetry'
import { mergeNonUserFields } from '@/lib/webhooks/utils'
import { resolveEnvVarsInObject } from '@/lib/webhooks/env-resolver'
import {
  createExternalWebhookSubscription,
  cleanupExternalWebhook,
} from '@/lib/webhooks/provider-subscriptions'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { isCredentialSetValue, extractCredentialSetId } from '@/executor/constants'
import { getProviderIdFromServiceId } from '@/lib/oauth/utils'
import {
  parseWebhookBody,
  handleProviderChallenges,
  handleProviderReachabilityTest,
  handlePreDeploymentVerification,
  findAllWebhooksForPath,
  verifyProviderAuth,
  shouldSkipWebhookEvent,
  checkWebhookPreprocessing,
  queueWebhookExecution,
  formatProviderErrorResponse,
} from '@/lib/webhooks/processor'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'

const logger = createLogger('WebhookRoutes')

// ---------------------------------------------------------------------------
// Auth-required webhook CRUD routes
// ---------------------------------------------------------------------------
const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET /api/webhooks
 * List webhooks for the current user with optional filtering by workflowId and blockId.
 */
app.get('/', async (c) => {
  const requestId = generateRequestId()

  try {
    const userId = getUserId(c)

    const workflowId = c.req.query('workflowId')
    const blockId = c.req.query('blockId')

    if (workflowId && blockId) {
      // Collaborative-aware path: allow collaborators with read access to view webhooks
      const wf = await db
        .select({ id: workflow.id, userId: workflow.userId, workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!wf.length) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return c.json({ error: 'Workflow not found' }, 404)
      }

      const wfRecord = wf[0]
      let canRead = wfRecord.userId === userId
      if (!canRead && wfRecord.workspaceId) {
        const permission = await getUserEntityPermissions(
          userId,
          'workspace',
          wfRecord.workspaceId
        )
        canRead = permission === 'read' || permission === 'write' || permission === 'admin'
      }

      if (!canRead) {
        logger.warn(
          `[${requestId}] User ${userId} denied permission to read webhooks for workflow ${workflowId}`
        )
        return c.json({ webhooks: [] })
      }

      const webhooks = await db
        .select({
          webhook: webhook,
          workflow: {
            id: workflow.id,
            name: workflow.name,
          },
        })
        .from(webhook)
        .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
        .leftJoin(
          workflowDeploymentVersion,
          and(
            eq(workflowDeploymentVersion.workflowId, workflow.id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .where(
          and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            or(
              eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
              and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
            )
          )
        )
        .orderBy(desc(webhook.updatedAt))

      logger.info(
        `[${requestId}] Retrieved ${webhooks.length} webhooks for workflow ${workflowId} block ${blockId}`
      )
      return c.json({ webhooks })
    }

    if (workflowId && !blockId) {
      // Return empty results to avoid breaking the UI
      return c.json({ webhooks: [] })
    }

    // Default: list webhooks owned by the session user
    logger.debug(`[${requestId}] Fetching user-owned webhooks for ${userId}`)
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(workflow.userId, userId))

    logger.info(`[${requestId}] Retrieved ${webhooks.length} user-owned webhooks`)
    return c.json({ webhooks })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhooks`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * POST /api/webhooks
 * Create or update a webhook.
 */
app.post('/', async (c) => {
  const requestId = generateRequestId()
  const userId = getUserId(c)

  try {
    const body = await c.req.json()
    const { workflowId, path, provider, providerConfig, blockId } = body

    if (!workflowId) {
      logger.warn(`[${requestId}] Missing required fields for webhook creation`, {
        hasWorkflowId: !!workflowId,
        hasPath: !!path,
      })
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Determine final path with special handling for credential-based providers
    let finalPath = path
    const credentialBasedProviders = ['gmail', 'outlook']
    const isCredentialBased = credentialBasedProviders.includes(provider)
    const isMicrosoftTeamsChatSubscription =
      provider === 'microsoft-teams' &&
      typeof providerConfig === 'object' &&
      providerConfig?.triggerId === 'microsoftteams_chat_subscription'

    if (!finalPath || finalPath.trim() === '') {
      if (isCredentialBased || isMicrosoftTeamsChatSubscription) {
        // Try to reuse existing path for this workflow+block if one exists
        if (blockId) {
          const existingForBlock = await db
            .select({ id: webhook.id, path: webhook.path })
            .from(webhook)
            .leftJoin(
              workflowDeploymentVersion,
              and(
                eq(workflowDeploymentVersion.workflowId, workflowId),
                eq(workflowDeploymentVersion.isActive, true)
              )
            )
            .where(
              and(
                eq(webhook.workflowId, workflowId),
                eq(webhook.blockId, blockId),
                or(
                  eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
                  and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
                )
              )
            )
            .limit(1)

          if (existingForBlock.length > 0) {
            finalPath = existingForBlock[0].path
            logger.info(
              `[${requestId}] Reusing existing generated path for ${provider} trigger: ${finalPath}`
            )
          }
        }

        if (!finalPath || finalPath.trim() === '') {
          finalPath = `${provider}-${crypto.randomUUID()}`
          logger.info(`[${requestId}] Generated webhook path for ${provider} trigger: ${finalPath}`)
        }
      } else {
        logger.warn(`[${requestId}] Missing path for webhook creation`, {
          hasWorkflowId: !!workflowId,
          hasPath: !!path,
        })
        return c.json({ error: 'Missing required path' }, 400)
      }
    }

    // Check if the workflow exists and user has permission to modify it
    const workflowData = await db
      .select({
        id: workflow.id,
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (workflowData.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return c.json({ error: 'Workflow not found' }, 404)
    }

    const workflowRecord = workflowData[0]

    let canModify = false
    if (workflowRecord.userId === userId) {
      canModify = true
    }
    if (!canModify && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowRecord.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canModify = true
      }
    }

    if (!canModify) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to modify webhook for workflow ${workflowId}`
      )
      return c.json({ error: 'Access denied' }, 403)
    }

    // Determine existing webhook to update
    let targetWebhookId: string | null = null
    if (isCredentialBased && blockId) {
      const existingForBlock = await db
        .select({ id: webhook.id })
        .from(webhook)
        .leftJoin(
          workflowDeploymentVersion,
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .where(
          and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            or(
              eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
              and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
            )
          )
        )
        .limit(1)
      if (existingForBlock.length > 0) {
        targetWebhookId = existingForBlock[0].id
      }
    }
    if (!targetWebhookId) {
      const existingByPath = await db
        .select({ id: webhook.id, workflowId: webhook.workflowId })
        .from(webhook)
        .where(eq(webhook.path, finalPath))
        .limit(1)
      if (existingByPath.length > 0) {
        if (existingByPath[0].workflowId !== workflowId) {
          logger.warn(`[${requestId}] Webhook path conflict: ${finalPath}`)
          return c.json(
            { error: 'Webhook path already exists.', code: 'PATH_EXISTS' },
            409
          )
        }
        targetWebhookId = existingByPath[0].id
      }
    }

    let savedWebhook: any = null
    const originalProviderConfig = providerConfig || {}
    let resolvedProviderConfig = await resolveEnvVarsInObject(
      originalProviderConfig,
      userId,
      workflowRecord.workspaceId || undefined
    )

    // --- Credential Set Handling ---
    const rawCredentialId = (resolvedProviderConfig?.credentialId ||
      resolvedProviderConfig?.triggerCredentials) as string | undefined
    const directCredentialSetId = resolvedProviderConfig?.credentialSetId as string | undefined

    if (directCredentialSetId || rawCredentialId) {
      const credentialSetId =
        directCredentialSetId ||
        (rawCredentialId && isCredentialSetValue(rawCredentialId)
          ? extractCredentialSetId(rawCredentialId)
          : null)

      if (credentialSetId) {
        logger.info(
          `[${requestId}] Credential set detected for ${provider} trigger. Set ${credentialSetId}`
        )

        // Credential set fan-out is handled by syncWebhooksForCredentialSet
        // which may not be available yet. For now, log and continue with
        // single-webhook creation using the resolved config.
        logger.warn(
          `[${requestId}] Credential set fan-out not yet implemented in sim-v2. Proceeding with single webhook.`
        )
      }
    }
    // --- End Credential Set Handling ---

    let externalSubscriptionCreated = false
    const createTempWebhookData = (providerConfigOverride = resolvedProviderConfig) => ({
      id: targetWebhookId || nanoid(),
      path: finalPath,
      provider,
      providerConfig: providerConfigOverride,
    })

    const userProvided = originalProviderConfig as Record<string, unknown>
    const configToSave: Record<string, unknown> = { ...userProvided }

    try {
      const result = await createExternalWebhookSubscription(
        createTempWebhookData(),
        workflowRecord,
        userId,
        requestId
      )
      const updatedConfig = result.updatedProviderConfig as Record<string, unknown>
      mergeNonUserFields(configToSave, updatedConfig, userProvided)
      resolvedProviderConfig = updatedConfig
      externalSubscriptionCreated = result.externalSubscriptionCreated
    } catch (err) {
      logger.error(`[${requestId}] Error creating external webhook subscription`, err)
      return c.json(
        {
          error: 'Failed to create external webhook subscription',
          details: err instanceof Error ? err.message : 'Unknown error',
        },
        500
      )
    }

    try {
      if (targetWebhookId) {
        logger.info(`[${requestId}] Updating existing webhook for path: ${finalPath}`, {
          webhookId: targetWebhookId,
          provider,
          hasCredentialId: !!(configToSave as any)?.credentialId,
        })
        const updatedResult = await db
          .update(webhook)
          .set({
            blockId,
            provider,
            providerConfig: configToSave,
            credentialSetId:
              ((configToSave as Record<string, unknown>)?.credentialSetId as string | null) || null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, targetWebhookId))
          .returning()
        savedWebhook = updatedResult[0]
        logger.info(`[${requestId}] Webhook updated successfully`, {
          webhookId: savedWebhook.id,
        })
      } else {
        const webhookId = nanoid()
        logger.info(`[${requestId}] Creating new webhook with ID: ${webhookId}`)
        const newResult = await db
          .insert(webhook)
          .values({
            id: webhookId,
            workflowId,
            blockId,
            path: finalPath,
            provider,
            providerConfig: configToSave,
            credentialSetId:
              ((configToSave as Record<string, unknown>)?.credentialSetId as string | null) || null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()
        savedWebhook = newResult[0]
      }
    } catch (dbError) {
      if (externalSubscriptionCreated) {
        logger.error(`[${requestId}] DB save failed, cleaning up external subscription`, dbError)
        try {
          await cleanupExternalWebhook(
            createTempWebhookData(configToSave),
            workflowRecord,
            requestId
          )
        } catch (cleanupError) {
          logger.error(
            `[${requestId}] Failed to cleanup external subscription after DB save failure`,
            cleanupError
          )
        }
      }
      throw dbError
    }

    if (!targetWebhookId && savedWebhook) {
      try {
        PlatformEvents.webhookCreated({
          webhookId: savedWebhook.id,
          workflowId,
          provider: provider || 'generic',
          workspaceId: workflowRecord.workspaceId || undefined,
        })
      } catch {
        // Telemetry should not fail the operation
      }
    }

    const status = targetWebhookId ? 200 : 201
    return c.json({ webhook: savedWebhook }, status)
  } catch (error: any) {
    logger.error(`[${requestId}] Error creating/updating webhook`, {
      message: error.message,
      stack: error.stack,
    })
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * GET /api/webhooks/:id
 * Get a specific webhook by ID.
 */
app.get('/:id', async (c) => {
  const requestId = generateRequestId()

  try {
    const id = c.req.param('id')
    const userId = getUserId(c)

    logger.debug(`[${requestId}] Fetching webhook with ID: ${id}`)

    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)

    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return c.json({ error: 'Webhook not found' }, 404)
    }

    const webhookData = webhooks[0]

    let hasAccess = false
    if (webhookData.workflow.userId === userId) {
      hasAccess = true
    }
    if (!hasAccess && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission !== null) {
        hasAccess = true
      }
    }

    if (!hasAccess) {
      logger.warn(`[${requestId}] User ${userId} denied access to webhook: ${id}`)
      return c.json({ error: 'Access denied' }, 403)
    }

    logger.info(`[${requestId}] Successfully retrieved webhook: ${id}`)
    return c.json({ webhook: webhooks[0] })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhook`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * PATCH /api/webhooks/:id
 * Update a webhook's isActive and/or failedCount.
 */
app.patch('/:id', async (c) => {
  const requestId = generateRequestId()

  try {
    const id = c.req.param('id')
    const userId = getUserId(c)

    logger.debug(`[${requestId}] Updating webhook with ID: ${id}`)

    const body = await c.req.json()
    const { isActive, failedCount } = body

    if (failedCount !== undefined) {
      const validation = validateInteger(failedCount, 'failedCount', { min: 0 })
      if (!validation.isValid) {
        logger.warn(`[${requestId}] ${validation.error}`)
        return c.json({ error: validation.error }, 400)
      }
    }

    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)

    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return c.json({ error: 'Webhook not found' }, 404)
    }

    const webhookData = webhooks[0]
    let canModify = false

    if (webhookData.workflow.userId === userId) {
      canModify = true
    }
    if (!canModify && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canModify = true
      }
    }

    if (!canModify) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to modify webhook: ${id}`
      )
      return c.json({ error: 'Access denied' }, 403)
    }

    logger.debug(`[${requestId}] Updating webhook properties`, {
      hasActiveUpdate: isActive !== undefined,
      hasFailedCountUpdate: failedCount !== undefined,
    })

    const updatedWebhook = await db
      .update(webhook)
      .set({
        isActive: isActive !== undefined ? isActive : webhooks[0].webhook.isActive,
        failedCount: failedCount !== undefined ? failedCount : webhooks[0].webhook.failedCount,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, id))
      .returning()

    logger.info(`[${requestId}] Successfully updated webhook: ${id}`)
    return c.json({ webhook: updatedWebhook[0] })
  } catch (error) {
    logger.error(`[${requestId}] Error updating webhook`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook. For credential sets, deletes all webhooks in the set for the same workflow+block.
 */
app.delete('/:id', async (c) => {
  const requestId = generateRequestId()

  try {
    const id = c.req.param('id')
    const userId = getUserId(c)

    logger.debug(`[${requestId}] Deleting webhook with ID: ${id}`)

    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)

    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return c.json({ error: 'Webhook not found' }, 404)
    }

    const webhookData = webhooks[0]

    let canDelete = false
    if (webhookData.workflow.userId === userId) {
      canDelete = true
    }
    if (!canDelete && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canDelete = true
      }
    }

    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to delete webhook: ${id}`
      )
      return c.json({ error: 'Access denied' }, 403)
    }

    const foundWebhook = webhookData.webhook
    const credentialSetId = foundWebhook.credentialSetId as string | undefined
    const foundBlockId = foundWebhook.blockId as string | undefined

    if (credentialSetId && foundBlockId) {
      // Credential set aware deletion: delete all webhooks in the set for same workflow+block
      const allCredentialSetWebhooks = await db
        .select()
        .from(webhook)
        .where(
          and(eq(webhook.workflowId, webhookData.workflow.id), eq(webhook.blockId, foundBlockId))
        )

      const webhooksToDelete = allCredentialSetWebhooks.filter(
        (w) => w.credentialSetId === credentialSetId
      )

      for (const w of webhooksToDelete) {
        await cleanupExternalWebhook(w, webhookData.workflow, requestId)
      }

      const idsToDelete = webhooksToDelete.map((w) => w.id)
      for (const wId of idsToDelete) {
        await db.delete(webhook).where(eq(webhook.id, wId))
      }

      try {
        for (const wId of idsToDelete) {
          PlatformEvents.webhookDeleted({
            webhookId: wId,
            workflowId: webhookData.workflow.id,
          })
        }
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(
        `[${requestId}] Successfully deleted ${idsToDelete.length} webhooks for credential set`,
        { credentialSetId, blockId: foundBlockId, deletedIds: idsToDelete }
      )
    } else {
      await cleanupExternalWebhook(foundWebhook, webhookData.workflow, requestId)
      await db.delete(webhook).where(eq(webhook.id, id))

      try {
        PlatformEvents.webhookDeleted({
          webhookId: id,
          workflowId: webhookData.workflow.id,
        })
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(`[${requestId}] Successfully deleted webhook: ${id}`)
    }

    return c.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting webhook`, {
      error: error.message,
      stack: error.stack,
    })
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Public webhook trigger routes (NO auth required)
// ---------------------------------------------------------------------------
const triggerApp = new Hono()

/**
 * GET /api/webhooks/trigger/:path
 * Handle GET-based provider challenges (WhatsApp verification, MS Graph validationToken).
 */
triggerApp.get('/trigger/:path', async (c) => {
  const requestId = generateRequestId()
  const path = c.req.param('path')

  const challengeResponse = await handleProviderChallenges({}, c.req.raw, requestId, path)
  if (challengeResponse) {
    return challengeResponse
  }

  return c.text('Method not allowed', 405)
})

/**
 * POST /api/webhooks/trigger/:path
 * Main webhook trigger endpoint. Receives webhook events from external providers
 * and queues workflow executions.
 */
triggerApp.post('/trigger/:path', async (c) => {
  const requestId = generateRequestId()
  const path = c.req.param('path')

  // Handle provider challenges before body parsing (Microsoft Graph validationToken, etc.)
  const earlyChallenge = await handleProviderChallenges({}, c.req.raw, requestId, path)
  if (earlyChallenge) {
    return earlyChallenge
  }

  // 1. Parse body
  const parseResult = await parseWebhookBody(c.req.raw, requestId)
  if (parseResult instanceof Response) {
    return parseResult
  }

  const { body, rawBody } = parseResult

  // 2. Handle provider challenges (Slack, WhatsApp, MS Graph)
  const challengeResponse = await handleProviderChallenges(body, c.req.raw, requestId, path)
  if (challengeResponse) {
    return challengeResponse
  }

  // 3. Find all webhooks for path (supports credential set fan-out)
  const allWebhooks = await findAllWebhooksForPath({ requestId, path })

  if (allWebhooks.length === 0) {
    logger.warn(`[${requestId}] Webhook or workflow not found for path: ${path}`)
    return c.json({ error: 'No active webhook found' }, 404)
  }

  // 4. Process each webhook
  const responses: Response[] = []

  for (const { webhook: foundWebhook, workflow: foundWorkflow } of allWebhooks) {
    // Verify auth
    const authError = await verifyProviderAuth(
      foundWebhook,
      foundWorkflow,
      c.req.raw,
      rawBody,
      requestId
    )
    if (authError) {
      if (allWebhooks.length > 1) {
        logger.warn(`[${requestId}] Auth failed for webhook ${foundWebhook.id}, continuing to next`)
        continue
      }
      return authError
    }

    // Reachability test
    const reachabilityResponse = handleProviderReachabilityTest(foundWebhook, body, requestId)
    if (reachabilityResponse) {
      return reachabilityResponse
    }

    // Preprocessing checks
    let preprocessError: Response | null = null
    try {
      preprocessError = await checkWebhookPreprocessing(foundWorkflow, foundWebhook, requestId)
      if (preprocessError) {
        if (allWebhooks.length > 1) {
          logger.warn(
            `[${requestId}] Preprocessing failed for webhook ${foundWebhook.id}, continuing to next`
          )
          continue
        }
        return preprocessError
      }
    } catch (error) {
      logger.error(`[${requestId}] Unexpected error during webhook preprocessing`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        webhookId: foundWebhook.id,
        workflowId: foundWorkflow.id,
      })

      if (allWebhooks.length > 1) {
        continue
      }

      return formatProviderErrorResponse(
        foundWebhook,
        'An unexpected error occurred during preprocessing',
        500
      )
    }

    // Check block deployment
    if (foundWebhook.blockId) {
      const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
      if (!blockExists) {
        const preDeployResponse = handlePreDeploymentVerification(foundWebhook, requestId)
        if (preDeployResponse) {
          return preDeployResponse
        }

        logger.info(
          `[${requestId}] Trigger block ${foundWebhook.blockId} not found in deployment for workflow ${foundWorkflow.id}`
        )
        if (allWebhooks.length > 1) {
          continue
        }
        return c.json({ error: 'Trigger block not found in deployment' }, 404)
      }
    }

    // Skip events based on provider-specific filtering
    if (shouldSkipWebhookEvent(foundWebhook, body, requestId)) {
      continue
    }

    // Queue execution
    const response = await queueWebhookExecution(foundWebhook, foundWorkflow, body, c.req.raw, {
      requestId,
      path,
    })
    responses.push(response)
  }

  if (responses.length === 0) {
    return c.json({ error: 'No webhooks processed successfully' }, 500)
  }

  if (responses.length === 1) {
    return responses[0]
  }

  // For multiple webhooks, return success if at least one succeeded
  logger.info(
    `[${requestId}] Processed ${responses.length} webhooks for path: ${path} (credential set fan-out)`
  )
  return c.json({ success: true, webhooksProcessed: responses.length })
})

export { app as webhookRoutes, triggerApp as webhookTriggerRoutes }
