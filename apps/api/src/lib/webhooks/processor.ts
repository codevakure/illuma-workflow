import { db } from '@sim/db'
import { credentialSet, subscription, webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { verifyWebhookAuth } from '@/lib/webhooks/auth-engine'
import { handleManifestChallenge } from '@/lib/webhooks/challenge-engine'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { manifestRegistry } from '@/integrations/manifest-loader'
import { isGitHubEventMatch } from '@/lib/webhooks/event-matching/github'
import { isHubSpotContactEventMatch } from '@/lib/webhooks/event-matching/hubspot'
import { isJiraEventMatch } from '@/lib/webhooks/event-matching/jira'

const logger = createLogger('WebhookProcessor')

export interface WebhookProcessorOptions {
  requestId: string
  path?: string
  webhookId?: string
}

/**
 * Reconstruct the external URL from forwarded headers.
 * Used for Twilio signature verification which requires the exact public URL.
 */
function getExternalUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')

  if (host) {
    const url = new URL(request.url)
    const reconstructed = `${proto}://${host}${url.pathname}${url.search}`
    return reconstructed
  }

  return request.url
}

/**
 * Resolve {{VARIABLE}} references in a string value.
 * @param value - String that may contain {{VARIABLE}} references
 * @param envVars - Already decrypted environment variables
 * @returns String with all {{VARIABLE}} references replaced
 */
function resolveEnvVars(value: string, envVars: Record<string, string>): string {
  return resolveEnvVarReferences(value, envVars) as string
}

/**
 * Resolve environment variables in webhook providerConfig.
 * @param config - Raw providerConfig from database (may contain {{VARIABLE}} refs)
 * @param envVars - Already decrypted environment variables
 * @returns New object with resolved values (original config is unchanged)
 */
function resolveProviderConfigEnvVars(
  config: Record<string, any>,
  envVars: Record<string, string>
): Record<string, any> {
  const resolved: Record<string, any> = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      resolved[key] = resolveEnvVars(value, envVars)
    } else {
      resolved[key] = value
    }
  }
  return resolved
}

// Signature validation is now handled by the generic auth engine (auth-engine.ts)
// reading AuthSpec from trigger manifests. Provider-specific validation functions
// have been removed. Custom auth (Slack, Stripe) delegates to marketplace handlers.

// ---------------------------------------------------------------------------
// Exported webhook processing functions
// ---------------------------------------------------------------------------

/**
 * Parse the webhook request body, supporting JSON and form-encoded payloads.
 * Returns a Response on parse failure.
 */
export async function parseWebhookBody(
  request: Request,
  requestId: string
): Promise<{ body: any; rawBody: string } | Response> {
  let rawBody: string | null = null
  try {
    const requestClone = request.clone()
    rawBody = await requestClone.text()

    if (!rawBody || rawBody.length === 0) {
      logger.debug(`[${requestId}] Received request with empty body, treating as empty object`)
      return { body: {}, rawBody: '' }
    }
  } catch (bodyError) {
    logger.error(`[${requestId}] Failed to read request body`, {
      error: bodyError instanceof Error ? bodyError.message : String(bodyError),
    })
    return new Response('Failed to read request body', { status: 400 })
  }

  let body: any
  try {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(rawBody)
      const payloadString = formData.get('payload')

      if (payloadString) {
        body = JSON.parse(payloadString)
        logger.debug(`[${requestId}] Parsed form-encoded GitHub webhook payload`)
      } else {
        body = Object.fromEntries(formData.entries())
        logger.debug(`[${requestId}] Parsed form-encoded webhook data (direct fields)`)
      }
    } else {
      body = JSON.parse(rawBody)
      logger.debug(`[${requestId}] Parsed JSON webhook payload`)
    }

    if (Object.keys(body).length === 0) {
      logger.debug(`[${requestId}] Received empty JSON object`)
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse webhook body`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
      contentType: request.headers.get('content-type'),
      bodyPreview: `${rawBody?.slice(0, 100)}...`,
    })
    return new Response('Invalid payload format', { status: 400 })
  }

  return { body, rawBody }
}

/**
 * Handle provider-specific verification challenges that occur BEFORE webhook lookup.
 * Uses manifest-driven challenge specs (body_echo, query_echo, hub_verify).
 * Returns null to continue normal processing flow.
 */
export async function handleProviderChallenges(
  body: any,
  request: Request,
  requestId: string,
  path: string
): Promise<Response | null> {
  const url = new URL(request.url)

  // Try manifest-based challenges first.
  // Iterate all registered triggers that have a challenge spec and test if the
  // current request matches. Only 3 challenge types exist — body_echo (Slack),
  // query_echo (MS Graph), hub_verify (WhatsApp) — so matching is unambiguous.
  const allTriggers = manifestRegistry.getAllTriggers()

  for (const trigger of allTriggers) {
    if (!trigger.challenge) continue

    if (trigger.challenge.type === 'body_echo') {
      const response = handleManifestChallenge(trigger.challenge, body, url)
      if (response) {
        logger.info(`[${requestId}] Handled body_echo challenge for trigger ${trigger.id}`)
        return response
      }
    }

    if (trigger.challenge.type === 'query_echo') {
      const response = handleManifestChallenge(trigger.challenge, body, url)
      if (response) {
        logger.info(`[${requestId}] Handled query_echo challenge for trigger ${trigger.id} on path: ${path}`)
        return response
      }
    }
  }

  // hub_verify challenges need provider config for token comparison.
  // Must query DB for matching webhooks (challenge happens before webhook lookup).
  const hubMode = url.searchParams.get('hub.mode')
  const hubToken = url.searchParams.get('hub.verify_token')
  const hubChallenge = url.searchParams.get('hub.challenge')

  if (hubMode && hubToken && hubChallenge) {
    // Find triggers with hub_verify challenge specs
    const hubTriggers = allTriggers.filter(
      (t) => t.challenge?.type === 'hub_verify'
    )

    if (hubTriggers.length > 0) {
      logger.info(`[${requestId}] Hub verification request received for path: ${path}`)

      // Query DB for webhooks matching the hub_verify providers
      const providers = [...new Set(hubTriggers.map((t) => t.provider))]

      for (const provider of providers) {
        const webhooks = await db
          .select({ webhook })
          .from(webhook)
          .leftJoin(
            workflowDeploymentVersion,
            and(
              eq(workflowDeploymentVersion.workflowId, webhook.workflowId),
              eq(workflowDeploymentVersion.isActive, true)
            )
          )
          .where(
            and(
              eq(webhook.provider, provider),
              eq(webhook.isActive, true),
              or(
                eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
                and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
              )
            )
          )

        for (const row of webhooks) {
          const wh = row.webhook
          const providerConfig = (wh.providerConfig as Record<string, any>) || {}
          const hubTrigger = hubTriggers.find((t) => t.provider === provider)

          if (hubTrigger?.challenge) {
            const response = handleManifestChallenge(
              hubTrigger.challenge,
              body,
              url,
              providerConfig
            )
            if (response && response.status === 200) {
              logger.info(`[${requestId}] Hub verification successful for webhook ${wh.id}`)
              return response
            }
          }
        }
      }

      logger.warn(`[${requestId}] No matching hub verification token found`)
      return new Response('Verification failed', { status: 403 })
    }
  }

  return null
}

/**
 * Handle provider-specific reachability tests that occur AFTER webhook lookup.
 * Currently handles Grain reachability test (empty body or no type).
 *
 * @param foundWebhook - The webhook record from the database
 * @param body - The parsed request body
 * @param requestId - Request ID for logging
 * @returns Response if this is a verification request, null to continue normal flow
 */
export function handleProviderReachabilityTest(
  foundWebhook: any,
  body: any,
  requestId: string
): Response | null {
  const provider = foundWebhook?.provider

  if (provider === 'grain') {
    const isVerificationRequest = !body || Object.keys(body).length === 0 || !body.type
    if (isVerificationRequest) {
      logger.info(
        `[${requestId}] Grain reachability test detected - returning 200 for webhook verification`
      )
      return Response.json({ status: 'ok', message: 'Webhook endpoint verified' })
    }
  }

  return null
}

/**
 * Format error response based on provider requirements.
 * Some providers (like Microsoft Teams) require specific response formats.
 */
export function formatProviderErrorResponse(
  foundWebhook: any,
  error: string,
  status: number
): Response {
  if (foundWebhook.provider === 'microsoft-teams') {
    return Response.json({ type: 'message', text: error }, { status })
  }
  return Response.json({ error }, { status })
}

/**
 * Check if a webhook event should be skipped based on provider-specific filtering.
 * Returns true if the event should be skipped, false if it should be processed.
 */
export function shouldSkipWebhookEvent(foundWebhook: any, body: any, requestId: string): boolean {
  const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

  // Stripe event type filtering
  if (foundWebhook.provider === 'stripe') {
    const eventTypes = providerConfig.eventTypes
    if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
      const eventType = body?.type
      if (eventType && !eventTypes.includes(eventType)) {
        logger.info(
          `[${requestId}] Stripe event type '${eventType}' not in allowed list for webhook ${foundWebhook.id}, skipping`
        )
        return true
      }
    }
  }

  // Grain event type filtering
  if (foundWebhook.provider === 'grain') {
    const eventTypes = providerConfig.eventTypes
    if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
      const eventType = body?.type
      if (eventType && !eventTypes.includes(eventType)) {
        logger.info(
          `[${requestId}] Grain event type '${eventType}' not in allowed list for webhook ${foundWebhook.id}, skipping`
        )
        return true
      }
    }
  }

  // Webflow collection filtering
  if (foundWebhook.provider === 'webflow') {
    const configuredCollectionId = providerConfig.collectionId
    if (configuredCollectionId) {
      const payloadCollectionId = body?.payload?.collectionId || body?.collectionId
      if (payloadCollectionId && payloadCollectionId !== configuredCollectionId) {
        logger.info(
          `[${requestId}] Webflow collection '${payloadCollectionId}' doesn't match configured collection '${configuredCollectionId}' for webhook ${foundWebhook.id}, skipping`
        )
        return true
      }
    }
  }

  return false
}

/** Providers that validate webhook URLs during creation, before workflow deployment */
const PROVIDERS_WITH_PRE_DEPLOYMENT_VERIFICATION = new Set(['grain'])

/**
 * Returns 200 OK for providers that validate URLs before the workflow is deployed.
 */
export function handlePreDeploymentVerification(
  foundWebhook: any,
  requestId: string
): Response | null {
  if (PROVIDERS_WITH_PRE_DEPLOYMENT_VERIFICATION.has(foundWebhook.provider)) {
    logger.info(
      `[${requestId}] ${foundWebhook.provider} webhook - block not in deployment, returning 200 OK for URL validation`
    )
    return Response.json({ status: 'ok', message: 'Webhook endpoint verified' })
  }
  return null
}

/**
 * Find an active webhook and its associated workflow by webhookId or path.
 * Uses leftJoin with workflowDeploymentVersion for deployment-aware lookup.
 */
export async function findWebhookAndWorkflow(
  options: WebhookProcessorOptions
): Promise<{ webhook: any; workflow: any } | null> {
  if (options.webhookId) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
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
          eq(webhook.id, options.webhookId),
          eq(webhook.isActive, true),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for id: ${options.webhookId}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  if (options.path) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
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
          eq(webhook.path, options.path),
          eq(webhook.isActive, true),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for path: ${options.path}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  return null
}

/**
 * Find ALL webhooks matching a path.
 * Used for credential sets where multiple webhooks share the same path.
 */
export async function findAllWebhooksForPath(
  options: WebhookProcessorOptions
): Promise<Array<{ webhook: any; workflow: any }>> {
  if (!options.path) {
    return []
  }

  const results = await db
    .select({
      webhook: webhook,
      workflow: workflow,
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
        eq(webhook.path, options.path),
        eq(webhook.isActive, true),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  if (results.length === 0) {
    logger.warn(`[${options.requestId}] No active webhooks found for path: ${options.path}`)
  } else if (results.length > 1) {
    logger.info(
      `[${options.requestId}] Found ${results.length} webhooks for path: ${options.path} (credential set fan-out)`
    )
  }

  return results
}

/**
 * Verify webhook provider authentication and signatures.
 *
 * Uses manifest-driven AuthSpec for all providers that have trigger definitions.
 * Falls through to legacy inline logic only for 'generic' (token + IP allowlist)
 * and 'telegram' (logging only) which have special requirements.
 *
 * Returns a Response with 401/403 if auth fails, null if auth passes.
 */
export async function verifyProviderAuth(
  foundWebhook: any,
  foundWorkflow: any,
  request: Request,
  rawBody: string,
  requestId: string
): Promise<Response | null> {
  // Step 1: Fetch and decrypt environment variables for signature verification
  let decryptedEnvVars: Record<string, string> = {}
  try {
    decryptedEnvVars = await getEffectiveDecryptedEnv(
      foundWorkflow.userId,
      foundWorkflow.workspaceId
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch environment variables`, { error })
  }

  // Step 2: Resolve {{VARIABLE}} references in providerConfig
  const rawProviderConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
  const providerConfig = resolveProviderConfigEnvVars(rawProviderConfig, decryptedEnvVars)

  // Step 3: Try manifest-driven auth verification
  // Look up trigger(s) for this provider and check if any have an auth spec
  const providerTriggers = manifestRegistry.getTriggersForProvider(foundWebhook.provider)
  const triggerId = providerConfig.triggerId as string | undefined

  // Find the specific trigger (by triggerId) or fall back to the first trigger for the provider
  const trigger = triggerId
    ? manifestRegistry.getTriggerById(triggerId)
    : providerTriggers[0]

  if (trigger?.auth) {
    logger.debug(`[${requestId}] Using manifest auth for ${foundWebhook.provider}`, {
      authType: trigger.auth.type,
      triggerId: trigger.id,
    })

    // Build extra context for custom auth handlers (e.g., Twilio needs request URL)
    let extra: { requestUrl?: string; formParams?: Record<string, unknown> } | undefined
    if (trigger.auth.type === 'custom') {
      const fullUrl = getExternalUrl(request)
      let formParams: Record<string, unknown> | undefined
      try {
        if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
          const urlParams = new URLSearchParams(rawBody)
          formParams = Object.fromEntries(urlParams.entries())
        }
      } catch {
        // Ignore parse errors for form params
      }
      extra = { requestUrl: fullUrl, formParams }
    }

    const result = await verifyWebhookAuth(
      trigger.auth,
      providerConfig,
      request.headers,
      rawBody,
      extra
    )

    if (!result.valid) {
      logger.warn(`[${requestId}] Manifest auth verification failed for ${foundWebhook.provider}`, {
        error: result.error,
        triggerId: trigger.id,
      })
      return new Response(`Unauthorized - ${result.error || 'Authentication failed'}`, {
        status: 401,
      })
    }

    logger.debug(`[${requestId}] Manifest auth verified for ${foundWebhook.provider}`)
  }

  // Step 4: Provider-specific inline logic for providers that need special handling
  // beyond what AuthSpec can express

  // Telegram: logging only (no actual auth)
  if (foundWebhook.provider === 'telegram') {
    const userAgent = request.headers.get('user-agent') || ''
    logger.debug(
      `[${requestId}] Telegram webhook request received with User-Agent: ${userAgent}`
    )
    if (!userAgent) {
      logger.warn(
        `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
      )
    }
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'
    logger.debug(`[${requestId}] Telegram webhook request from IP: ${clientIp}`)
  }

  // Generic webhook: token + IP allowlist (special two-factor logic)
  if (foundWebhook.provider === 'generic') {
    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token
      const secretHeaderName = providerConfig.secretHeaderName

      if (configToken) {
        let isTokenValid = false

        if (secretHeaderName) {
          const headerValue = request.headers.get(
            (secretHeaderName as string).toLowerCase()
          )
          if (headerValue === configToken) {
            isTokenValid = true
          }
        } else {
          const authHeader = request.headers.get('authorization')
          if (authHeader?.toLowerCase().startsWith('bearer ')) {
            const token = authHeader.substring(7)
            if (token === configToken) {
              isTokenValid = true
            }
          }
        }

        if (!isTokenValid) {
          return new Response('Unauthorized - Invalid authentication token', { status: 401 })
        }
      } else {
        return new Response('Unauthorized - Authentication required but not configured', {
          status: 401,
        })
      }
    }

    // IP allowlist for generic webhooks
    if (
      providerConfig.allowedIps &&
      Array.isArray(providerConfig.allowedIps) &&
      (providerConfig.allowedIps as string[]).length > 0
    ) {
      const clientIp =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'

      if (clientIp === 'unknown' || !(providerConfig.allowedIps as string[]).includes(clientIp)) {
        logger.warn(
          `[${requestId}] Forbidden webhook access attempt - IP not allowed: ${clientIp}`
        )
        return new Response('Forbidden - IP not allowed', { status: 403 })
      }
    }
  }

  // Default bearer token check for providers without manifest auth
  if (!trigger?.auth && foundWebhook.provider !== 'generic' && foundWebhook.provider !== 'telegram') {
    const pConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    if (pConfig.token) {
      const authHeader = request.headers.get('authorization')
      const providedToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : null
      if (!providedToken || providedToken !== pConfig.token) {
        logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
        return new Response('Unauthorized', { status: 401 })
      }
    }
  }

  return null
}

/**
 * Run preprocessing checks for webhook execution.
 * This handles rate limiting and deployment verification.
 */
export async function checkWebhookPreprocessing(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string
): Promise<Response | null> {
  try {
    const executionId = uuidv4()

    const preprocessResult = await preprocessExecution({
      workflowId: foundWorkflow.id,
      userId: foundWorkflow.userId,
      triggerType: 'webhook',
      executionId,
      requestId,
      checkRateLimit: true,
      checkDeployment: true,
      workspaceId: foundWorkflow.workspaceId,
    })

    if (!preprocessResult.success) {
      const error = preprocessResult.error!
      logger.warn(`[${requestId}] Webhook preprocessing failed`, {
        provider: foundWebhook.provider,
        error: error.message,
        statusCode: error.statusCode,
      })

      if (foundWebhook.provider === 'microsoft-teams') {
        return Response.json(
          {
            type: 'message',
            text: error.message,
          },
          { status: error.statusCode }
        )
      }

      return Response.json({ error: error.message }, { status: error.statusCode })
    }

    logger.debug(`[${requestId}] Webhook preprocessing passed`, {
      provider: foundWebhook.provider,
    })

    return null
  } catch (preprocessError) {
    logger.error(`[${requestId}] Error during webhook preprocessing:`, preprocessError)

    if (foundWebhook.provider === 'microsoft-teams') {
      return Response.json(
        {
          type: 'message',
          text: 'Internal error during preprocessing',
        },
        { status: 500 }
      )
    }

    return Response.json({ error: 'Internal error during preprocessing' }, { status: 500 })
  }
}

/**
 * Queue (or execute inline) a webhook workflow execution.
 * Handles provider-specific event filtering and response formatting.
 */
export async function queueWebhookExecution(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: Request,
  options: WebhookProcessorOptions
): Promise<Response> {
  try {
    // GitHub event filtering for event-specific triggers
    if (foundWebhook.provider === 'github') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      if (triggerId && triggerId !== 'github_webhook') {
        const eventType = request.headers.get('x-github-event')
        const action = body.action

        if (!isGitHubEventMatch(triggerId, eventType || '', action, body)) {
          logger.debug(
            `[${options.requestId}] GitHub event mismatch for trigger ${triggerId}. Event: ${eventType}, Action: ${action}. Skipping execution.`,
            {
              webhookId: foundWebhook.id,
              workflowId: foundWorkflow.id,
              triggerId,
              receivedEvent: eventType,
              receivedAction: action,
            }
          )

          return Response.json({
            message: 'Event type does not match trigger configuration. Ignoring.',
          })
        }
      }
    }

    // Jira event filtering for event-specific triggers
    if (foundWebhook.provider === 'jira') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      if (triggerId && triggerId !== 'jira_webhook') {
        const webhookEvent = body.webhookEvent as string | undefined

        if (!isJiraEventMatch(triggerId, webhookEvent || '', body)) {
          logger.debug(
            `[${options.requestId}] Jira event mismatch for trigger ${triggerId}. Event: ${webhookEvent}. Skipping execution.`,
            {
              webhookId: foundWebhook.id,
              workflowId: foundWorkflow.id,
              triggerId,
              receivedEvent: webhookEvent,
            }
          )

          return Response.json({
            message: 'Event type does not match trigger configuration. Ignoring.',
          })
        }
      }
    }

    // HubSpot event filtering
    if (foundWebhook.provider === 'hubspot') {
      const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = providerConfig.triggerId as string | undefined

      if (triggerId?.startsWith('hubspot_')) {
        const events = Array.isArray(body) ? body : [body]
        const firstEvent = events[0]

        const subscriptionType = firstEvent?.subscriptionType as string | undefined

        if (!isHubSpotContactEventMatch(triggerId, subscriptionType || '')) {
          logger.debug(
            `[${options.requestId}] HubSpot event mismatch for trigger ${triggerId}. Event: ${subscriptionType}. Skipping execution.`,
            {
              webhookId: foundWebhook.id,
              workflowId: foundWorkflow.id,
              triggerId,
              receivedEvent: subscriptionType,
            }
          )

          return Response.json({
            message: 'Event type does not match trigger configuration. Ignoring.',
          })
        }

        logger.info(
          `[${options.requestId}] HubSpot event match confirmed for trigger ${triggerId}. Event: ${subscriptionType}`,
          {
            webhookId: foundWebhook.id,
            workflowId: foundWorkflow.id,
            triggerId,
            receivedEvent: subscriptionType,
          }
        )
      }
    }

    const headers = Object.fromEntries(request.headers.entries())

    // For Microsoft Teams Graph notifications, extract unique identifiers for idempotency
    if (
      foundWebhook.provider === 'microsoft-teams' &&
      body?.value &&
      Array.isArray(body.value) &&
      body.value.length > 0
    ) {
      const notification = body.value[0]
      const subscriptionId = notification.subscriptionId
      const messageId = notification.resourceData?.id

      if (subscriptionId && messageId) {
        headers['x-teams-notification-id'] = `${subscriptionId}:${messageId}`
      }
    }

    // Extract credentialId from webhook config
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const credentialId = providerConfig.credentialId as string | undefined
    const credentialSetId = foundWebhook.credentialSetId as string | undefined

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: foundWorkflow.userId,
      provider: foundWebhook.provider,
      body,
      headers,
      path: options.path || foundWebhook.path,
      blockId: foundWebhook.blockId,
      ...(credentialId ? { credentialId } : {}),
    }

    // Execute inline for now (no job queue in sim-v2 yet)
    void (async () => {
      try {
        const { executeWebhookWorkflow } = await import('@/lib/workflows/webhook-execute')
        await executeWebhookWorkflow(payload)
      } catch (error) {
        logger.error(`[${options.requestId}] Webhook execution failed`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()

    logger.info(
      `[${options.requestId}] Fired inline webhook execution for ${foundWebhook.provider} webhook`
    )

    // Provider-specific responses
    if (foundWebhook.provider === 'microsoft-teams') {
      const teamsConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const triggerId = teamsConfig.triggerId as string | undefined

      // Chat subscription (Graph API) returns 202
      if (triggerId === 'microsoftteams_chat_subscription') {
        return new Response(null, { status: 202 })
      }

      // Channel webhook (outgoing webhook) returns message response
      return Response.json({
        type: 'message',
        text: 'Sim',
      })
    }

    // Twilio Voice requires TwiML XML response
    if (foundWebhook.provider === 'twilio_voice') {
      const twilioConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
      const twimlResponse = (twilioConfig.twimlResponse as string | undefined)?.trim()

      // If user provided custom TwiML, convert square brackets to angle brackets
      if (twimlResponse && twimlResponse.length > 0) {
        const convertedTwiml = convertSquareBracketsToTwiML(twimlResponse)
        return new Response(convertedTwiml, {
          status: 200,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
          },
        })
      }

      // Default TwiML if none provided
      const defaultTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Your call is being processed.</Say>
  <Pause length="1"/>
</Response>`

      return new Response(defaultTwiml, {
        status: 200,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
        },
      })
    }

    return Response.json({ message: 'Webhook processed' })
  } catch (error: any) {
    logger.error(`[${options.requestId}] Failed to queue webhook execution:`, error)

    if (foundWebhook.provider === 'microsoft-teams') {
      return Response.json(
        {
          type: 'message',
          text: 'Webhook processing failed',
        },
        { status: 500 }
      )
    }

    if (foundWebhook.provider === 'twilio_voice') {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, but an error occurred processing your call. Please try again later.</Say>
  <Hangup/>
</Response>`

      return new Response(errorTwiml, {
        status: 200,
        headers: {
          'Content-Type': 'text/xml',
        },
      })
    }

    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
