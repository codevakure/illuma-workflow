import { createLogger } from '@sim/logger'
import { isEmailAllowed, validateAuthToken } from '@/lib/core/security/deployment'
import { decryptSecret } from '@/lib/core/security/encryption'

const logger = createLogger('DeploymentAuth')

interface DeploymentAuthConfig {
  id: string
  authType: string
  password: string | null
  allowedEmails: string[] | null
}

interface AuthResult {
  authorized: boolean
  error?: string
}

/**
 * Validates chat authentication based on authType.
 * Supports: public, password, email auth types.
 */
export async function validateChatAuth(
  requestId: string,
  deployment: DeploymentAuthConfig,
  request: Request,
  body?: { password?: string; email?: string; input?: string }
): Promise<AuthResult> {
  const authType = deployment.authType || 'public'

  if (authType === 'public') {
    return { authorized: true }
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const cookieName = `chat_auth_${deployment.id}`
  const cookieMatch = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`))
  if (cookieMatch) {
    const token = cookieMatch[1]
    if (validateAuthToken(token, deployment.id, deployment.password)) {
      return { authorized: true }
    }
  }

  if (authType === 'password') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }

    if (!body) {
      return { authorized: false, error: 'Password is required' }
    }

    const { password, input } = body

    if (input && !password) {
      return { authorized: false, error: 'auth_required_password' }
    }

    if (!password) {
      return { authorized: false, error: 'Password is required' }
    }

    if (!deployment.password) {
      logger.error(`[${requestId}] No password set for password-protected chat: ${deployment.id}`)
      return { authorized: false, error: 'Authentication configuration error' }
    }

    try {
      const { decrypted } = await decryptSecret(deployment.password)
      if (password !== decrypted) {
        return { authorized: false, error: 'Invalid password' }
      }
      return { authorized: true }
    } catch (error) {
      logger.error(`[${requestId}] Error validating password:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  if (authType === 'email') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }

    if (!body) {
      return { authorized: false, error: 'Email is required' }
    }

    const { email, input } = body

    if (input && !email) {
      return { authorized: false, error: 'auth_required_email' }
    }

    if (!email) {
      return { authorized: false, error: 'Email is required' }
    }

    const allowedEmails = deployment.allowedEmails || []

    if (isEmailAllowed(email, allowedEmails)) {
      return { authorized: true }
    }

    return { authorized: false, error: 'Email not authorized' }
  }

  return { authorized: false, error: 'Unsupported authentication type' }
}

/**
 * Validates form authentication based on authType.
 * Supports: public, password, email auth types.
 */
export async function validateFormAuth(
  requestId: string,
  deployment: DeploymentAuthConfig,
  request: Request,
  body?: { password?: string; email?: string; formData?: Record<string, unknown> }
): Promise<AuthResult> {
  const authType = deployment.authType || 'public'

  if (authType === 'public') {
    return { authorized: true }
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const cookieName = `form_auth_${deployment.id}`
  const cookieMatch = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`))
  if (cookieMatch) {
    const token = cookieMatch[1]
    if (validateAuthToken(token, deployment.id, deployment.password)) {
      return { authorized: true }
    }
  }

  if (authType === 'password') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }

    if (!body) {
      return { authorized: false, error: 'Password is required' }
    }

    const { password, formData } = body

    if (formData && !password) {
      return { authorized: false, error: 'auth_required_password' }
    }

    if (!password) {
      return { authorized: false, error: 'Password is required' }
    }

    if (!deployment.password) {
      logger.error(`[${requestId}] No password set for password-protected form: ${deployment.id}`)
      return { authorized: false, error: 'Authentication configuration error' }
    }

    try {
      const { decrypted } = await decryptSecret(deployment.password)
      if (password !== decrypted) {
        return { authorized: false, error: 'Invalid password' }
      }
      return { authorized: true }
    } catch (error) {
      logger.error(`[${requestId}] Error validating password:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  if (authType === 'email') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }

    if (!body) {
      return { authorized: false, error: 'Email is required' }
    }

    const { email, formData } = body

    if (formData && !email) {
      return { authorized: false, error: 'auth_required_email' }
    }

    if (!email) {
      return { authorized: false, error: 'Email is required' }
    }

    const allowedEmails: string[] = deployment.allowedEmails || []

    if (isEmailAllowed(email, allowedEmails)) {
      return { authorized: true }
    }

    return { authorized: false, error: 'Email not authorized for this form' }
  }

  return { authorized: false, error: 'Unsupported authentication type' }
}
