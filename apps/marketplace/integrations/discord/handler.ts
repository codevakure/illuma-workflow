import type { ToolHandler } from '../../sdk/types'

const DISCORD_API = 'https://discord.com/api/v10'

async function discordRequest(
  method: string,
  path: string,
  botToken: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const headers: Record<string, string> = {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  }

  const response = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (response.status === 204) {
    return { ok: true, data: {}, status: 204 }
  }

  const data = await response.json()
  if (!response.ok) {
    return { ok: false, data, status: response.status }
  }
  return { ok: true, data, status: response.status }
}

const handler: ToolHandler = {
  operations: {
    discord_send_message: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      if (!botToken) return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      if (!channelId) return { success: false, output: {}, error: 'Missing required parameter: channelId' }

      const result = await discordRequest('POST', `/channels/${channelId}/messages`, botToken, {
        content: (params.content as string) || 'Message sent from Sim',
      })

      if (!result.ok) {
        return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      }

      return { success: true, output: { message: 'Message sent successfully', data: result.data } }
    },

    discord_get_messages: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      if (!botToken) return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      if (!channelId) return { success: false, output: {}, error: 'Missing required parameter: channelId' }

      const limit = Math.min(Number(params.limit) || 10, 100)
      const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`, {
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        return { success: false, output: {}, error: `Discord API error: ${response.status}` }
      }
      const messages = await response.json()
      return {
        success: true,
        output: {
          message: `Retrieved ${messages.length} messages from Discord channel`,
          data: { messages, channel_id: messages.length > 0 ? messages[0].channel_id : '' },
        },
      }
    },

    discord_edit_message: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      if (!botToken) return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      if (!channelId) return { success: false, output: {}, error: 'Missing required parameter: channelId' }
      if (!messageId) return { success: false, output: {}, error: 'Missing required parameter: messageId' }

      const body: Record<string, unknown> = {}
      if (params.content) body.content = params.content

      const result = await discordRequest('PATCH', `/channels/${channelId}/messages/${messageId}`, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Message edited successfully', data: result.data } }
    },

    discord_delete_message: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      if (!botToken || !channelId || !messageId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/channels/${channelId}/messages/${messageId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Message deleted successfully' } }
    },

    discord_add_reaction: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      const emoji = params.emoji as string
      if (!botToken || !channelId || !messageId || !emoji) return { success: false, output: {}, error: 'Missing required parameters' }

      const encodedEmoji = encodeURIComponent(emoji)
      const result = await discordRequest('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Reaction added successfully' } }
    },

    discord_remove_reaction: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      const emoji = params.emoji as string
      if (!botToken || !channelId || !messageId || !emoji) return { success: false, output: {}, error: 'Missing required parameters' }

      const encodedEmoji = encodeURIComponent(emoji)
      const userId = (params.userId as string) || '@me'
      const result = await discordRequest('DELETE', `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/${userId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Reaction removed successfully' } }
    },

    discord_pin_message: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      if (!botToken || !channelId || !messageId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('PUT', `/channels/${channelId}/pins/${messageId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Message pinned successfully' } }
    },

    discord_unpin_message: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const messageId = params.messageId as string
      if (!botToken || !channelId || !messageId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/channels/${channelId}/pins/${messageId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Message unpinned successfully' } }
    },

    discord_create_thread: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const name = params.name as string
      if (!botToken || !channelId || !name) return { success: false, output: {}, error: 'Missing required parameters' }

      const path = params.messageId
        ? `/channels/${channelId}/messages/${params.messageId}/threads`
        : `/channels/${channelId}/threads`

      const body: Record<string, unknown> = { name }
      if (params.autoArchiveDuration) body.auto_archive_duration = Number(params.autoArchiveDuration)

      const result = await discordRequest('POST', path, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Thread created successfully', data: result.data } }
    },

    discord_join_thread: async (params) => {
      const botToken = params.botToken as string
      const threadId = params.threadId as string
      if (!botToken || !threadId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('PUT', `/channels/${threadId}/thread-members/@me`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Joined thread successfully' } }
    },

    discord_leave_thread: async (params) => {
      const botToken = params.botToken as string
      const threadId = params.threadId as string
      if (!botToken || !threadId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/channels/${threadId}/thread-members/@me`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Left thread successfully' } }
    },

    discord_archive_thread: async (params) => {
      const botToken = params.botToken as string
      const threadId = params.threadId as string
      if (!botToken || !threadId) return { success: false, output: {}, error: 'Missing required parameters' }

      const archived = params.archived !== false
      const result = await discordRequest('PATCH', `/channels/${threadId}`, botToken, { archived })
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: archived ? 'Thread archived successfully' : 'Thread unarchived successfully', data: result.data } }
    },

    discord_create_channel: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const name = params.name as string
      if (!botToken || !serverId || !name) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = { name }
      if (params.type !== undefined) body.type = Number(params.type)
      if (params.topic) body.topic = params.topic
      if (params.parentId) body.parent_id = params.parentId

      const result = await discordRequest('POST', `/guilds/${serverId}/channels`, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Channel created successfully', data: result.data } }
    },

    discord_update_channel: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      if (!botToken || !channelId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.topic !== undefined) body.topic = params.topic

      const result = await discordRequest('PATCH', `/channels/${channelId}`, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Channel updated successfully', data: result.data } }
    },

    discord_delete_channel: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      if (!botToken || !channelId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/channels/${channelId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Channel deleted successfully' } }
    },

    discord_get_channel: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      if (!botToken || !channelId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('GET', `/channels/${channelId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Channel retrieved successfully', data: result.data } }
    },

    discord_get_server: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      if (!botToken || !serverId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('GET', `/guilds/${serverId}?with_counts=true`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Server retrieved successfully', data: result.data } }
    },

    discord_get_user: async (params) => {
      const botToken = params.botToken as string
      const userId = params.userId as string
      if (!botToken || !userId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('GET', `/users/${userId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'User retrieved successfully', data: result.data } }
    },

    discord_get_member: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const userId = params.userId as string
      if (!botToken || !serverId || !userId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('GET', `/guilds/${serverId}/members/${userId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Member retrieved successfully', data: result.data } }
    },

    discord_update_member: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const userId = params.userId as string
      if (!botToken || !serverId || !userId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.nick !== undefined) body.nick = params.nick
      if (params.mute !== undefined) body.mute = params.mute
      if (params.deaf !== undefined) body.deaf = params.deaf

      const result = await discordRequest('PATCH', `/guilds/${serverId}/members/${userId}`, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Member updated successfully', data: result.data } }
    },

    discord_kick_member: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const userId = params.userId as string
      if (!botToken || !serverId || !userId) return { success: false, output: {}, error: 'Missing required parameters' }

      const extraHeaders: Record<string, string> = {}
      if (params.reason) extraHeaders['X-Audit-Log-Reason'] = encodeURIComponent(params.reason as string)

      const result = await discordRequest('DELETE', `/guilds/${serverId}/members/${userId}`, botToken, undefined, extraHeaders)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Member kicked successfully' } }
    },

    discord_ban_member: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const userId = params.userId as string
      if (!botToken || !serverId || !userId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.deleteMessageDays) body.delete_message_days = Number(params.deleteMessageDays)

      const extraHeaders: Record<string, string> = {}
      if (params.reason) extraHeaders['X-Audit-Log-Reason'] = encodeURIComponent(params.reason as string)

      const result = await discordRequest('PUT', `/guilds/${serverId}/bans/${userId}`, botToken, body, extraHeaders)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Member banned successfully' } }
    },

    discord_unban_member: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const userId = params.userId as string
      if (!botToken || !serverId || !userId) return { success: false, output: {}, error: 'Missing required parameters' }

      const extraHeaders: Record<string, string> = {}
      if (params.reason) extraHeaders['X-Audit-Log-Reason'] = encodeURIComponent(params.reason as string)

      const result = await discordRequest('DELETE', `/guilds/${serverId}/bans/${userId}`, botToken, undefined, extraHeaders)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Member unbanned successfully' } }
    },

    discord_create_role: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const name = params.name as string
      if (!botToken || !serverId || !name) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = { name }
      if (params.color !== undefined) body.color = Number(params.color)
      if (params.hoist !== undefined) body.hoist = params.hoist
      if (params.mentionable !== undefined) body.mentionable = params.mentionable

      const result = await discordRequest('POST', `/guilds/${serverId}/roles`, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Role created successfully', data: result.data } }
    },

    discord_update_role: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const roleId = params.roleId as string
      if (!botToken || !serverId || !roleId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.color !== undefined) body.color = Number(params.color)
      if (params.hoist !== undefined) body.hoist = params.hoist
      if (params.mentionable !== undefined) body.mentionable = params.mentionable

      const result = await discordRequest('PATCH', `/guilds/${serverId}/roles/${roleId}`, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Role updated successfully', data: result.data } }
    },

    discord_delete_role: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const roleId = params.roleId as string
      if (!botToken || !serverId || !roleId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/guilds/${serverId}/roles/${roleId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Role deleted successfully' } }
    },

    discord_assign_role: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const userId = params.userId as string
      const roleId = params.roleId as string
      if (!botToken || !serverId || !userId || !roleId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('PUT', `/guilds/${serverId}/members/${userId}/roles/${roleId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Role assigned successfully' } }
    },

    discord_remove_role: async (params) => {
      const botToken = params.botToken as string
      const serverId = params.serverId as string
      const userId = params.userId as string
      const roleId = params.roleId as string
      if (!botToken || !serverId || !userId || !roleId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/guilds/${serverId}/members/${userId}/roles/${roleId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Role removed successfully' } }
    },

    discord_create_invite: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      if (!botToken || !channelId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.maxAge !== undefined) body.max_age = Number(params.maxAge)
      if (params.maxUses !== undefined) body.max_uses = Number(params.maxUses)
      if (params.temporary !== undefined) body.temporary = params.temporary

      const result = await discordRequest('POST', `/channels/${channelId}/invites`, botToken, body)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Invite created successfully', data: result.data } }
    },

    discord_get_invite: async (params) => {
      const botToken = params.botToken as string
      const inviteCode = params.inviteCode as string
      if (!botToken || !inviteCode) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('GET', `/invites/${inviteCode}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Invite retrieved successfully', data: result.data } }
    },

    discord_delete_invite: async (params) => {
      const botToken = params.botToken as string
      const inviteCode = params.inviteCode as string
      if (!botToken || !inviteCode) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/invites/${inviteCode}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Invite deleted successfully' } }
    },

    discord_create_webhook: async (params) => {
      const botToken = params.botToken as string
      const channelId = params.channelId as string
      const name = params.name as string
      if (!botToken || !channelId || !name) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('POST', `/channels/${channelId}/webhooks`, botToken, { name })
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Webhook created successfully', data: result.data } }
    },

    discord_execute_webhook: async (params) => {
      const webhookId = params.webhookId as string
      const webhookToken = params.webhookToken as string
      const content = params.content as string
      if (!webhookId || !webhookToken || !content) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = { content }
      if (params.username) body.username = params.username

      const response = await fetch(`${DISCORD_API}/webhooks/${webhookId}/${webhookToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (errorData as Record<string, unknown>).message as string || `Discord API error: ${response.status}` }
      }

      const data = response.status === 204 ? {} : await response.json()
      return { success: true, output: { message: 'Webhook executed successfully', data } }
    },

    discord_get_webhook: async (params) => {
      const botToken = params.botToken as string
      const webhookId = params.webhookId as string
      if (!botToken || !webhookId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('GET', `/webhooks/${webhookId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Webhook retrieved successfully', data: result.data } }
    },

    discord_delete_webhook: async (params) => {
      const botToken = params.botToken as string
      const webhookId = params.webhookId as string
      if (!botToken || !webhookId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await discordRequest('DELETE', `/webhooks/${webhookId}`, botToken)
      if (!result.ok) return { success: false, output: {}, error: (result.data.message as string) || `Discord API error: ${result.status}` }
      return { success: true, output: { message: 'Webhook deleted successfully' } }
    },
  },
}

export default handler
