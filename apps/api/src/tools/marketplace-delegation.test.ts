/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Mock all dependencies that executeTool imports
vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockReturnValue('mock-token'),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-req-123'),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('http://localhost:3001'),
}))

vi.mock('@/lib/mcp/utils', () => ({
  parseMcpToolId: vi.fn(),
}))

const mockIsCustomTool = vi.fn().mockReturnValue(false)
const mockIsMcpTool = vi.fn().mockReturnValue(false)
vi.mock('@/executor/constants', () => ({
  isCustomTool: (...args: unknown[]) => mockIsCustomTool(...args),
  isMcpTool: (...args: unknown[]) => mockIsMcpTool(...args),
}))

const mockGetToolAsync = vi.fn().mockResolvedValue(null)
const mockValidateRequiredParametersAfterMerge = vi.fn()
vi.mock('@/tools/utils', () => ({
  getToolAsync: (...args: unknown[]) => mockGetToolAsync(...args),
  validateRequiredParametersAfterMerge: (...args: unknown[]) =>
    mockValidateRequiredParametersAfterMerge(...args),
}))

// Now import the function under test (after mocks are set up)
import { executeTool } from '@/tools/index'

describe('marketplace delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCustomTool.mockReturnValue(false)
    mockIsMcpTool.mockReturnValue(false)
    mockGetToolAsync.mockResolvedValue(null)
  })

  it('delegates all non-custom non-MCP tools to marketplace', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          output: { searchResults: [{ title: 'Test' }], totalHits: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await executeTool('wikipedia_search', { query: 'test' })

    expect(result.success).toBe(true)
    expect(result.output.searchResults).toHaveLength(1)
    expect(result.timing).toBeDefined()
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0)

    // Verify fetch was called to the marketplace
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/tools/wikipedia_search/execute'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  it('sends params and context to marketplace', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, output: {} }), { status: 200 })
    )
    vi.stubGlobal('fetch', mockFetch)

    await executeTool('google_books_volume_search', {
      query: 'TypeScript',
      apiKey: 'test-key',
      _context: { workspaceId: 'ws-1', workflowId: 'wf-1' },
    })

    const fetchCall = mockFetch.mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)

    // apiKey should be in context (extracted from params)
    expect(body.context.apiKey).toBe('test-key')
    expect(body.context.workspaceId).toBe('ws-1')
    expect(body.context.workflowId).toBe('wf-1')
    expect(body.context.requestId).toBe('test-req-123')

    // Params should not contain internal fields
    expect(body.params.query).toBe('TypeScript')
    expect(body.params._context).toBeUndefined()
    expect(body.params.accessToken).toBeUndefined()
    expect(body.params.credential).toBeUndefined()
  })

  it('returns error when marketplace responds with non-OK status', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404 })
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await executeTool('nonexistent_tool', { query: 'test' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('404')
    expect(result.timing).toBeDefined()
  })

  it('returns error when marketplace is unreachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

    const result = await executeTool('wikipedia_search', { query: 'test' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')
    expect(result.timing).toBeDefined()
  })

  it('handles marketplace returning success: false', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          output: {},
          error: 'Missing required parameter: query',
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await executeTool('wikipedia_search', {})

    expect(result.success).toBe(false)
    expect(result.error).toBe('Missing required parameter: query')
  })

  it('passes accessToken from params to marketplace context', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, output: {} }), { status: 200 })
    )
    vi.stubGlobal('fetch', mockFetch)

    await executeTool('slack_message', {
      accessToken: 'oauth-token-xyz',
      channel: 'general',
      message: 'hello',
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.context.accessToken).toBe('oauth-token-xyz')
    expect(body.params.accessToken).toBeUndefined()
  })

  it('uses MARKETPLACE_URL from environment', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, output: {} }), { status: 200 })
    )
    vi.stubGlobal('fetch', mockFetch)

    await executeTool('wikipedia_search', { query: 'test' })

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('localhost:3002')
  })

  it('does not delegate to marketplace for custom tools', async () => {
    mockIsCustomTool.mockReturnValue(true)
    mockGetToolAsync.mockResolvedValue(null)

    // Custom tool not found → throws "Custom tool not found"
    const result = await executeTool('custom_abc123', { input: 'test' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Custom tool not found')
  })

  it('does not delegate to marketplace for MCP tools', async () => {
    mockIsMcpTool.mockReturnValue(true)

    const { parseMcpToolId } = await import('@/lib/mcp/utils')
    ;(parseMcpToolId as Mock).mockReturnValue({ serverId: 'srv', toolName: 'tool' })

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, output: {} }), { status: 200 })
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await executeTool('mcp-server1-tool1', {
      _context: { workflowId: 'wf-1', workspaceId: 'ws-1' },
    })

    // Verify no marketplace URL was called
    const marketplaceCalls = mockFetch.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes('/api/marketplace/')
    )
    expect(marketplaceCalls).toHaveLength(0)
  })

  it('normalizes tool IDs before marketplace delegation', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, output: {} }), { status: 200 })
    )
    vi.stubGlobal('fetch', mockFetch)

    await executeTool('knowledge_search_abc123-def456', { query: 'test' })

    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('/knowledge_search/')
    expect(calledUrl).not.toContain('abc123')
  })
})
