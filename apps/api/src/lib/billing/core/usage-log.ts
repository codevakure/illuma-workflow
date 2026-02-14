/**
 * Usage logging stubs
 * TODO: Implement usage log tracking for billing auditing
 */

/**
 * Parameters for batch logging workflow usage
 */
export interface LogWorkflowUsageBatchParams {
  userId: string
  workspaceId?: string
  workflowId: string
  executionId?: string
  baseExecutionCharge?: number
  models?: Record<
    string,
    {
      total: number
      tokens: { input: number; output: number }
    }
  >
}

/**
 * Log all workflow usage entries in a single batch insert
 */
export async function logWorkflowUsageBatch(
  _params: LogWorkflowUsageBatchParams
): Promise<void> {}

/**
 * Log a model usage charge (token-based)
 */
export async function logModelUsage(_params: {
  userId: string
  source: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  workspaceId?: string
  workflowId?: string
  executionId?: string
}): Promise<void> {}

/**
 * Log a fixed charge (flat fee)
 */
export async function logFixedUsage(_params: {
  userId: string
  source: string
  description: string
  cost: number
  workspaceId?: string
  workflowId?: string
  executionId?: string
}): Promise<void> {}
