import type { ToolHandler } from '../../sdk/types'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = 300000

const handler: ToolHandler = {
  operations: {
    firecrawl_scrape: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const url = params.url as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }

      const body: Record<string, unknown> = {
        url,
        formats:
          (params.formats as string[]) ||
          (params.scrapeOptions as Record<string, unknown>)?.formats ||
          ['markdown'],
      }

      if (typeof params.onlyMainContent === 'boolean') body.onlyMainContent = params.onlyMainContent
      if (params.includeTags) body.includeTags = params.includeTags
      if (params.excludeTags) body.excludeTags = params.excludeTags
      if (params.maxAge) body.maxAge = Number(params.maxAge)
      if (params.headers) body.headers = params.headers
      if (params.waitFor) body.waitFor = Number(params.waitFor)
      if (typeof params.mobile === 'boolean') body.mobile = params.mobile
      if (typeof params.skipTlsVerification === 'boolean')
        body.skipTlsVerification = params.skipTlsVerification
      if (params.timeout) body.timeout = Number(params.timeout)
      if (typeof params.removeBase64Images === 'boolean')
        body.removeBase64Images = params.removeBase64Images
      if (typeof params.blockAds === 'boolean') body.blockAds = params.blockAds
      if (params.proxy) body.proxy = params.proxy

      if (params.scrapeOptions) {
        const opts = params.scrapeOptions as Record<string, unknown>
        for (const [key, val] of Object.entries(opts)) {
          if (val != null && !(key in body)) {
            body[key] = val
          }
        }
      }

      const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Firecrawl API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          markdown: data.data?.markdown,
          html: data.data?.html,
          metadata: data.data?.metadata,
        },
      }
    },

    firecrawl_crawl: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const url = params.url as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }

      const body: Record<string, unknown> = {
        url,
        limit: Number(params.limit) || 100,
        scrapeOptions: (params.scrapeOptions as Record<string, unknown>) || {
          formats: (params.formats as string[]) || ['markdown'],
          onlyMainContent: params.onlyMainContent || false,
        },
      }

      if (params.maxDepth) body.maxDiscoveryDepth = Number(params.maxDepth)
      if (params.maxDiscoveryDepth) body.maxDiscoveryDepth = Number(params.maxDiscoveryDepth)
      if (params.excludePaths) body.excludePaths = params.excludePaths
      if (params.includePaths) body.includePaths = params.includePaths

      const response = await fetch('https://api.firecrawl.dev/v2/crawl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Firecrawl API error: ${response.status} ${errorText}` }
      }

      const initData = await response.json()
      const jobId = initData.jobId || initData.id

      let elapsedTime = 0
      while (elapsedTime < MAX_POLL_TIME_MS) {
        const statusResponse = await fetch(`https://api.firecrawl.dev/v2/crawl/${jobId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          return { success: false, output: {}, error: `Failed to get crawl status: ${statusResponse.statusText}` }
        }

        const crawlData = await statusResponse.json()

        if (crawlData.status === 'completed') {
          return {
            success: true,
            output: {
              pages: crawlData.data || [],
              total: crawlData.total || 0,
              creditsUsed: crawlData.creditsUsed || 0,
            },
          }
        }

        if (crawlData.status === 'failed') {
          return { success: false, output: {}, error: `Crawl job failed: ${crawlData.error || 'Unknown error'}` }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      }

      return { success: false, output: {}, error: `Crawl job did not complete within ${MAX_POLL_TIME_MS / 1000}s` }
    },

    firecrawl_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const query = params.query as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const body: Record<string, unknown> = { query }

      if (params.limit) body.limit = Number(params.limit)
      if (params.scrapeOptions) body.scrapeOptions = params.scrapeOptions

      const response = await fetch('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Firecrawl API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: { data: data.data },
      }
    },

    firecrawl_extract: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const urls = params.urls as string[]

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!urls) {
        return { success: false, output: {}, error: 'Missing required parameter: urls' }
      }

      const body: Record<string, unknown> = { urls }

      if (params.prompt) body.prompt = params.prompt
      if (params.schema) body.schema = params.schema
      if (typeof params.enableWebSearch === 'boolean') body.enableWebSearch = params.enableWebSearch
      if (typeof params.ignoreSitemap === 'boolean') body.ignoreSitemap = params.ignoreSitemap
      if (typeof params.includeSubdomains === 'boolean')
        body.includeSubdomains = params.includeSubdomains
      if (typeof params.showSources === 'boolean') body.showSources = params.showSources
      if (typeof params.ignoreInvalidURLs === 'boolean')
        body.ignoreInvalidURLs = params.ignoreInvalidURLs

      const response = await fetch('https://api.firecrawl.dev/v2/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Firecrawl API error: ${response.status} ${errorText}` }
      }

      const initData = await response.json()
      const jobId = initData.id

      let elapsedTime = 0
      while (elapsedTime < MAX_POLL_TIME_MS) {
        const statusResponse = await fetch(`https://api.firecrawl.dev/v2/extract/${jobId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          return { success: false, output: {}, error: `Failed to get extract status: ${statusResponse.statusText}` }
        }

        const extractData = await statusResponse.json()

        if (extractData.status === 'completed') {
          return {
            success: true,
            output: {
              jobId,
              success: true,
              data: extractData.data || {},
            },
          }
        }

        if (extractData.status === 'failed') {
          return { success: false, output: {}, error: `Extract job failed: ${extractData.error || 'Unknown error'}` }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      }

      return { success: false, output: {}, error: `Extract job did not complete within ${MAX_POLL_TIME_MS / 1000}s` }
    },

    firecrawl_map: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const url = params.url as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }

      const body: Record<string, unknown> = { url }

      if (params.search) body.search = params.search
      if (params.sitemap) body.sitemap = params.sitemap
      if (typeof params.includeSubdomains === 'boolean')
        body.includeSubdomains = params.includeSubdomains
      if (typeof params.ignoreQueryParameters === 'boolean')
        body.ignoreQueryParameters = params.ignoreQueryParameters
      if (params.limit) body.limit = Number(params.limit)
      if (params.timeout) body.timeout = Number(params.timeout)
      if (params.location) body.location = params.location

      const response = await fetch('https://api.firecrawl.dev/v2/map', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Firecrawl API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: data.success,
        output: {
          success: data.success,
          links: data.links || [],
        },
      }
    },

    firecrawl_agent: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const prompt = params.prompt as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!prompt) {
        return { success: false, output: {}, error: 'Missing required parameter: prompt' }
      }

      const body: Record<string, unknown> = { prompt }

      if (params.urls) {
        if (Array.isArray(params.urls)) {
          body.urls = params.urls
        } else if (typeof params.urls === 'string') {
          try {
            const parsed = JSON.parse(params.urls as string)
            body.urls = Array.isArray(parsed) ? parsed : [parsed]
          } catch {
            body.urls = [params.urls]
          }
        }
      }
      if (params.schema) body.schema = params.schema
      if (params.maxCredits) body.maxCredits = Number(params.maxCredits)
      if (typeof params.strictConstrainToURLs === 'boolean')
        body.strictConstrainToURLs = params.strictConstrainToURLs

      const response = await fetch('https://api.firecrawl.dev/v2/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Firecrawl API error: ${response.status} ${errorText}` }
      }

      const initData = await response.json()
      const jobId = initData.id

      let elapsedTime = 0
      while (elapsedTime < MAX_POLL_TIME_MS) {
        const statusResponse = await fetch(`https://api.firecrawl.dev/v2/agent/${jobId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          return { success: false, output: {}, error: `Failed to get agent status: ${statusResponse.statusText}` }
        }

        const agentData = await statusResponse.json()

        if (agentData.status === 'completed') {
          return {
            success: true,
            output: {
              jobId,
              success: true,
              status: 'completed',
              data: agentData.data || {},
              creditsUsed: agentData.creditsUsed,
              expiresAt: agentData.expiresAt,
              sources: agentData.sources,
            },
          }
        }

        if (agentData.status === 'failed') {
          return { success: false, output: {}, error: `Agent job failed: ${agentData.error || 'Unknown error'}` }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      }

      return { success: false, output: {}, error: `Agent job did not complete within ${MAX_POLL_TIME_MS / 1000}s` }
    },
  },
}

export default handler
