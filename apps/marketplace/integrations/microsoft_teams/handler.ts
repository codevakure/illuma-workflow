import type { ToolHandler } from '../../sdk/types'

const MS_GRAPH = 'https://graph.microsoft.com/v1.0'

const handler: ToolHandler = {
  operations: {
    microsoft_teams_read_channel: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      const channelId = params.channelId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!teamId || !channelId) return { success: false, output: {}, error: 'Missing teamId or channelId' }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          messages: (data.value || []).map((m: Record<string, unknown>) => ({
            id: m.id,
            content: (m.body as Record<string, unknown>)?.content ?? '',
            createdDateTime: m.createdDateTime,
            from: m.from,
            webUrl: m.webUrl,
          })),
        },
      }
    },

    microsoft_teams_read_chat: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const chatId = params.chatId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!chatId) return { success: false, output: {}, error: 'Missing chatId' }

      const url = `${MS_GRAPH}/chats/${encodeURIComponent(chatId)}/messages`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          messages: (data.value || []).map((m: Record<string, unknown>) => ({
            id: m.id,
            content: (m.body as Record<string, unknown>)?.content ?? '',
            createdDateTime: m.createdDateTime,
            from: m.from,
            webUrl: m.webUrl,
          })),
        },
      }
    },

    microsoft_teams_get_message: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!teamId || !channelId || !messageId) return { success: false, output: {}, error: 'Missing teamId, channelId, or messageId' }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          id: data.id,
          content: data.body?.content ?? '',
          createdDateTime: data.createdDateTime,
          from: data.from,
          webUrl: data.webUrl,
        },
      }
    },

    microsoft_teams_write_channel: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      const channelId = params.channelId as string
      const content = params.content as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!teamId || !channelId) return { success: false, output: {}, error: 'Missing teamId or channelId' }
      if (!content) return { success: false, output: {}, error: 'Missing content' }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { content } }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          updatedContent: true,
          metadata: {
            messageId: data.id,
            teamId: data.channelIdentity?.teamId || teamId,
            channelId: data.channelIdentity?.channelId || channelId,
            content: data.body?.content || content,
            createdTime: data.createdDateTime || new Date().toISOString(),
            url: data.webUrl || '',
          },
        },
      }
    },

    microsoft_teams_write_chat: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const chatId = params.chatId as string
      const content = params.content as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!chatId) return { success: false, output: {}, error: 'Missing chatId' }
      if (!content) return { success: false, output: {}, error: 'Missing content' }

      const url = `${MS_GRAPH}/chats/${encodeURIComponent(chatId)}/messages`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { content } }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          updatedContent: true,
          metadata: {
            messageId: data.id,
            chatId: data.chatId || chatId,
            content: data.body?.content || content,
            createdTime: data.createdDateTime || new Date().toISOString(),
            url: data.webUrl || '',
          },
        },
      }
    },

    microsoft_teams_reply_to_message: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      const content = params.content as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!teamId || !channelId || !messageId || !content) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/replies`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { content } }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          messageId: data.id,
          content: data.body?.content || content,
          createdDateTime: data.createdDateTime,
        },
      }
    },

    microsoft_teams_update_channel_message: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      const content = params.content as string
      if (!accessToken || !teamId || !channelId || !messageId || !content) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { content } }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return { success: true, output: { messageId: data.id, content: data.body?.content } }
    },

    microsoft_teams_update_chat_message: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const chatId = params.chatId as string
      const messageId = params.messageId as string
      const content = params.content as string
      if (!accessToken || !chatId || !messageId || !content) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${MS_GRAPH}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { content } }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return { success: true, output: { messageId: data.id, content: data.body?.content } }
    },

    microsoft_teams_delete_chat_message: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const chatId = params.chatId as string
      const messageId = params.messageId as string
      if (!accessToken || !chatId || !messageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const meResponse = await fetch(`${MS_GRAPH}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!meResponse.ok) return { success: false, output: {}, error: 'Failed to get user information' }
      const userData = await meResponse.json()
      const userId = userData.id

      const deleteUrl = `${MS_GRAPH}/users/${encodeURIComponent(userId)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/softDelete`
      const deleteResponse = await fetch(deleteUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!deleteResponse.ok) {
        const err = await deleteResponse.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || 'Failed to delete message' }
      }

      return { success: true, output: { deleted: true, messageId, metadata: { messageId, chatId } } }
    },

    microsoft_teams_delete_channel_message: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      if (!accessToken || !teamId || !channelId || !messageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/softDelete`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || 'Failed to delete message' }
      }

      return { success: true, output: { deleted: true, messageId, metadata: { messageId, teamId, channelId } } }
    },

    microsoft_teams_set_reaction: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const chatId = params.chatId as string
      const messageId = params.messageId as string
      const reactionType = params.reactionType as string
      if (!accessToken || !chatId || !messageId || !reactionType) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${MS_GRAPH}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/setReaction`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactionType }),
      })
      if (!response.ok && response.status !== 204) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || 'Failed to set reaction' }
      }
      return { success: true, output: { reactionSet: true, reactionType, messageId } }
    },

    microsoft_teams_unset_reaction: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const chatId = params.chatId as string
      const messageId = params.messageId as string
      const reactionType = params.reactionType as string
      if (!accessToken || !chatId || !messageId || !reactionType) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${MS_GRAPH}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/unsetReaction`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactionType }),
      })
      if (!response.ok && response.status !== 204) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || 'Failed to unset reaction' }
      }
      return { success: true, output: { reactionUnset: true, reactionType, messageId } }
    },

    microsoft_teams_list_team_members: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      if (!accessToken || !teamId) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/members`
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          members: (data.value || []).map((m: Record<string, unknown>) => ({
            id: m.id, displayName: m.displayName, email: m.email, roles: m.roles,
          })),
        },
      }
    },

    microsoft_teams_list_channel_members: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const teamId = params.teamId as string
      const channelId = params.channelId as string
      if (!accessToken || !teamId || !channelId) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = `${MS_GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/members`
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          members: (data.value || []).map((m: Record<string, unknown>) => ({
            id: m.id, displayName: m.displayName, email: m.email, roles: m.roles,
          })),
        },
      }
    },
  },
}

export default handler
