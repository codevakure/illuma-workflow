import { randomUUID } from 'crypto'
import { Hono } from 'hono'
import { db, chat, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { validateChatAuth } from '@/lib/auth/deployment-auth'
import {
  addCorsHeaders,
  setDeploymentAuthCookie,
  validateAuthToken,
} from '@/lib/core/security/deployment'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { ChatFiles } from '@/lib/uploads'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'

const logger = createLogger('ChatPublicAPI')

const chatFileSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  type: z.string().min(1, 'File type is required'),
  size: z.number().positive('File size must be positive'),
  data: z.string().min(1, 'File data is required'),
  lastModified: z.number().optional(),
})

const chatPostBodySchema = z.object({
  input: z.string().optional(),
  password: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  conversationId: z.string().optional(),
  files: z.array(chatFileSchema).optional().default([]),
})

const app = new Hono()

/**
 * OPTIONS /:identifier
 * CORS preflight handler for public chat endpoint.
 */
app.options('/:identifier', (c) => {
  const response = new Response(null, { status: 204 })
  return addCorsHeaders(response, c.req.raw)
})

/**
 * POST /:identifier
 * Process chat messages with streaming (public endpoint).
 */
app.post('/:identifier', async (c) => {
  const identifier = c.req.param('identifier')
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing chat request for identifier: ${identifier}`)

    let parsedBody: z.infer<typeof chatPostBodySchema>
    try {
      const rawBody = await c.req.json()
      const validation = chatPostBodySchema.safeParse(rawBody)

      if (!validation.success) {
        const errorMessage = validation.error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ')
        logger.warn(`[${requestId}] Validation error: ${errorMessage}`)
        const response = new Response(
          JSON.stringify({ error: `Invalid request body: ${errorMessage}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
        return addCorsHeaders(response, c.req.raw)
      }

      parsedBody = validation.data
    } catch (_error) {
      const response = new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deploymentResult = await db
      .select({
        id: chat.id,
        workflowId: chat.workflowId,
        userId: chat.userId,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
        allowedEmails: chat.allowedEmails,
        outputConfigs: chat.outputConfigs,
      })
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
      const response = new Response(
        JSON.stringify({ error: 'Chat not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deployment = deploymentResult[0]

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)

      const [workflowRecord] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, deployment.workflowId))
        .limit(1)

      const workspaceId = workflowRecord?.workspaceId
      if (!workspaceId) {
        logger.warn(`[${requestId}] Cannot log: workflow ${deployment.workflowId} has no workspace`)
        const response = new Response(
          JSON.stringify({ error: 'This chat is currently unavailable' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
        return addCorsHeaders(response, c.req.raw)
      }

      const executionId = randomUUID()
      const loggingSession = new LoggingSession(
        deployment.workflowId,
        executionId,
        'chat',
        requestId
      )

      await loggingSession.safeStart({
        userId: deployment.userId,
        workspaceId,
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: 'This chat is currently unavailable. The chat has been disabled.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      const response = new Response(
        JSON.stringify({ error: 'This chat is currently unavailable' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deploymentForAuth = {
      ...deployment,
      allowedEmails: deployment.allowedEmails as string[] | null,
    }
    const authResult = await validateChatAuth(requestId, deploymentForAuth, c.req.raw, parsedBody)
    if (!authResult.authorized) {
      const response = new Response(
        JSON.stringify({ error: authResult.error || 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const { input, password, email, conversationId, files } = parsedBody

    if ((password || email) && !input) {
      const response = new Response(
        JSON.stringify({ authenticated: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
      setDeploymentAuthCookie(response, 'chat', deployment.id, deployment.authType, deployment.password)
      return addCorsHeaders(response, c.req.raw)
    }

    if (!input && (!files || files.length === 0)) {
      const response = new Response(
        JSON.stringify({ error: 'No input provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const executionId = randomUUID()

    const loggingSession = new LoggingSession(deployment.workflowId, executionId, 'chat', requestId)

    const preprocessResult = await preprocessExecution({
      workflowId: deployment.workflowId,
      userId: deployment.userId,
      triggerType: 'chat',
      executionId,
      requestId,
      checkRateLimit: true,
      checkDeployment: true,
      loggingSession,
    })

    if (!preprocessResult.success) {
      logger.warn(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`)
      const response = new Response(
        JSON.stringify({
          error: preprocessResult.error?.message || 'Failed to process request',
        }),
        {
          status: preprocessResult.error?.statusCode || 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const { actorUserId, workflowRecord } = preprocessResult
    const workspaceOwnerId = actorUserId!
    const workspaceId = workflowRecord?.workspaceId
    if (!workspaceId) {
      logger.error(`[${requestId}] Workflow ${deployment.workflowId} has no workspaceId`)
      const response = new Response(
        JSON.stringify({ error: 'Workflow has no associated workspace' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    try {
      const selectedOutputs: string[] = []
      if (deployment.outputConfigs && Array.isArray(deployment.outputConfigs)) {
        for (const config of deployment.outputConfigs as Array<{ blockId: string; path?: string }>) {
          const outputId = config.path
            ? `${config.blockId}_${config.path}`
            : `${config.blockId}_content`
          selectedOutputs.push(outputId)
        }
      }

      const workflowInput: Record<string, unknown> = { input, conversationId }
      if (files && Array.isArray(files) && files.length > 0) {
        const executionContext = {
          workspaceId,
          workflowId: deployment.workflowId,
          executionId,
        }

        try {
          const uploadedFiles = await ChatFiles.processChatFiles(
            files,
            executionContext,
            requestId,
            deployment.userId
          )

          if (uploadedFiles.length > 0) {
            workflowInput.files = uploadedFiles
            logger.info(`[${requestId}] Successfully processed ${uploadedFiles.length} files`)
          }
        } catch (fileError: unknown) {
          const fileErr = fileError as Error
          logger.error(`[${requestId}] Failed to process chat files:`, fileErr)

          await loggingSession.safeStart({
            userId: workspaceOwnerId,
            workspaceId,
            variables: {},
          })

          await loggingSession.safeCompleteWithError({
            error: {
              message: `File upload failed: ${fileErr.message || 'Unable to process uploaded files'}`,
              stackTrace: fileErr.stack,
            },
            traceSpans: [],
          })

          throw fileErr
        }
      }

      const workflowForExecution = {
        id: deployment.workflowId,
        userId: deployment.userId,
        workspaceId,
        isDeployed: workflowRecord?.isDeployed ?? false,
        variables: (workflowRecord?.variables as Record<string, unknown>) ?? undefined,
      }

      const stream = await createStreamingResponse({
        requestId,
        workflow: workflowForExecution,
        input: workflowInput,
        executingUserId: workspaceOwnerId,
        streamConfig: {
          selectedOutputs,
          isSecureMode: true,
          workflowTriggerType: 'chat',
        },
        executionId,
      })

      const streamResponse = new Response(stream, {
        status: 200,
        headers: SSE_HEADERS,
      })
      return addCorsHeaders(streamResponse, c.req.raw)
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Error processing chat request:`, err)
      const response = new Response(
        JSON.stringify({ error: err.message || 'Failed to process request' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }
  } catch (error: unknown) {
    const err = error as Error
    logger.error(`[${requestId}] Error processing chat request:`, err)
    const response = new Response(
      JSON.stringify({ error: err.message || 'Failed to process request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
    return addCorsHeaders(response, c.req.raw)
  }
})

/**
 * GET /:identifier
 * Get chat deployment info (public endpoint).
 */
app.get('/:identifier', async (c) => {
  const identifier = c.req.param('identifier')
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Fetching chat info for identifier: ${identifier}`)

    const deploymentResult = await db
      .select({
        id: chat.id,
        title: chat.title,
        description: chat.description,
        customizations: chat.customizations,
        isActive: chat.isActive,
        workflowId: chat.workflowId,
        authType: chat.authType,
        password: chat.password,
        allowedEmails: chat.allowedEmails,
        outputConfigs: chat.outputConfigs,
      })
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
      const response = new Response(
        JSON.stringify({ error: 'Chat not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deployment = deploymentResult[0]

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)
      const response = new Response(
        JSON.stringify({ error: 'This chat is currently unavailable' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const cookieHeader = c.req.raw.headers.get('cookie') || ''
    const cookieName = `chat_auth_${deployment.id}`
    const cookieMatch = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`))

    if (
      deployment.authType !== 'public' &&
      cookieMatch &&
      validateAuthToken(cookieMatch[1], deployment.id, deployment.password)
    ) {
      const response = new Response(
        JSON.stringify({
          id: deployment.id,
          title: deployment.title,
          description: deployment.description,
          customizations: deployment.customizations,
          authType: deployment.authType,
          outputConfigs: deployment.outputConfigs,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deploymentForAuth = {
      ...deployment,
      allowedEmails: deployment.allowedEmails as string[] | null,
    }
    const authResult = await validateChatAuth(requestId, deploymentForAuth, c.req.raw)
    if (!authResult.authorized) {
      logger.info(
        `[${requestId}] Authentication required for chat: ${identifier}, type: ${deployment.authType}`
      )
      const response = new Response(
        JSON.stringify({ error: authResult.error || 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const response = new Response(
      JSON.stringify({
        id: deployment.id,
        title: deployment.title,
        description: deployment.description,
        customizations: deployment.customizations,
        authType: deployment.authType,
        outputConfigs: deployment.outputConfigs,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
    return addCorsHeaders(response, c.req.raw)
  } catch (error: unknown) {
    const err = error as Error
    logger.error(`[${requestId}] Error fetching chat info:`, err)
    const response = new Response(
      JSON.stringify({ error: err.message || 'Failed to fetch chat information' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
    return addCorsHeaders(response, c.req.raw)
  }
})

export { app as chatPublicRoutes }
