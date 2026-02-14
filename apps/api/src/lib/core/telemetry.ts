/**
 * Telemetry no-op stub for the API server.
 *
 * The sim app uses OpenTelemetry for tracing workflow executions.
 * In the standalone API, telemetry is a no-op unless explicitly configured.
 * All functions silently succeed so callers do not need to guard against errors.
 */

/**
 * No-op: Track a platform event
 */
export function trackPlatformEvent(
  _eventName: string,
  _attributes: Record<string, string | number | boolean>
): void {
  // No-op
}

/**
 * No-op: Create OTel span from a trace span
 */
export function createOTelSpanFromTraceSpan(_traceSpan: unknown, _parentSpan?: unknown): null {
  return null
}

/**
 * No-op: Create OTel spans for a full workflow execution
 */
export function createOTelSpansForWorkflowExecution(_params: {
  workflowId: string
  workflowName?: string
  executionId: string
  traceSpans: unknown[]
  trigger: string
  startTime: string
  endTime: string
  totalDurationMs: number
  status: 'success' | 'error'
  error?: string
}): void {
  // No-op
}

/**
 * No-op: Trace a block execution with an OTel span
 */
export async function traceBlockExecution<T>(
  _blockType: string,
  _blockId: string,
  _blockName: string,
  fn: (span: unknown) => Promise<T>
): Promise<T> {
  // Execute the function with a dummy span object
  return fn({
    setAttribute: () => {},
    setStatus: () => {},
    recordException: () => {},
    end: () => {},
  })
}

/**
 * No-op platform event helpers.
 * Each method accepts the same typed attributes as the real implementation
 * but does nothing.
 */
const noop = (..._args: unknown[]): void => {}

export const PlatformEvents = {
  userSignedUp: noop,
  userSignedIn: noop,
  passwordResetRequested: noop,
  workspaceCreated: noop,
  workspaceMemberInvited: noop,
  workspaceMemberJoined: noop,
  workflowCreated: noop,
  workflowDeleted: noop,
  workflowDuplicated: noop,
  workflowDeployed: noop,
  workflowUndeployed: noop,
  workflowExecuted: noop,
  knowledgeBaseCreated: noop,
  knowledgeBaseDeleted: noop,
  knowledgeBaseDocumentsUploaded: noop,
  knowledgeBaseSearched: noop,
  apiKeyGenerated: noop,
  apiKeyRevoked: noop,
  oauthConnected: noop,
  oauthDisconnected: noop,
  credentialSetCreated: noop,
  webhookCreated: noop,
  webhookDeleted: noop,
  webhookTriggered: noop,
  mcpServerAdded: noop,
  mcpToolExecuted: noop,
  templateUsed: noop,
  subscriptionCreated: noop,
  subscriptionChanged: noop,
  subscriptionCancelled: noop,
  folderCreated: noop,
  folderDeleted: noop,
  chatDeployed: noop,
}
