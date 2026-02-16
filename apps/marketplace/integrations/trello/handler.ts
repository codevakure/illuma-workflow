import type { ToolHandler } from '../../sdk/types'

const BASE_URL = 'https://api.trello.com/1'

function trelloUrl(path: string, accessToken: string, apiKey: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${BASE_URL}${path}${sep}key=${apiKey}&token=${accessToken}`
}

const handler: ToolHandler = {
  operations: {
    trello_list_lists: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const apiKey = params.apiKey as string
      const boardId = params.boardId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!boardId) return { success: false, output: {}, error: 'Missing required parameter: boardId' }

      const resp = await fetch(trelloUrl(`/boards/${boardId}/lists`, accessToken, apiKey), {
        headers: { Accept: 'application/json' },
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Trello API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      if (!Array.isArray(data)) {
        return { success: false, output: { lists: [], count: 0 }, error: 'Invalid response from Trello API' }
      }

      return {
        success: true,
        output: { lists: data, count: data.length },
      }
    },

    trello_list_cards: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const apiKey = params.apiKey as string
      const boardId = params.boardId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!boardId) return { success: false, output: {}, error: 'Missing required parameter: boardId' }

      let path = `/boards/${boardId}/cards?fields=id,name,desc,url,idBoard,idList,closed,labels,due,dueComplete`
      if (params.listId) path += `&list=${params.listId}`

      const resp = await fetch(trelloUrl(path, accessToken, apiKey), {
        headers: { Accept: 'application/json' },
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Trello API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      if (!Array.isArray(data)) {
        return { success: false, output: { cards: [], count: 0 }, error: 'Invalid response from Trello API' }
      }

      return {
        success: true,
        output: { cards: data, count: data.length },
      }
    },

    trello_create_card: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const apiKey = params.apiKey as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!params.listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }
      if (!params.name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const body: Record<string, unknown> = {
        idList: params.listId,
        name: params.name,
      }
      if (params.desc) body.desc = params.desc
      if (params.pos) body.pos = params.pos
      if (params.due) body.due = params.due
      if (params.labels) body.idLabels = params.labels

      const resp = await fetch(trelloUrl('/cards', accessToken, apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Trello API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      if (!data?.id) {
        return { success: false, output: {}, error: data?.message || 'Failed to create card' }
      }

      return { success: true, output: { card: data } }
    },

    trello_update_card: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const apiKey = params.apiKey as string
      const cardId = params.cardId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!cardId) return { success: false, output: {}, error: 'Missing required parameter: cardId' }

      const body: Record<string, unknown> = {}
      if (params.name !== undefined) body.name = params.name
      if (params.desc !== undefined) body.desc = params.desc
      if (params.closed !== undefined) body.closed = params.closed
      if (params.idList !== undefined) body.idList = params.idList
      if (params.due !== undefined) body.due = params.due
      if (params.dueComplete !== undefined) body.dueComplete = params.dueComplete

      if (Object.keys(body).length === 0) {
        return { success: false, output: {}, error: 'At least one field must be provided to update' }
      }

      const resp = await fetch(trelloUrl(`/cards/${cardId}`, accessToken, apiKey), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Trello API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      if (!data?.id) {
        return { success: false, output: {}, error: data?.message || 'Failed to update card' }
      }

      return { success: true, output: { card: data } }
    },

    trello_get_actions: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const apiKey = params.apiKey as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!params.boardId && !params.cardId) {
        return { success: false, output: {}, error: 'Either boardId or cardId is required' }
      }

      const id = params.boardId || params.cardId
      const type = params.boardId ? 'boards' : 'cards'
      let path = `/${type}/${id}/actions?fields=id,type,date,memberCreator,data`
      if (params.filter) path += `&filter=${params.filter}`
      const limit = params.limit || 50
      path += `&limit=${limit}`

      const resp = await fetch(trelloUrl(path, accessToken, apiKey), {
        headers: { Accept: 'application/json' },
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Trello API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      if (!Array.isArray(data)) {
        return { success: false, output: { actions: [], count: 0 }, error: 'Invalid response from Trello API' }
      }

      return {
        success: true,
        output: { actions: data, count: data.length },
      }
    },

    trello_add_comment: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const apiKey = params.apiKey as string
      const cardId = params.cardId as string
      const text = params.text as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!cardId || !text) {
        return { success: false, output: {}, error: 'Missing required parameters: cardId and text' }
      }

      const resp = await fetch(trelloUrl(`/cards/${cardId}/actions/comments`, accessToken, apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Trello API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      if (!data?.id) {
        return { success: false, output: {}, error: data?.message || 'Failed to add comment' }
      }

      return {
        success: true,
        output: {
          comment: {
            id: data.id,
            text: data.data?.text,
            date: data.date,
            memberCreator: data.memberCreator,
          },
        },
      }
    },
  },
}

export default handler
