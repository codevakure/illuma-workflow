import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    perplexity_chat: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const content = params.content as string
      if (!content) {
        return { success: false, output: {}, error: 'Missing required parameter: content' }
      }

      const model = (params.model as string) || 'sonar'
      const messages: Array<{ role: string; content: string }> = []

      if (params.systemPrompt) {
        messages.push({ role: 'system', content: params.systemPrompt as string })
      }

      messages.push({ role: 'user', content })

      const body: Record<string, unknown> = {
        model,
        messages,
      }

      if (params.max_tokens !== undefined) {
        body.max_tokens = Number(params.max_tokens) || 10000
      }

      if (params.temperature !== undefined) {
        body.temperature = Number(params.temperature)
      }

      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Perplexity API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          content: data.choices[0].message.content,
          model: data.model,
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          },
        },
      }
    },

    perplexity_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const body: Record<string, unknown> = { query }

      if (params.max_results !== undefined) {
        body.max_results = Number(params.max_results)
      }

      if (params.search_domain_filter) {
        const filter = params.search_domain_filter
        body.search_domain_filter = Array.isArray(filter)
          ? filter
          : (filter as string).split(',').map((d: string) => d.trim()).filter(Boolean)
      }

      if (params.max_tokens_per_page !== undefined) {
        body.max_tokens_per_page = Number(params.max_tokens_per_page)
      }

      if (params.country) body.country = params.country
      if (params.search_recency_filter) body.search_recency_filter = params.search_recency_filter
      if (params.search_after_date) body.search_after_date = params.search_after_date
      if (params.search_before_date) body.search_before_date = params.search_before_date

      const response = await fetch('https://api.perplexity.ai/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Perplexity Search API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          results: (data.results || []).map((result: Record<string, unknown>) => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            date: result.date,
            last_updated: result.last_updated,
          })),
        },
      }
    },
  },
}

export default handler
