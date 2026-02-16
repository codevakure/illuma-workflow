import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    clay_populate: async (params) => {
      const webhookURL = params.webhookURL as string
      if (!webhookURL) {
        return { success: false, output: {}, error: 'Missing required parameter: webhookURL' }
      }
      if (!params.data) {
        return { success: false, output: {}, error: 'Missing required parameter: data' }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      const authToken = params.authToken as string | undefined
      if (authToken && authToken.trim() !== '') {
        headers['x-clay-webhook-auth'] = authToken
      }

      const response = await fetch(webhookURL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: params.data }),
      })

      const contentType = response.headers.get('content-type')
      const timestamp = new Date().toISOString()

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      let responseData: unknown
      if (contentType?.includes('application/json')) {
        responseData = await response.json()
      } else {
        responseData = await response.text()
      }

      return {
        success: true,
        output: {
          data: contentType?.includes('application/json')
            ? responseData
            : { message: responseData },
          metadata: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            timestamp,
            contentType: contentType || 'unknown',
          },
        },
      }
    },
  },
}

export default handler
