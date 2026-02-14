/**
 * Storage limit stubs
 * TODO: Implement storage quota management
 */

/**
 * Check if a user has sufficient storage quota for an upload
 */
export async function checkStorageQuota(
  _userId: string,
  _sizeBytes: number
): Promise<{ allowed: boolean; error?: string }> {
  return { allowed: true }
}

/**
 * Get the storage limit for a user based on their plan
 */
export async function getUserStorageLimit(_userId: string): Promise<number> {
  return Number.MAX_SAFE_INTEGER
}

/**
 * Get current storage usage for a user
 */
export async function getUserStorageUsage(_userId: string): Promise<number> {
  return 0
}
