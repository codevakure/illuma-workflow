import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    jina_read_url: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const url = params.url as string
      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }

      // Build the Jina Reader URL
      const cleanUrl = url.replace(/^https?:\/\//, '')
      const readerUrl = `https://r.jina.ai/https://${cleanUrl}`

      // Build headers
      const jsonResponse = params.jsonResponse as boolean
      const headers: Record<string, string> = {
        Accept: jsonResponse ? 'application/json' : 'text/plain',
        Authorization: `Bearer ${apiKey}`,
      }

      if (params.useReaderLMv2 === true) {
        headers['X-Respond-With'] = 'readerlm-v2'
      }
      if (params.gatherLinks === true) {
        headers['X-With-Links-Summary'] = 'true'
      }
      if (params.withImagesummary === true) {
        headers['X-With-Images-Summary'] = 'true'
      }
      if (params.retainImages) {
        headers['X-Retain-Images'] = params.retainImages as string
      }
      if (params.returnFormat) {
        headers['X-Return-Format'] = params.returnFormat as string
      }
      if (params.withIframe === true) {
        headers['X-With-Iframe'] = 'true'
      }
      if (params.withShadowDom === true) {
        headers['X-With-Shadow-Dom'] = 'true'
      }
      if (params.withGeneratedAlt === true) {
        headers['X-With-Generated-Alt'] = 'true'
      }
      if (params.robotsTxt) {
        headers['X-Robots-Txt'] = params.robotsTxt as string
      }
      if (params.dnt === true) {
        headers.DNT = '1'
      }
      if (params.noGfm === true) {
        headers['X-No-Gfm'] = 'true'
      }
      if (params.noCache === true) {
        headers['X-No-Cache'] = 'true'
      }

      const response = await fetch(readerUrl, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Jina Reader API error: ${response.status} ${errorText}` }
      }

      const contentType = response.headers.get('content-type')

      if (contentType?.includes('application/json')) {
        const data = await response.json()
        return {
          success: true,
          output: {
            content: data.data?.content || data.content || JSON.stringify(data),
          },
        }
      }

      const content = await response.text()
      return {
        success: true,
        output: { content },
      }
    },

    jina_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const q = params.q as string
      if (!q) {
        return { success: false, output: {}, error: 'Missing required parameter: q' }
      }

      // Build search URL
      const query = encodeURIComponent(q)
      const queryParams: string[] = []

      if (params.site) {
        const sites = typeof params.site === 'string'
          ? (params.site as string).split(',')
          : params.site as string[]
        sites.forEach((s: string) => queryParams.push(`site=${encodeURIComponent(s.trim())}`))
      }

      const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : ''
      const searchUrl = `https://s.jina.ai/${query}${queryString}`

      // Build headers
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }

      if (params.withFavicon === true) headers['X-With-Favicon'] = 'true'
      if (params.withImagesummary === true) headers['X-With-Images-Summary'] = 'true'
      if (params.withLinksummary === true) headers['X-With-Links-Summary'] = 'true'
      if (params.retainImages) headers['X-Retain-Images'] = params.retainImages as string
      if (params.noCache === true) headers['X-No-Cache'] = 'true'
      if (params.withGeneratedAlt === true) headers['X-With-Generated-Alt'] = 'true'
      if (params.respondWith) headers['X-Respond-With'] = params.respondWith as string
      if (params.returnFormat || params.searchReturnFormat) {
        headers['X-Return-Format'] = (params.returnFormat || params.searchReturnFormat) as string
      }
      if (params.searchRetainImages) headers['X-Retain-Images'] = params.searchRetainImages as string
      if (params.num) headers['X-Num'] = String(params.num)

      const response = await fetch(searchUrl, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Jina Search API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      const results = Array.isArray(data) ? data : data.data || []

      return {
        success: true,
        output: {
          results: results.map((result: Record<string, unknown>) => ({
            title: result.title || '',
            description: result.description || '',
            url: result.url || '',
            content: result.content || '',
          })),
        },
      }
    },
  },
}

export default handler
