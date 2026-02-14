/**
 * Internal auth token generation stub.
 * The actual implementation requires jose and server-side secrets.
 * This stub provides the type signature for client-side compilation.
 */

export async function generateInternalToken(userId?: string): Promise<string> {
  throw new Error('generateInternalToken is only available on the server')
}

export async function verifyInternalToken(token: string): Promise<{ userId?: string }> {
  throw new Error('verifyInternalToken is only available on the server')
}
