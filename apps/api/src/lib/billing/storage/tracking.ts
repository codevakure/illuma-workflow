/**
 * Storage usage tracking stubs
 * TODO: Implement storage usage tracking
 */

/**
 * Increment storage usage after a successful upload
 */
export async function incrementStorageUsage(
  _userId: string,
  _sizeBytes: number
): Promise<void> {}

/**
 * Decrement storage usage after a file deletion
 */
export async function decrementStorageUsage(
  _userId: string,
  _sizeBytes: number
): Promise<void> {}
