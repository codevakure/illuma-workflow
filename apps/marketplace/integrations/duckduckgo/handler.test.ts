/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockFetch } from '../../sdk/testing'
import handler from './handler'

const mockFetch = vi.fn()
const originalFetch = global.fetch

describe('duckduckgo handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetch.mockReset()
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('duckduckgo_search', () => {
    it('returns search results', async () => {
      global.fetch = createMockFetch([
        {
          body: {
            Heading: 'TypeScript',
            Abstract: 'TypeScript is a programming language.',
            AbstractText: 'TypeScript is a programming language.',
            AbstractSource: 'Wikipedia',
            AbstractURL: 'https://en.wikipedia.org/wiki/TypeScript',
            Image: 'https://example.com/image.png',
            Answer: '',
            AnswerType: '',
            Type: 'A',
            RelatedTopics: [
              {
                FirstURL: 'https://example.com/related',
                Text: 'Related topic',
                Result: '<a>Related</a>',
              },
            ],
            Results: [],
          },
        },
      ])

      const result = await handler.operations.duckduckgo_search(
        { query: 'TypeScript' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.heading).toBe('TypeScript')
      expect(result.output.abstract).toBe('TypeScript is a programming language.')
      expect(result.output.type).toBe('A')
      expect(result.output.relatedTopics).toHaveLength(1)
      expect(result.output.relatedTopics[0].Text).toBe('Related topic')
    })

    it('returns error when query is missing', async () => {
      const result = await handler.operations.duckduckgo_search({}, createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('query')
    })

    it('handles API errors', async () => {
      global.fetch = createMockFetch([{ status: 500, body: {} }])

      const result = await handler.operations.duckduckgo_search(
        { query: 'test' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('500')
    })

    it('passes noHtml and skipDisambig parameters', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ Heading: '', RelatedTopics: [], Results: [] }), { status: 200 })
      )
      global.fetch = mockFetch

      await handler.operations.duckduckgo_search(
        { query: 'test', noHtml: true, skipDisambig: true },
        createMockContext()
      )

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('no_html=1')
      expect(calledUrl).toContain('skip_disambig=1')
    })

    it('handles empty results gracefully', async () => {
      global.fetch = createMockFetch([{ body: { Heading: '', RelatedTopics: [], Results: [] } }])

      const result = await handler.operations.duckduckgo_search(
        { query: 'xyznonexistent123' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.heading).toBe('')
      expect(result.output.relatedTopics).toHaveLength(0)
    })
  })
})
