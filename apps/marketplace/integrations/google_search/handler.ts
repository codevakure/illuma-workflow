import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    google_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const query = params.query as string
      const searchEngineId = params.searchEngineId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!query) return { success: false, output: {}, error: 'Missing query' }
      if (!searchEngineId) return { success: false, output: {}, error: 'Missing searchEngineId' }

      const url = new URL('https://www.googleapis.com/customsearch/v1')
      url.searchParams.set('key', apiKey)
      url.searchParams.set('q', query)
      url.searchParams.set('cx', searchEngineId)
      if (params.num) url.searchParams.set('num', String(params.num))

      const response = await fetch(url.toString(), {
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Search API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          items: data.items || [],
          searchInformation: data.searchInformation || {
            totalResults: '0',
            searchTime: 0,
            formattedSearchTime: '0',
            formattedTotalResults: '0',
          },
        },
      }
    },
  },
}

export default handler
