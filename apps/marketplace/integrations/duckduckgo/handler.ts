import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    duckduckgo_search: async (params) => {
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const searchParams = new URLSearchParams({
        q: query,
        format: 'json',
        no_html: params.noHtml !== false ? '1' : '0',
        skip_disambig: params.skipDisambig ? '1' : '0',
      })

      const response = await fetch(
        `https://api.duckduckgo.com/?${searchParams.toString()}`,
        { headers: { Accept: 'application/json' } }
      )

      if (!response.ok) {
        return { success: false, output: {}, error: `DuckDuckGo API error: ${response.status}` }
      }

      const data = await response.json()

      const relatedTopics = (data.RelatedTopics || []).map((topic: Record<string, unknown>) => ({
        FirstURL: topic.FirstURL,
        Text: topic.Text,
        Result: topic.Result,
        Icon: topic.Icon
          ? {
              URL: (topic.Icon as Record<string, unknown>).URL,
              Height: (topic.Icon as Record<string, unknown>).Height,
              Width: (topic.Icon as Record<string, unknown>).Width,
            }
          : undefined,
      }))

      const results = (data.Results || []).map((result: Record<string, unknown>) => ({
        FirstURL: result.FirstURL,
        Text: result.Text,
        Result: result.Result,
        Icon: result.Icon
          ? {
              URL: (result.Icon as Record<string, unknown>).URL,
              Height: (result.Icon as Record<string, unknown>).Height,
              Width: (result.Icon as Record<string, unknown>).Width,
            }
          : undefined,
      }))

      return {
        success: true,
        output: {
          heading: data.Heading || '',
          abstract: data.Abstract || '',
          abstractText: data.AbstractText || '',
          abstractSource: data.AbstractSource || '',
          abstractURL: data.AbstractURL || '',
          image: data.Image || '',
          answer: data.Answer || '',
          answerType: data.AnswerType || '',
          type: data.Type || '',
          relatedTopics,
          results,
        },
      }
    },
  },
}

export default handler
