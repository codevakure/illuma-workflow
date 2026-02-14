/**
 * Type-only exports for workflow deployment versions.
 * Server-side persistence functions are not available in the web client.
 */

export interface WorkflowDeploymentVersionResponse {
  id: string
  version: number
  name?: string | null
  description?: string | null
  isActive: boolean
  createdAt: string
  createdBy?: string | null
  deployedBy?: string | null
}
