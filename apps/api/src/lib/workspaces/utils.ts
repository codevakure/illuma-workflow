/**
 * Workspace utility stubs
 * TODO: Implement workspace billing resolution
 */

/**
 * Get the billed account user ID for a workspace.
 * Returns the user ID that should be charged for workflow executions
 * in this workspace, or null if not configured.
 */
export async function getWorkspaceBilledAccountUserId(
  _workspaceId: string
): Promise<string | null> {
  return null
}

/**
 * Get workspace billing settings
 */
export async function getWorkspaceBillingSettings(
  _workspaceId: string
): Promise<{
  billedAccountUserId: string | null
  allowPersonalApiKeys: boolean
} | null> {
  return null
}
