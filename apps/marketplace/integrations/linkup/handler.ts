import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    linkup_search: async (params) => {
      const apiKey = params.apiKey as string
      const q = params.q as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!q) {
        return { success: false, output: {}, error: 'Missing required parameter: q' }
      }

      const body: Record<string, unknown> = {
        q,
        depth: (params.depth as string) || 'standard',
        outputType: (params.outputType as string) || 'sourcedAnswer',
      }

      if (params.includeImages !== undefined) body.includeImages = params.includeImages
      if (params.fromDate) body.fromDate = params.fromDate
      if (params.toDate) body.toDate = params.toDate

      if (params.excludeDomains) {
        body.excludeDomains = (params.excludeDomains as string)
          .split(',')
          .map((d) => d.trim())
          .filter((d) => d.length > 0)
      }

      if (params.includeDomains) {
        body.includeDomains = (params.includeDomains as string)
          .split(',')
          .map((d) => d.trim())
          .filter((d) => d.length > 0)
      }

      if (params.includeInlineCitations !== undefined)
        body.includeInlineCitations = params.includeInlineCitations
      if (params.includeSources !== undefined) body.includeSources = params.includeSources

      const response = await fetch('https://api.linkup.so/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Linkup API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: data,
      }
    },
  },
}

export default handler
