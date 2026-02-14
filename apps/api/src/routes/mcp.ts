import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('McpRoutes')

const app = new Hono<{ Variables: AuthContext }>()

let db: any
let mcpServers: any
let workflowMcpServer: any
let workflowMcpTool: any
let workflow: any
let workflowBlocks: any
let useInMemory = false
let dbInitialized = false

async function initDb() {
  try {
    const dbModule = await import('@sim/db')
    db = dbModule.db
    mcpServers = dbModule.mcpServers
    workflowMcpServer = dbModule.workflowMcpServer
    workflowMcpTool = dbModule.workflowMcpTool
    workflow = dbModule.workflow
    workflowBlocks = dbModule.workflowBlocks

    await db.select().from(mcpServers).limit(1)
    logger.info('Database connection established for MCP routes')
    return true
  } catch (error) {
    logger.warn('Database not available for MCP routes, using in-memory:', error)
    useInMemory = true
    return false
  }
}

async function ensureInit() {
  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }
}

/**
 * GET /mcp/tools/stored?workspaceId={id}
 * Returns stored MCP tools for a workspace, joined through workflow_mcp_server.
 */
app.get('/tools/stored', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ data: { tools: [] } })
    }

    const { eq } = await import('drizzle-orm')

    const servers = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.workspaceId, workspaceId))

    if (servers.length === 0) {
      return c.json({ data: { tools: [] } })
    }

    const { inArray } = await import('drizzle-orm')
    const serverIds = servers.map((s: { id: string }) => s.id)

    const tools = await db
      .select()
      .from(workflowMcpTool)
      .where(inArray(workflowMcpTool.serverId, serverIds))

    return c.json({ data: { tools } })
  } catch (error) {
    logger.error('Error fetching stored MCP tools', error)
    return c.json({ data: { tools: [] } })
  }
})

/**
 * GET /mcp/tools/discover?workspaceId={id}
 * Discovers available MCP tools from connected servers.
 * Stub: returns empty tools array since live discovery requires active server connections.
 */
app.get('/tools/discover', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  logger.info(`MCP tool discovery requested for workspace: ${workspaceId}`)
  return c.json({ data: { tools: [] } })
})

/**
 * GET /mcp/servers?workspaceId={id}
 * Lists MCP servers for a workspace.
 */
app.get('/servers', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json({ data: { servers: [] } })
  }

  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ data: { servers: [] } })
    }

    const { eq, and, isNull } = await import('drizzle-orm')

    const servers = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))

    return c.json({ data: { servers } })
  } catch (error) {
    logger.error('Error listing MCP servers', error)
    return c.json({ data: { servers: [] } })
  }
})

/**
 * POST /mcp/servers
 * Creates a new MCP server for a workspace.
 * Uses deterministic server IDs based on URL hash to ensure that re-adding
 * the same server produces the same ID.
 */
app.post('/servers', async (c) => {
  const body = await c.req.json()
  const userId = getUserId(c)
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info('Registering MCP server', {
      name: body.name,
      transport: body.transport,
      workspaceId,
    })

    if (!body.name || !body.transport) {
      return c.json({ error: 'Missing required fields: name or transport' }, 400)
    }

    const { generateMcpServerId } = await import('@/lib/mcp/utils')
    const { eq, and } = await import('drizzle-orm')

    const serverId = body.url
      ? generateMcpServerId(workspaceId, body.url)
      : crypto.randomUUID()

    const [existingServer] = await db
      .select({ id: mcpServers.id, deletedAt: mcpServers.deletedAt })
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      .limit(1)

    if (existingServer) {
      logger.info(`Server with ID ${serverId} already exists, updating instead of creating`)

      await db
        .update(mcpServers)
        .set({
          name: body.name,
          description: body.description,
          transport: body.transport,
          url: body.url,
          headers: body.headers || {},
          timeout: body.timeout || 30000,
          retries: body.retries || 3,
          enabled: body.enabled !== false,
          connectionStatus: 'connected',
          lastConnected: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        })
        .where(eq(mcpServers.id, serverId))

      try {
        const { mcpService } = await import('@/lib/mcp/service')
        await mcpService.clearCache(workspaceId)
      } catch (_e) {
        logger.warn('Could not clear MCP cache after server update')
      }

      logger.info(`Successfully updated MCP server: ${body.name} (ID: ${serverId})`)
      return c.json({ data: { serverId, updated: true } })
    }

    await db
      .insert(mcpServers)
      .values({
        id: serverId,
        workspaceId,
        createdBy: userId,
        name: body.name,
        description: body.description,
        transport: body.transport,
        url: body.url,
        headers: body.headers || {},
        timeout: body.timeout || 30000,
        retries: body.retries || 3,
        enabled: body.enabled !== false,
        connectionStatus: 'connected',
        lastConnected: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    try {
      const { mcpService } = await import('@/lib/mcp/service')
      await mcpService.clearCache(workspaceId)
    } catch (_e) {
      logger.warn('Could not clear MCP cache after server creation')
    }

    logger.info(`Successfully registered MCP server: ${body.name} (ID: ${serverId})`)
    return c.json({ data: { serverId } }, 201)
  } catch (error) {
    logger.error('Error registering MCP server:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to register MCP server' },
      500
    )
  }
})

/**
 * PATCH /mcp/servers/:serverId
 * Updates an MCP server in the workspace.
 */
app.patch('/servers/:serverId', async (c) => {
  const serverId = c.req.param('serverId')
  const body = await c.req.json()
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Updating MCP server: ${serverId} in workspace: ${workspaceId}`)

    const { eq, and, isNull } = await import('drizzle-orm')

    // Remove workspaceId from body to prevent it from being updated
    const { workspaceId: _, ...updateData } = body

    // Get the current server to check if URL is changing
    const [currentServer] = await db
      .select({ url: mcpServers.url })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, serverId),
          eq(mcpServers.workspaceId, workspaceId),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)

    const [updatedServer] = await db
      .update(mcpServers)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mcpServers.id, serverId),
          eq(mcpServers.workspaceId, workspaceId),
          isNull(mcpServers.deletedAt)
        )
      )
      .returning()

    if (!updatedServer) {
      return c.json({ error: 'Server not found or access denied' }, 404)
    }

    // Only clear cache if URL changed (requires re-discovery)
    const urlChanged = body.url && currentServer?.url !== body.url
    if (urlChanged) {
      try {
        const { mcpService } = await import('@/lib/mcp/service')
        await mcpService.clearCache(workspaceId)
        logger.info('Cleared cache due to URL change')
      } catch (_e) {
        logger.warn('Could not clear MCP cache after URL change')
      }
    }

    logger.info(`Successfully updated MCP server: ${serverId}`)
    return c.json({ data: { server: updatedServer } })
  } catch (error) {
    logger.error('Error updating MCP server:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to update MCP server' },
      500
    )
  }
})

/**
 * DELETE /mcp/servers
 * Deletes an MCP server from the workspace.
 */
app.delete('/servers', async (c) => {
  const serverId = c.req.query('serverId')
  const workspaceId = c.req.query('workspaceId')

  if (!serverId) {
    return c.json({ error: 'serverId parameter is required' }, 400)
  }

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Deleting MCP server: ${serverId} from workspace: ${workspaceId}`)

    const { eq, and } = await import('drizzle-orm')

    const [deletedServer] = await db
      .delete(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      .returning()

    if (!deletedServer) {
      return c.json({ error: 'Server not found or access denied' }, 404)
    }

    try {
      const { mcpService } = await import('@/lib/mcp/service')
      await mcpService.clearCache(workspaceId)
    } catch (_e) {
      logger.warn('Could not clear MCP cache after server deletion')
    }

    logger.info(`Successfully deleted MCP server: ${serverId}`)
    return c.json({ data: { message: `Server ${serverId} deleted successfully` } })
  } catch (error) {
    logger.error('Error deleting MCP server:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to delete MCP server' },
      500
    )
  }
})

/**
 * POST /mcp/servers/:serverId/refresh
 * Refreshes an MCP server connection and discovers tools.
 * Updates server status and syncs tool schemas to workflow blocks.
 */
app.post('/servers/:serverId/refresh', async (c) => {
  const serverId = c.req.param('serverId')
  const body = await c.req.json().catch(() => ({}))
  const userId = getUserId(c)
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Refreshing MCP server: ${serverId}`)

    const { eq, and, isNull } = await import('drizzle-orm')

    const [server] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, serverId),
          eq(mcpServers.workspaceId, workspaceId),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)

    if (!server) {
      return c.json({ error: 'Server not found or access denied' }, 404)
    }

    let connectionStatus: 'connected' | 'disconnected' | 'error' = 'error'
    let toolCount = 0
    let lastError: string | null = null
    let discoveredTools: Array<{ name: string; description?: string; inputSchema: unknown }> = []
    let syncResult = { updatedCount: 0, updatedWorkflowIds: [] as string[] }

    interface StatusConfig {
      consecutiveFailures: number
      lastSuccessfulDiscovery: string | null
    }

    const currentStatusConfig: StatusConfig =
      (server.statusConfig as StatusConfig | null) ?? {
        consecutiveFailures: 0,
        lastSuccessfulDiscovery: null,
      }

    try {
      const { mcpService } = await import('@/lib/mcp/service')
      discoveredTools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
      connectionStatus = 'connected'
      toolCount = discoveredTools.length
      logger.info(`Discovered ${toolCount} tools from server ${serverId}`)

      // Sync tool schemas to workflow blocks that use these tools
      try {
        syncResult = await syncToolSchemasToWorkflows(
          workspaceId,
          serverId,
          discoveredTools,
          serverId
        )
      } catch (syncError) {
        logger.warn('Error syncing tool schemas to workflows:', syncError)
      }
    } catch (error) {
      connectionStatus = 'error'
      lastError = error instanceof Error ? error.message : 'Connection test failed'
      logger.warn(`Failed to connect to server ${serverId}:`, error)
    }

    const now = new Date()
    const newStatusConfig =
      connectionStatus === 'connected'
        ? { consecutiveFailures: 0, lastSuccessfulDiscovery: now.toISOString() }
        : {
            consecutiveFailures: currentStatusConfig.consecutiveFailures + 1,
            lastSuccessfulDiscovery: currentStatusConfig.lastSuccessfulDiscovery,
          }

    const [refreshedServer] = await db
      .update(mcpServers)
      .set({
        lastToolsRefresh: now,
        connectionStatus,
        lastError,
        lastConnected: connectionStatus === 'connected' ? now : server.lastConnected,
        toolCount,
        statusConfig: newStatusConfig,
        updatedAt: now,
      })
      .where(eq(mcpServers.id, serverId))
      .returning()

    if (connectionStatus === 'connected') {
      try {
        const { mcpService } = await import('@/lib/mcp/service')
        await mcpService.clearCache(workspaceId)
      } catch (_e) {
        logger.warn('Could not clear MCP cache after refresh')
      }
    }

    return c.json({
      data: {
        status: connectionStatus,
        toolCount,
        lastConnected: refreshedServer?.lastConnected?.toISOString() || null,
        error: lastError,
        workflowsUpdated: syncResult.updatedCount,
        updatedWorkflowIds: syncResult.updatedWorkflowIds,
      },
    })
  } catch (error) {
    logger.error('Error refreshing MCP server:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh MCP server' },
      500
    )
  }
})

/**
 * POST /mcp/servers/test-connection
 * Tests connection to an MCP server before registering it.
 */
app.post('/servers/test-connection', async (c) => {
  const body = await c.req.json()
  const userId = getUserId(c)
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  try {
    logger.info('Testing MCP server connection', {
      name: body.name,
      transport: body.transport,
      url: body.url ? `${body.url.substring(0, 50)}...` : undefined,
    })

    if (!body.name || !body.transport) {
      return c.json(
        { data: { success: false, error: 'Missing required fields: name and transport' } },
        400
      )
    }

    if (body.transport === 'streamable-http' && !body.url) {
      return c.json(
        { data: { success: false, error: 'URL is required for HTTP-based transports' } },
        400
      )
    }

    const initialConfig = {
      id: `test-${crypto.randomUUID()}`,
      name: body.name,
      transport: body.transport,
      url: body.url,
      headers: body.headers || {},
      timeout: body.timeout || 10000,
      retries: 1,
      enabled: true,
    }

    // Resolve env vars using shared utility (non-strict mode for testing)
    const { resolveMcpConfigEnvVars } = await import('@/lib/mcp/resolve-config')
    const { config: testConfig, missingVars } = await resolveMcpConfigEnvVars(
      initialConfig,
      userId,
      workspaceId,
      { strict: false }
    )

    if (missingVars.length > 0) {
      logger.warn('Some environment variables not found during test:', { missingVars })
    }

    const testSecurityPolicy = {
      requireConsent: false,
      auditLevel: 'none' as const,
      maxToolExecutionsPerHour: 0,
    }

    interface TestConnectionResult {
      success: boolean
      error?: string
      serverInfo?: { name: string; version: string }
      negotiatedVersion?: string
      supportedCapabilities?: string[]
      toolCount?: number
      warnings?: string[]
    }

    const result: TestConnectionResult = { success: false }

    const { McpClient } = await import('@/lib/mcp/client')
    let client: InstanceType<typeof McpClient> | null = null

    try {
      client = new McpClient(testConfig, testSecurityPolicy)
      await client.connect()

      result.negotiatedVersion = client.getNegotiatedVersion()

      try {
        const tools = await client.listTools()
        result.toolCount = tools.length
        result.success = true
      } catch (toolError) {
        logger.warn('Connection established but could not list tools:', toolError)
        result.success = false
        const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error'
        result.error = `Connection established but could not list tools: ${errorMessage}`
        result.warnings = result.warnings || []
        result.warnings.push(
          'Server connected but tool listing failed - connection may be incomplete'
        )
      }

      const clientVersionInfo = McpClient.getVersionInfo()
      if (result.negotiatedVersion !== clientVersionInfo.preferred) {
        result.warnings = result.warnings || []
        result.warnings.push(
          `Server uses protocol version '${result.negotiatedVersion}' instead of preferred '${clientVersionInfo.preferred}'`
        )
      }

      logger.info('MCP server test successful', {
        name: body.name,
        negotiatedVersion: result.negotiatedVersion,
        toolCount: result.toolCount,
      })
    } catch (error) {
      logger.warn('MCP server test failed:', error)
      result.success = false
      result.error = error instanceof Error ? error.message : 'Unknown connection error'
    } finally {
      if (client) {
        try {
          await client.disconnect()
        } catch (disconnectError) {
          logger.warn('Test client disconnect error (expected):', disconnectError)
        }
      }
    }

    return c.json({ data: result }, result.success ? 200 : 400)
  } catch (error) {
    logger.error('Error testing MCP server connection:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to test server connection' },
      500
    )
  }
})

/**
 * POST /mcp/tools/execute
 * Executes an MCP tool on a connected server.
 */
app.post('/tools/execute', async (c) => {
  const body = await c.req.json()
  const userId = getUserId(c)
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  try {
    const { serverId, toolName, arguments: rawArgs } = body
    const args = rawArgs || {}

    logger.info('MCP tool execution request received', {
      serverId,
      toolName,
      userId,
      workspaceId,
    })

    const { validateStringParam, categorizeError } = await import('@/lib/mcp/utils')

    const serverIdValidation = validateStringParam(serverId, 'serverId')
    if (!serverIdValidation.isValid) {
      return c.json({ error: (serverIdValidation as { isValid: false; error: string }).error }, 400)
    }

    const toolNameValidation = validateStringParam(toolName, 'toolName')
    if (!toolNameValidation.isValid) {
      return c.json({ error: (toolNameValidation as { isValid: false; error: string }).error }, 400)
    }

    logger.info(
      `Executing tool ${toolName} on server ${serverId} for user ${userId} in workspace ${workspaceId}`
    )

    const { mcpService } = await import('@/lib/mcp/service')

    // Validate tool and coerce argument types
    interface McpToolType {
      name: string
      description?: string
      inputSchema: {
        type?: string
        properties?: Record<string, { type?: string; [key: string]: unknown }>
        required?: string[]
      }
      serverId: string
      serverName: string
    }

    let tool: McpToolType | null = null
    try {
      if (body.toolSchema) {
        tool = {
          name: toolName,
          inputSchema: body.toolSchema,
          serverId,
          serverName: 'provided-schema',
        }
        logger.info(`Using provided schema for ${toolName}, skipping discovery`)
      } else {
        const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
        tool = (tools.find((t) => t.name === toolName) as McpToolType) ?? null

        if (!tool) {
          return c.json(
            {
              error: `Tool ${toolName} not found on server ${serverId}. Available tools: ${tools.map((t) => t.name).join(', ')}`,
            },
            404
          )
        }
      }

      // Coerce argument types based on schema
      if (tool.inputSchema?.properties) {
        for (const [paramName, paramSchema] of Object.entries(tool.inputSchema.properties)) {
          const schema = paramSchema as Record<string, unknown>
          const value = args[paramName]

          if (value === undefined || value === null) {
            continue
          }

          if (
            (schema.type === 'number' || schema.type === 'integer') &&
            typeof value === 'string'
          ) {
            const numValue =
              schema.type === 'integer'
                ? Number.parseInt(value)
                : Number.parseFloat(value)
            if (!Number.isNaN(numValue)) {
              args[paramName] = numValue
            }
          } else if (schema.type === 'boolean' && typeof value === 'string') {
            if (value.toLowerCase() === 'true') {
              args[paramName] = true
            } else if (value.toLowerCase() === 'false') {
              args[paramName] = false
            }
          } else if (schema.type === 'array' && typeof value === 'string') {
            const stringValue = value.trim()
            if (stringValue) {
              try {
                const parsed = JSON.parse(stringValue)
                if (Array.isArray(parsed)) {
                  args[paramName] = parsed
                } else {
                  args[paramName] = [parsed]
                }
              } catch {
                if (stringValue.includes(',')) {
                  args[paramName] = stringValue
                    .split(',')
                    .map((item: string) => item.trim())
                    .filter((item: string) => item)
                } else {
                  args[paramName] = [stringValue]
                }
              }
            } else {
              args[paramName] = []
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to discover tools for validation, proceeding anyway:', error)
    }

    // Validate tool arguments
    if (tool) {
      const validationError = validateToolArguments(tool, args)
      if (validationError) {
        logger.warn(`Tool validation failed: ${validationError}`)
        return c.json(
          { error: `Invalid arguments for tool ${toolName}: ${validationError}` },
          400
        )
      }
    }

    const toolCall = {
      name: toolName,
      arguments: args,
    }

    // Use execution timeout from limits module
    const { getExecutionTimeout } = await import('@/lib/core/execution-limits')
    const executionTimeout = getExecutionTimeout(undefined, 'sync')

    const result = await Promise.race([
      mcpService.executeTool(userId, serverId, toolCall, workspaceId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), executionTimeout)
      ),
    ])

    const transformedResult = transformToolResult(result)

    if (result.isError) {
      logger.warn(`Tool execution returned error for ${toolName} on ${serverId}`)
      return c.json(
        { error: transformedResult.error || 'Tool execution failed', data: transformedResult },
        400
      )
    }

    logger.info(`Successfully executed tool ${toolName} on server ${serverId}`)
    return c.json({ data: transformedResult })
  } catch (error) {
    logger.error('Error executing MCP tool:', error)

    const { categorizeError } = await import('@/lib/mcp/utils')
    const { message, status } = categorizeError(error)
    return c.json({ error: message }, status as 400 | 401 | 404 | 408 | 500)
  }
})

/**
 * GET /mcp/workflow-servers?workspaceId={id}
 * Lists workflow MCP servers for a workspace.
 */
app.get('/workflow-servers', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) {
    return c.json({ data: { servers: [] } })
  }

  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ data: { servers: [] } })
    }

    const { eq, inArray, sql } = await import('drizzle-orm')

    const servers = await db
      .select({
        id: workflowMcpServer.id,
        workspaceId: workflowMcpServer.workspaceId,
        createdBy: workflowMcpServer.createdBy,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
        isPublic: workflowMcpServer.isPublic,
        createdAt: workflowMcpServer.createdAt,
        updatedAt: workflowMcpServer.updatedAt,
        toolCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM "workflow_mcp_tool"
          WHERE "workflow_mcp_tool"."server_id" = "workflow_mcp_server"."id"
        )`.as('tool_count'),
      })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.workspaceId, workspaceId))

    const serverIds = servers.map((s: { id: string }) => s.id)
    const tools =
      serverIds.length > 0
        ? await db
            .select({
              serverId: workflowMcpTool.serverId,
              toolName: workflowMcpTool.toolName,
            })
            .from(workflowMcpTool)
            .where(inArray(workflowMcpTool.serverId, serverIds))
        : []

    const toolNamesByServer: Record<string, string[]> = {}
    for (const tool of tools) {
      if (!toolNamesByServer[tool.serverId]) {
        toolNamesByServer[tool.serverId] = []
      }
      toolNamesByServer[tool.serverId].push(tool.toolName)
    }

    const serversWithToolNames = servers.map((server: { id: string }) => ({
      ...server,
      toolNames: toolNamesByServer[server.id] || [],
    }))

    return c.json({ data: { servers: serversWithToolNames } })
  } catch (error) {
    logger.error('Error listing workflow MCP servers', error)
    return c.json({ data: { servers: [] } })
  }
})

/**
 * GET /mcp/workflow-servers/:serverId
 * Gets a single workflow MCP server with its tools.
 */
app.get('/workflow-servers/:serverId', async (c) => {
  const serverId = c.req.param('serverId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ error: 'Server not found' }, 404)
    }

    const { eq, and } = await import('drizzle-orm')

    const [server] = await db
      .select()
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
      )
      .limit(1)

    if (!server) {
      return c.json({ error: 'Server not found' }, 404)
    }

    const tools = await db
      .select()
      .from(workflowMcpTool)
      .where(eq(workflowMcpTool.serverId, serverId))

    return c.json({ data: { server, tools } })
  } catch (error) {
    logger.error(`Error fetching workflow MCP server ${serverId}`, error)
    return c.json({ error: 'Failed to fetch workflow MCP server' }, 500)
  }
})

/**
 * POST /mcp/workflow-servers
 * Creates a new workflow MCP server and optionally adds workflow tools.
 */
app.post('/workflow-servers', async (c) => {
  const body = await c.req.json()
  const userId = getUserId(c)
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info('Creating workflow MCP server', {
      name: body.name,
      workspaceId,
      workflowIds: body.workflowIds,
    })

    if (!body.name) {
      return c.json({ error: 'Missing required field: name' }, 400)
    }

    const { eq, inArray } = await import('drizzle-orm')
    const { sanitizeToolName } = await import('@/lib/mcp/workflow-tool-schema')

    const serverId = crypto.randomUUID()

    const [server] = await db
      .insert(workflowMcpServer)
      .values({
        id: serverId,
        workspaceId,
        createdBy: userId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        isPublic: body.isPublic ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    const workflowIds: string[] = body.workflowIds || []
    const addedTools: Array<{ workflowId: string; toolName: string }> = []

    if (workflowIds.length > 0) {
      const workflows = await db
        .select({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          isDeployed: workflow.isDeployed,
          workspaceId: workflow.workspaceId,
        })
        .from(workflow)
        .where(inArray(workflow.id, workflowIds))

      const { hasValidStartBlock } = await import(
        '@/lib/workflows/triggers/trigger-utils.server'
      )

      for (const workflowRecord of workflows) {
        if (workflowRecord.workspaceId !== workspaceId) {
          logger.warn(
            `Skipping workflow ${workflowRecord.id} - does not belong to workspace`
          )
          continue
        }

        if (!workflowRecord.isDeployed) {
          logger.warn(`Skipping workflow ${workflowRecord.id} - not deployed`)
          continue
        }

        const hasStartBlock = await hasValidStartBlock(workflowRecord.id)
        if (!hasStartBlock) {
          logger.warn(`Skipping workflow ${workflowRecord.id} - no start block`)
          continue
        }

        const toolName = sanitizeToolName(workflowRecord.name)
        const toolDescription =
          workflowRecord.description || `Execute ${workflowRecord.name} workflow`

        const toolId = crypto.randomUUID()
        await db.insert(workflowMcpTool).values({
          id: toolId,
          serverId,
          workflowId: workflowRecord.id,
          toolName,
          toolDescription,
          parameterSchema: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        addedTools.push({ workflowId: workflowRecord.id, toolName })
      }

      logger.info(
        `Added ${addedTools.length} tools to server ${serverId}:`,
        addedTools.map((t) => t.toolName)
      )
    }

    logger.info(
      `Successfully created workflow MCP server: ${body.name} (ID: ${serverId})`
    )

    return c.json({ data: { server, addedTools } }, 201)
  } catch (error) {
    logger.error('Error creating workflow MCP server:', error)
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create workflow MCP server',
      },
      500
    )
  }
})

/**
 * PATCH /mcp/workflow-servers/:serverId
 * Updates a workflow MCP server.
 */
app.patch('/workflow-servers/:serverId', async (c) => {
  const serverId = c.req.param('serverId')
  const body = await c.req.json()
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Updating workflow MCP server: ${serverId}`)

    const { eq, and } = await import('drizzle-orm')

    const [existingServer] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
      )
      .limit(1)

    if (!existingServer) {
      return c.json({ error: 'Server not found' }, 404)
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (body.name !== undefined) {
      updateData.name = body.name.trim()
    }
    if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null
    }
    if (body.isPublic !== undefined) {
      updateData.isPublic = body.isPublic
    }

    const [updatedServer] = await db
      .update(workflowMcpServer)
      .set(updateData)
      .where(eq(workflowMcpServer.id, serverId))
      .returning()

    logger.info(`Successfully updated workflow MCP server: ${serverId}`)
    return c.json({ data: { server: updatedServer } })
  } catch (error) {
    logger.error('Error updating workflow MCP server:', error)
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update workflow MCP server',
      },
      500
    )
  }
})

/**
 * DELETE /mcp/workflow-servers/:serverId
 * Deletes a workflow MCP server and all its tools (cascade).
 */
app.delete('/workflow-servers/:serverId', async (c) => {
  const serverId = c.req.param('serverId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Deleting workflow MCP server: ${serverId}`)

    const { eq, and } = await import('drizzle-orm')

    const [deletedServer] = await db
      .delete(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
      )
      .returning()

    if (!deletedServer) {
      return c.json({ error: 'Server not found' }, 404)
    }

    logger.info(`Successfully deleted workflow MCP server: ${serverId}`)
    return c.json({ data: { message: `Server ${serverId} deleted successfully` } })
  } catch (error) {
    logger.error('Error deleting workflow MCP server:', error)
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to delete workflow MCP server',
      },
      500
    )
  }
})

/**
 * GET /mcp/workflow-servers/:serverId/tools?workspaceId={id}
 * Gets tools for a workflow MCP server with joined workflow metadata.
 */
app.get('/workflow-servers/:serverId/tools', async (c) => {
  const serverId = c.req.param('serverId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ data: { tools: [] } })
    }

    const { eq, and } = await import('drizzle-orm')

    // Verify server belongs to workspace
    const [server] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
      )
      .limit(1)

    if (!server) {
      return c.json({ error: 'Server not found' }, 404)
    }

    const tools = await db
      .select({
        id: workflowMcpTool.id,
        serverId: workflowMcpTool.serverId,
        workflowId: workflowMcpTool.workflowId,
        toolName: workflowMcpTool.toolName,
        toolDescription: workflowMcpTool.toolDescription,
        parameterSchema: workflowMcpTool.parameterSchema,
        createdAt: workflowMcpTool.createdAt,
        updatedAt: workflowMcpTool.updatedAt,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
        isDeployed: workflow.isDeployed,
      })
      .from(workflowMcpTool)
      .leftJoin(workflow, eq(workflowMcpTool.workflowId, workflow.id))
      .where(eq(workflowMcpTool.serverId, serverId))

    return c.json({ data: { tools } })
  } catch (error) {
    logger.error(`Error fetching tools for workflow MCP server ${serverId}`, error)
    return c.json({ data: { tools: [] } })
  }
})

/**
 * POST /mcp/workflow-servers/:serverId/tools
 * Adds a workflow as a tool to a workflow MCP server.
 */
app.post('/workflow-servers/:serverId/tools', async (c) => {
  const serverId = c.req.param('serverId')
  const body = await c.req.json()
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Adding tool to workflow MCP server: ${serverId}`, {
      workflowId: body.workflowId,
    })

    if (!body.workflowId) {
      return c.json({ error: 'Missing required field: workflowId' }, 400)
    }

    const { eq, and } = await import('drizzle-orm')
    const { sanitizeToolName } = await import('@/lib/mcp/workflow-tool-schema')

    // Verify server exists and belongs to workspace
    const [server] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
      )
      .limit(1)

    if (!server) {
      return c.json({ error: 'Server not found' }, 404)
    }

    // Verify workflow exists
    const [workflowRecord] = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        isDeployed: workflow.isDeployed,
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(eq(workflow.id, body.workflowId))
      .limit(1)

    if (!workflowRecord) {
      return c.json({ error: 'Workflow not found' }, 404)
    }

    if (workflowRecord.workspaceId !== workspaceId) {
      return c.json({ error: 'Workflow does not belong to this workspace' }, 403)
    }

    if (!workflowRecord.isDeployed) {
      return c.json(
        { error: 'Workflow must be deployed before adding as a tool' },
        400
      )
    }

    // Check for valid start block
    const { hasValidStartBlock } = await import(
      '@/lib/workflows/triggers/trigger-utils.server'
    )
    const hasStartBlock = await hasValidStartBlock(body.workflowId)
    if (!hasStartBlock) {
      return c.json(
        { error: 'Workflow must have a Start block to be used as an MCP tool' },
        400
      )
    }

    // Check for duplicate
    const [existingTool] = await db
      .select({ id: workflowMcpTool.id })
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.serverId, serverId),
          eq(workflowMcpTool.workflowId, body.workflowId)
        )
      )
      .limit(1)

    if (existingTool) {
      return c.json(
        { error: 'This workflow is already added as a tool to this server' },
        409
      )
    }

    const toolName = sanitizeToolName(body.toolName?.trim() || workflowRecord.name)
    const toolDescription =
      body.toolDescription?.trim() ||
      workflowRecord.description ||
      `Execute ${workflowRecord.name} workflow`

    const toolId = crypto.randomUUID()
    const [tool] = await db
      .insert(workflowMcpTool)
      .values({
        id: toolId,
        serverId,
        workflowId: body.workflowId,
        toolName,
        toolDescription,
        parameterSchema: body.parameterSchema || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    logger.info(
      `Successfully added tool ${toolName} (workflow: ${body.workflowId}) to server ${serverId}`
    )

    return c.json({ data: { tool } }, 201)
  } catch (error) {
    logger.error('Error adding tool:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to add tool' },
      500
    )
  }
})

/**
 * PATCH /mcp/workflow-servers/:serverId/tools/:toolId
 * Updates a tool's configuration in a workflow MCP server.
 */
app.patch('/workflow-servers/:serverId/tools/:toolId', async (c) => {
  const serverId = c.req.param('serverId')
  const toolId = c.req.param('toolId')
  const body = await c.req.json()
  const workspaceId = body.workspaceId || c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Updating tool ${toolId} in server ${serverId}`)

    const { eq, and } = await import('drizzle-orm')
    const { sanitizeToolName } = await import('@/lib/mcp/workflow-tool-schema')

    // Verify server exists and belongs to workspace
    const [server] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
      )
      .limit(1)

    if (!server) {
      return c.json({ error: 'Server not found' }, 404)
    }

    // Verify tool exists and belongs to server
    const [existingTool] = await db
      .select({ id: workflowMcpTool.id })
      .from(workflowMcpTool)
      .where(and(eq(workflowMcpTool.id, toolId), eq(workflowMcpTool.serverId, serverId)))
      .limit(1)

    if (!existingTool) {
      return c.json({ error: 'Tool not found' }, 404)
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (body.toolName !== undefined) {
      updateData.toolName = sanitizeToolName(body.toolName)
    }
    if (body.toolDescription !== undefined) {
      updateData.toolDescription = body.toolDescription?.trim() || null
    }
    if (body.parameterSchema !== undefined) {
      updateData.parameterSchema = body.parameterSchema
    }

    const [updatedTool] = await db
      .update(workflowMcpTool)
      .set(updateData)
      .where(eq(workflowMcpTool.id, toolId))
      .returning()

    logger.info(`Successfully updated tool ${toolId}`)
    return c.json({ data: { tool: updatedTool } })
  } catch (error) {
    logger.error('Error updating tool:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to update tool' },
      500
    )
  }
})

/**
 * DELETE /mcp/workflow-servers/:serverId/tools/:toolId
 * Deletes a tool from a workflow MCP server.
 */
app.delete('/workflow-servers/:serverId/tools/:toolId', async (c) => {
  const serverId = c.req.param('serverId')
  const toolId = c.req.param('toolId')
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  await ensureInit()

  if (useInMemory) {
    return c.json({ error: 'Database not available' }, 503)
  }

  try {
    logger.info(`Deleting tool ${toolId} from server ${serverId}`)

    const { eq, and } = await import('drizzle-orm')

    // Verify server exists and belongs to workspace
    const [server] = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.id, serverId), eq(workflowMcpServer.workspaceId, workspaceId))
      )
      .limit(1)

    if (!server) {
      return c.json({ error: 'Server not found' }, 404)
    }

    const [deletedTool] = await db
      .delete(workflowMcpTool)
      .where(and(eq(workflowMcpTool.id, toolId), eq(workflowMcpTool.serverId, serverId)))
      .returning()

    if (!deletedTool) {
      return c.json({ error: 'Tool not found' }, 404)
    }

    logger.info(`Successfully deleted tool ${toolId}`)
    return c.json({ data: { message: `Tool ${toolId} deleted successfully` } })
  } catch (error) {
    logger.error('Error deleting tool:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to delete tool' },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

interface ToolResultContent {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
}

interface ToolResult {
  content?: ToolResultContent[]
  isError?: boolean
  [key: string]: unknown
}

interface ToolExecutionResult {
  success: boolean
  output?: ToolResult
  error?: string
}

/**
 * Transforms a raw MCP tool result into a standardized execution result.
 */
function transformToolResult(result: ToolResult): ToolExecutionResult {
  if (result.isError) {
    return {
      success: false,
      error: result.content?.[0]?.text || 'Tool execution failed',
    }
  }

  return {
    success: true,
    output: result,
  }
}

/**
 * Validates tool arguments against its input schema.
 */
function validateToolArguments(
  tool: { inputSchema?: { required?: string[]; properties?: Record<string, unknown> } },
  args: Record<string, unknown>
): string | null {
  if (!tool.inputSchema) {
    return null
  }

  const schema = tool.inputSchema

  if (schema.required && Array.isArray(schema.required)) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in (args || {}))) {
        return `Missing required property: ${requiredProp}`
      }
    }
  }

  if (schema.properties && args) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propValue = args[propName]
      if (propValue !== undefined && hasType(propSchema)) {
        const expectedType = propSchema.type
        const actualType = typeof propValue

        if (expectedType === 'string' && actualType !== 'string') {
          return `Property ${propName} must be a string`
        }
        if (expectedType === 'number' && actualType !== 'number') {
          return `Property ${propName} must be a number`
        }
        if (expectedType === 'boolean' && actualType !== 'boolean') {
          return `Property ${propName} must be a boolean`
        }
        if (
          expectedType === 'object' &&
          (actualType !== 'object' || propValue === null || Array.isArray(propValue))
        ) {
          return `Property ${propName} must be an object`
        }
        if (expectedType === 'array' && !Array.isArray(propValue)) {
          return `Property ${propName} must be an array`
        }
      }
    }
  }

  return null
}

interface SchemaProperty {
  type: string
  [key: string]: unknown
}

/**
 * Type guard to check if a value has a type property.
 */
function hasType(prop: unknown): prop is SchemaProperty {
  return typeof prop === 'object' && prop !== null && 'type' in prop
}

/**
 * MCP core tool parameter keys that are metadata, not user-entered test values.
 * These should be preserved when cleaning up params during schema updates.
 */
const MCP_TOOL_CORE_PARAMS = new Set(['serverId', 'serverUrl', 'toolName', 'serverName'])

interface StoredToolSchema {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  description?: string
  [key: string]: unknown
}

interface StoredTool {
  type: string
  title: string
  toolId: string
  params: {
    serverId: string
    serverUrl?: string
    toolName: string
    serverName?: string
    [key: string]: unknown
  }
  schema?: StoredToolSchema
  [key: string]: unknown
}

interface SyncResult {
  updatedCount: number
  updatedWorkflowIds: string[]
}

/**
 * Syncs tool schemas from discovered MCP tools to all workflow blocks using those tools.
 * Returns the count and IDs of updated workflows.
 */
async function syncToolSchemasToWorkflows(
  workspaceId: string,
  serverId: string,
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>,
  requestId: string
): Promise<SyncResult> {
  const { eq } = await import('drizzle-orm')

  await ensureInit()
  if (useInMemory || !workflowBlocks) {
    return { updatedCount: 0, updatedWorkflowIds: [] }
  }

  const toolsByName = new Map(tools.map((t) => [t.name, t]))

  const workspaceWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(eq(workflow.workspaceId, workspaceId))

  const workflowIds = workspaceWorkflows.map((w: { id: string }) => w.id)
  if (workflowIds.length === 0) return { updatedCount: 0, updatedWorkflowIds: [] }

  const agentBlocks = await db
    .select({
      id: workflowBlocks.id,
      workflowId: workflowBlocks.workflowId,
      subBlocks: workflowBlocks.subBlocks,
    })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.type, 'agent'))

  const updatedWorkflowIds = new Set<string>()

  for (const block of agentBlocks) {
    if (!workflowIds.includes(block.workflowId)) continue

    const subBlocks = block.subBlocks as Record<string, unknown> | null
    if (!subBlocks) continue

    const toolsSubBlock = subBlocks.tools as { value?: StoredTool[] } | undefined
    if (!toolsSubBlock?.value || !Array.isArray(toolsSubBlock.value)) continue

    let hasUpdates = false
    const updatedTools = toolsSubBlock.value.map((tool: StoredTool) => {
      if (tool.type !== 'mcp' || tool.params?.serverId !== serverId) {
        return tool
      }

      const freshTool = toolsByName.get(tool.params.toolName)
      if (!freshTool) return tool

      const newSchema: StoredToolSchema = {
        ...(freshTool.inputSchema as StoredToolSchema),
        description: freshTool.description,
      }

      const schemasMatch = JSON.stringify(tool.schema) === JSON.stringify(newSchema)

      if (!schemasMatch) {
        hasUpdates = true

        const validParamKeys = new Set(
          Object.keys((newSchema.properties as Record<string, unknown>) || {})
        )

        const cleanedParams: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(tool.params || {})) {
          if (MCP_TOOL_CORE_PARAMS.has(key) || validParamKeys.has(key)) {
            cleanedParams[key] = value
          }
        }

        return { ...tool, schema: newSchema, params: cleanedParams }
      }

      return tool
    })

    if (hasUpdates) {
      const updatedSubBlocks = {
        ...subBlocks,
        tools: { ...toolsSubBlock, value: updatedTools },
      }

      await db
        .update(workflowBlocks)
        .set({ subBlocks: updatedSubBlocks, updatedAt: new Date() })
        .where(eq(workflowBlocks.id, block.id))

      updatedWorkflowIds.add(block.workflowId)
    }
  }

  if (updatedWorkflowIds.size > 0) {
    logger.info(
      `Synced tool schemas to ${updatedWorkflowIds.size} workflow(s) for server ${serverId}`
    )
  }

  return {
    updatedCount: updatedWorkflowIds.size,
    updatedWorkflowIds: Array.from(updatedWorkflowIds),
  }
}

export { app as mcpRoutes }
