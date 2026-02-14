import { createMiddleware } from 'hono/factory'

/**
 * Auth context that will be available in routes
 */
export interface AuthContext {
  userId: string
  authType: 'jwt' | 'api_key' | 'internal' | 'placeholder'
}

/**
 * Placeholder auth middleware - always passes with a test user
 *
 * TODO: Implement real auth:
 * 1. Session-manager JWT validation (GATEWAY_JWT_SECRET)
 * 2. Internal JWT validation (INTERNAL_API_SECRET)
 * 3. API key validation (X-API-Key header)
 */
export const authMiddleware = createMiddleware<{
  Variables: AuthContext
}>(async (c, next) => {
  // Placeholder: Always authenticate as test user
  // In production, this will validate:
  // - Bearer token (session-manager JWT or internal JWT)
  // - X-API-Key header

  const authHeader = c.req.header('Authorization')
  const apiKey = c.req.header('X-API-Key')

  // For now, use a placeholder user ID or extract from headers for testing
  let userId = 'test-user-id'
  let authType: AuthContext['authType'] = 'placeholder'

  // Allow passing user ID via header for testing
  const testUserId = c.req.header('X-Test-User-Id')
  if (testUserId) {
    userId = testUserId
  }

  // Log auth attempt (for debugging)
  if (authHeader) {
    console.log('[Auth] Bearer token provided (placeholder mode - not validated)')
    authType = 'jwt'
  } else if (apiKey) {
    console.log('[Auth] API key provided (placeholder mode - not validated)')
    authType = 'api_key'
  } else {
    console.log('[Auth] No auth provided, using placeholder user')
  }

  c.set('userId', userId)
  c.set('authType', authType)

  await next()
})

/**
 * Get user ID from context (for use in routes)
 */
export function getUserId(c: { get: (key: 'userId') => string }): string {
  return c.get('userId')
}
