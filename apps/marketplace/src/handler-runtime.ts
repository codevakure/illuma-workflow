import type { HandlerContext, HandlerResult } from '../sdk/types'
import { getHandlerForTool, getIntegrationForTool } from './handler-loader'
import { manifestRegistry } from './manifest-loader'
import { createLogger } from './lib/logger'

const logger = createLogger('handler-runtime')

/** Default operation timeout: 30 seconds */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Validates auth credentials based on the manifest authMode.
 * Returns an error result if required credentials are missing, or null if valid.
 */
function validateAuth(toolId: string, params: Record<string, unknown>, ctx: HandlerContext): HandlerResult | null {
  const integration = manifestRegistry.getIntegrationForTool(toolId)
  if (!integration) return null

  const authMode = integration.block?.authMode
  if (!authMode) return null

  if (authMode === 'oauth') {
    if (!ctx.accessToken && !params.accessToken) {
      return { success: false, output: {}, error: 'OAuth access token is required. Connect your account first.' }
    }
  } else if (authMode === 'api_key') {
    if (!ctx.apiKey && !params.apiKey) {
      return { success: false, output: {}, error: 'API key is required.' }
    }
  } else if (authMode === 'bot_token') {
    if (!ctx.apiKey && !params.apiKey && !params.botToken) {
      return { success: false, output: {}, error: 'Bot token is required.' }
    }
  }

  return null
}

/**
 * Executes a tool operation by looking up the handler and calling the operation function.
 * Auth credentials are validated automatically based on the manifest authMode.
 */
export async function executeOperation(
  toolId: string,
  params: Record<string, unknown>,
  ctx: HandlerContext,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<HandlerResult> {
  const handler = getHandlerForTool(toolId)
  if (!handler) {
    return {
      success: false,
      output: {},
      error: `No handler found for tool: ${toolId}`,
    }
  }

  // Validate auth credentials based on manifest authMode
  const authError = validateAuth(toolId, params, ctx)
  if (authError) return authError

  // Find the operation - tool IDs often include the integration prefix (e.g., "slack_message")
  // Try exact match first, then strip integration prefix
  let operation = handler.operations[toolId]

  if (!operation) {
    const integrationId = getIntegrationForTool(toolId)
    if (integrationId && toolId.startsWith(`${integrationId}_`)) {
      const shortName = toolId.slice(integrationId.length + 1)
      operation = handler.operations[shortName]
    }
  }

  if (!operation) {
    const available = Object.keys(handler.operations).join(', ')
    return {
      success: false,
      output: {},
      error: `Operation "${toolId}" not found. Available: ${available}`,
    }
  }

  try {
    const result = await Promise.race([
      operation(params, ctx),
      new Promise<HandlerResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ])

    logger.info(`Executed ${toolId}`, { requestId: ctx.requestId, success: result.success })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Operation ${toolId} failed: ${message}`, { requestId: ctx.requestId })
    return {
      success: false,
      output: {},
      error: message,
    }
  }
}

/**
 * Validates credentials for an integration's handler.
 */
export async function validateCredentials(
  toolId: string,
  credentials: Record<string, unknown>
): Promise<{ valid: boolean; error?: string }> {
  const handler = getHandlerForTool(toolId)
  if (!handler) {
    return { valid: false, error: `No handler found for tool: ${toolId}` }
  }

  if (!handler.validateCredentials) {
    return { valid: true }
  }

  try {
    await handler.validateCredentials(credentials)
    return { valid: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { valid: false, error: message }
  }
}
