import { randomUUID } from 'crypto'
import { Hono } from 'hono'
import { db } from '@sim/db'
import { form, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { validateFormAuth } from '@/lib/auth/deployment-auth'
import {
  addCorsHeaders,
  setDeploymentAuthCookie,
  validateAuthToken,
} from '@/lib/core/security/deployment'
import { generateRequestId } from '@/lib/core/utils/request'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'

const logger = createLogger('FormPublicAPI')

const formPostBodySchema = z.object({
  formData: z.record(z.unknown()).optional(),
  password: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
})

/**
 * Get the input format schema from the workflow's start block.
 */
async function getWorkflowInputSchema(workflowId: string): Promise<unknown[]> {
  try {
    const blocks = await db
      .select()
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, workflowId))

    const startBlock = blocks.find((block) => isInputDefinitionTrigger(block.type))

    if (!startBlock) {
      return []
    }

    const subBlocks = startBlock.subBlocks as Record<string, { value?: unknown }> | null
    return normalizeInputFormatValue(subBlocks?.inputFormat?.value)
  } catch (error) {
    logger.error('Error fetching workflow input schema:', error)
    return []
  }
}

const app = new Hono()

/**
 * OPTIONS /:identifier
 * CORS preflight handler for public form endpoint.
 */
app.options('/:identifier', (c) => {
  const response = new Response(null, { status: 204 })
  return addCorsHeaders(response, c.req.raw)
})

/**
 * POST /:identifier
 * Process form submissions (public endpoint).
 */
app.post('/:identifier', async (c) => {
  const identifier = c.req.param('identifier')
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing form submission for identifier: ${identifier}`)

    let parsedBody: z.infer<typeof formPostBodySchema>
    try {
      const rawBody = await c.req.json()
      const validation = formPostBodySchema.safeParse(rawBody)

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
        id: form.id,
        workflowId: form.workflowId,
        userId: form.userId,
        isActive: form.isActive,
        authType: form.authType,
        password: form.password,
        allowedEmails: form.allowedEmails,
        customizations: form.customizations,
      })
      .from(form)
      .where(eq(form.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Form not found for identifier: ${identifier}`)
      const response = new Response(
        JSON.stringify({ error: 'Form not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deployment = deploymentResult[0]

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Form is not active: ${identifier}`)

      const [workflowRecord] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, deployment.workflowId))
        .limit(1)

      const workspaceId = workflowRecord?.workspaceId
      if (!workspaceId) {
        logger.warn(`[${requestId}] Cannot log: workflow ${deployment.workflowId} has no workspace`)
        const response = new Response(
          JSON.stringify({ error: 'This form is currently unavailable' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
        return addCorsHeaders(response, c.req.raw)
      }

      const executionId = randomUUID()
      const loggingSession = new LoggingSession(
        deployment.workflowId,
        executionId,
        'form',
        requestId
      )

      await loggingSession.safeStart({
        userId: deployment.userId,
        workspaceId,
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: 'This form is currently unavailable. The form has been disabled.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      const response = new Response(
        JSON.stringify({ error: 'This form is currently unavailable' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deploymentForAuth = {
      ...deployment,
      allowedEmails: deployment.allowedEmails as string[] | null,
    }
    const authResult = await validateFormAuth(requestId, deploymentForAuth, c.req.raw, parsedBody)
    if (!authResult.authorized) {
      const response = new Response(
        JSON.stringify({ error: authResult.error || 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const { formData, password, email } = parsedBody

    if ((password || email) && !formData) {
      const response = new Response(
        JSON.stringify({ authenticated: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
      setDeploymentAuthCookie(response, 'form', deployment.id, deployment.authType, deployment.password)
      return addCorsHeaders(response, c.req.raw)
    }

    if (!formData || Object.keys(formData).length === 0) {
      const response = new Response(
        JSON.stringify({ error: 'No form data provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const executionId = randomUUID()
    const loggingSession = new LoggingSession(deployment.workflowId, executionId, 'form', requestId)

    const preprocessResult = await preprocessExecution({
      workflowId: deployment.workflowId,
      userId: deployment.userId,
      triggerType: 'form',
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
      const workflowForExecution = {
        id: deployment.workflowId,
        userId: deployment.userId,
        workspaceId,
        isDeployed: workflowRecord?.isDeployed ?? false,
        variables: (workflowRecord?.variables ?? {}) as Record<string, unknown>,
      }

      const workflowInput = {
        input: formData,
        ...formData,
      }

      const stream = await createStreamingResponse({
        requestId,
        workflow: workflowForExecution,
        input: workflowInput,
        executingUserId: workspaceOwnerId,
        streamConfig: {
          selectedOutputs: [],
          isSecureMode: true,
          workflowTriggerType: 'api',
        },
        executionId,
      })

      const reader = stream.getReader()

      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } finally {
        reader.releaseLock()
      }

      logger.info(`[${requestId}] Form submission successful for ${identifier}`)

      const customizations = deployment.customizations as Record<string, unknown> | null
      const response = new Response(
        JSON.stringify({
          success: true,
          executionId,
          thankYouTitle: (customizations?.thankYouTitle as string) || 'Thank you!',
          thankYouMessage:
            (customizations?.thankYouMessage as string) ||
            'Your response has been submitted successfully.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Error processing form submission:`, err)
      const response = new Response(
        JSON.stringify({ error: err.message || 'Failed to process form submission' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }
  } catch (error: unknown) {
    const err = error as Error
    logger.error(`[${requestId}] Error processing form submission:`, err)
    const response = new Response(
      JSON.stringify({ error: err.message || 'Failed to process form submission' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
    return addCorsHeaders(response, c.req.raw)
  }
})

/**
 * GET /:identifier
 * Get form deployment info with input schema (public endpoint).
 */
app.get('/:identifier', async (c) => {
  const identifier = c.req.param('identifier')
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Fetching form info for identifier: ${identifier}`)

    const deploymentResult = await db
      .select({
        id: form.id,
        title: form.title,
        description: form.description,
        customizations: form.customizations,
        isActive: form.isActive,
        workflowId: form.workflowId,
        authType: form.authType,
        password: form.password,
        allowedEmails: form.allowedEmails,
        showBranding: form.showBranding,
      })
      .from(form)
      .where(eq(form.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Form not found for identifier: ${identifier}`)
      const response = new Response(
        JSON.stringify({ error: 'Form not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deployment = deploymentResult[0]

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Form is not active: ${identifier}`)
      const response = new Response(
        JSON.stringify({ error: 'This form is currently unavailable' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const inputSchema = await getWorkflowInputSchema(deployment.workflowId)

    const cookieHeader = c.req.raw.headers.get('cookie') || ''
    const cookieName = `form_auth_${deployment.id}`
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
          showBranding: deployment.showBranding,
          inputSchema,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
      return addCorsHeaders(response, c.req.raw)
    }

    const deploymentForAuth = {
      ...deployment,
      allowedEmails: deployment.allowedEmails as string[] | null,
    }
    const authResult = await validateFormAuth(requestId, deploymentForAuth, c.req.raw)
    if (!authResult.authorized) {
      logger.info(
        `[${requestId}] Authentication required for form: ${identifier}, type: ${deployment.authType}`
      )
      const customizations = deployment.customizations as Record<string, unknown> | null
      const response = new Response(
        JSON.stringify({
          success: false,
          error: authResult.error || 'Authentication required',
          authType: deployment.authType,
          title: deployment.title,
          customizations: {
            primaryColor: customizations?.primaryColor,
            logoUrl: customizations?.logoUrl,
          },
        }),
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
        showBranding: deployment.showBranding,
        inputSchema,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
    return addCorsHeaders(response, c.req.raw)
  } catch (error: unknown) {
    const err = error as Error
    logger.error(`[${requestId}] Error fetching form info:`, err)
    const response = new Response(
      JSON.stringify({ error: err.message || 'Failed to fetch form information' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
    return addCorsHeaders(response, c.req.raw)
  }
})

export { app as formPublicRoutes }
