import { createHash } from 'crypto'
import { isDev } from '@/lib/core/config/feature-flags'

/**
 * Shared authentication utilities for deployed chat and form endpoints.
 * These functions handle token generation, validation, cookies, and CORS.
 */

function hashPassword(encryptedPassword: string): string {
  return createHash('sha256').update(encryptedPassword).digest('hex').substring(0, 8)
}

function encryptAuthToken(
  deploymentId: string,
  type: string,
  encryptedPassword?: string | null
): string {
  const pwHash = encryptedPassword ? hashPassword(encryptedPassword) : ''
  return Buffer.from(`${deploymentId}:${type}:${Date.now()}:${pwHash}`).toString('base64')
}

/**
 * Validates an authentication token for a deployment (chat or form)
 */
export function validateAuthToken(
  token: string,
  deploymentId: string,
  encryptedPassword?: string | null
): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString()
    const parts = decoded.split(':')
    const [storedId, _type, timestamp, storedPwHash] = parts

    if (storedId !== deploymentId) {
      return false
    }

    const createdAt = Number.parseInt(timestamp)
    const now = Date.now()
    const expireTime = 24 * 60 * 60 * 1000

    if (now - createdAt > expireTime) {
      return false
    }

    if (encryptedPassword) {
      const currentPwHash = hashPassword(encryptedPassword)
      if (storedPwHash !== currentPwHash) {
        return false
      }
    }

    return true
  } catch (_e) {
    return false
  }
}

/**
 * Sets an authentication cookie for a deployment.
 * Appends a Set-Cookie header to the response.
 */
export function setDeploymentAuthCookie(
  response: Response,
  cookiePrefix: 'chat' | 'form',
  deploymentId: string,
  authType: string,
  encryptedPassword?: string | null
): void {
  const token = encryptAuthToken(deploymentId, authType, encryptedPassword)
  const cookieName = `${cookiePrefix}_auth_${deploymentId}`
  const secure = !isDev ? '; Secure' : ''
  const cookieValue = `${cookieName}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24}`
  response.headers.append('Set-Cookie', cookieValue)
}

/**
 * Adds CORS headers to allow cross-origin requests for embedded deployments
 */
export function addCorsHeaders(response: Response, request: Request): Response {
  const origin = request.headers.get('origin') || ''

  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
  }

  return response
}

/**
 * Checks if an email matches the allowed emails list (exact match or domain match)
 */
export function isEmailAllowed(email: string, allowedEmails: string[]): boolean {
  if (allowedEmails.includes(email)) {
    return true
  }

  const atIndex = email.indexOf('@')
  if (atIndex > 0) {
    const domain = email.substring(atIndex + 1)
    if (domain && allowedEmails.some((allowed: string) => allowed === `@${domain}`)) {
      return true
    }
  }

  return false
}
