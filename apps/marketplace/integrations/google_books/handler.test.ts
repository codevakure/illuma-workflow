/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockFetch } from '../../sdk/testing'
import handler from './handler'

const SAMPLE_VOLUME = {
  id: 'abc123',
  volumeInfo: {
    title: 'TypeScript Handbook',
    subtitle: 'A Complete Guide',
    authors: ['Author One', 'Author Two'],
    publisher: 'Tech Press',
    publishedDate: '2023-01-01',
    description: 'A comprehensive guide to TypeScript.',
    pageCount: 350,
    categories: ['Computers'],
    averageRating: 4.5,
    ratingsCount: 100,
    language: 'en',
    previewLink: 'https://books.google.com/books?id=abc123',
    infoLink: 'https://books.google.com/books?id=abc123&source=gbs_api',
    imageLinks: {
      thumbnail: 'https://books.google.com/books/content?id=abc123&printsec=frontcover',
      smallThumbnail: 'https://books.google.com/books/content?id=abc123&printsec=small',
    },
    industryIdentifiers: [
      { type: 'ISBN_10', identifier: '1234567890' },
      { type: 'ISBN_13', identifier: '9781234567890' },
    ],
  },
}

const mockFetch = vi.fn()
const originalFetch = global.fetch

describe('google_books handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetch.mockReset()
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('google_books_volume_search', () => {
    it('returns search results', async () => {
      global.fetch = createMockFetch([
        {
          body: {
            totalItems: 1,
            items: [SAMPLE_VOLUME],
          },
        },
      ])

      const result = await handler.operations.google_books_volume_search(
        { query: 'TypeScript', apiKey: 'test-key' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.totalItems).toBe(1)
      expect(result.output.volumes).toHaveLength(1)
      expect(result.output.volumes[0].title).toBe('TypeScript Handbook')
      expect(result.output.volumes[0].isbn10).toBe('1234567890')
      expect(result.output.volumes[0].isbn13).toBe('9781234567890')
      expect(result.output.volumes[0].thumbnailUrl).toContain('abc123')
    })

    it('returns error when apiKey is missing', async () => {
      const result = await handler.operations.google_books_volume_search(
        { query: 'test' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('apiKey')
    })

    it('returns error when query is missing', async () => {
      const result = await handler.operations.google_books_volume_search(
        { apiKey: 'key' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('query')
    })

    it('uses apiKey from context', async () => {
      global.fetch = createMockFetch([{ body: { totalItems: 0, items: [] } }])

      const result = await handler.operations.google_books_volume_search(
        { query: 'test' },
        createMockContext({ apiKey: 'ctx-key' })
      )

      expect(result.success).toBe(true)
    })

    it('handles empty results', async () => {
      global.fetch = createMockFetch([{ body: { totalItems: 0 } }])

      const result = await handler.operations.google_books_volume_search(
        { query: 'xyznonexistent', apiKey: 'key' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.totalItems).toBe(0)
      expect(result.output.volumes).toHaveLength(0)
    })

    it('handles API errors', async () => {
      global.fetch = createMockFetch([{ status: 403, body: { error: 'Forbidden' } }])

      const result = await handler.operations.google_books_volume_search(
        { query: 'test', apiKey: 'bad-key' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('403')
    })

    it('passes optional parameters', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ totalItems: 0, items: [] }), { status: 200 })
      )
      global.fetch = mockFetch

      await handler.operations.google_books_volume_search(
        { query: 'test', apiKey: 'key', filter: 'free-ebooks', maxResults: 5, langRestrict: 'en' },
        createMockContext()
      )

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('filter=free-ebooks')
      expect(calledUrl).toContain('maxResults=5')
      expect(calledUrl).toContain('langRestrict=en')
    })
  })

  describe('google_books_volume_details', () => {
    it('returns volume details', async () => {
      global.fetch = createMockFetch([{ body: SAMPLE_VOLUME }])

      const result = await handler.operations.google_books_volume_details(
        { volumeId: 'abc123', apiKey: 'key' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.title).toBe('TypeScript Handbook')
      expect(result.output.subtitle).toBe('A Complete Guide')
      expect(result.output.authors).toEqual(['Author One', 'Author Two'])
      expect(result.output.pageCount).toBe(350)
    })

    it('returns error when apiKey is missing', async () => {
      const result = await handler.operations.google_books_volume_details(
        { volumeId: 'abc' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('apiKey')
    })

    it('returns error when volumeId is missing', async () => {
      const result = await handler.operations.google_books_volume_details(
        { apiKey: 'key' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('volumeId')
    })

    it('returns error when volume not found', async () => {
      global.fetch = createMockFetch([{ body: { id: 'abc', kind: 'books#volume' } }])

      const result = await handler.operations.google_books_volume_details(
        { volumeId: 'nonexistent', apiKey: 'key' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Volume not found')
    })

    it('handles missing optional fields gracefully', async () => {
      global.fetch = createMockFetch([{
        body: {
          id: 'minimal',
          volumeInfo: {
            title: 'Minimal Book',
          },
        },
      }])

      const result = await handler.operations.google_books_volume_details(
        { volumeId: 'minimal', apiKey: 'key' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.title).toBe('Minimal Book')
      expect(result.output.authors).toEqual([])
      expect(result.output.isbn10).toBeNull()
      expect(result.output.thumbnailUrl).toBeNull()
    })
  })
})
