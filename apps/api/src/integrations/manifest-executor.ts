/**
 * Manifest-driven tool executor.
 *
 * Executes tools defined by JSON manifests using one of three modes:
 *   - direct:  Template interpolation → SSRF-protected HTTP → output mapping
 *   - proxy:   Delegates to an existing handler in routes/tool-proxy/handlers/
 *   - sandbox: Delegates to the function executor (E2B / isolated-vm)
 *
 * Reuses the existing SSRF protection from `secureFetchWithPinnedIP`.
 */

import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { interpolate, interpolateObject, buildQueryString } from '@/integrations/template-engine'
import { mapOutput } from '@/integrations/output-mapper'
import { manifestRegistry } from '@/integrations/manifest-loader'
import type { ToolManifest } from '@/integrations/types'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('ManifestExecutor')

/**
 * Executes a manifest-defined tool.
 *
 * @param toolId - The tool ID (must exist in the manifest registry)
 * @param params - User-provided parameters
 * @returns Standard ToolResponse
 */
export async function executeManifestTool(
  toolId: string,
  params: Record<string, unknown>
): Promise<ToolResponse> {
  const tool = manifestRegistry.getTool(toolId)
  if (!tool) {
    return {
      success: false,
      output: {},
      error: `No manifest found for tool: ${toolId}`,
    }
  }

  switch (tool.executionMode) {
    case 'direct':
      return executeDirect(tool, params)
    case 'proxy':
      return executeProxy(tool, params)
    case 'sandbox':
      return executeSandbox(tool, params)
    default:
      return {
        success: false,
        output: {},
        error: `Unknown execution mode: ${tool.executionMode}`,
      }
  }
}

// ---------------------------------------------------------------------------
// Direct mode — template interpolation → HTTP → output mapping
// ---------------------------------------------------------------------------

async function executeDirect(
  tool: ToolManifest,
  params: Record<string, unknown>
): Promise<ToolResponse> {
  if (!tool.request) {
    return {
      success: false,
      output: {},
      error: `Direct tool ${tool.id} has no request configuration`,
    }
  }

  try {
    // Build URL with template interpolation
    let url = interpolate(tool.request.url, params)

    // Append query parameters if specified
    if (tool.request.query) {
      const qs = buildQueryString(tool.request.query, params)
      if (qs) {
        url += (url.includes('?') ? '&' : '?') + qs
      }
    }

    // Validate URL for SSRF protection
    const urlValidation = await validateUrlWithDNS(url, 'manifestToolUrl')
    if (!urlValidation.isValid) {
      return {
        success: false,
        output: {},
        error: `Invalid tool URL: ${urlValidation.error}`,
      }
    }

    // Build headers
    const headers = tool.request.headers
      ? interpolateObject(tool.request.headers, params)
      : {}

    // Build body
    const method = tool.request.method.toUpperCase()
    let bodyStr: string | undefined
    if (method !== 'GET' && method !== 'HEAD' && tool.request.body) {
      const interpolatedBody = interpolateObject(
        tool.request.body as Record<string, unknown>,
        params
      )
      bodyStr = JSON.stringify(interpolatedBody)

      // Ensure Content-Type is set for JSON bodies
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json'
      }
    }

    logger.info(`Manifest direct: ${method} ${url}`, { toolId: tool.id })

    // Execute with SSRF-pinned fetch
    const secureResponse = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, {
      method,
      headers,
      body: bodyStr,
      timeout: 30_000,
    })

    // Convert to standard Response
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
      let errorData: unknown
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
          : (errorData as Record<string, string>)?.error ||
            (errorData as Record<string, string>)?.message ||
            `API error: ${response.status}`

      return {
        success: false,
        output: { status: response.status, statusText: response.statusText, data: errorData },
        error: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
      }
    }

    // Parse response JSON
    let responseData: unknown
    try {
      responseData = await response.json()
    } catch {
      const text = await response.text()
      responseData = { text }
    }

    // Apply output mapping if defined
    if (tool.response?.outputMapping) {
      const mapped = mapOutput(responseData, tool.response.outputMapping)
      return { success: true, output: mapped }
    }

    // Default: return raw response data
    const output =
      typeof responseData === 'object' && responseData !== null
        ? (responseData as Record<string, unknown>)
        : { data: responseData }

    return { success: true, output }
  } catch (error) {
    logger.error(`Manifest direct execution failed for ${tool.id}`, { error })
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Direct execution failed',
    }
  }
}

// ---------------------------------------------------------------------------
// Proxy mode — delegates to existing tool-proxy handlers
// ---------------------------------------------------------------------------

async function executeProxy(
  tool: ToolManifest,
  params: Record<string, unknown>
): Promise<ToolResponse> {
  if (!tool.proxy) {
    return {
      success: false,
      output: {},
      error: `Proxy tool ${tool.id} has no proxy configuration`,
    }
  }

  try {
    // Dynamically import the handler
    const handlerModule = await import(
      `@/routes/tool-proxy/handlers/${tool.proxy.handler}`
    )

    if (typeof handlerModule.default !== 'function' && typeof handlerModule.handler !== 'function') {
      return {
        success: false,
        output: {},
        error: `Handler "${tool.proxy.handler}" does not export a handler function`,
      }
    }

    const handlerFn = handlerModule.default || handlerModule.handler
    const result = await handlerFn(params, tool.proxy.operation)

    return result
  } catch (error) {
    logger.error(`Manifest proxy execution failed for ${tool.id}`, { error })
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Proxy execution failed',
    }
  }
}

// ---------------------------------------------------------------------------
// Sandbox mode — delegates to function executor (E2B / isolated-vm)
// ---------------------------------------------------------------------------

async function executeSandbox(
  tool: ToolManifest,
  _params: Record<string, unknown>
): Promise<ToolResponse> {
  if (!tool.codeModule) {
    return {
      success: false,
      output: {},
      error: `Sandbox tool ${tool.id} has no codeModule defined`,
    }
  }

  // Sandbox execution will be implemented when needed
  // For now, return a clear error indicating this mode is not yet active
  return {
    success: false,
    output: {},
    error: `Sandbox execution mode is not yet implemented for tool ${tool.id}`,
  }
}
