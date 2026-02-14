/**
 * Hybrid authentication check stub.
 * Supports both session-based and API-key-based authentication.
 */

interface HybridAuthOptions {
  requireWorkflowId?: boolean
}

interface HybridAuthResult {
  success: boolean
  userId?: string
  error?: string
}

/**
 * Checks authentication using either session cookies or API key headers.
 */
export async function checkHybridAuth(
  _request: Request,
  _options?: HybridAuthOptions
): Promise<HybridAuthResult> {
  return { success: false, error: 'Not implemented' }
}
