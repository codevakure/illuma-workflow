import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    search_tool: async (params) => {
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const numResults = Number(params.numResults) || 5
      const type = (params.type as string) || 'neural'

      const exaApiKey = process.env.EXA_API_KEY
      if (!exaApiKey) {
        return {
          success: true,
          output: {
            results: [],
            query,
            totalResults: 0,
            source: 'none',
            message: 'No search provider configured. Set EXA_API_KEY for web search.',
          },
        }
      }

      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': exaApiKey,
        },
        body: JSON.stringify({
          query,
          numResults,
          type,
          contents: { text: { maxCharacters: 3000 } },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Search API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          results: data.results || [],
          query,
          totalResults: data.results?.length || 0,
          source: 'exa',
        },
      }
    },
  },
}

export default handler
