/**
 * Placeholder auth module for the API.
 * In production, this will integrate with session-manager.
 */

export interface Session {
  user: {
    id: string
    email?: string
    name?: string
    image?: string
  } | null
}

/**
 * Placeholder session getter.
 * In production, this will validate JWT from session-manager.
 */
export async function getSession(): Promise<Session | null> {
  // For now, return a test session
  // This will be replaced with real auth when we integrate session-manager
  return {
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
    },
  }
}

/**
 * Get session from request headers (for Hono context)
 */
export async function getSessionFromRequest(request: Request): Promise<Session | null> {
  const testUserId = request.headers.get('X-Test-User-Id')
  const authHeader = request.headers.get('Authorization')

  if (testUserId) {
    return {
      user: {
        id: testUserId,
        email: `${testUserId}@example.com`,
        name: 'Test User',
      },
    }
  }

  if (authHeader?.startsWith('Bearer ')) {
    // In production, validate the JWT here
    // For now, just return a placeholder
    return {
      user: {
        id: 'jwt-user-id',
        email: 'jwt@example.com',
        name: 'JWT User',
      },
    }
  }

  // Default test user for development
  return {
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
    },
  }
}

export { getSession as auth }
