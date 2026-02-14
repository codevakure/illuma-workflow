import type { Context } from 'hono'
import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { resolveRouteToToolId } from '@/routes/tool-proxy/route-map'
import { tools } from '@/tools/registry'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import { formatRequestParams } from '@/tools/utils'

const logger = createLogger('GenericProxyHandler')

/**
 * Generic proxy handler that reads a ToolConfig and forwards the request
 * to the appropriate external API. This handles the ~120 "simple forwarder"
 * tools that just validate params, call an external API, and return results.
 *
 * For internal proxy routes (/api/tools/...), this handler:
 * 1. Resolves the route path to a tool ID
 * 2. Reads the ToolConfig for that tool
 * 3. Builds the request using the ToolConfig's request.url/headers/body functions
 * 4. Calls the external API (with SSRF protection)
 * 5. Applies transformResponse if defined
 * 6. Returns the result
 */
export async function handleGenericProxy(
  service: string,
  action: string | undefined,
  body: Record<string, any>,
  c: Context
): Promise<ToolResponse> {
  const requestId = generateRequestId()
  const routePath = action ? `${service}/${action}` : service

  // Resolve route path to tool ID
  const toolId = resolveRouteToToolId(routePath)
  if (!toolId) {
    logger.warn(`[${requestId}] No tool found for route: /api/tools/${routePath}`)
    return {
      success: false,
      output: {},
      error: `Tool route /api/tools/${routePath} is not mapped to any tool. This tool may need a dedicated handler.`,
    }
  }

  const tool = tools[toolId]
  if (!tool) {
    logger.warn(`[${requestId}] Tool config not found for ID: ${toolId}`)
    return {
      success: false,
      output: {},
      error: `Tool configuration not found for ${toolId}`,
    }
  }

  logger.info(`[${requestId}] Generic proxy: ${routePath} -> ${toolId}`)

  try {
    // Build the request from the tool config
    const requestParams = formatRequestParams(tool, body)

    // The ToolConfig's request.url may be the internal route itself (e.g., /api/tools/asana/create-task)
    // We need the ACTUAL external URL. For tools that point back to internal routes,
    // the ToolConfig's request functions already compute the external URL from params.
    const endpointUrl =
      typeof tool.request.url === 'function' ? tool.request.url(body) : tool.request.url

    // If the URL still points to an internal route, this tool needs a dedicated handler
    if (endpointUrl.startsWith('/api/')) {
      logger.warn(
        `[${requestId}] Tool ${toolId} points to internal route ${endpointUrl} - needs dedicated handler`
      )
      return {
        success: false,
        output: {},
        error: `Tool ${toolId} requires a dedicated proxy handler (internal route: ${endpointUrl})`,
      }
    }

    // Validate URL for SSRF protection
    const urlValidation = await validateUrlWithDNS(endpointUrl, 'toolUrl')
    if (!urlValidation.isValid) {
      return {
        success: false,
        output: {},
        error: `Invalid tool URL: ${urlValidation.error}`,
      }
    }

    // Build headers from the tool config
    const headers = tool.request.headers ? tool.request.headers(body) : {}

    // Build body from the tool config
    const method = requestParams.method
    const requestBody = requestParams.body

    logger.info(`[${requestId}] ${method} ${endpointUrl}`)

    // Execute the request with SSRF protection
    const secureResponse = await secureFetchWithPinnedIP(endpointUrl, urlValidation.resolvedIP!, {
      method,
      headers,
      body: requestBody ?? undefined,
      timeout: requestParams.timeout,
    })

    // Convert to standard Response for transformResponse compatibility
    const responseHeaders = new Headers(secureResponse.headers.toRecord())
    const nullBodyStatuses = new Set([101, 204, 205, 304])

    let response: Response
    if (nullBodyStatuses.has(secureResponse.status)) {
      response = new Response(null, {
        status: secureResponse.status,
        statusText: secureResponse.statusText,
        headers: responseHeaders,
      })
    } else {
      const bodyBuffer = await secureResponse.arrayBuffer()
      response = new Response(bodyBuffer, {
        status: secureResponse.status,
        statusText: secureResponse.statusText,
        headers: responseHeaders,
      })
    }

    // Handle error responses
    if (!response.ok) {
      let errorData: any
      try {
        errorData = await response.json()
      } catch {
        try {
          errorData = await response.text()
        } catch {
          errorData = null
        }
      }

      const errorMessage =
        typeof errorData === 'string'
          ? errorData
          : errorData?.error || errorData?.message || `API error: ${response.status}`

      return {
        success: false,
        output: { status: response.status, statusText: response.statusText, data: errorData },
        error: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
      }
    }

    // Apply transformResponse if the tool defines one
    if (tool.transformResponse) {
      try {
        const result = await tool.transformResponse(response, body)
        return result
      } catch (transformError) {
        logger.error(`[${requestId}] transformResponse error for ${toolId}:`, transformError)
        return {
          success: false,
          output: {},
          error:
            transformError instanceof Error
              ? transformError.message
              : 'Response transformation failed',
        }
      }
    }

    // Default: parse JSON response
    let responseData: any
    try {
      responseData = await response.json()
    } catch {
      // Non-JSON response
      const text = await response.text()
      responseData = { text }
    }

    return {
      success: true,
      output: responseData.output || responseData,
    }
  } catch (error) {
    logger.error(`[${requestId}] Generic proxy error for ${toolId}:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Unknown error in generic proxy',
    }
  }
}
