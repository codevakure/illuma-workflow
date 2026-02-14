import crypto from 'crypto'
import { db } from '@sim/db'
import { credentialSet, subscription, webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { isGitHubEventMatch } from '@/triggers/github/utils'
import { isHubSpotContactEventMatch } from '@/triggers/hubspot/utils'
import { isJiraEventMatch } from '@/triggers/jira/utils'

const logger = createLogger('WebhookProcessor')

export interface WebhookProcessorOptions {
  requestId: string
  path?: string
  webhookId?: string
}

/**
 * Timing-safe string comparison using crypto.timingSafeEqual.
 * Returns false immediately if lengths differ (no timing leak on length).
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
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

// ---------------------------------------------------------------------------
// Signature validation helpers (inlined, no external server utils dependency)
// ---------------------------------------------------------------------------

/**
 * Validates a Microsoft Teams outgoing webhook HMAC signature.
 * Secret is base64-encoded, signature header starts with "HMAC ", output is base64.
 */
function validateMicrosoftTeamsSignature(
  hmacSecret: string,
  signature: string,
  body: string
): boolean {
  try {
    if (!hmacSecret || !signature || !body) {
      return false
    }

    if (!signature.startsWith('HMAC ')) {
      return false
    }

    const providedSignature = signature.substring(5)

    const secretBytes = Buffer.from(hmacSecret, 'base64')
    const bodyBytes = Buffer.from(body, 'utf8')
    const computedHash = crypto.createHmac('sha256', secretBytes).update(bodyBytes).digest('base64')

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Microsoft Teams signature:', error)
    return false
  }
}

/**
 * Validates a Twilio webhook signature using HMAC SHA-1.
 * The signing string is URL + sorted param key/value pairs concatenated.
 */
function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, any>
): boolean {
  try {
    if (!authToken || !signature || !url) {
      logger.warn('Twilio signature validation missing required fields', {
        hasAuthToken: !!authToken,
        hasSignature: !!signature,
        hasUrl: !!url,
      })
      return false
    }

    const sortedKeys = Object.keys(params).sort()
    let data = url
    for (const key of sortedKeys) {
      data += key + params[key]
    }

    const computedHash = crypto
      .createHmac('sha1', authToken)
      .update(data, 'utf8')
      .digest('base64')

    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Twilio signature:', error)
    return false
  }
}

/**
 * Validates a Typeform webhook signature using HMAC SHA-256.
 * Signature header format: sha256=<base64>.
 */
function validateTypeformSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      return false
    }

    if (!signature.startsWith('sha256=')) {
      return false
    }

    const providedSignature = signature.substring(7)

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Typeform signature:', error)
    return false
  }
}

/**
 * Validates a Linear webhook signature using HMAC SHA-256 (hex output).
 */
function validateLinearSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Linear signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Linear signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })

    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Linear signature:', error)
    return false
  }
}

/**
 * Validates a Circleback webhook signature using HMAC SHA-256 (hex output).
 */
function validateCirclebackSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Circleback signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Circleback signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })

    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Circleback signature:', error)
    return false
  }
}

/**
 * Validates a Cal.com webhook signature using HMAC SHA-256 (hex output).
 * Signature header may have sha256= prefix.
 */
function validateCalcomSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Cal.com signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    let providedSignature: string
    if (signature.startsWith('sha256=')) {
      providedSignature = signature.substring(7)
    } else {
      providedSignature = signature
    }

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Cal.com signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Cal.com signature:', error)
    return false
  }
}

/**
 * Validates a Jira webhook signature using HMAC SHA-256.
 * Signature header format: sha256=<hex>.
 */
function validateJiraSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Jira signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    if (!signature.startsWith('sha256=')) {
      logger.warn('Jira signature has invalid format (expected sha256=)', {
        signaturePrefix: signature.substring(0, 10),
      })
      return false
    }

    const providedSignature = signature.substring(7)

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Jira signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Jira signature:', error)
    return false
  }
}

/**
 * Validates a GitHub webhook signature using HMAC SHA-256 or SHA-1.
 * Signature header format: sha256=<hex> or sha1=<hex>.
 */
function validateGitHubSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('GitHub signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    let algorithm: 'sha256' | 'sha1'
    let providedSignature: string

    if (signature.startsWith('sha256=')) {
      algorithm = 'sha256'
      providedSignature = signature.substring(7)
    } else if (signature.startsWith('sha1=')) {
      algorithm = 'sha1'
      providedSignature = signature.substring(5)
    } else {
      logger.warn('GitHub signature has invalid format', {
        signature: `${signature.substring(0, 10)}...`,
      })
      return false
    }

    const computedHash = crypto.createHmac(algorithm, secret).update(body, 'utf8').digest('hex')

    logger.debug('GitHub signature comparison', {
      algorithm,
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating GitHub signature:', error)
    return false
  }
}

/**
 * Validates a Fireflies webhook signature using HMAC SHA-256.
 * Signature header format: sha256=<hex>.
 */
function validateFirefliesSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Fireflies signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    if (!signature.startsWith('sha256=')) {
      logger.warn('Fireflies signature has invalid format (expected sha256=)', {
        signaturePrefix: signature.substring(0, 10),
      })
      return false
    }

    const providedSignature = signature.substring(7)

    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Fireflies signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedSignature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedSignature.length,
      match: computedHash === providedSignature,
    })

    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Fireflies signature:', error)
    return false
  }
}

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
 * Slack url_verification, Microsoft Graph validationToken, WhatsApp hub verification.
 * Returns null to continue normal processing flow.
 */
export async function handleProviderChallenges(
  body: any,
  request: Request,
  requestId: string,
  path: string
): Promise<Response | null> {
  // Slack url_verification challenge
  if (body.type === 'url_verification' && body.challenge) {
    return Response.json({ challenge: body.challenge })
  }

  const url = new URL(request.url)

  // Microsoft Graph subscription validation (can come as GET or POST)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    logger.info(`[${requestId}] Microsoft Graph subscription validation for path: ${path}`)
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // WhatsApp hub verification
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode && token && challenge) {
    logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

    if (mode !== 'subscribe') {
      logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
      return new Response('Invalid mode', { status: 400 })
    }

    // Query DB for whatsapp webhooks matching the verification token
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
          eq(webhook.provider, 'whatsapp'),
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
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        logger.debug(`[${requestId}] Webhook ${wh.id} has no verification token, skipping`)
        continue
      }

      if (token === verificationToken) {
        logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
        return new Response(challenge, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
    }

    logger.warn(`[${requestId}] No matching WhatsApp verification token found`)
    return new Response('Verification failed', { status: 403 })
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

  // Microsoft Teams outgoing webhook HMAC verification
  if (foundWebhook.provider === 'microsoft-teams') {
    if (providerConfig.hmacSecret) {
      const authHeader = request.headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('HMAC ')) {
        logger.warn(
          `[${requestId}] Microsoft Teams outgoing webhook missing HMAC authorization header`
        )
        return new Response('Unauthorized - Missing HMAC signature', { status: 401 })
      }

      const isValidSignature = validateMicrosoftTeamsSignature(
        providerConfig.hmacSecret,
        authHeader,
        rawBody
      )

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Microsoft Teams HMAC signature verification failed`)
        return new Response('Unauthorized - Invalid HMAC signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Microsoft Teams HMAC signature verified successfully`)
    }
  }

  // Provider-specific verification (inline, ported from verifyProviderWebhook)
  {
    const authHeader = request.headers.get('authorization')
    const pConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    switch (foundWebhook.provider) {
      case 'github':
        break
      case 'stripe':
        break
      case 'gmail':
        break
      case 'telegram': {
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

        break
      }
      case 'microsoft-teams':
        break
      case 'generic':
        if (pConfig.requireAuth) {
          let isAuthenticated = false
          if (pConfig.token) {
            const bearerMatch = authHeader?.match(/^bearer\s+(.+)$/i)
            const providedToken = bearerMatch ? bearerMatch[1] : null
            if (providedToken === pConfig.token) {
              isAuthenticated = true
            }
            if (!isAuthenticated && pConfig.secretHeaderName) {
              const customHeaderValue = request.headers.get(pConfig.secretHeaderName)
              if (customHeaderValue === pConfig.token) {
                isAuthenticated = true
              }
            }
            if (!isAuthenticated) {
              logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
              return new Response('Unauthorized - Invalid authentication token', { status: 401 })
            }
          }
        }
        // IP allowlist for generic webhooks
        if (
          pConfig.allowedIps &&
          Array.isArray(pConfig.allowedIps) &&
          pConfig.allowedIps.length > 0
        ) {
          const clientIp =
            request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
            request.headers.get('x-real-ip') ||
            'unknown'

          if (clientIp === 'unknown' || !pConfig.allowedIps.includes(clientIp)) {
            logger.warn(
              `[${requestId}] Forbidden webhook access attempt - IP not allowed: ${clientIp}`
            )
            return new Response('Forbidden - IP not allowed', { status: 403 })
          }
        }
        break
      default:
        if (pConfig.token) {
          const providedToken = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : null
          if (!providedToken || providedToken !== pConfig.token) {
            logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
            return new Response('Unauthorized', { status: 401 })
          }
        }
    }
  }

  // Google Forms shared-secret authentication (Apps Script forwarder)
  if (foundWebhook.provider === 'google_forms') {
    const expectedToken = providerConfig.token as string | undefined
    const secretHeaderName = providerConfig.secretHeaderName as string | undefined

    if (expectedToken) {
      let isTokenValid = false

      if (secretHeaderName) {
        const headerValue = request.headers.get(secretHeaderName.toLowerCase())
        if (headerValue === expectedToken) {
          isTokenValid = true
        }
      } else {
        const authHeader = request.headers.get('authorization')
        if (authHeader?.toLowerCase().startsWith('bearer ')) {
          const token = authHeader.substring(7)
          if (token === expectedToken) {
            isTokenValid = true
          }
        }
      }

      if (!isTokenValid) {
        logger.warn(`[${requestId}] Google Forms webhook authentication failed`)
        return new Response('Unauthorized - Invalid secret', { status: 401 })
      }
    }
  }

  // Twilio Voice webhook signature verification
  if (foundWebhook.provider === 'twilio_voice') {
    const authToken = providerConfig.authToken as string | undefined

    if (authToken) {
      const signature = request.headers.get('x-twilio-signature')

      if (!signature) {
        logger.warn(`[${requestId}] Twilio Voice webhook missing signature header`)
        return new Response('Unauthorized - Missing Twilio signature', { status: 401 })
      }

      let params: Record<string, any> = {}
      try {
        if (typeof rawBody === 'string') {
          const urlParams = new URLSearchParams(rawBody)
          params = Object.fromEntries(urlParams.entries())
        }
      } catch (error) {
        logger.error(
          `[${requestId}] Error parsing Twilio webhook body for signature validation:`,
          error
        )
        return new Response('Bad Request - Invalid body format', { status: 400 })
      }

      const fullUrl = getExternalUrl(request)
      const isValidSignature = validateTwilioSignature(authToken, signature, fullUrl, params)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Twilio Voice signature verification failed`, {
          url: fullUrl,
          signatureLength: signature.length,
          paramsCount: Object.keys(params).length,
          authTokenLength: authToken.length,
        })
        return new Response('Unauthorized - Invalid Twilio signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Twilio Voice signature verified successfully`)
    }
  }

  // Typeform webhook signature verification
  if (foundWebhook.provider === 'typeform') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      const signature = request.headers.get('Typeform-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Typeform webhook missing signature header`)
        return new Response('Unauthorized - Missing Typeform signature', { status: 401 })
      }

      const isValidSignature = validateTypeformSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Typeform signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new Response('Unauthorized - Invalid Typeform signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Typeform signature verified successfully`)
    }
  }

  // Linear webhook signature verification
  if (foundWebhook.provider === 'linear') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      const signature = request.headers.get('Linear-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Linear webhook missing signature header`)
        return new Response('Unauthorized - Missing Linear signature', { status: 401 })
      }

      const isValidSignature = validateLinearSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Linear signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new Response('Unauthorized - Invalid Linear signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Linear signature verified successfully`)
    }
  }

  // Circleback webhook signature verification
  if (foundWebhook.provider === 'circleback') {
    const secret = providerConfig.webhookSecret as string | undefined

    if (secret) {
      const signature = request.headers.get('x-signature')

      if (!signature) {
        logger.warn(`[${requestId}] Circleback webhook missing signature header`)
        return new Response('Unauthorized - Missing Circleback signature', { status: 401 })
      }

      const isValidSignature = validateCirclebackSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Circleback signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new Response('Unauthorized - Invalid Circleback signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Circleback signature verified successfully`)
    }
  }

  // Cal.com webhook signature verification
  if (foundWebhook.provider === 'calcom') {
    const secret = providerConfig.webhookSecret as string | undefined

    if (secret) {
      const signature = request.headers.get('X-Cal-Signature-256')

      if (!signature) {
        logger.warn(`[${requestId}] Cal.com webhook missing signature header`)
        return new Response('Unauthorized - Missing Cal.com signature', { status: 401 })
      }

      const isValidSignature = validateCalcomSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Cal.com signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new Response('Unauthorized - Invalid Cal.com signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Cal.com signature verified successfully`)
    }
  }

  // Jira webhook signature verification
  if (foundWebhook.provider === 'jira') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      const signature = request.headers.get('X-Hub-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Jira webhook missing signature header`)
        return new Response('Unauthorized - Missing Jira signature', { status: 401 })
      }

      const isValidSignature = validateJiraSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Jira signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new Response('Unauthorized - Invalid Jira signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Jira signature verified successfully`)
    }
  }

  // GitHub webhook signature verification
  if (foundWebhook.provider === 'github') {
    const secret = providerConfig.secret as string | undefined

    if (secret) {
      // GitHub supports both SHA-256 (preferred) and SHA-1 (legacy)
      const signature256 = request.headers.get('X-Hub-Signature-256')
      const signature1 = request.headers.get('X-Hub-Signature')
      const signature = signature256 || signature1

      if (!signature) {
        logger.warn(`[${requestId}] GitHub webhook missing signature header`)
        return new Response('Unauthorized - Missing GitHub signature', { status: 401 })
      }

      const isValidSignature = validateGitHubSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] GitHub signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
          usingSha256: !!signature256,
        })
        return new Response('Unauthorized - Invalid GitHub signature', { status: 401 })
      }

      logger.debug(`[${requestId}] GitHub signature verified successfully`, {
        usingSha256: !!signature256,
      })
    }
  }

  // Fireflies webhook signature verification
  if (foundWebhook.provider === 'fireflies') {
    const secret = providerConfig.webhookSecret as string | undefined

    if (secret) {
      const signature = request.headers.get('x-hub-signature')

      if (!signature) {
        logger.warn(`[${requestId}] Fireflies webhook missing signature header`)
        return new Response('Unauthorized - Missing Fireflies signature', { status: 401 })
      }

      const isValidSignature = validateFirefliesSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Fireflies signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new Response('Unauthorized - Invalid Fireflies signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Fireflies signature verified successfully`)
    }
  }

  // Generic webhook token-based auth (resolved env vars)
  if (foundWebhook.provider === 'generic') {
    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token
      const secretHeaderName = providerConfig.secretHeaderName

      if (configToken) {
        let isTokenValid = false

        if (secretHeaderName) {
          const headerValue = request.headers.get(secretHeaderName.toLowerCase())
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
