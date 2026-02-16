/**
 * Generic webhook challenge handler engine.
 *
 * Reads ChallengeSpec from trigger manifests and responds to provider
 * verification challenges (URL verification, subscription validation)
 * without provider-specific inline code.
 */

import { createLogger } from '@sim/logger'
import type { ChallengeSpec } from '@/integrations/types'

const logger = createLogger('WebhookChallengeEngine')

/**
 * Attempt to handle a webhook verification challenge using a manifest ChallengeSpec.
 *
 * Returns a Response if this request matches the challenge pattern,
 * or null to continue normal webhook processing.
 *
 * @param challenge - The ChallengeSpec from the trigger manifest
 * @param body - Parsed request body
 * @param url - The request URL (for query parameter challenges)
 * @param providerConfig - Resolved provider config (for token verification)
 */
export function handleManifestChallenge(
  challenge: ChallengeSpec,
  body: unknown,
  url: URL,
  providerConfig?: Record<string, unknown>
): Response | null {
  switch (challenge.type) {
    case 'body_echo':
      return handleBodyEcho(challenge, body)
    case 'query_echo':
      return handleQueryEcho(challenge, url)
    case 'hub_verify':
      return handleHubVerify(challenge, body, url, providerConfig)
    default:
      logger.warn('Unknown challenge type', { type: (challenge as { type: string }).type })
      return null
  }
}

/**
 * Body echo challenge (e.g., Slack url_verification).
 *
 * If the body contains the specified field, echo it back as JSON.
 * Slack sends: { "type": "url_verification", "challenge": "abc123" }
 * Expected response: { "challenge": "abc123" }
 */
function handleBodyEcho(
  challenge: Extract<ChallengeSpec, { type: 'body_echo' }>,
  body: unknown
): Response | null {
  if (!body || typeof body !== 'object') return null

  const bodyObj = body as Record<string, unknown>
  const fieldValue = bodyObj[challenge.field]

  if (fieldValue === undefined || fieldValue === null) {
    return null
  }

  logger.info('Handling body_echo challenge', { field: challenge.field })
  return Response.json({ [challenge.field]: fieldValue })
}

/**
 * Query parameter echo challenge (e.g., Microsoft Graph validationToken).
 *
 * If the URL has the specified query param, echo its value as plaintext.
 */
function handleQueryEcho(
  challenge: Extract<ChallengeSpec, { type: 'query_echo' }>,
  url: URL
): Response | null {
  const value = url.searchParams.get(challenge.param)
  if (!value) return null

  logger.info('Handling query_echo challenge', { param: challenge.param })
  return new Response(value, {
    status: 200,
    headers: { 'Content-Type': challenge.contentType || 'text/plain' },
  })
}

/**
 * Hub verification challenge (e.g., WhatsApp, Facebook).
 *
 * Checks hub.mode === 'subscribe', verifies hub.verify_token against
 * the provider config, and echoes hub.challenge on success.
 *
 * Note: This variant does NOT require DB lookup — it uses the providerConfig
 * passed from the caller. For pre-lookup challenges (where no webhook has been
 * found yet), the caller must iterate webhooks and call this per config.
 */
function handleHubVerify(
  challenge: Extract<ChallengeSpec, { type: 'hub_verify' }>,
  _body: unknown,
  url: URL,
  providerConfig?: Record<string, unknown>
): Response | null {
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const hubChallenge = url.searchParams.get('hub.challenge')

  if (!mode || !token || !hubChallenge) return null

  if (mode !== 'subscribe') {
    logger.warn('Hub verification invalid mode', { mode })
    return new Response('Invalid mode', { status: 400 })
  }

  if (!providerConfig) {
    logger.warn('Hub verification called without provider config')
    return new Response('Verification failed', { status: 403 })
  }

  const expectedToken = providerConfig[challenge.verifyTokenField] as string | undefined
  if (!expectedToken) {
    logger.warn('Hub verification: no token configured', { field: challenge.verifyTokenField })
    return new Response('Verification failed', { status: 403 })
  }

  if (token === expectedToken) {
    logger.info('Hub verification successful')
    return new Response(hubChallenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  logger.warn('Hub verification token mismatch')
  return new Response('Verification failed', { status: 403 })
}
