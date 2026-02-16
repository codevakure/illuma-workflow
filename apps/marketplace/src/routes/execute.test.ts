/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('../lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock handler-loader
const mockGetHandlerForTool = vi.fn()

vi.mock('../handler-loader', () => ({
  getHandlerForTool: (...args: unknown[]) => mockGetHandlerForTool(...args),
  getIntegrationForTool: vi.fn(),
}))

// Mock handler-runtime
const mockExecuteOperation = vi.fn()
const mockValidateCredentials = vi.fn()

vi.mock('../handler-runtime', () => ({
  executeOperation: (...args: unknown[]) => mockExecuteOperation(...args),
  validateCredentials: (...args: unknown[]) => mockValidateCredentials(...args),
}))

// Mock manifest-loader
const mockGetTool = vi.fn()

vi.mock('../manifest-loader', () => ({
  manifestRegistry: {
    getTool: (...args: unknown[]) => mockGetTool(...args),
  },
}))

import { executeRoutes } from './execute'

/** Helper to make requests against the test app */
function createTestApp(): Hono {
  const app = new Hono()
  app.route('/api/marketplace', executeRoutes)
  return app
}

function request(app: Hono, method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return app.request(`http://localhost${path}`, init)
}

describe('execute routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST /tools/:toolId/execute', () => {
    it('returns 404 when no handler found', async () => {
      mockGetHandlerForTool.mockReturnValue(undefined)

      const res = await request(app, 'POST', '/api/marketplace/tools/nonexistent/execute', {
        params: {},
      })

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.success).toBe(false)
      expect(json.error).toContain('No handler found')
    })

    it('returns 400 for invalid JSON body', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: {} })

      const res = await app.request('http://localhost/api/marketplace/tools/test_tool/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{',
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Invalid JSON body')
    })

    it('executes tool and returns result with timing', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: { search: vi.fn() } })
      mockExecuteOperation.mockResolvedValue({
        success: true,
        output: { title: 'Wikipedia Article' },
      })

      const res = await request(app, 'POST', '/api/marketplace/tools/wikipedia_search/execute', {
        params: { query: 'test' },
        context: { requestId: 'req-123', workspaceId: 'ws-456' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.output.title).toBe('Wikipedia Article')
      expect(json.timing).toBeDefined()
      expect(json.timing.duration).toBeGreaterThanOrEqual(0)
      expect(json.timing.startedAt).toBeDefined()
    })

    it('passes params and context to executeOperation', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: { search: vi.fn() } })
      mockExecuteOperation.mockResolvedValue({ success: true, output: {} })

      await request(app, 'POST', '/api/marketplace/tools/wikipedia_search/execute', {
        params: { query: 'test', limit: 5 },
        context: {
          requestId: 'req-abc',
          accessToken: 'token-xyz',
          apiKey: 'key-123',
          workspaceId: 'ws-456',
          workflowId: 'wf-789',
        },
      })

      expect(mockExecuteOperation).toHaveBeenCalledWith(
        'wikipedia_search',
        { query: 'test', limit: 5 },
        expect.objectContaining({
          requestId: 'req-abc',
          accessToken: 'token-xyz',
          apiKey: 'key-123',
          workspaceId: 'ws-456',
          workflowId: 'wf-789',
        })
      )
    })

    it('uses default requestId when not provided', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: { search: vi.fn() } })
      mockExecuteOperation.mockResolvedValue({ success: true, output: {} })

      await request(app, 'POST', '/api/marketplace/tools/wikipedia_search/execute', {
        params: {},
      })

      expect(mockExecuteOperation).toHaveBeenCalledWith(
        'wikipedia_search',
        {},
        expect.objectContaining({
          requestId: expect.stringMatching(/^mkt-\d+$/),
        })
      )
    })

    it('defaults params to empty object when not provided', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: { search: vi.fn() } })
      mockExecuteOperation.mockResolvedValue({ success: true, output: {} })

      await request(app, 'POST', '/api/marketplace/tools/wikipedia_search/execute', {})

      expect(mockExecuteOperation).toHaveBeenCalledWith(
        'wikipedia_search',
        {},
        expect.any(Object)
      )
    })
  })

  describe('POST /tools/:toolId/test', () => {
    it('returns 404 when no handler found', async () => {
      mockGetHandlerForTool.mockReturnValue(undefined)

      const res = await request(app, 'POST', '/api/marketplace/tools/nonexistent/test', {})

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.success).toBe(false)
    })

    it('executes tool with test context', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: { search: vi.fn() } })
      mockExecuteOperation.mockResolvedValue({
        success: true,
        output: { result: 'test data' },
      })

      const res = await request(app, 'POST', '/api/marketplace/tools/wikipedia_search/test', {
        params: { query: 'test' },
        credentials: { apiKey: 'test-key' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.timing).toBeDefined()
    })

    it('passes credentials to context', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: { search: vi.fn() } })
      mockExecuteOperation.mockResolvedValue({ success: true, output: {} })

      await request(app, 'POST', '/api/marketplace/tools/wikipedia_search/test', {
        params: {},
        credentials: { apiKey: 'my-key', accessToken: 'my-token' },
      })

      expect(mockExecuteOperation).toHaveBeenCalledWith(
        'wikipedia_search',
        {},
        expect.objectContaining({
          apiKey: 'my-key',
          accessToken: 'my-token',
          requestId: expect.stringMatching(/^test-\d+$/),
        })
      )
    })

    it('allows empty body for testing', async () => {
      mockGetHandlerForTool.mockReturnValue({ operations: { search: vi.fn() } })
      mockExecuteOperation.mockResolvedValue({ success: true, output: {} })

      const res = await app.request('http://localhost/api/marketplace/tools/wikipedia_search/test', {
        method: 'POST',
      })

      expect(res.status).toBe(200)
    })
  })

  describe('POST /tools/:toolId/validate', () => {
    it('returns 400 for invalid JSON', async () => {
      const res = await app.request('http://localhost/api/marketplace/tools/test_tool/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.valid).toBe(false)
    })

    it('validates credentials and returns result', async () => {
      mockValidateCredentials.mockResolvedValue({ valid: true })

      const res = await request(app, 'POST', '/api/marketplace/tools/slack_message/validate', {
        credentials: { apiKey: 'xoxb-123' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.valid).toBe(true)
      expect(mockValidateCredentials).toHaveBeenCalledWith('slack_message', { apiKey: 'xoxb-123' })
    })

    it('returns invalid when validation fails', async () => {
      mockValidateCredentials.mockResolvedValue({ valid: false, error: 'Invalid API key' })

      const res = await request(app, 'POST', '/api/marketplace/tools/slack_message/validate', {
        credentials: { apiKey: 'bad' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.valid).toBe(false)
      expect(json.error).toBe('Invalid API key')
    })

    it('defaults credentials to empty object', async () => {
      mockValidateCredentials.mockResolvedValue({ valid: true })

      await request(app, 'POST', '/api/marketplace/tools/test_tool/validate', {})

      expect(mockValidateCredentials).toHaveBeenCalledWith('test_tool', {})
    })
  })

  describe('GET /tools/:toolId/schema', () => {
    it('returns 404 when tool not found', async () => {
      mockGetTool.mockReturnValue(undefined)

      const res = await request(app, 'GET', '/api/marketplace/tools/nonexistent/schema')

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.error).toContain('Tool not found')
    })

    it('returns tool schema', async () => {
      mockGetTool.mockReturnValue({
        id: 'wikipedia_search',
        name: 'Wikipedia Search',
        params: {
          query: { type: 'string', required: true, description: 'Search query' },
        },
        outputs: {
          title: { type: 'string', description: 'Article title' },
          content: { type: 'string', description: 'Article content' },
        },
      })

      const res = await request(app, 'GET', '/api/marketplace/tools/wikipedia_search/schema')

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.toolId).toBe('wikipedia_search')
      expect(json.name).toBe('Wikipedia Search')
      expect(json.params.query.type).toBe('string')
      expect(json.outputs.title.type).toBe('string')
    })

    it('defaults params and outputs to empty objects', async () => {
      mockGetTool.mockReturnValue({
        id: 'simple_tool',
        name: 'Simple Tool',
      })

      const res = await request(app, 'GET', '/api/marketplace/tools/simple_tool/schema')

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.params).toEqual({})
      expect(json.outputs).toEqual({})
    })
  })
})
