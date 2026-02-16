import type { ToolHandler } from '../../sdk/types'

function splitCommaSeparated(value: unknown): string[] {
  if (!value) return []
  return String(value).split(',').map((s) => s.trim()).filter(Boolean)
}

const handler: ToolHandler = {
  operations: {
    tavily_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const body: Record<string, unknown> = { query }

      if (params.max_results) body.max_results = Number(params.max_results)
      if (params.topic) body.topic = params.topic
      if (params.search_depth) body.search_depth = params.search_depth

      if (params.include_answer && params.include_answer !== 'false' && params.include_answer !== '') {
        body.include_answer = params.include_answer === 'true' ? true : params.include_answer
      }

      if (params.include_raw_content && params.include_raw_content !== 'false' && params.include_raw_content !== '') {
        body.include_raw_content = params.include_raw_content === 'true' ? true : params.include_raw_content
      }

      if (params.include_images !== undefined) body.include_images = params.include_images
      if (params.include_image_descriptions !== undefined) body.include_image_descriptions = params.include_image_descriptions
      if (params.include_favicon !== undefined) body.include_favicon = params.include_favicon
      if (params.chunks_per_source) body.chunks_per_source = Number(params.chunks_per_source)
      if (params.time_range) body.time_range = params.time_range
      if (params.start_date) body.start_date = params.start_date
      if (params.end_date) body.end_date = params.end_date

      const includeDomains = splitCommaSeparated(params.include_domains)
      if (includeDomains.length > 0) body.include_domains = includeDomains

      const excludeDomains = splitCommaSeparated(params.exclude_domains)
      if (excludeDomains.length > 0) body.exclude_domains = excludeDomains

      if (params.country) body.country = params.country
      if (params.auto_parameters !== undefined) body.auto_parameters = params.auto_parameters

      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Tavily Search API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          query: data.query,
          results: (data.results || []).map((result: Record<string, unknown>) => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            ...(result.score !== undefined && { score: result.score }),
            ...(result.raw_content && { raw_content: result.raw_content }),
            ...(result.favicon && { favicon: result.favicon }),
          })),
          ...(data.answer && { answer: data.answer }),
          ...(data.images && { images: data.images }),
          ...(data.auto_parameters && { auto_parameters: data.auto_parameters }),
          response_time: data.response_time,
        },
      }
    },

    tavily_extract: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const urls = params.urls
      if (!urls) {
        return { success: false, output: {}, error: 'Missing required parameter: urls' }
      }

      const body: Record<string, unknown> = {
        urls: typeof urls === 'string' ? [urls] : urls,
      }

      if (params.extract_depth) body.extract_depth = params.extract_depth
      if (params.format) body.format = params.format
      if (params.include_images !== undefined) body.include_images = params.include_images
      if (params.include_favicon !== undefined) body.include_favicon = params.include_favicon

      const response = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Tavily Extract API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          results: data.results || [],
          ...(data.failed_results && { failed_results: data.failed_results }),
          response_time: data.response_time,
        },
      }
    },

    tavily_crawl: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const url = params.url as string
      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }

      const body: Record<string, unknown> = { url }

      if (params.instructions) body.instructions = params.instructions
      if (params.max_depth) body.max_depth = Number(params.max_depth)
      if (params.max_breadth) body.max_breadth = Number(params.max_breadth)
      if (params.limit) body.limit = Number(params.limit)

      const selectPaths = splitCommaSeparated(params.select_paths)
      if (selectPaths.length > 0) body.select_paths = selectPaths

      const selectDomains = splitCommaSeparated(params.select_domains)
      if (selectDomains.length > 0) body.select_domains = selectDomains

      const excludePaths = splitCommaSeparated(params.exclude_paths)
      if (excludePaths.length > 0) body.exclude_paths = excludePaths

      const excludeDomains = splitCommaSeparated(params.exclude_domains)
      if (excludeDomains.length > 0) body.exclude_domains = excludeDomains

      if (params.allow_external !== undefined) body.allow_external = params.allow_external
      if (params.include_images !== undefined) body.include_images = params.include_images
      if (params.extract_depth) body.extract_depth = params.extract_depth
      if (params.format) body.format = params.format
      if (params.include_favicon !== undefined) body.include_favicon = params.include_favicon

      const response = await fetch('https://api.tavily.com/crawl', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Tavily Crawl API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          base_url: data.base_url,
          results: data.results || [],
          response_time: data.response_time,
          ...(data.request_id && { request_id: data.request_id }),
        },
      }
    },

    tavily_map: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const url = params.url as string
      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }

      const body: Record<string, unknown> = { url }

      if (params.instructions) body.instructions = params.instructions
      if (params.max_depth) body.max_depth = Number(params.max_depth)
      if (params.max_breadth) body.max_breadth = Number(params.max_breadth)
      if (params.limit) body.limit = Number(params.limit)

      const selectPaths = splitCommaSeparated(params.select_paths)
      if (selectPaths.length > 0) body.select_paths = selectPaths

      const selectDomains = splitCommaSeparated(params.select_domains)
      if (selectDomains.length > 0) body.select_domains = selectDomains

      const excludePaths = splitCommaSeparated(params.exclude_paths)
      if (excludePaths.length > 0) body.exclude_paths = excludePaths

      const excludeDomains = splitCommaSeparated(params.exclude_domains)
      if (excludeDomains.length > 0) body.exclude_domains = excludeDomains

      if (params.allow_external !== undefined) body.allow_external = params.allow_external

      const response = await fetch('https://api.tavily.com/map', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Tavily Map API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          base_url: data.base_url,
          results: data.results || [],
          response_time: data.response_time,
          ...(data.request_id && { request_id: data.request_id }),
        },
      }
    },
  },
}

export default handler
