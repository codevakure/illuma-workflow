/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext, HandlerResult, ToolHandler } from '../sdk/types'

vi.mock('./lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock handler-loader
const mockGetHandlerForTool = vi.fn()
const mockGetIntegrationForTool = vi.fn()

vi.mock('./handler-loader', () => ({
  getHandlerForTool: (...args: unknown[]) => mockGetHandlerForTool(...args),
  getIntegrationForTool: (...args: unknown[]) => mockGetIntegrationForTool(...args),
}))

import { executeOperation, validateCredentials } from './handler-runtime'

function createCtx(overrides?: Partial<HandlerContext>): HandlerContext {
  return {
    requestId: `test-${Date.now()}`,
    ...overrides,
  }
}

describe('handler-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('executeOperation', () => {
    it('returns error when no handler found', async () => {
      mockGetHandlerForTool.mockReturnValue(undefined)

      const result = await executeOperation('nonexistent', {}, createCtx())

      expect(result.success).toBe(false)
      expect(result.error).toContain('No handler found')
    })

    it('dispatches to the correct operation by exact tool ID match', async () => {
      const operationFn = vi.fn().mockResolvedValue({
        success: true,
        output: { title: 'Test Article' },
      })

      const handler: ToolHandler = {
        operations: { wikipedia_search: operationFn },
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const params = { query: 'test' }
      const ctx = createCtx()
      const result = await executeOperation('wikipedia_search', params, ctx)

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ title: 'Test Article' })
      expect(operationFn).toHaveBeenCalledWith(params, ctx)
    })

    it('falls back to short name when exact match fails', async () => {
      const operationFn = vi.fn().mockResolvedValue({
        success: true,
        output: { data: 'ok' },
      })

      const handler: ToolHandler = {
        operations: { search: operationFn },
      }

      mockGetHandlerForTool.mockReturnValue(handler)
      mockGetIntegrationForTool.mockReturnValue('wikipedia')

      const result = await executeOperation('wikipedia_search', {}, createCtx())

      expect(result.success).toBe(true)
      expect(operationFn).toHaveBeenCalled()
    })

    it('returns error when operation not found in handler', async () => {
      const handler: ToolHandler = {
        operations: { message: vi.fn() },
      }

      mockGetHandlerForTool.mockReturnValue(handler)
      mockGetIntegrationForTool.mockReturnValue('slack')

      const result = await executeOperation('slack_upload', {}, createCtx())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Operation "slack_upload" not found')
      expect(result.error).toContain('message')
    })

    it('catches thrown errors and returns HandlerResult', async () => {
      const operationFn = vi.fn().mockRejectedValue(new Error('API rate limit exceeded'))

      const handler: ToolHandler = {
        operations: { wikipedia_search: operationFn },
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await executeOperation('wikipedia_search', {}, createCtx())

      expect(result.success).toBe(false)
      expect(result.error).toBe('API rate limit exceeded')
      expect(result.output).toEqual({})
    })

    it('catches non-Error thrown values', async () => {
      const operationFn = vi.fn().mockRejectedValue('string error')

      const handler: ToolHandler = {
        operations: { wikipedia_search: operationFn },
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await executeOperation('wikipedia_search', {}, createCtx())

      expect(result.success).toBe(false)
      expect(result.error).toBe('string error')
    })

    it('enforces timeout', async () => {
      const slowOperation = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true, output: {} }), 5000))
      )

      const handler: ToolHandler = {
        operations: { wikipedia_search: slowOperation },
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await executeOperation('wikipedia_search', {}, createCtx(), 50)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    })

    it('passes params and context to the operation', async () => {
      const operationFn = vi.fn().mockResolvedValue({ success: true, output: {} })

      const handler: ToolHandler = {
        operations: { wikipedia_search: operationFn },
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const params = { query: 'test', limit: 5 }
      const ctx = createCtx({ workspaceId: 'ws-123', apiKey: 'key-abc' })

      await executeOperation('wikipedia_search', params, ctx)

      expect(operationFn).toHaveBeenCalledWith(params, ctx)
      expect(operationFn.mock.calls[0][1].workspaceId).toBe('ws-123')
      expect(operationFn.mock.calls[0][1].apiKey).toBe('key-abc')
    })

    it('returns the full HandlerResult from the operation', async () => {
      const expectedResult: HandlerResult = {
        success: true,
        output: { results: [{ id: 1 }, { id: 2 }], total: 2 },
      }

      const operationFn = vi.fn().mockResolvedValue(expectedResult)

      const handler: ToolHandler = {
        operations: { wikipedia_search: operationFn },
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await executeOperation('wikipedia_search', {}, createCtx())

      expect(result).toEqual(expectedResult)
    })
  })

  describe('validateCredentials', () => {
    it('returns error when no handler found', async () => {
      mockGetHandlerForTool.mockReturnValue(undefined)

      const result = await validateCredentials('nonexistent', {})

      expect(result.valid).toBe(false)
      expect(result.error).toContain('No handler found')
    })

    it('returns valid when handler has no validateCredentials', async () => {
      const handler: ToolHandler = {
        operations: { search: vi.fn() },
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await validateCredentials('wikipedia_search', {})

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns valid when validateCredentials succeeds', async () => {
      const handler: ToolHandler = {
        operations: { search: vi.fn() },
        validateCredentials: vi.fn().mockResolvedValue(undefined),
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await validateCredentials('slack_message', { apiKey: 'xoxb-123' })

      expect(result.valid).toBe(true)
      expect(handler.validateCredentials).toHaveBeenCalledWith({ apiKey: 'xoxb-123' })
    })

    it('returns invalid when validateCredentials throws', async () => {
      const handler: ToolHandler = {
        operations: { search: vi.fn() },
        validateCredentials: vi.fn().mockRejectedValue(new Error('Invalid API key')),
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await validateCredentials('slack_message', { apiKey: 'bad' })

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid API key')
    })

    it('handles non-Error thrown values in validateCredentials', async () => {
      const handler: ToolHandler = {
        operations: { search: vi.fn() },
        validateCredentials: vi.fn().mockRejectedValue('string error'),
      }

      mockGetHandlerForTool.mockReturnValue(handler)

      const result = await validateCredentials('slack_message', {})

      expect(result.valid).toBe(false)
      expect(result.error).toBe('string error')
    })
  })
})
