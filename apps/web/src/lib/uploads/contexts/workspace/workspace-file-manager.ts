/**
 * Type-only exports for workspace file records.
 * Server-side file management functions are not available in the web client.
 */

export interface WorkspaceFileRecord {
  id: string
  workspaceId: string
  name: string
  key: string
  path: string
  url?: string
  size: number
  type: string
  uploadedBy: string
  uploadedAt: Date
}
