/**
 * Generic webhook authentication engine.
 *
 * Reads AuthSpec from trigger manifests and performs signature verification
 * without provider-specific switch/case blocks. Handles HMAC, bearer token,
 * and custom (marketplace-delegated) verification.
 */

import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import type { AuthSpec } from '@/integrations/types'

const logger = createLogger('WebhookAuthEngine')

export interface AuthVerificationResult {
  valid: boolean
  error?: string
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
 * Verify an incoming webhook request against a declarative AuthSpec.
 *
 * @param auth - The AuthSpec from the trigger manifest
 * @param providerConfig - Resolved provider config (env vars already expanded)
 * @param headers - Request headers
 * @param rawBody - Raw request body string
 * @param extra - Additional context for custom auth (e.g., request URL for Twilio)
 */
export async function verifyWebhookAuth(
  auth: AuthSpec,
  providerConfig: Record<string, unknown>,
  headers: Headers,
  rawBody: string,
  extra?: { requestUrl?: string; formParams?: Record<string, unknown> }
): Promise<AuthVerificationResult> {
  switch (auth.type) {
    case 'hmac':
      return verifyHmacAuth(auth, providerConfig, headers, rawBody)
    case 'bearer':
      return verifyBearerAuth(auth, providerConfig, headers)
    case 'custom':
      return verifyCustomAuth(auth, providerConfig, headers, rawBody, extra)
    default:
      logger.warn('Unknown auth type in manifest', { type: (auth as { type: string }).type })
      return { valid: false, error: `Unknown auth type: ${(auth as { type: string }).type}` }
  }
}

/**
 * HMAC signature verification.
 *
 * Covers: GitHub (sha256, hex, prefix "sha256="), Linear (sha256, hex, no prefix),
 * Typeform (sha256, base64, prefix "sha256="), Cal.com, Jira, Fireflies,
 * Circleback, Microsoft Teams (base64 secret + base64 output).
 */
function verifyHmacAuth(
  auth: Extract<AuthSpec, { type: 'hmac' }>,
  providerConfig: Record<string, unknown>,
  headers: Headers,
  rawBody: string
): AuthVerificationResult {
  const secret = providerConfig[auth.secretField] as string | undefined
  if (!secret) {
    // No secret configured — skip verification (provider allows unsigned webhooks)
    return { valid: true }
  }

  const signatureHeader = headers.get(auth.headerName)
  if (!signatureHeader) {
    return { valid: false, error: `Missing signature header: ${auth.headerName}` }
  }

  try {
    // Strip prefix from the signature header value
    let providedSignature = signatureHeader
    if (auth.signaturePrefix) {
      if (!signatureHeader.startsWith(auth.signaturePrefix)) {
        // Try case-insensitive prefix match for flexibility
        if (!signatureHeader.toLowerCase().startsWith(auth.signaturePrefix.toLowerCase())) {
          return { valid: false, error: `Signature header missing expected prefix: ${auth.signaturePrefix}` }
        }
        providedSignature = signatureHeader.substring(auth.signaturePrefix.length)
      } else {
        providedSignature = signatureHeader.substring(auth.signaturePrefix.length)
      }
    }

    // Determine secret encoding
    const secretBuffer = auth.secretEncoding === 'base64'
      ? Buffer.from(secret, 'base64')
      : Buffer.from(secret, 'utf8')

    const encoding = auth.encoding ?? 'hex'
    const computedHash = crypto
      .createHmac(auth.algorithm, secretBuffer)
      .update(rawBody, 'utf8')
      .digest(encoding as crypto.BinaryToTextEncoding)

    if (!safeCompare(computedHash, providedSignature)) {
      logger.debug('HMAC signature mismatch', {
        algorithm: auth.algorithm,
        encoding,
        headerName: auth.headerName,
        computedLength: computedHash.length,
        providedLength: providedSignature.length,
      })
      return { valid: false, error: 'Invalid signature' }
    }

    return { valid: true }
  } catch (error) {
    logger.error('Error during HMAC verification', { error })
    return { valid: false, error: 'Signature verification error' }
  }
}

/**
 * Bearer token verification.
 *
 * Covers: Google Forms, generic webhook (bearer mode).
 */
function verifyBearerAuth(
  auth: Extract<AuthSpec, { type: 'bearer' }>,
  providerConfig: Record<string, unknown>,
  headers: Headers
): AuthVerificationResult {
  const expectedToken = providerConfig[auth.secretField] as string | undefined
  if (!expectedToken) {
    return { valid: true }
  }

  const headerValue = headers.get(auth.headerName)
  if (!headerValue) {
    return { valid: false, error: `Missing auth header: ${auth.headerName}` }
  }

  // Extract token from "Bearer <token>" format
  const bearerMatch = headerValue.match(/^bearer\s+(.+)$/i)
  const providedToken = bearerMatch ? bearerMatch[1] : headerValue

  if (!safeCompare(expectedToken, providedToken)) {
    return { valid: false, error: 'Invalid token' }
  }

  return { valid: true }
}

/**
 * Custom auth verification — delegates to a marketplace handler.
 *
 * The handler identifier is in auth.handler (e.g., "slack_verify_webhook").
 * The API calls the marketplace's execute endpoint to run the verification.
 *
 * Covers: Slack (v0:timestamp:body), Stripe (t=timestamp,v1=signature),
 * Twilio Voice (URL+params HMAC), Microsoft Teams (base64 secret HMAC).
 */
async function verifyCustomAuth(
  auth: Extract<AuthSpec, { type: 'custom' }>,
  providerConfig: Record<string, unknown>,
  headers: Headers,
  rawBody: string,
  extra?: { requestUrl?: string; formParams?: Record<string, unknown> }
): Promise<AuthVerificationResult> {
  const marketplaceUrl = process.env.MARKETPLACE_URL || 'http://localhost:3002'
  const toolId = auth.handler

  try {
    const headersObj: Record<string, string> = {}
    headers.forEach((value, key) => {
      headersObj[key] = value
    })

    const response = await fetch(`${marketplaceUrl}/api/marketplace/tools/${toolId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: {
          headers: headersObj,
          body: rawBody,
          config: providerConfig,
          ...(extra?.requestUrl ? { requestUrl: extra.requestUrl } : {}),
          ...(extra?.formParams ? { formParams: extra.formParams } : {}),
        },
        context: {},
      }),
    })

    if (!response.ok) {
      logger.error('Custom auth handler returned error', {
        handler: toolId,
        status: response.status,
      })
      return { valid: false, error: `Auth handler ${toolId} returned ${response.status}` }
    }

    const result = (await response.json()) as { output?: { valid?: boolean; error?: string } }
    const valid = result.output?.valid === true

    if (!valid) {
      logger.debug('Custom auth handler rejected request', {
        handler: toolId,
        error: result.output?.error,
      })
    }

    return {
      valid,
      error: valid ? undefined : result.output?.error || 'Custom auth verification failed',
    }
  } catch (error) {
    logger.error('Failed to call custom auth handler', { handler: toolId, error })
    return { valid: false, error: `Failed to reach auth handler: ${toolId}` }
  }
}
