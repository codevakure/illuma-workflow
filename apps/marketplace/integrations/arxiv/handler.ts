import type { ToolHandler } from '../../sdk/types'

interface ArxivPaper {
  id: string
  title: string
  summary: string
  authors: string[]
  published: string
  updated: string
  link: string
  pdfLink: string
  categories: string[]
  primaryCategory: string
  comment?: string
  journalRef?: string
  doi?: string
}

function extractXmlValue(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`)
  const match = xml.match(regex)
  return match ? match[1].trim() : undefined
}

function extractXmlAttribute(xml: string, tagName: string, attrName: string): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*${attrName}="([^"]*)"[^>]*>`)
  const match = xml.match(regex)
  return match ? match[1] : undefined
}

function extractAuthors(entryXml: string): string[] {
  const authors: string[] = []
  const authorRegex = /<author[^>]*>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g
  let match
  while ((match = authorRegex.exec(entryXml)) !== null) {
    authors.push(match[1].trim())
  }
  return authors
}

function extractPdfLink(entryXml: string): string {
  // Match <link> with title="pdf" — attributes can appear in any order
  const pdfLinkRegex = /<link\s[^>]*title="pdf"[^>]*>/
  const linkMatch = entryXml.match(pdfLinkRegex)
  if (!linkMatch) return ''
  const hrefMatch = linkMatch[0].match(/href="([^"]*)"/)
  return hrefMatch ? hrefMatch[1] : ''
}

function extractCategories(entryXml: string): string[] {
  const categories: string[] = []
  const categoryRegex = /<category[^>]*term="([^"]*)"[^>]*>/g
  let match
  while ((match = categoryRegex.exec(entryXml)) !== null) {
    categories.push(match[1])
  }
  return categories
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function parseArxivXML(xmlText: string): ArxivPaper[] {
  const papers: ArxivPaper[] = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let match

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryXml = match[1]
    papers.push({
      id: extractXmlValue(entryXml, 'id')?.replace('http://arxiv.org/abs/', '') || '',
      title: cleanText(extractXmlValue(entryXml, 'title') || ''),
      summary: cleanText(extractXmlValue(entryXml, 'summary') || ''),
      authors: extractAuthors(entryXml),
      published: extractXmlValue(entryXml, 'published') || '',
      updated: extractXmlValue(entryXml, 'updated') || '',
      link: extractXmlValue(entryXml, 'id') || '',
      pdfLink: extractPdfLink(entryXml),
      categories: extractCategories(entryXml),
      primaryCategory: extractXmlAttribute(entryXml, 'arxiv:primary_category', 'term') || '',
      comment: extractXmlValue(entryXml, 'arxiv:comment'),
      journalRef: extractXmlValue(entryXml, 'arxiv:journal_ref'),
      doi: extractXmlValue(entryXml, 'arxiv:doi'),
    })
  }

  return papers
}

function extractTotalResults(xmlText: string): number {
  const match = xmlText.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/)
  return match ? parseInt(match[1], 10) : 0
}

const handler: ToolHandler = {
  operations: {
    arxiv_search: async (params) => {
      const searchQuery = params.searchQuery as string
      if (!searchQuery) {
        return { success: false, output: {}, error: 'Missing required parameter: searchQuery' }
      }

      const urlParams = new URLSearchParams()
      const field = params.searchField as string
      const query = field && field !== 'all' ? `${field}:${searchQuery}` : searchQuery
      urlParams.append('search_query', query)
      urlParams.append('max_results', String(Math.min(Number(params.maxResults) || 10, 2000)))
      if (params.sortBy) urlParams.append('sortBy', params.sortBy as string)
      if (params.sortOrder) urlParams.append('sortOrder', params.sortOrder as string)

      const response = await fetch(
        `https://export.arxiv.org/api/query?${urlParams.toString()}`,
        { headers: { 'Content-Type': 'application/xml' } }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `ArXiv API error: ${response.status}` }
      }

      const xmlText = await response.text()
      return {
        success: true,
        output: {
          papers: parseArxivXML(xmlText),
          totalResults: extractTotalResults(xmlText),
          query: searchQuery,
        },
      }
    },

    arxiv_get_paper: async (params) => {
      let paperId = params.paperId as string
      if (!paperId) {
        return { success: false, output: {}, error: 'Missing required parameter: paperId' }
      }

      if (paperId.includes('arxiv.org/abs/')) {
        paperId = paperId.split('arxiv.org/abs/')[1]
      }

      const urlParams = new URLSearchParams({ id_list: paperId })
      const response = await fetch(
        `https://export.arxiv.org/api/query?${urlParams.toString()}`,
        { headers: { 'Content-Type': 'application/xml' } }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `ArXiv API error: ${response.status}` }
      }

      const xmlText = await response.text()
      const papers = parseArxivXML(xmlText)

      return {
        success: true,
        output: { paper: papers[0] || null },
      }
    },

    arxiv_get_author_papers: async (params) => {
      const authorName = params.authorName as string
      if (!authorName) {
        return { success: false, output: {}, error: 'Missing required parameter: authorName' }
      }

      const urlParams = new URLSearchParams({
        search_query: `au:"${authorName}"`,
        max_results: String(Math.min(Number(params.maxResults) || 10, 2000)),
        sortBy: 'submittedDate',
        sortOrder: 'descending',
      })

      const response = await fetch(
        `https://export.arxiv.org/api/query?${urlParams.toString()}`,
        { headers: { 'Content-Type': 'application/xml' } }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `ArXiv API error: ${response.status}` }
      }

      const xmlText = await response.text()
      return {
        success: true,
        output: {
          authorPapers: parseArxivXML(xmlText),
          totalResults: extractTotalResults(xmlText),
          authorName,
        },
      }
    },
  },
}

export default handler
