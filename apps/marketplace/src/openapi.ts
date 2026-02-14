/**
 * OpenAPI specification for the Marketplace service.
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Illuma Marketplace API',
    version: '0.0.1',
    description: 'Integration marketplace service that serves block, tool, trigger, and integration manifests.',
  },
  servers: [{ url: 'http://localhost:3002', description: 'Local development' }],
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey' as const,
        in: 'header' as const,
        name: 'X-Marketplace-Key',
        description: 'Marketplace API key. Skipped when MARKETPLACE_API_KEY is not configured.',
      },
    },
  },
  security: [{ apiKey: [] }],
  paths: {
    '/': {
      get: {
        summary: 'Service info',
        tags: ['Root'],
        security: [],
        responses: {
          '200': { description: 'Service name, version, and docs link' },
        },
      },
    },

    '/api/marketplace/integrations': {
      get: {
        summary: 'List all integrations',
        tags: ['Integrations'],
        responses: {
          '200': { description: 'All integration manifests' },
          '401': { description: 'Missing API key' },
        },
      },
    },
    '/api/marketplace/integrations/{id}': {
      get: {
        summary: 'Get integration by ID',
        tags: ['Integrations'],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Integration manifest' },
          '404': { description: 'Integration not found' },
        },
      },
    },

    '/api/marketplace/blocks': {
      get: {
        summary: 'List all blocks',
        tags: ['Blocks'],
        parameters: [
          { name: 'category', in: 'query' as const, required: false, schema: { type: 'string' }, description: 'Filter by category' },
        ],
        responses: {
          '200': { description: 'Array of block manifests' },
        },
      },
    },
    '/api/marketplace/blocks/{type}': {
      get: {
        summary: 'Get block by type',
        tags: ['Blocks'],
        parameters: [{ name: 'type', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Block manifest' },
          '404': { description: 'Block not found' },
        },
      },
    },

    '/api/marketplace/tools': {
      get: {
        summary: 'List all tools',
        tags: ['Tools'],
        parameters: [
          { name: 'executionMode', in: 'query' as const, required: false, schema: { type: 'string' }, description: 'Filter by execution mode' },
        ],
        responses: {
          '200': { description: 'Array of tool manifests' },
        },
      },
    },
    '/api/marketplace/tools/{id}': {
      get: {
        summary: 'Get tool by ID',
        tags: ['Tools'],
        parameters: [{ name: 'id', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Tool manifest' },
          '404': { description: 'Tool not found' },
        },
      },
    },

    '/api/marketplace/triggers': {
      get: {
        summary: 'List all triggers',
        tags: ['Triggers'],
        responses: {
          '200': { description: 'Array of trigger manifests' },
        },
      },
    },
    '/api/marketplace/triggers/{provider}': {
      get: {
        summary: 'Get trigger by provider',
        tags: ['Triggers'],
        parameters: [{ name: 'provider', in: 'path' as const, required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Trigger manifest' },
          '404': { description: 'Trigger not found' },
        },
      },
    },

    '/api/marketplace/stats': {
      get: {
        summary: 'Manifest statistics',
        tags: ['Monitoring'],
        responses: {
          '200': { description: 'Counts of loaded manifests' },
        },
      },
    },
    '/api/marketplace/health': {
      get: {
        summary: 'Health check',
        tags: ['Monitoring'],
        security: [],
        responses: {
          '200': { description: 'Service health with manifest stats' },
        },
      },
    },
  },
} as const
