import type { HandlerContext, HandlerResult } from './types'

/**
 * Creates a mock HandlerContext with sensible defaults for testing.
 */
export function createMockContext(overrides?: Partial<HandlerContext>): HandlerContext {
  return {
    requestId: `test-${Date.now()}`,
    ...overrides,
  }
}

/**
 * Asserts that a HandlerResult indicates success.
 */
export function expectSuccess(result: HandlerResult): void {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${result.error}`)
  }
}

/**
 * Asserts that a HandlerResult indicates failure with an optional error message check.
 */
export function expectError(result: HandlerResult, messageContains?: string): void {
  if (result.success) {
    throw new Error('Expected error but got success')
  }
  if (messageContains && result.error && !result.error.includes(messageContains)) {
    throw new Error(
      `Expected error containing "${messageContains}" but got: "${result.error}"`
    )
  }
}

/**
 * Creates a mock fetch function that returns a predefined response.
 * Useful for testing handler operations that make HTTP calls.
 */
export function createMockFetch(
  responses: Array<{
    url?: string | RegExp
    status?: number
    body?: unknown
    headers?: Record<string, string>
  }>
): typeof globalThis.fetch {
  let callIndex = 0

  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    // Try URL-based matching first
    const urlMatchedResponse = responses.find((r) => {
      if (!r.url) return false
      if (typeof r.url === 'string') return url.includes(r.url)
      return r.url.test(url)
    })

    // Fall back to sequential (responses without URL filter)
    const sequentialResponses = responses.filter((r) => !r.url)
    const sequentialResponse = sequentialResponses[callIndex]

    const matchedResponse = urlMatchedResponse ?? sequentialResponse
    if (!urlMatchedResponse) {
      callIndex++
    }

    if (!matchedResponse) {
      throw new Error(`No mock response configured for: ${url}`)
    }

    const status = matchedResponse.status ?? 200
    const body = matchedResponse.body ?? {}
    const headers = new Headers(matchedResponse.headers ?? { 'content-type': 'application/json' })

    return new Response(JSON.stringify(body), { status, headers })
  }) as typeof globalThis.fetch
}
