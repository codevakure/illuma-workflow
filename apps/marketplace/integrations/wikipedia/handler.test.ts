/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockFetch } from '../../sdk/testing'
import handler from './handler'

const mockFetch = vi.fn()
const originalFetch = global.fetch

describe('wikipedia handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetch.mockReset()
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('wikipedia_search', () => {
    it('returns search results for a query', async () => {
      global.fetch = createMockFetch([
        {
          body: [
            'TypeScript',
            ['TypeScript', 'TypeScript (disambiguation)'],
            ['A programming language', 'Disambiguation page'],
            ['https://en.wikipedia.org/wiki/TypeScript', 'https://en.wikipedia.org/wiki/TypeScript_(disambiguation)'],
          ],
        },
      ])

      const result = await handler.operations.wikipedia_search(
        { query: 'TypeScript' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.searchResults).toHaveLength(2)
      expect(result.output.searchResults[0].title).toBe('TypeScript')
      expect(result.output.totalHits).toBe(2)
      expect(result.output.query).toBe('TypeScript')
    })

    it('returns error when query is missing', async () => {
      const result = await handler.operations.wikipedia_search({}, createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('query')
    })

    it('handles API errors', async () => {
      global.fetch = createMockFetch([{ status: 500, body: {} }])

      const result = await handler.operations.wikipedia_search(
        { query: 'test' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('500')
    })

    it('respects searchLimit parameter', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(['test', [], [], []]), { status: 200 })
      )
      global.fetch = mockFetch

      await handler.operations.wikipedia_search(
        { query: 'test', searchLimit: '5' },
        createMockContext()
      )

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('limit=5')
    })
  })

  describe('wikipedia_summary', () => {
    it('returns page summary', async () => {
      global.fetch = createMockFetch([
        {
          body: {
            type: 'standard',
            title: 'TypeScript',
            displaytitle: 'TypeScript',
            extract: 'TypeScript is a programming language.',
            pageid: 12345,
            lang: 'en',
            timestamp: '2024-01-01T00:00:00Z',
          },
        },
      ])

      const result = await handler.operations.wikipedia_summary(
        { pageTitle: 'TypeScript' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.summary.title).toBe('TypeScript')
      expect(result.output.summary.extract).toBe('TypeScript is a programming language.')
    })

    it('returns error when pageTitle is missing', async () => {
      const result = await handler.operations.wikipedia_summary({}, createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('pageTitle')
    })
  })

  describe('wikipedia_content', () => {
    it('returns page HTML content', async () => {
      const mockResponse = new Response('<html><body>Content</body></html>', {
        status: 200,
        headers: {
          etag: '"12345/abc"',
          'last-modified': '2024-01-01T00:00:00Z',
        },
      })
      mockFetch.mockResolvedValue(mockResponse)
      global.fetch = mockFetch

      const result = await handler.operations.wikipedia_content(
        { pageTitle: 'TypeScript' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.content.html).toContain('Content')
      expect(result.output.content.revision).toBe(12345)
    })

    it('returns error when pageTitle is missing', async () => {
      const result = await handler.operations.wikipedia_content({}, createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('pageTitle')
    })
  })

  describe('wikipedia_random', () => {
    it('returns a random page', async () => {
      global.fetch = createMockFetch([
        {
          body: {
            type: 'standard',
            title: 'Random Article',
            extract: 'A random Wikipedia article.',
            pageid: 99999,
            lang: 'en',
          },
        },
      ])

      const result = await handler.operations.wikipedia_random({}, createMockContext())

      expect(result.success).toBe(true)
      expect(result.output.randomPage.title).toBe('Random Article')
    })
  })
})
