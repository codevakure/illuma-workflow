import { createLogger } from '@sim/logger'
import { generateInternalToken } from '@/lib/auth/internal'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { generateRequestId } from '@/lib/core/utils/request'
import { parseMcpToolId } from '@/lib/mcp/utils'
import { isCustomTool, isMcpTool } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { OAuthTokenPayload, ToolResponse } from '@/tools/types'
import { getToolAsync, validateRequiredParametersAfterMerge } from '@/tools/utils'

const logger = createLogger('Tools')

/**
 * Normalizes a tool ID by stripping resource ID suffix (UUID).
 * Workflow tools: 'workflow_executor_<uuid>' -> 'workflow_executor'
 * Knowledge tools: 'knowledge_search_<uuid>' -> 'knowledge_search'
 */
function normalizeToolId(toolId: string): string {
  if (toolId.startsWith('workflow_executor_') && toolId.length > 'workflow_executor_'.length) {
    return 'workflow_executor'
  }
  const knowledgeOps = ['knowledge_search', 'knowledge_upload_chunk', 'knowledge_create_document']
  for (const op of knowledgeOps) {
    if (toolId.startsWith(`${op}_`) && toolId.length > op.length + 1) {
      return op
    }
  }
  return toolId
}

/**
 * Maximum request body size in bytes.
 */
const MAX_REQUEST_BODY_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

const BODY_SIZE_LIMIT_ERROR_MESSAGE =
  'Request body size limit exceeded (10MB). The workflow data is too large to process. Try reducing the size of variables, inputs, or data being passed between blocks.'

function validateRequestBodySize(
  body: string | undefined,
  requestId: string,
  context: string
): void {
  if (!body) return

  const bodySize = Buffer.byteLength(body, 'utf8')
  if (bodySize > MAX_REQUEST_BODY_SIZE_BYTES) {
    const bodySizeMB = (bodySize / (1024 * 1024)).toFixed(2)
    const maxSizeMB = (MAX_REQUEST_BODY_SIZE_BYTES / (1024 * 1024)).toFixed(0)
    logger.error(`[${requestId}] Request body size exceeds limit for ${context}:`, {
      bodySize,
      bodySizeMB: `${bodySizeMB}MB`,
      maxSize: MAX_REQUEST_BODY_SIZE_BYTES,
      maxSizeMB: `${maxSizeMB}MB`,
    })
    throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
  }
}

function isBodySizeLimitError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase()
  return (
    lowerMessage.includes('body size') ||
    lowerMessage.includes('payload too large') ||
    lowerMessage.includes('entity too large') ||
    lowerMessage.includes('request entity too large') ||
    lowerMessage.includes('body_not_allowed') ||
    lowerMessage.includes('request body larger than')
  )
}

/**
 * System parameters that should be filtered out when extracting MCP tool arguments
 */
const MCP_SYSTEM_PARAMETERS = new Set([
  'serverId',
  'serverUrl',
  'toolName',
  'serverName',
  '_context',
  'envVars',
  'workflowVariables',
  'blockData',
  'blockNameMapping',
  '_toolSchema',
])

const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'http://localhost:3002'

/**
 * Execute a tool by dispatching to the appropriate handler.
 *
 * Three dispatch paths:
 * 1. Custom tools → DB lookup + execute via /api/function/execute
 * 2. MCP tools → POST /api/mcp/tools/execute
 * 3. Everything else → POST marketplace /api/marketplace/tools/:id/execute
 */
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  skipPostProcess = false,
  executionContext?: ExecutionContext
): Promise<ToolResponse> {
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()
  const requestId = generateRequestId()

  try {
    const normalizedToolId = normalizeToolId(toolId)
    const contextParams = { ...params }

    // --- Custom tool path ---
    if (isCustomTool(normalizedToolId)) {
      const workflowId = contextParams._context?.workflowId
      const tool = await getToolAsync(normalizedToolId, workflowId)
      if (!tool) {
        throw new Error(`Custom tool not found: ${normalizedToolId}`)
      }

      validateRequiredParametersAfterMerge(toolId, tool, contextParams)

      // Resolve OAuth credentials if needed
      await resolveCredentials(contextParams, toolId, requestId, executionContext)

      // Custom tools use directExecution or request config
      if (tool.directExecution) {
        const result = await tool.directExecution(contextParams)
        return addTiming(result, startTime)
      }

      if (tool.request) {
        return await executeCustomToolRequest(tool, contextParams, requestId, startTime)
      }

      throw new Error(`Custom tool ${toolId} has no execution method`)
    }

    // --- MCP tool path ---
    if (isMcpTool(normalizedToolId)) {
      return await executeMcpTool(normalizedToolId, params, executionContext, requestId, startTimeISO)
    }

    // --- Marketplace tool path (everything else) ---
    // Resolve OAuth credentials before delegating to marketplace
    await resolveCredentials(contextParams, toolId, requestId, executionContext)

    return await executeMarketplaceTool(
      normalizedToolId,
      contextParams,
      executionContext,
      requestId,
      startTimeISO
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing tool ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    let errorMessage = 'Unknown error occurred'

    if (error instanceof Error) {
      errorMessage = error.message || `Error executing tool ${toolId}`
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      if (error.status) {
        errorMessage = `HTTP ${error.status}: ${error.statusText || 'Request failed'}`
        if (error.data) {
          if (typeof error.data === 'string') {
            errorMessage = `${errorMessage} - ${error.data}`
          } else if (error.data.message) {
            errorMessage = `${errorMessage} - ${error.data.message}`
          } else if (error.data.error) {
            errorMessage = `${errorMessage} - ${
              typeof error.data.error === 'string'
                ? error.data.error
                : JSON.stringify(error.data.error)
            }`
          }
        }
      } else if (error.message) {
        errorMessage =
          error.message === 'undefined (undefined)'
            ? `Error executing tool ${toolId}`
            : error.message
      }
    }

    return {
      success: false,
      output: {},
      error: errorMessage,
      timing: {
        startTime: startTimeISO,
        endTime: new Date().toISOString(),
        duration: Date.now() - startTime.getTime(),
      },
    }
  }
}

/**
 * Resolve OAuth credentials if a credential parameter is present.
 * Fetches access token from the auth service and injects it into params.
 */
async function resolveCredentials(
  contextParams: Record<string, any>,
  toolId: string,
  requestId: string,
  executionContext?: ExecutionContext
): Promise<void> {
  if (!contextParams.credential) return

  logger.info(
    `[${requestId}] Tool ${toolId} needs access token for credential: ${contextParams.credential}`
  )

  try {
    const baseUrl = getBaseUrl()

    const tokenPayload: OAuthTokenPayload = {
      credentialId: contextParams.credential as string,
    }

    const workflowId =
      contextParams.workflowId ||
      contextParams._context?.workflowId ||
      executionContext?.workflowId
    if (workflowId) {
      tokenPayload.workflowId = workflowId
    }

    const tokenUrlObj = new URL('/api/auth/oauth/token', baseUrl)
    if (workflowId) {
      tokenUrlObj.searchParams.set('workflowId', workflowId)
    }

    const tokenHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (typeof window === 'undefined') {
      try {
        const internalToken = await generateInternalToken()
        tokenHeaders.Authorization = `Bearer ${internalToken}`
      } catch (_e) {
        // Swallow token generation errors
      }
    }

    const response = await fetch(tokenUrlObj.toString(), {
      method: 'POST',
      headers: tokenHeaders,
      body: JSON.stringify(tokenPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch access token: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    contextParams.accessToken = data.accessToken
    if (data.idToken) contextParams.idToken = data.idToken
    if (data.instanceUrl) contextParams.instanceUrl = data.instanceUrl

    // Preserve credential for downstream transforms
    ;(contextParams as any)._credentialId = contextParams.credential
    if (workflowId) {
      ;(contextParams as any)._workflowId = workflowId
    }
    contextParams.credential = undefined
    if (contextParams.workflowId) contextParams.workflowId = undefined

    logger.info(`[${requestId}] Successfully got access token for ${toolId}`)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching access token for ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Failed to obtain credential for tool ${toolId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Execute a custom tool via its request configuration.
 * Custom tools are the only tools that retain request configs (built dynamically from DB schemas).
 */
async function executeCustomToolRequest(
  tool: { request?: any; transformResponse?: any },
  params: Record<string, any>,
  requestId: string,
  startTime: Date
): Promise<ToolResponse> {
  const baseUrl = getBaseUrl()
  const endpointUrl =
    typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
  const fullUrl = new URL(endpointUrl, baseUrl).toString()

  const method =
    typeof tool.request.method === 'function' ? tool.request.method(params) : tool.request.method
  const headers = tool.request.headers ? tool.request.headers(params) : {}
  const bodyResult = tool.request.body ? tool.request.body(params) : undefined
  const body = bodyResult ? (typeof bodyResult === 'string' ? bodyResult : JSON.stringify(bodyResult)) : undefined

  // Add internal auth for server-side
  if (typeof window === 'undefined') {
    try {
      const internalToken = await generateInternalToken()
      headers.Authorization = `Bearer ${internalToken}`
    } catch (_e) {
      // Continue without token
    }
  }

  const workflowId = params._context?.workflowId
  const urlObj = new URL(fullUrl)
  if (workflowId) {
    urlObj.searchParams.set('workflowId', workflowId)
  }

  const response = await fetch(urlObj.toString(), {
    method,
    headers,
    body,
  })

  if (tool.transformResponse) {
    const data = await tool.transformResponse(response, params)
    return addTiming(data, startTime)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Custom tool request failed: ${response.status} ${errorText}`)
  }

  const responseData = await response.json()
  return addTiming(
    {
      success: true,
      output: responseData.output || responseData,
    },
    startTime
  )
}

/**
 * Execute a tool via the marketplace service.
 */
async function executeMarketplaceTool(
  toolId: string,
  params: Record<string, any>,
  executionContext?: ExecutionContext,
  requestId?: string,
  startTimeISO?: string
): Promise<ToolResponse> {
  const actualRequestId = requestId || generateRequestId()
  const actualStartTime = startTimeISO || new Date().toISOString()

  try {
    const context: Record<string, unknown> = {
      requestId: actualRequestId,
    }
    if (params.accessToken) context.accessToken = params.accessToken
    if (params.apiKey) context.apiKey = params.apiKey
    if (params._context?.workspaceId) context.workspaceId = params._context.workspaceId
    if (params._context?.workflowId) context.workflowId = params._context.workflowId

    // Strip internal fields from params before sending to marketplace
    const toolParams = { ...params }
    delete toolParams._context
    delete toolParams.accessToken
    delete toolParams.credential

    const url = `${MARKETPLACE_URL}/api/marketplace/tools/${encodeURIComponent(toolId)}/execute`
    logger.info(`[${actualRequestId}] Calling marketplace: POST ${url}`)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: toolParams, context }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error(`[${actualRequestId}] Marketplace error for ${toolId}:`, {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Marketplace tool execution failed: ${response.status} ${errorText}`)
    }

    const result = await response.json()

    const endTime = new Date()
    return {
      success: result.success ?? false,
      output: result.output ?? {},
      error: result.error,
      timing: {
        startTime: actualStartTime,
        endTime: endTime.toISOString(),
        duration: endTime.getTime() - new Date(actualStartTime).getTime(),
      },
    }
  } catch (error) {
    logger.error(`[${actualRequestId}] Error executing marketplace tool ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
    })

    const endTime = new Date()
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : `Marketplace tool execution failed: ${toolId}`,
      timing: {
        startTime: actualStartTime,
        endTime: endTime.toISOString(),
        duration: endTime.getTime() - new Date(actualStartTime).getTime(),
      },
    }
  }
}

/**
 * Execute an MCP tool via the server-side MCP endpoint
 */
async function executeMcpTool(
  toolId: string,
  params: Record<string, any>,
  executionContext?: ExecutionContext,
  requestId?: string,
  startTimeISO?: string
): Promise<ToolResponse> {
  const actualRequestId = requestId || generateRequestId()
  const actualStartTime = startTimeISO || new Date().toISOString()

  try {
    logger.info(`[${actualRequestId}] Executing MCP tool: ${toolId}`)

    const { serverId, toolName } = parseMcpToolId(toolId)
    const baseUrl = getBaseUrl()

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (typeof window === 'undefined') {
      try {
        const internalToken = await generateInternalToken()
        headers.Authorization = `Bearer ${internalToken}`
      } catch (error) {
        logger.error(`[${actualRequestId}] Failed to generate internal token:`, error)
      }
    }

    let toolArguments = {}
    if (params.arguments) {
      if (typeof params.arguments === 'string') {
        try {
          toolArguments = JSON.parse(params.arguments)
        } catch (error) {
          logger.warn(`[${actualRequestId}] Failed to parse MCP arguments JSON:`, params.arguments)
          toolArguments = {}
        }
      } else {
        toolArguments = params.arguments
      }
    } else {
      toolArguments = Object.fromEntries(
        Object.entries(params).filter(([key]) => !MCP_SYSTEM_PARAMETERS.has(key))
      )
    }

    const workspaceId = params._context?.workspaceId || executionContext?.workspaceId
    const workflowId = params._context?.workflowId || executionContext?.workflowId

    if (!workspaceId) {
      return {
        success: false,
        output: {},
        error: `Missing workspaceId in execution context for MCP tool ${toolName}`,
        timing: {
          startTime: actualStartTime,
          endTime: new Date().toISOString(),
          duration: Date.now() - new Date(actualStartTime).getTime(),
        },
      }
    }

    const toolSchema = params._toolSchema

    const requestBody: Record<string, any> = {
      serverId,
      toolName,
      arguments: toolArguments,
      workflowId,
      workspaceId,
    }

    if (toolSchema) {
      requestBody.toolSchema = toolSchema
    }

    const body = JSON.stringify(requestBody)
    validateRequestBodySize(body, actualRequestId, `mcp:${toolId}`)

    logger.info(`[${actualRequestId}] Making MCP tool request to ${toolName} on ${serverId}`, {
      hasWorkspaceId: !!workspaceId,
      hasWorkflowId: !!workflowId,
      hasToolSchema: !!toolSchema,
    })

    const response = await fetch(`${baseUrl}/api/mcp/tools/execute`, {
      method: 'POST',
      headers,
      body,
    })

    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - new Date(actualStartTime).getTime()

    if (!response.ok) {
      if (response.status === 413) {
        return {
          success: false,
          output: {},
          error: BODY_SIZE_LIMIT_ERROR_MESSAGE,
          timing: { startTime: actualStartTime, endTime: endTimeISO, duration },
        }
      }

      let errorMessage = `MCP tool execution failed: ${response.status} ${response.statusText}`
      try {
        const errorData = await response.json()
        if (errorData.error) errorMessage = errorData.error
      } catch {
        // Use default message
      }

      return {
        success: false,
        output: {},
        error: errorMessage,
        timing: { startTime: actualStartTime, endTime: endTimeISO, duration },
      }
    }

    const result = await response.json()

    if (!result.success) {
      return {
        success: false,
        output: {},
        error: result.error || 'MCP tool execution failed',
        timing: { startTime: actualStartTime, endTime: endTimeISO, duration },
      }
    }

    logger.info(`[${actualRequestId}] MCP tool ${toolId} executed successfully`)

    return {
      success: true,
      output: result.data?.output || result.output || result.data || {},
      timing: { startTime: actualStartTime, endTime: endTimeISO, duration },
    }
  } catch (error) {
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - new Date(actualStartTime).getTime()

    const errorMsg = error instanceof Error ? error.message : String(error)
    if (isBodySizeLimitError(errorMsg)) {
      return {
        success: false,
        output: {},
        error: BODY_SIZE_LIMIT_ERROR_MESSAGE,
        timing: { startTime: actualStartTime, endTime: endTimeISO, duration },
      }
    }

    logger.error(`[${actualRequestId}] Error executing MCP tool ${toolId}:`, error)

    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : `Failed to execute MCP tool ${toolId}`,
      timing: { startTime: actualStartTime, endTime: endTimeISO, duration },
    }
  }
}

/**
 * Add timing data to a tool response.
 */
function addTiming(result: ToolResponse, startTime: Date): ToolResponse {
  const endTime = new Date()
  return {
    ...result,
    timing: {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: endTime.getTime() - startTime.getTime(),
    },
  }
}
