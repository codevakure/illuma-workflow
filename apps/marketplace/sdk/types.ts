/**
 * Context passed to every handler invocation.
 * The API server resolves credentials before calling marketplace.
 */
export interface HandlerContext {
  /** OAuth access token (resolved by API server) */
  accessToken?: string
  /** API key or bot token (from credentials) */
  apiKey?: string
  /** Workspace ID for multi-tenant isolation */
  workspaceId?: string
  /** Workflow ID for context */
  workflowId?: string
  /** Unique request ID for tracing */
  requestId: string
  /** File download helper (for UserFile objects) */
  downloadFile?: (fileRef: unknown) => Promise<Buffer>
}

/**
 * Standard result from any handler operation.
 */
export interface HandlerResult {
  success: boolean
  output: Record<string, unknown>
  error?: string
}

/**
 * A single operation handler function.
 * Can contain any TypeScript logic: HTTP calls, data processing, algorithms, etc.
 */
export type OperationHandler = (
  params: Record<string, unknown>,
  ctx: HandlerContext
) => Promise<HandlerResult>

/**
 * The export shape of every handler.ts file.
 * Maps operation names to handler functions.
 */
export interface ToolHandler {
  operations: Record<string, OperationHandler>
  /** Optional credential validation before execution */
  validateCredentials?: (credentials: Record<string, unknown>) => Promise<void>
}
