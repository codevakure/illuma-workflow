import type { ToolHandler } from '../../sdk/types'

const BASE_URL = 'https://api.cursor.com/v0'

function cursorAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
}

const handler: ToolHandler = {
  operations: {
    cursor_launch_agent: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const repository = params.repository as string
      const promptText = params.promptText as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!repository) return { success: false, output: {}, error: 'Missing required parameter: repository' }
      if (!promptText) return { success: false, output: {}, error: 'Missing required parameter: promptText' }

      const body: Record<string, any> = {
        source: { repository },
        prompt: { text: promptText },
      }

      if (params.ref) body.source.ref = params.ref
      if (params.promptImages) {
        try {
          body.prompt.images = JSON.parse(params.promptImages as string)
        } catch {
          body.prompt.images = []
        }
      }
      if (params.model) body.model = params.model

      const target: Record<string, any> = {}
      if (params.branchName) target.branchName = params.branchName
      if (typeof params.autoCreatePr === 'boolean') target.autoCreatePr = params.autoCreatePr
      if (typeof params.openAsCursorGithubApp === 'boolean') target.openAsCursorGithubApp = params.openAsCursorGithubApp
      if (typeof params.skipReviewerRequest === 'boolean') target.skipReviewerRequest = params.skipReviewerRequest
      if (Object.keys(target).length > 0) body.target = target

      const resp = await fetch(`${BASE_URL}/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: cursorAuthHeader(apiKey),
        },
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Cursor API error: ${resp.status} ${errText}` }
      }

      const data = await resp.json()
      const agentUrl = `https://cursor.com/agents?selectedBcId=${data.id}`
      return {
        success: true,
        output: {
          content: 'Agent launched successfully!',
          metadata: { id: data.id, url: agentUrl },
        },
      }
    },

    cursor_add_followup: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const agentId = params.agentId as string
      const followupPromptText = params.followupPromptText as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!agentId) return { success: false, output: {}, error: 'Missing required parameter: agentId' }
      if (!followupPromptText) return { success: false, output: {}, error: 'Missing required parameter: followupPromptText' }

      const body: Record<string, any> = {
        prompt: { text: followupPromptText },
      }

      if (params.promptImages) {
        try {
          body.prompt.images = JSON.parse(params.promptImages as string)
        } catch {
          body.prompt.images = []
        }
      }

      const resp = await fetch(`${BASE_URL}/agents/${agentId}/followup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: cursorAuthHeader(apiKey),
        },
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Cursor API error: ${resp.status} ${errText}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          content: `Follow-up added to agent ${data.id}`,
          metadata: { id: data.id },
        },
      }
    },

    cursor_get_agent: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const agentId = params.agentId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!agentId) return { success: false, output: {}, error: 'Missing required parameter: agentId' }

      const resp = await fetch(`${BASE_URL}/agents/${agentId}`, {
        method: 'GET',
        headers: { Authorization: cursorAuthHeader(apiKey) },
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Cursor API error: ${resp.status} ${errText}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          content: `Agent "${data.name}" is ${data.status}`,
          metadata: data,
        },
      }
    },

    cursor_get_conversation: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const agentId = params.agentId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!agentId) return { success: false, output: {}, error: 'Missing required parameter: agentId' }

      const resp = await fetch(`${BASE_URL}/agents/${agentId}/conversation`, {
        method: 'GET',
        headers: { Authorization: cursorAuthHeader(apiKey) },
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Cursor API error: ${resp.status} ${errText}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          content: `Retrieved ${data.messages.length} messages`,
          metadata: { id: data.id, messages: data.messages },
        },
      }
    },

    cursor_list_agents: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const url = new URL(`${BASE_URL}/agents`)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.cursor) url.searchParams.set('cursor', params.cursor as string)

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: cursorAuthHeader(apiKey) },
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Cursor API error: ${resp.status} ${errText}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          content: `Found ${data.agents.length} agents`,
          metadata: {
            agents: data.agents,
            nextCursor: data.nextCursor,
          },
        },
      }
    },

    cursor_stop_agent: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const agentId = params.agentId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!agentId) return { success: false, output: {}, error: 'Missing required parameter: agentId' }

      const resp = await fetch(`${BASE_URL}/agents/${agentId}/stop`, {
        method: 'POST',
        headers: { Authorization: cursorAuthHeader(apiKey) },
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Cursor API error: ${resp.status} ${errText}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          content: `Agent ${data.id} has been stopped`,
          metadata: { id: data.id },
        },
      }
    },

    cursor_delete_agent: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const agentId = params.agentId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!agentId) return { success: false, output: {}, error: 'Missing required parameter: agentId' }

      const resp = await fetch(`${BASE_URL}/agents/${agentId}`, {
        method: 'DELETE',
        headers: { Authorization: cursorAuthHeader(apiKey) },
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Cursor API error: ${resp.status} ${errText}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          content: `Agent ${data.id} has been deleted`,
          metadata: { id: data.id },
        },
      }
    },
  },
}

export default handler
