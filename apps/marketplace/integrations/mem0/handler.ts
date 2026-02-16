import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    mem0_add_memories: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const userId = params.userId as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!userId) {
        return { success: false, output: {}, error: 'Missing required parameter: userId' }
      }

      let messagesArray = params.messages
      if (typeof messagesArray === 'string') {
        try {
          messagesArray = JSON.parse(messagesArray)
        } catch {
          return { success: false, output: {}, error: 'Messages must be a valid JSON array of objects with role and content' }
        }
      }

      if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
        return { success: false, output: {}, error: 'Messages must be a non-empty array' }
      }

      for (const msg of messagesArray as Array<Record<string, unknown>>) {
        if (!msg.role || !msg.content) {
          return { success: false, output: {}, error: 'Each message must have role and content properties' }
        }
      }

      const response = await fetch('https://api.mem0.ai/v1/memories/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesArray,
          version: 'v2',
          user_id: userId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Mem0 API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      if (Array.isArray(data) && data.length === 0) {
        return { success: true, output: { memories: [] } }
      }

      if (Array.isArray(data) && data.length > 0) {
        const memoryIds = data.map((memory: Record<string, unknown>) => memory.id)
        return { success: true, output: { ids: memoryIds, memories: data } }
      }

      if (data && !Array.isArray(data) && data.id) {
        return { success: true, output: { ids: [data.id], memories: [data] } }
      }

      return { success: true, output: { memories: Array.isArray(data) ? data : [data] } }
    },

    mem0_get_memories: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const userId = params.userId as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!userId) {
        return { success: false, output: {}, error: 'Missing required parameter: userId' }
      }

      if (params.memoryId) {
        const response = await fetch(`https://api.mem0.ai/v1/memories/${params.memoryId}/`, {
          method: 'GET',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          return {
            success: false,
            output: {},
            error: `Mem0 API error: ${response.status} ${JSON.stringify(errorData)}`,
          }
        }

        const data = await response.json()
        const memories = Array.isArray(data) ? data : [data]
        const ids = memories.map((m: Record<string, unknown>) => m.id).filter(Boolean)

        return { success: true, output: { memories, ids } }
      }

      const andConditions: Array<Record<string, unknown>> = [{ user_id: userId }]

      if (params.startDate || params.endDate) {
        const dateFilter: Record<string, unknown> = {}
        if (params.startDate) dateFilter.gte = params.startDate
        if (params.endDate) dateFilter.lte = params.endDate
        andConditions.push({ created_at: dateFilter })
      }

      const body: Record<string, unknown> = {
        page_size: Number(params.limit || 10),
        filters: { AND: andConditions },
      }

      const response = await fetch('https://api.mem0.ai/v2/memories/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Mem0 API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()
      const memories = Array.isArray(data) ? data : [data]
      const ids = memories.map((m: Record<string, unknown>) => m.id).filter(Boolean)

      return { success: true, output: { memories, ids } }
    },

    mem0_search_memories: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const userId = params.userId as string
      const query = params.query as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!userId) {
        return { success: false, output: {}, error: 'Missing required parameter: userId' }
      }
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const response = await fetch('https://api.mem0.ai/v2/memories/search/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          filters: { user_id: userId },
          top_k: Number(params.limit || 10),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Mem0 API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return { success: true, output: { searchResults: [], ids: [] } }
      }

      if (Array.isArray(data)) {
        const searchResults = data.map((item: Record<string, unknown>) => ({
          id: item.id,
          memory: item.memory || '',
          user_id: item.user_id,
          agent_id: item.agent_id,
          app_id: item.app_id,
          run_id: item.run_id,
          hash: item.hash,
          metadata: item.metadata,
          categories: item.categories,
          created_at: item.created_at,
          updated_at: item.updated_at,
          score: item.score || 0,
        }))
        const ids = data.map((item: Record<string, unknown>) => item.id).filter(Boolean)
        return { success: true, output: { searchResults, ids } }
      }

      return { success: true, output: { searchResults: [], ids: [] } }
    },
  },
}

export default handler
