# Testing Guide

Every handler should have accompanying tests. This guide covers how to write and run them.

## Running Tests

```bash
# Run all marketplace tests
cd apps/marketplace && bun test

# Run tests for a specific integration
cd apps/marketplace && bun test integrations/slack/

# Watch mode
cd apps/marketplace && bun run test:watch
```

## Writing Handler Tests

Create `handler.test.ts` next to `handler.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock fetch before importing handler
const mockFetch = vi.fn()
global.fetch = mockFetch

import handler from './handler'

describe('my_service handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('my_service_search', () => {
    it('returns results on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: '1', title: 'Test' }] }),
      })

      const result = await handler.operations.my_service_search(
        { query: 'test', apiKey: 'key-123' },
        { requestId: 'req-1' }
      )

      expect(result.success).toBe(true)
      expect(result.output.results).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.myservice.com'),
        expect.objectContaining({ headers: expect.any(Object) })
      )
    })

    it('returns error when API key is missing', async () => {
      const result = await handler.operations.my_service_search(
        { query: 'test' },
        { requestId: 'req-1' }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('API key')
    })

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limited',
      })

      const result = await handler.operations.my_service_search(
        { query: 'test', apiKey: 'key-123' },
        { requestId: 'req-1' }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('429')
    })
  })
})
```

## Test Patterns

### Mock Fetch Responses

```typescript
// Successful JSON response
mockFetch.mockResolvedValueOnce({
  ok: true,
  json: async () => ({ data: 'value' }),
})

// Successful text response
mockFetch.mockResolvedValueOnce({
  ok: true,
  text: async () => '<xml>data</xml>',
})

// Error response
mockFetch.mockResolvedValueOnce({
  ok: false,
  status: 404,
  statusText: 'Not Found',
  text: async () => 'Resource not found',
})

// Network failure
mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
```

### Testing OAuth Operations

```typescript
const result = await handler.operations.my_op(
  { param: 'value' },
  { requestId: 'req-1', accessToken: 'oauth-token-123' }
)

expect(mockFetch).toHaveBeenCalledWith(
  expect.any(String),
  expect.objectContaining({
    headers: expect.objectContaining({
      Authorization: 'Bearer oauth-token-123',
    }),
  })
)
```

### Testing All Operations

Every handler test should cover:

1. **Happy path** — valid params produce expected output
2. **Missing required params** — returns error without calling API
3. **API errors** — non-2xx status codes handled gracefully
4. **All operations** — every key in `handler.operations` has at least one test

## Marketplace UI Testing

Start the marketplace server and visit `http://localhost:3002/ui`. Find your integration and click "Test" on any tool. Fill in the parameters and execute.

This is useful for integration testing with real API endpoints (use real credentials).
