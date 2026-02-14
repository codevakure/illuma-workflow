/**
 * File authorization stub for the API server.
 */

/**
 * Verifies if a user has access to a file.
 */
export async function verifyFileAccess(
  _key: string,
  _userId: string,
  _workspaceId?: string,
  _context?: string,
  _throwOnFail?: boolean
): Promise<boolean> {
  return true
}
