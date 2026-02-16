import { createLogger } from '@sim/logger'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { AGENT, isCustomTool } from '@/executor/constants'
import { getCustomTool } from '@/hooks/queries/custom-tools'
import { useEnvironmentStore } from '@/stores/settings/environment'
import { manifestRegistry } from '@/integrations/manifest-loader'
import { enrichKBTagFiltersSchema, enrichKBTagsSchema } from '@/tools/schema-enrichers'
import type { ToolConfig } from '@/tools/types'
import type { ToolManifest, IntegrationManifest } from '@/integrations/types'

const logger = createLogger('ToolsUtils')

/**
 * Schema enrichment configs for core block tools that need runtime schema enrichment.
 * These are the only tools that use schemaEnrichment (knowledge block tools).
 */
const SCHEMA_ENRICHMENTS: Record<string, ToolConfig['schemaEnrichment']> = {
  knowledge_search: {
    tagFilters: {
      dependsOn: 'knowledgeBaseId',
      enrichSchema: enrichKBTagFiltersSchema,
    },
  },
  knowledge_create_document: {
    documentTags: {
      dependsOn: 'knowledgeBaseId',
      enrichSchema: enrichKBTagsSchema,
    },
  },
}

/**
 * Converts a manifest ToolManifest into a ToolConfig-compatible object.
 * Only provides schema information — execution is delegated to the marketplace.
 */
function toolConfigFromManifest(tool: ToolManifest, integration?: IntegrationManifest): ToolConfig {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    version: tool.version,
    params: tool.params as ToolConfig['params'],
    outputs: tool.outputs as ToolConfig['outputs'],
    oauth: tool.oauth as ToolConfig['oauth'],
    schemaEnrichment: SCHEMA_ENRICHMENTS[tool.id],
  }
}

/**
 * Creates parameter schema from custom tool schema
 */
export function createParamSchema(customTool: any): Record<string, any> {
  const params: Record<string, any> = {}

  if (customTool.schema.function?.parameters?.properties) {
    const properties = customTool.schema.function.parameters.properties
    const required = customTool.schema.function.parameters.required || []

    Object.entries(properties).forEach(([key, config]: [string, any]) => {
      const isRequired = required.includes(key)

      const paramConfig: Record<string, any> = {
        type: config.type || 'string',
        required: isRequired,
        description: config.description || '',
      }

      if (isRequired) {
        paramConfig.visibility = 'user-or-llm'
      } else {
        paramConfig.visibility = 'user-only'
      }

      params[key] = paramConfig
    })
  }

  return params
}

/**
 * Get environment variables from store (client-side only)
 */
export function getClientEnvVars(getStore?: () => any): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const envStore = getStore ? getStore() : useEnvironmentStore.getState()
    const allEnvVars = envStore.getAllVariables()

    return Object.entries(allEnvVars).reduce(
      (acc, [key, variable]: [string, any]) => {
        acc[key] = variable.value
        return acc
      },
      {} as Record<string, string>
    )
  } catch (_error) {
    return {}
  }
}

/**
 * Creates the request body configuration for custom tools
 */
export function createCustomToolRequestBody(
  customTool: any,
  isClient = true,
  workflowId?: string,
  getStore?: () => any
) {
  return (params: Record<string, any>) => {
    const envVars = params.envVars || (isClient ? getClientEnvVars(getStore) : {})
    const workflowVariables = params.workflowVariables || {}
    const blockData = params.blockData || {}
    const blockNameMapping = params.blockNameMapping || {}

    return {
      code: customTool.code,
      params: params,
      schema: customTool.schema.function.parameters,
      envVars: envVars,
      workflowVariables: workflowVariables,
      blockData: blockData,
      blockNameMapping: blockNameMapping,
      workflowId: params._context?.workflowId || workflowId,
      userId: params._context?.userId,
      isCustomTool: true,
    }
  }
}

/**
 * Validates required parameters after LLM and user params have been merged.
 * This is the final validation before tool execution.
 */
export function validateRequiredParametersAfterMerge(
  toolId: string,
  tool: ToolConfig | undefined,
  params: Record<string, any>,
  parameterNameMap?: Record<string, string>
): void {
  if (!tool) {
    throw new Error(`Tool not found: ${toolId}`)
  }

  for (const [paramName, paramConfig] of Object.entries(tool.params)) {
    if (
      (paramConfig as any).visibility === 'user-or-llm' &&
      paramConfig.required &&
      (!(paramName in params) ||
        params[paramName] === null ||
        params[paramName] === undefined ||
        params[paramName] === '')
    ) {
      const toolName = tool.name || toolId
      const friendlyParamName =
        parameterNameMap?.[paramName] || formatParameterNameForError(paramName)
      throw new Error(`${friendlyParamName} is required for ${toolName}`)
    }
  }
}

/**
 * Formats a parameter name for user-friendly error messages
 */
function formatParameterNameForError(paramName: string): string {
  return paramName
    .split(/(?=[A-Z])|[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Get a tool by its ID. Reads from the manifest registry (core blocks + marketplace tools).
 * Falls back to custom tool lookup on the client side.
 */
export function getTool(toolId: string): ToolConfig | undefined {
  // Check manifest registry (covers all marketplace tools + core blocks)
  const manifestTool = manifestRegistry.getTool(toolId)
  if (manifestTool) {
    const integration = manifestRegistry.getIntegrationForTool(toolId)
    return toolConfigFromManifest(manifestTool, integration)
  }

  // Check if it's a custom tool (client-side only)
  if (isCustomTool(toolId) && typeof window !== 'undefined') {
    const identifier = toolId.slice(AGENT.CUSTOM_TOOL_PREFIX.length)
    const customTool = getCustomTool(identifier)
    if (customTool) {
      return createToolConfig(customTool, toolId)
    }
  }

  return undefined
}

/**
 * Get a tool by its ID asynchronously (supports server-side custom tool fetching).
 */
export async function getToolAsync(
  toolId: string,
  workflowId?: string
): Promise<ToolConfig | undefined> {
  // Check manifest registry (covers all marketplace tools + core blocks)
  const manifestTool = manifestRegistry.getTool(toolId)
  if (manifestTool) {
    const integration = manifestRegistry.getIntegrationForTool(toolId)
    return toolConfigFromManifest(manifestTool, integration)
  }

  // Check if it's a custom tool
  if (isCustomTool(toolId)) {
    return fetchCustomToolFromAPI(toolId, workflowId)
  }

  return undefined
}

// Helper function to create a tool config from a custom tool
function createToolConfig(customTool: any, customToolId: string): ToolConfig {
  const params = createParamSchema(customTool)

  return {
    id: customToolId,
    name: customTool.title,
    description: customTool.schema.function?.description || '',
    version: '1.0.0',
    params,
    request: {
      url: '/api/function/execute',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: createCustomToolRequestBody(customTool, true),
    },
    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!data.success) {
        throw new Error(data.error || 'Custom tool execution failed')
      }
      return {
        success: true,
        output: data.output.result || data.output,
        error: undefined,
      }
    },
  }
}

// Create a tool config from a custom tool definition by fetching from API
async function fetchCustomToolFromAPI(
  customToolId: string,
  workflowId?: string
): Promise<ToolConfig | undefined> {
  const identifier = customToolId.replace('custom_', '')

  try {
    const baseUrl = getBaseUrl()
    const url = new URL('/api/tools/custom', baseUrl)

    if (workflowId) {
      url.searchParams.append('workflowId', workflowId)
    }

    const headers: Record<string, string> = {}
    if (typeof window === 'undefined') {
      try {
        const { generateInternalToken } = await import('@/lib/auth/internal')
        const internalToken = await generateInternalToken()
        headers.Authorization = `Bearer ${internalToken}`
      } catch (error) {
        logger.warn('Failed to generate internal token for custom tools fetch', { error })
      }
    }

    const response = await fetch(url.toString(), {
      headers,
    })

    if (!response.ok) {
      logger.error(`Failed to fetch custom tools: ${response.statusText}`)
      return undefined
    }

    const result = await response.json()

    if (!result.data || !Array.isArray(result.data)) {
      logger.error(`Invalid response when fetching custom tools: ${JSON.stringify(result)}`)
      return undefined
    }

    const customTool = result.data.find(
      (tool: any) => tool.id === identifier || tool.title === identifier
    )

    if (!customTool) {
      logger.error(`Custom tool not found: ${identifier}`)
      return undefined
    }

    const params = createParamSchema(customTool)

    return {
      id: customToolId,
      name: customTool.title,
      description: customTool.schema.function?.description || '',
      version: '1.0.0',
      params,
      request: {
        url: '/api/function/execute',
        method: 'POST',
        headers: () => ({ 'Content-Type': 'application/json' }),
        body: createCustomToolRequestBody(customTool, false, workflowId),
      },
      transformResponse: async (response: Response) => {
        const data = await response.json()
        if (!data.success) {
          throw new Error(data.error || 'Custom tool execution failed')
        }
        return {
          success: true,
          output: data.output.result || data.output,
          error: undefined,
        }
      },
    }
  } catch (error) {
    logger.error(`Error fetching custom tool ${identifier} from API:`, error)
    return undefined
  }
}
