/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext } from '../../sdk/testing'
import handler from './handler'

const SAMPLE_ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">42</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <published>2017-06-12T17:57:34Z</published>
    <updated>2023-08-02T00:41:18Z</updated>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
    <category term="cs.CL"/>
    <category term="cs.LG"/>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">15 pages, 5 figures</arxiv:comment>
  </entry>
</feed>`

const mockFetch = vi.fn()
const originalFetch = global.fetch

function mockFetchXml(xml: string, status = 200) {
  mockFetch.mockResolvedValue(new Response(xml, {
    status,
    headers: { 'content-type': 'application/xml' },
  }))
}

describe('arxiv handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockFetch.mockReset()
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('arxiv_search', () => {
    it('returns parsed papers from XML response', async () => {
      mockFetchXml(SAMPLE_ARXIV_XML)

      const result = await handler.operations.arxiv_search(
        { searchQuery: 'attention' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.papers).toHaveLength(1)
      expect(result.output.papers[0].title).toBe('Attention Is All You Need')
      expect(result.output.papers[0].authors).toContain('Ashish Vaswani')
      expect(result.output.papers[0].authors).toContain('Noam Shazeer')
      expect(result.output.papers[0].primaryCategory).toBe('cs.CL')
      expect(result.output.papers[0].categories).toContain('cs.CL')
      expect(result.output.papers[0].categories).toContain('cs.LG')
      expect(result.output.totalResults).toBe(42)
      expect(result.output.query).toBe('attention')
    })

    it('returns error when searchQuery is missing', async () => {
      const result = await handler.operations.arxiv_search({}, createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('searchQuery')
    })

    it('handles API errors', async () => {
      mockFetchXml('', 500)

      const result = await handler.operations.arxiv_search(
        { searchQuery: 'test' },
        createMockContext()
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('500')
    })

    it('applies search field filter', async () => {
      mockFetch.mockResolvedValue(
        new Response(SAMPLE_ARXIV_XML, { status: 200 })
      )

      await handler.operations.arxiv_search(
        { searchQuery: 'transformers', searchField: 'ti' },
        createMockContext()
      )

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('search_query=ti%3Atransformers')
    })

    it('respects maxResults parameter', async () => {
      mockFetch.mockResolvedValue(
        new Response(SAMPLE_ARXIV_XML, { status: 200 })
      )

      await handler.operations.arxiv_search(
        { searchQuery: 'test', maxResults: 5 },
        createMockContext()
      )

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('max_results=5')
    })

    it('extracts PDF link from entry', async () => {
      mockFetchXml(SAMPLE_ARXIV_XML)

      const result = await handler.operations.arxiv_search(
        { searchQuery: 'attention' },
        createMockContext()
      )

      expect(result.output.papers[0].pdfLink).toBe('http://arxiv.org/pdf/1706.03762v7')
    })
  })

  describe('arxiv_get_paper', () => {
    it('returns paper details by ID', async () => {
      mockFetchXml(SAMPLE_ARXIV_XML)

      const result = await handler.operations.arxiv_get_paper(
        { paperId: '1706.03762' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.paper).toBeDefined()
      expect(result.output.paper.title).toBe('Attention Is All You Need')
    })

    it('strips arxiv.org URL from paper ID', async () => {
      mockFetch.mockResolvedValue(
        new Response(SAMPLE_ARXIV_XML, { status: 200 })
      )

      await handler.operations.arxiv_get_paper(
        { paperId: 'https://arxiv.org/abs/1706.03762' },
        createMockContext()
      )

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('id_list=1706.03762')
    })

    it('returns error when paperId is missing', async () => {
      const result = await handler.operations.arxiv_get_paper({}, createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('paperId')
    })

    it('returns null paper when not found', async () => {
      const emptyXml = `<?xml version="1.0"?><feed></feed>`
      mockFetchXml(emptyXml)

      const result = await handler.operations.arxiv_get_paper(
        { paperId: 'nonexistent' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.paper).toBeNull()
    })
  })

  describe('arxiv_get_author_papers', () => {
    it('returns papers by author', async () => {
      mockFetchXml(SAMPLE_ARXIV_XML)

      const result = await handler.operations.arxiv_get_author_papers(
        { authorName: 'Vaswani' },
        createMockContext()
      )

      expect(result.success).toBe(true)
      expect(result.output.authorPapers).toHaveLength(1)
      expect(result.output.authorName).toBe('Vaswani')
      expect(result.output.totalResults).toBe(42)
    })

    it('returns error when authorName is missing', async () => {
      const result = await handler.operations.arxiv_get_author_papers({}, createMockContext())

      expect(result.success).toBe(false)
      expect(result.error).toContain('authorName')
    })

    it('constructs correct author search query', async () => {
      mockFetch.mockResolvedValue(
        new Response(SAMPLE_ARXIV_XML, { status: 200 })
      )

      await handler.operations.arxiv_get_author_papers(
        { authorName: 'Vaswani' },
        createMockContext()
      )

      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).toContain('search_query=au')
      expect(calledUrl).toContain('Vaswani')
      expect(calledUrl).toContain('sortBy=submittedDate')
    })
  })
})
