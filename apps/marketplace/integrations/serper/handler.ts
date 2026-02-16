import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    serper_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const searchType = (params.type as string) || 'search'

      const body: Record<string, unknown> = { q: query }
      if (params.num) body.num = Number(params.num)
      if (params.gl) body.gl = params.gl
      if (params.hl) body.hl = params.hl

      const response = await fetch(`https://google.serper.dev/${searchType}`, {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Serper API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      let searchResults: Array<Record<string, unknown>> = []

      if (searchType === 'news') {
        searchResults =
          (data.news || []).map((item: Record<string, unknown>, index: number) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            position: index + 1,
            date: item.date,
            imageUrl: item.imageUrl,
          }))
      } else if (searchType === 'places') {
        searchResults =
          (data.places || []).map((item: Record<string, unknown>, index: number) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            position: index + 1,
            rating: item.rating,
            reviews: item.reviews,
            address: item.address,
          }))
      } else if (searchType === 'images') {
        searchResults =
          (data.images || []).map((item: Record<string, unknown>, index: number) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            position: index + 1,
            imageUrl: item.imageUrl,
          }))
      } else {
        searchResults =
          (data.organic || []).map((item: Record<string, unknown>, index: number) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            position: index + 1,
          }))
      }

      return {
        success: true,
        output: { searchResults },
      }
    },
  },
}

export default handler
