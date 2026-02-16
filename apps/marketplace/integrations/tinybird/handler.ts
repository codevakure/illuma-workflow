import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    tinybird_query: async (params) => {
      const baseUrl = (params.base_url as string || '').replace(/\/$/, '')
      const query = params.query as string
      const token = params.token as string

      if (!baseUrl || !query || !token) {
        return { success: false, output: {}, error: 'Missing required parameters: base_url, query, token' }
      }

      const searchParams = new URLSearchParams()
      searchParams.set('q', query)
      if (params.pipeline) {
        searchParams.set('pipeline', params.pipeline as string)
      }

      const response = await fetch(`${baseUrl}/v0/sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${token}`,
        },
        body: searchParams.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Tinybird API error: ${response.status} ${errorText}` }
      }

      const responseText = await response.text()
      const contentType = response.headers.get('content-type') || ''
      const isJson = contentType.includes('application/json') || contentType.includes('text/json')

      if (isJson) {
        const data = JSON.parse(responseText)
        return {
          success: true,
          output: {
            data: data.data || [],
            rows: data.rows || 0,
            statistics: data.statistics
              ? {
                  elapsed: data.statistics.elapsed,
                  rows_read: data.statistics.rows_read,
                  bytes_read: data.statistics.bytes_read,
                }
              : undefined,
          },
        }
      }

      return {
        success: true,
        output: {
          data: responseText,
          rows: undefined,
          statistics: undefined,
        },
      }
    },

    tinybird_events: async (params) => {
      const baseUrl = (params.base_url as string || '').replace(/\/$/, '')
      const datasource = params.datasource as string
      const data = params.data as string
      const token = params.token as string

      if (!baseUrl || !datasource || !data || !token) {
        return { success: false, output: {}, error: 'Missing required parameters: base_url, datasource, data, token' }
      }

      const url = new URL(`${baseUrl}/v0/events`)
      url.searchParams.set('name', datasource)
      if (params.wait) {
        url.searchParams.set('wait', 'true')
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      }

      if (params.format === 'json') {
        headers['Content-Type'] = 'application/json'
      } else {
        headers['Content-Type'] = 'application/x-ndjson'
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: data,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Tinybird Events API error: ${response.status} ${errorText}` }
      }

      const result = await response.json()

      return {
        success: true,
        output: {
          successful_rows: result.successful_rows ?? 0,
          quarantined_rows: result.quarantined_rows ?? 0,
        },
      }
    },
  },
}

export default handler
