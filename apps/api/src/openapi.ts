/**
 * OpenAPI specification for the Illuma API service.
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Illuma API',
    version: '0.0.1',
    description: 'Core API service for workflow management, execution, and integrations.',
  },
  servers: [{ url: 'http://localhost:3001', description: 'Local development' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http' as const,
        scheme: 'bearer',
        description: 'Session-based authentication token',
      },
    },
  },
  paths: {
    // ── Health ──────────────────────────────────────────────
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['Health'],
        security: [],
        responses: { '200': { description: 'Service health status' } },
      },
    },

    // ── Workflows ──────────────────────────────────────────
    '/api/workflows': {
      get: {
        summary: 'List workflows',
        tags: ['Workflows'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'workspaceId', in: 'query' as const, required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Array of workflows' } },
      },
      post: {
        summary: 'Create workflow',
        tags: ['Workflows'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Created workflow' } },
      },
    },
    '/api/workflows/{id}': {
      get: {
        summary: 'Get workflow',
        tags: ['Workflows'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Workflow with state' } },
      },
      put: {
        summary: 'Update workflow',
        tags: ['Workflows'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated workflow' } },
      },
      delete: {
        summary: 'Delete workflow',
        tags: ['Workflows'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },

    // ── Workflow Execution ──────────────────────────────────
    '/api/workflows/{id}/execute': {
      post: {
        summary: 'Execute workflow',
        tags: ['Execution'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } },
          { name: 'stream', in: 'query' as const, required: false, schema: { type: 'boolean' }, description: 'Enable SSE streaming' },
        ],
        responses: { '200': { description: 'Execution result or SSE stream' } },
      },
    },
    '/api/workflows/{id}/log': {
      post: {
        summary: 'Persist execution log',
        tags: ['Execution'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Log persisted' } },
      },
    },
    '/api/workflows/{id}/executions/{executionId}/cancel': {
      post: {
        summary: 'Cancel execution',
        tags: ['Execution'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } },
          { name: 'executionId', in: 'path' as const, required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Execution cancelled' } },
      },
    },

    // ── Workflow State ─────────────────────────────────────
    '/api/workflows/{id}/state': {
      post: {
        summary: 'Sync workflow state',
        tags: ['Workflow State'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'State synced' } },
      },
    },

    // ── Workflow Deployment ────────────────────────────────
    '/api/workflows/{id}/deploy': {
      get: {
        summary: 'Get deployment info',
        tags: ['Deployment'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deployment status' } },
      },
      post: {
        summary: 'Deploy workflow',
        tags: ['Deployment'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deployed' } },
      },
      delete: {
        summary: 'Undeploy workflow',
        tags: ['Deployment'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Undeployed' } },
      },
    },
    '/api/workflows/{id}/deployed': {
      get: {
        summary: 'Get deployed workflow state',
        tags: ['Deployment'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deployed state' } },
      },
    },
    '/api/workflows/{id}/deployments': {
      get: {
        summary: 'List deployment versions',
        tags: ['Deployment'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Array of deployment versions' } },
      },
    },
    '/api/workflows/{id}/deployments/{version}/state': {
      get: {
        summary: 'Get state for deployment version',
        tags: ['Deployment'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } },
          { name: 'version', in: 'path' as const, required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Deployment version state' } },
      },
    },
    '/api/workflows/{id}/deployments/{version}': {
      patch: {
        summary: 'Activate deployment version',
        tags: ['Deployment'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } },
          { name: 'version', in: 'path' as const, required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Version activated' } },
      },
    },

    // ── Workflow Operations ─────────────────────────────────
    '/api/workflows/{id}/duplicate': {
      post: {
        summary: 'Duplicate workflow',
        tags: ['Workflow Operations'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Duplicated workflow' } },
      },
    },
    '/api/workflows/{id}/chat/status': {
      get: {
        summary: 'Check chat deployment status',
        tags: ['Workflow Operations'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Chat deployment status' } },
      },
    },
    '/api/workflows/{id}/form/status': {
      get: {
        summary: 'Check form deployment status',
        tags: ['Workflow Operations'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Form deployment status' } },
      },
    },
    '/api/workflows/{id}/paused': {
      get: {
        summary: 'List paused executions',
        tags: ['Workflow Operations'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Paused executions' } },
      },
    },

    // ── Workspaces ──────────────────────────────────────────
    '/api/workspaces': {
      get: {
        summary: 'List workspaces',
        tags: ['Workspaces'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Array of workspaces' } },
      },
      post: {
        summary: 'Create workspace',
        tags: ['Workspaces'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Created workspace' } },
      },
    },
    '/api/workspaces/{id}': {
      get: {
        summary: 'Get workspace',
        tags: ['Workspaces'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Workspace details' } },
      },
      put: {
        summary: 'Update workspace',
        tags: ['Workspaces'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated workspace' } },
      },
      delete: {
        summary: 'Delete workspace',
        tags: ['Workspaces'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/workspaces/{id}/environment': {
      get: {
        summary: 'Get workspace environment variables',
        tags: ['Workspaces'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Environment variables' } },
      },
    },

    // ── Users ───────────────────────────────────────────────
    '/api/users/me/settings': {
      get: {
        summary: 'Get user settings',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'User settings' } },
      },
      patch: {
        summary: 'Update user settings',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Updated settings' } },
      },
    },

    // ── Auth ────────────────────────────────────────────────
    '/api/auth/socket-token': {
      post: {
        summary: 'Get socket token',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Socket token' } },
      },
    },
    '/api/auth/oauth/token': {
      post: {
        summary: 'Exchange credential for access token',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'OAuth access token' } },
      },
      get: {
        summary: 'Get access token via query',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'credentialId', in: 'query' as const, required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OAuth access token' } },
      },
    },
    '/api/auth/oauth/credentials': {
      get: {
        summary: 'Get credentials for provider',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Credentials' } },
      },
    },
    '/api/auth/oauth/connections': {
      get: {
        summary: 'List OAuth connections',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'OAuth connections' } },
      },
    },

    // ── Providers ───────────────────────────────────────────
    '/api/providers/base/models': {
      get: {
        summary: 'List base models',
        tags: ['Providers'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Available models' } },
      },
    },
    '/api/providers/ollama/models': {
      get: {
        summary: 'List Ollama models',
        tags: ['Providers'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Ollama models' } },
      },
    },
    '/api/providers/openrouter/models': {
      get: {
        summary: 'List OpenRouter models',
        tags: ['Providers'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'OpenRouter models' } },
      },
    },

    // ── Memory ──────────────────────────────────────────────
    '/api/memory': {
      get: {
        summary: 'List memory entries',
        tags: ['Memory'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'workspaceId', in: 'query' as const, required: true, schema: { type: 'string' } },
          { name: 'query', in: 'query' as const, required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query' as const, required: false, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Memory entries' } },
      },
      post: {
        summary: 'Create/update memory entry',
        tags: ['Memory'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Upserted entry' } },
      },
    },
    '/api/memory/{key}': {
      delete: {
        summary: 'Delete memory entry',
        tags: ['Memory'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
      patch: {
        summary: 'Update memory entry',
        tags: ['Memory'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
    },

    // ── Files ───────────────────────────────────────────────
    '/api/files': {
      post: {
        summary: 'Upload file',
        tags: ['Files'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Uploaded file metadata' } },
      },
    },

    // ── Webhooks ────────────────────────────────────────────
    '/api/webhooks': {
      get: {
        summary: 'List webhooks',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'workflowId', in: 'query' as const, required: false, schema: { type: 'string' } },
          { name: 'blockId', in: 'query' as const, required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Array of webhooks' } },
      },
      post: {
        summary: 'Create webhook',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Created webhook' } },
      },
    },
    '/api/webhooks/{id}': {
      get: {
        summary: 'Get webhook',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Webhook details' } },
      },
      put: {
        summary: 'Update webhook',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated webhook' } },
      },
      delete: {
        summary: 'Delete webhook',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },

    // ── Public webhook triggers (no auth) ───────────────────
    '/api/webhooks/{path}': {
      get: {
        summary: 'Webhook trigger (GET)',
        tags: ['Webhook Triggers'],
        security: [],
        parameters: [{ name: 'path', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Trigger response' } },
      },
      post: {
        summary: 'Webhook trigger (POST)',
        tags: ['Webhook Triggers'],
        security: [],
        parameters: [{ name: 'path', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Trigger response' } },
      },
    },

    // ── Folders ─────────────────────────────────────────────
    '/api/folders': {
      get: {
        summary: 'List folders',
        tags: ['Folders'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Array of folders' } },
      },
      post: {
        summary: 'Create folder',
        tags: ['Folders'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Created folder' } },
      },
    },

    // ── Environment ─────────────────────────────────────────
    '/api/environment': {
      get: {
        summary: 'Get environment variables',
        tags: ['Environment'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Environment variables' } },
      },
      post: {
        summary: 'Set environment variable',
        tags: ['Environment'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Variable set' } },
      },
    },

    // ── Templates ───────────────────────────────────────────
    '/api/templates': {
      get: {
        summary: 'List templates',
        tags: ['Templates'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Array of templates' } },
      },
    },

    // ── Logs ────────────────────────────────────────────────
    '/api/logs': {
      get: {
        summary: 'List execution logs',
        tags: ['Logs'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Execution logs' } },
      },
    },

    // ── Credential Sets ─────────────────────────────────────
    '/api/credential-sets': {
      get: {
        summary: 'List credential sets',
        tags: ['Credential Sets'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Credential sets' } },
      },
    },

    // ── Schedules ───────────────────────────────────────────
    '/api/schedules': {
      get: {
        summary: 'List schedules',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Array of schedules' } },
      },
    },

    // ── Resume ──────────────────────────────────────────────
    '/api/resume': {
      post: {
        summary: 'Resume paused execution',
        tags: ['Resume'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Execution resumed' } },
      },
    },

    // ── Registry ────────────────────────────────────────────
    '/api/registry': {
      get: {
        summary: 'Get registry data',
        tags: ['Registry'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Registry data' } },
      },
    },

    // ── Tools ───────────────────────────────────────────────
    '/api/tools/thinking': {
      post: {
        summary: 'Thinking/reasoning tool',
        tags: ['Tools'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Thinking result' } },
      },
    },
    '/api/tools/search': {
      post: {
        summary: 'Search tool',
        tags: ['Tools'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Search results' } },
      },
    },

    // ── Knowledge ───────────────────────────────────────────
    '/api/knowledge': {
      get: {
        summary: 'List knowledge base entries',
        tags: ['Knowledge'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Knowledge entries' } },
      },
    },

    // ── Guardrails ──────────────────────────────────────────
    '/api/guardrails': {
      get: {
        summary: 'List guardrails',
        tags: ['Guardrails'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Guardrails' } },
      },
    },

    // ── MCP ─────────────────────────────────────────────────
    '/api/mcp': {
      get: {
        summary: 'MCP integration',
        tags: ['MCP'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'MCP data' } },
      },
    },

    // ── Copilot ─────────────────────────────────────────────
    '/api/copilot': {
      post: {
        summary: 'Copilot request',
        tags: ['Copilot'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Copilot response' } },
      },
    },

    // ── API Keys (stubs) ────────────────────────────────────
    '/api/users/me/api-keys': {
      get: {
        summary: 'List API keys',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Array of API keys' } },
      },
      post: {
        summary: 'Create API key',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Created API key' } },
      },
    },
    '/api/users/me/api-keys/{keyId}': {
      delete: {
        summary: 'Delete API key',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'keyId', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
  },
} as const
