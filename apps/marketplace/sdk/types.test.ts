import { describe, expect, it } from 'vitest'
import type { HandlerContext, HandlerResult, OperationHandler, ToolHandler } from './types'

describe('SDK Types', () => {
  it('HandlerContext has required requestId', () => {
    const ctx: HandlerContext = { requestId: 'test-123' }
    expect(ctx.requestId).toBe('test-123')
    expect(ctx.accessToken).toBeUndefined()
    expect(ctx.apiKey).toBeUndefined()
    expect(ctx.workspaceId).toBeUndefined()
    expect(ctx.workflowId).toBeUndefined()
  })

  it('HandlerContext accepts all optional fields', () => {
    const ctx: HandlerContext = {
      requestId: 'test-123',
      accessToken: 'oauth-token',
      apiKey: 'api-key-123',
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
    }
    expect(ctx.accessToken).toBe('oauth-token')
    expect(ctx.apiKey).toBe('api-key-123')
    expect(ctx.workspaceId).toBe('ws-1')
    expect(ctx.workflowId).toBe('wf-1')
  })

  it('HandlerResult success shape', () => {
    const result: HandlerResult = {
      success: true,
      output: { message: 'sent', ts: '123' },
    }
    expect(result.success).toBe(true)
    expect(result.output.message).toBe('sent')
    expect(result.error).toBeUndefined()
  })

  it('HandlerResult error shape', () => {
    const result: HandlerResult = {
      success: false,
      output: {},
      error: 'Something went wrong',
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Something went wrong')
  })

  it('OperationHandler is an async function', async () => {
    const handler: OperationHandler = async (params, ctx) => ({
      success: true,
      output: { echo: params.message },
    })

    const result = await handler({ message: 'hello' }, { requestId: 'test' })
    expect(result.success).toBe(true)
    expect(result.output.echo).toBe('hello')
  })

  it('ToolHandler maps operations', async () => {
    const tool: ToolHandler = {
      operations: {
        send: async (params) => ({
          success: true,
          output: { sent: params.text },
        }),
        read: async () => ({
          success: true,
          output: { messages: [] },
        }),
      },
    }

    expect(Object.keys(tool.operations)).toEqual(['send', 'read'])
    const result = await tool.operations.send({ text: 'hi' }, { requestId: 'test' })
    expect(result.output.sent).toBe('hi')
  })

  it('ToolHandler supports optional validateCredentials', async () => {
    const tool: ToolHandler = {
      operations: {},
      validateCredentials: async (creds) => {
        if (!creds.apiKey) throw new Error('Missing API key')
      },
    }

    await expect(tool.validateCredentials!({})).rejects.toThrow('Missing API key')
    await expect(tool.validateCredentials!({ apiKey: 'key' })).resolves.toBeUndefined()
  })
})
