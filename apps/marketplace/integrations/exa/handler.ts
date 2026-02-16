import type { ToolHandler } from '../../sdk/types'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = 300000

function splitCommaSeparated(value: unknown): string[] {
  if (!value || typeof value !== 'string') return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

const handler: ToolHandler = {
  operations: {
    exa_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const body: Record<string, unknown> = { query }

      if (params.numResults) body.numResults = Number(params.numResults)
      if (params.useAutoprompt !== undefined) body.useAutoprompt = params.useAutoprompt
      if (params.type) body.type = params.type

      const includeDomains = splitCommaSeparated(params.includeDomains)
      if (includeDomains.length > 0) body.includeDomains = includeDomains

      const excludeDomains = splitCommaSeparated(params.excludeDomains)
      if (excludeDomains.length > 0) body.excludeDomains = excludeDomains

      if (params.category) body.category = params.category

      const contents: Record<string, unknown> = {}
      if (params.text !== undefined) contents.text = params.text
      if (params.highlights !== undefined) contents.highlights = params.highlights
      if (params.summary !== undefined) contents.summary = params.summary
      if (params.livecrawl) contents.livecrawl = params.livecrawl
      if (Object.keys(contents).length > 0) body.contents = contents

      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Exa Search API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          results: (data.results || []).map((result: Record<string, unknown>) => ({
            title: result.title || '',
            url: result.url,
            publishedDate: result.publishedDate,
            author: result.author,
            summary: result.summary,
            favicon: result.favicon,
            image: result.image,
            text: result.text,
            highlights: result.highlights,
            score: result.score,
          })),
        },
      }
    },

    exa_get_contents: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const urls = params.urls as string
      if (!urls) {
        return { success: false, output: {}, error: 'Missing required parameter: urls' }
      }

      const urlArray = splitCommaSeparated(urls)
      if (urlArray.length === 0) {
        return { success: false, output: {}, error: 'No valid URLs provided' }
      }

      const body: Record<string, unknown> = { urls: urlArray }

      if (params.text !== undefined) body.text = params.text

      if (params.summaryQuery) {
        body.summary = { query: params.summaryQuery }
      }

      if (params.subpages !== undefined) body.subpages = Number(params.subpages)

      const subpageTarget = splitCommaSeparated(params.subpageTarget)
      if (subpageTarget.length > 0) body.subpageTarget = subpageTarget

      if (params.highlights !== undefined) body.highlights = params.highlights
      if (params.livecrawl) body.livecrawl = params.livecrawl

      const response = await fetch('https://api.exa.ai/contents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Exa Get Contents API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          results: (data.results || []).map((result: Record<string, unknown>) => ({
            url: result.url,
            title: result.title || '',
            text: result.text || '',
            summary: result.summary || '',
            highlights: result.highlights,
          })),
        },
      }
    },

    exa_find_similar_links: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const url = params.url as string
      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }

      const body: Record<string, unknown> = { url }

      if (params.numResults) body.numResults = Number(params.numResults)

      const includeDomains = splitCommaSeparated(params.includeDomains)
      if (includeDomains.length > 0) body.includeDomains = includeDomains

      const excludeDomains = splitCommaSeparated(params.excludeDomains)
      if (excludeDomains.length > 0) body.excludeDomains = excludeDomains

      if (params.excludeSourceDomain !== undefined) body.excludeSourceDomain = params.excludeSourceDomain

      const contents: Record<string, unknown> = {}
      if (params.text !== undefined) contents.text = params.text
      if (params.highlights !== undefined) contents.highlights = params.highlights
      if (params.summary !== undefined) contents.summary = params.summary
      if (params.livecrawl) contents.livecrawl = params.livecrawl
      if (Object.keys(contents).length > 0) body.contents = contents

      const response = await fetch('https://api.exa.ai/findSimilar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Exa Find Similar API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          similarLinks: (data.results || []).map((result: Record<string, unknown>) => ({
            title: result.title || '',
            url: result.url,
            text: result.text || '',
            summary: result.summary,
            highlights: result.highlights,
            score: result.score || 0,
          })),
        },
      }
    },

    exa_answer: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const body: Record<string, unknown> = { query }
      if (params.text) body.text = params.text

      const response = await fetch('https://api.exa.ai/answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Exa Answer API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          query: data.query || '',
          answer: data.answer || '',
          citations:
            (data.citations || []).map((citation: Record<string, unknown>) => ({
              title: citation.title || '',
              url: citation.url,
              text: citation.text || '',
            })),
        },
      }
    },

    exa_research: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const body: Record<string, unknown> = { instructions: query }
      if (params.model) body.model = params.model

      // Create the research task
      const createResponse = await fetch('https://api.exa.ai/research/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!createResponse.ok) {
        const errorText = await createResponse.text().catch(() => '')
        return { success: false, output: {}, error: `Exa Research API error: ${createResponse.status} ${errorText}` }
      }

      const createData = await createResponse.json()
      const taskId = createData.researchId

      if (!taskId) {
        return { success: false, output: {}, error: 'No research task ID returned' }
      }

      // Poll for completion
      let elapsedTime = 0
      while (elapsedTime < MAX_POLL_TIME_MS) {
        const statusResponse = await fetch(`https://api.exa.ai/research/v1/${taskId}`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          return { success: false, output: {}, error: `Failed to get research task status: ${statusResponse.status}` }
        }

        const taskData = await statusResponse.json()

        if (taskData.status === 'completed') {
          const content =
            taskData.output?.content || taskData.output?.parsed || 'Research completed successfully'

          return {
            success: true,
            output: {
              research: [
                {
                  title: 'Research Complete',
                  url: '',
                  summary: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                  text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                  publishedDate: undefined,
                  author: undefined,
                  score: 1.0,
                },
              ],
            },
          }
        }

        if (taskData.status === 'failed' || taskData.status === 'canceled') {
          return {
            success: false,
            output: {},
            error: `Research task ${taskData.status}: ${taskData.error || 'Unknown error'}`,
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      }

      return {
        success: false,
        output: {},
        error: `Research task did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
      }
    },
  },
}

export default handler
