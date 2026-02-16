import type { ToolHandler } from '../../sdk/types'

const ZEP_API = 'https://api.getzep.com/api/v2'

function zepHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Api-Key ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

const handler: ToolHandler = {
  operations: {
    zep_add_user: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const userId = params.userId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!userId) return { success: false, output: {}, error: 'Missing userId' }

      const body: Record<string, unknown> = { user_id: userId }
      if (params.email) body.email = params.email
      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName

      if (params.metadata) {
        let metadataObj = params.metadata
        if (typeof metadataObj === 'string') {
          try { metadataObj = JSON.parse(metadataObj) } catch {
            return { success: false, output: {}, error: 'Metadata must be valid JSON' }
          }
        }
        body.metadata = metadataObj
      }

      const response = await fetch(`${ZEP_API}/users`, {
        method: 'POST',
        headers: zepHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const text = await response.text()
      if (!text || text.trim() === '') {
        return { success: true, output: {} }
      }

      const data = JSON.parse(text)
      return {
        success: true,
        output: {
          userId: data.user_id, email: data.email,
          firstName: data.first_name, lastName: data.last_name,
          uuid: data.uuid, createdAt: data.created_at, metadata: data.metadata,
        },
      }
    },

    zep_get_user: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const userId = params.userId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!userId) return { success: false, output: {}, error: 'Missing userId' }

      const response = await fetch(`${ZEP_API}/users/${userId}`, {
        headers: zepHeaders(apiKey),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          userId: data.user_id, email: data.email,
          firstName: data.first_name, lastName: data.last_name,
          uuid: data.uuid, createdAt: data.created_at, updatedAt: data.updated_at,
          metadata: data.metadata,
        },
      }
    },

    zep_create_thread: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const threadId = params.threadId as string
      const userId = params.userId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!threadId) return { success: false, output: {}, error: 'Missing threadId' }
      if (!userId) return { success: false, output: {}, error: 'Missing userId' }

      const response = await fetch(`${ZEP_API}/threads`, {
        method: 'POST',
        headers: zepHeaders(apiKey),
        body: JSON.stringify({ thread_id: threadId, user_id: userId }),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const text = await response.text()
      if (!text || text.trim() === '') {
        return { success: true, output: {} }
      }

      const data = JSON.parse(text)
      return {
        success: true,
        output: {
          threadId: data.thread_id, userId: data.user_id,
          uuid: data.uuid, createdAt: data.created_at, projectUuid: data.project_uuid,
        },
      }
    },

    zep_delete_thread: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const threadId = params.threadId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!threadId) return { success: false, output: {}, error: 'Missing threadId' }

      const response = await fetch(`${ZEP_API}/threads/${threadId}`, {
        method: 'DELETE',
        headers: zepHeaders(apiKey),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      return { success: true, output: { deleted: true } }
    },

    zep_get_threads: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }

      const queryParams = new URLSearchParams()
      queryParams.append('page_size', String(Number(params.pageSize || 10)))
      queryParams.append('page_number', String(Number(params.pageNumber || 1)))
      if (params.orderBy) queryParams.append('order_by', params.orderBy as string)
      if (params.asc !== undefined) queryParams.append('asc', String(params.asc))

      const response = await fetch(`${ZEP_API}/threads?${queryParams.toString()}`, {
        headers: zepHeaders(apiKey),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          threads: data.threads || [],
          responseCount: data.response_count,
          totalCount: data.total_count,
        },
      }
    },

    zep_get_user_threads: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const userId = params.userId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!userId) return { success: false, output: {}, error: 'Missing userId' }

      const limit = Number(params.limit || 10)
      const response = await fetch(`${ZEP_API}/users/${userId}/threads?limit=${limit}`, {
        headers: zepHeaders(apiKey),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const data = await response.json()
      const threads = data.threads || data || []

      return {
        success: true,
        output: { threads, totalCount: threads.length },
      }
    },

    zep_add_messages: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const threadId = params.threadId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!threadId) return { success: false, output: {}, error: 'Missing threadId' }

      let messagesArray = params.messages
      if (typeof messagesArray === 'string') {
        try { messagesArray = JSON.parse(messagesArray) } catch {
          return { success: false, output: {}, error: 'Messages must be a valid JSON array' }
        }
      }

      if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
        return { success: false, output: {}, error: 'Messages must be a non-empty array' }
      }

      for (const msg of messagesArray as Array<Record<string, unknown>>) {
        if (!msg.role || !msg.content) {
          return { success: false, output: {}, error: 'Each message must have role and content' }
        }
      }

      const response = await fetch(`${ZEP_API}/threads/${threadId}/messages`, {
        method: 'POST',
        headers: zepHeaders(apiKey),
        body: JSON.stringify({ messages: messagesArray }),
      })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const text = await response.text()
      if (!text || text.trim() === '') {
        return { success: true, output: { threadId, added: true, messageIds: [] } }
      }

      const data = JSON.parse(text)
      return {
        success: true,
        output: { threadId, added: true, messageIds: data.message_uuids || [] },
      }
    },

    zep_get_messages: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const threadId = params.threadId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!threadId) return { success: false, output: {}, error: 'Missing threadId' }

      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', String(Number(params.limit)))
      if (params.cursor) queryParams.append('cursor', params.cursor as string)
      if (params.lastn) queryParams.append('lastn', String(Number(params.lastn)))

      const queryString = queryParams.toString()
      const url = `${ZEP_API}/threads/${threadId}/messages${queryString ? `?${queryString}` : ''}`

      const response = await fetch(url, { headers: zepHeaders(apiKey) })

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          messages: data.messages || [],
          rowCount: data.row_count,
          totalCount: data.total_count,
        },
      }
    },

    zep_get_context: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const threadId = params.threadId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!threadId) return { success: false, output: {}, error: 'Missing threadId' }

      const queryParams = new URLSearchParams()
      queryParams.append('mode', (params.mode as string) || 'summary')
      if (params.minRating !== undefined) {
        queryParams.append('minRating', String(Number(params.minRating)))
      }

      const response = await fetch(
        `${ZEP_API}/threads/${threadId}/context?${queryParams.toString()}`,
        { headers: zepHeaders(apiKey) }
      )

      if (!response.ok) {
        const error = await response.text()
        return { success: false, output: {}, error: `Zep API error (${response.status}): ${error}` }
      }

      const data = await response.json()
      return { success: true, output: { context: data.context } }
    },
  },
}

export default handler
