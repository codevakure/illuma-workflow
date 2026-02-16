import type { ToolHandler } from '../../sdk/types'

const USER_AGENT = 'Sim/1.0 (https://sim.ai)'

const handler: ToolHandler = {
  operations: {
    wikipedia_search: async (params) => {
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const limit = Math.min(Number(params.searchLimit) || 10, 50)
      const searchParams = new URLSearchParams({
        action: 'opensearch',
        search: query,
        format: 'json',
        namespace: '0',
        limit: String(limit),
      })

      const response = await fetch(
        `https://en.wikipedia.org/w/api.php?${searchParams.toString()}`,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `Wikipedia API error: ${response.status}` }
      }

      const data = await response.json()
      const [searchTerm, titles, descriptions, urls] = data

      const searchResults = (titles as string[]).map((title: string, index: number) => ({
        id: index,
        key: title.replace(/ /g, '_'),
        title,
        excerpt: (descriptions as string[])[index] || '',
        matched_title: title,
        description: (descriptions as string[])[index] || '',
        url: (urls as string[])[index] || '',
      }))

      return {
        success: true,
        output: { searchResults, totalHits: titles.length, query: searchTerm },
      }
    },

    wikipedia_summary: async (params) => {
      const pageTitle = params.pageTitle as string
      if (!pageTitle) {
        return { success: false, output: {}, error: 'Missing required parameter: pageTitle' }
      }

      const encodedTitle = encodeURIComponent(pageTitle.replace(/ /g, '_'))
      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `Wikipedia API error: ${response.status}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          summary: {
            type: data.type || '',
            title: data.title || '',
            displaytitle: data.displaytitle || data.title || '',
            description: data.description,
            extract: data.extract || '',
            extract_html: data.extract_html,
            thumbnail: data.thumbnail,
            originalimage: data.originalimage,
            content_urls: data.content_urls || {
              desktop: { page: '', revisions: '', edit: '', talk: '' },
              mobile: { page: '', revisions: '', edit: '', talk: '' },
            },
            lang: data.lang || '',
            dir: data.dir || 'ltr',
            timestamp: data.timestamp || '',
            pageid: data.pageid || 0,
            wikibase_item: data.wikibase_item,
            coordinates: data.coordinates,
          },
        },
      }
    },

    wikipedia_content: async (params) => {
      const pageTitle = params.pageTitle as string
      if (!pageTitle) {
        return { success: false, output: {}, error: 'Missing required parameter: pageTitle' }
      }

      const encodedTitle = encodeURIComponent(pageTitle.replace(/ /g, '_'))
      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/html/${encodedTitle}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html; charset=utf-8; profile="https://www.mediawiki.org/wiki/Specs/HTML/2.1.0"',
          },
        }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `Wikipedia API error: ${response.status}` }
      }

      const html = await response.text()
      const revision = response.headers.get('etag')?.match(/^"(\d+)/)?.[1] || '0'
      const timestamp = response.headers.get('last-modified') || new Date().toISOString()

      return {
        success: true,
        output: {
          content: {
            title: '',
            pageid: 0,
            html,
            revision: parseInt(revision, 10),
            tid: response.headers.get('etag') || '',
            timestamp,
            content_model: 'wikitext',
            content_format: 'text/html',
          },
        },
      }
    },

    wikipedia_random: async () => {
      const response = await fetch(
        'https://en.wikipedia.org/api/rest_v1/page/random/summary',
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `Wikipedia API error: ${response.status}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          randomPage: {
            type: data.type || '',
            title: data.title || '',
            displaytitle: data.displaytitle || data.title || '',
            description: data.description,
            extract: data.extract || '',
            thumbnail: data.thumbnail,
            content_urls: data.content_urls || { desktop: { page: '' }, mobile: { page: '' } },
            lang: data.lang || '',
            timestamp: data.timestamp || '',
            pageid: data.pageid || 0,
          },
        },
      }
    },
  },
}

export default handler
