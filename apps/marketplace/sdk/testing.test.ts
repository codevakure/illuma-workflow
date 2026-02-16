import { describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockFetch, expectError, expectSuccess } from './testing'

describe('createMockContext', () => {
  it('returns context with default requestId', () => {
    const ctx = createMockContext()
    expect(ctx.requestId).toMatch(/^test-\d+$/)
  })

  it('accepts overrides', () => {
    const ctx = createMockContext({
      requestId: 'custom-id',
      accessToken: 'token-123',
      workspaceId: 'ws-1',
    })
    expect(ctx.requestId).toBe('custom-id')
    expect(ctx.accessToken).toBe('token-123')
    expect(ctx.workspaceId).toBe('ws-1')
  })
})

describe('expectSuccess', () => {
  it('does not throw for success result', () => {
    expect(() =>
      expectSuccess({ success: true, output: {} })
    ).not.toThrow()
  })

  it('throws for error result', () => {
    expect(() =>
      expectSuccess({ success: false, output: {}, error: 'bad' })
    ).toThrow('Expected success but got error: bad')
  })
})

describe('expectError', () => {
  it('does not throw for error result', () => {
    expect(() =>
      expectError({ success: false, output: {}, error: 'bad' })
    ).not.toThrow()
  })

  it('throws for success result', () => {
    expect(() =>
      expectError({ success: true, output: {} })
    ).toThrow('Expected error but got success')
  })

  it('checks error message contains substring', () => {
    expect(() =>
      expectError({ success: false, output: {}, error: 'Connection refused' }, 'refused')
    ).not.toThrow()

    expect(() =>
      expectError({ success: false, output: {}, error: 'Connection refused' }, 'timeout')
    ).toThrow('Expected error containing "timeout"')
  })
})

describe('createMockFetch', () => {
  it('returns mock response matching URL', async () => {
    const mockFetch = createMockFetch([
      { url: 'api.example.com', body: { data: 'test' } },
    ])

    const response = await mockFetch('https://api.example.com/endpoint')
    const json = await response.json()
    expect(json).toEqual({ data: 'test' })
  })

  it('returns mock response with custom status', async () => {
    const mockFetch = createMockFetch([
      { status: 404, body: { error: 'not found' } },
    ])

    const response = await mockFetch('https://any.com')
    expect(response.status).toBe(404)
  })

  it('supports regex URL matching', async () => {
    const mockFetch = createMockFetch([
      { url: /slack\.com\/api/, body: { ok: true } },
    ])

    const response = await mockFetch('https://slack.com/api/chat.postMessage')
    const json = await response.json()
    expect(json).toEqual({ ok: true })
  })

  it('throws for unmatched URLs when no fallback', async () => {
    const mockFetch = createMockFetch([
      { url: 'specific.com', body: {} },
    ])

    await expect(mockFetch('https://other.com')).rejects.toThrow('No mock response configured')
  })

  it('falls through to sequential responses when no URL specified', async () => {
    const mockFetch = createMockFetch([
      { body: { step: 1 } },
      { body: { step: 2 } },
    ])

    const res1 = await mockFetch('https://any.com/first')
    expect(await res1.json()).toEqual({ step: 1 })

    const res2 = await mockFetch('https://any.com/second')
    expect(await res2.json()).toEqual({ step: 2 })
  })
})
