import type { ToolHandler } from '../../sdk/types'

function wfHeaders(accessToken: string, includeContentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  }
  if (includeContentType) headers['Content-Type'] = 'application/json'
  return headers
}

const handler: ToolHandler = {
  operations: {
    webflow_list_items: async (params) => {
      const accessToken = params.accessToken as string
      const collectionId = params.collectionId as string
      if (!accessToken || !collectionId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, collectionId' }
      }

      const qp = new URLSearchParams()
      if (params.offset) qp.append('offset', String(params.offset))
      if (params.limit) qp.append('limit', String(params.limit))

      const qs = qp.toString()
      const url = qs
        ? `https://api.webflow.com/v2/collections/${collectionId}/items?${qs}`
        : `https://api.webflow.com/v2/collections/${collectionId}/items`

      const response = await fetch(url, {
        headers: wfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.message || err.err || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          items: data.items || [],
          metadata: {
            itemCount: (data.items || []).length,
            offset: data.offset,
            limit: data.limit,
          },
        },
      }
    },

    webflow_get_item: async (params) => {
      const accessToken = params.accessToken as string
      const collectionId = params.collectionId as string
      const itemId = params.itemId as string
      if (!accessToken || !collectionId || !itemId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(
        `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`,
        { headers: wfHeaders(accessToken) },
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.message || err.err || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { item: data, metadata: { itemId: data.id || 'unknown' } } }
    },

    webflow_create_item: async (params) => {
      const accessToken = params.accessToken as string
      const collectionId = params.collectionId as string
      if (!accessToken || !collectionId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let fieldData: Record<string, unknown>
      try {
        fieldData = typeof params.fieldData === 'string'
          ? JSON.parse(params.fieldData as string)
          : params.fieldData as Record<string, unknown>
      } catch {
        return { success: false, output: {}, error: 'Invalid fieldData JSON' }
      }

      const response = await fetch(
        `https://api.webflow.com/v2/collections/${collectionId}/items`,
        {
          method: 'POST',
          headers: wfHeaders(accessToken, true),
          body: JSON.stringify({ fieldData }),
        },
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.message || err.err || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { item: data, metadata: { itemId: data.id || 'unknown' } } }
    },

    webflow_update_item: async (params) => {
      const accessToken = params.accessToken as string
      const collectionId = params.collectionId as string
      const itemId = params.itemId as string
      if (!accessToken || !collectionId || !itemId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let fieldData: Record<string, unknown>
      try {
        fieldData = typeof params.fieldData === 'string'
          ? JSON.parse(params.fieldData as string)
          : params.fieldData as Record<string, unknown>
      } catch {
        return { success: false, output: {}, error: 'Invalid fieldData JSON' }
      }

      const response = await fetch(
        `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`,
        {
          method: 'PATCH',
          headers: wfHeaders(accessToken, true),
          body: JSON.stringify({ fieldData }),
        },
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.message || err.err || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { item: data, metadata: { itemId: data.id || 'unknown' } } }
    },

    webflow_delete_item: async (params) => {
      const accessToken = params.accessToken as string
      const collectionId = params.collectionId as string
      const itemId = params.itemId as string
      if (!accessToken || !collectionId || !itemId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(
        `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`,
        {
          method: 'DELETE',
          headers: wfHeaders(accessToken),
        },
      )

      const isSuccess = response.status === 204 || response.ok

      if (!isSuccess) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.message || err.err || `HTTP ${response.status}` }
      }

      return { success: true, output: { success: true, metadata: { deleted: true } } }
    },
  },
}

export default handler
