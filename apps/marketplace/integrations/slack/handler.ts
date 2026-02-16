import type { ToolHandler } from '../../sdk/types'

const SLACK_API = 'https://slack.com/api'

function slackHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

function resolveToken(params: Record<string, unknown>, ctx: { accessToken?: string }): string {
  return (ctx.accessToken || params.accessToken || params.botToken) as string
}

function mapMessage(msg: Record<string, unknown>) {
  return {
    type: (msg.type as string) ?? 'message',
    ts: msg.ts,
    text: (msg.text as string) ?? '',
    user: msg.user ?? null,
    bot_id: msg.bot_id ?? null,
    username: msg.username ?? null,
    channel: msg.channel ?? null,
    team: msg.team ?? null,
    thread_ts: msg.thread_ts ?? null,
    parent_user_id: msg.parent_user_id ?? null,
    reply_count: msg.reply_count ?? null,
    reply_users_count: msg.reply_users_count ?? null,
    latest_reply: msg.latest_reply ?? null,
    subscribed: msg.subscribed ?? null,
    last_read: msg.last_read ?? null,
    unread_count: msg.unread_count ?? null,
    subtype: msg.subtype ?? null,
    reactions: msg.reactions ?? [],
    is_starred: msg.is_starred ?? false,
    pinned_to: msg.pinned_to ?? [],
    files: (Array.isArray(msg.files) ? msg.files : []).map((f: Record<string, unknown>) => ({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      size: f.size,
      url_private: f.url_private ?? null,
      permalink: f.permalink ?? null,
      mode: f.mode ?? null,
    })),
    attachments: msg.attachments ?? [],
    blocks: msg.blocks ?? [],
    edited: msg.edited ?? null,
    permalink: msg.permalink ?? null,
  }
}

const handler: ToolHandler = {
  operations: {
    slack_message: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }

      const isDM = params.destinationType === 'dm'
      let channel = isDM ? undefined : (params.channel as string)
      const userId = isDM ? (params.dmUserId as string) : (params.userId as string)

      if (isDM && userId) {
        const openResp = await fetch(`${SLACK_API}/conversations.open`, {
          method: 'POST',
          headers: slackHeaders(token),
          body: JSON.stringify({ users: userId }),
        })
        const openData = await openResp.json()
        if (openData.ok && openData.channel?.id) {
          channel = openData.channel.id
        } else {
          return { success: false, output: {}, error: openData.error || 'Failed to open DM conversation' }
        }
      }

      if (!channel) {
        return { success: false, output: {}, error: 'Missing channel or user ID' }
      }

      const body: Record<string, unknown> = {
        channel,
        text: params.text,
      }
      if (params.thread_ts) body.thread_ts = params.thread_ts

      const resp = await fetch(`${SLACK_API}/chat.postMessage`, {
        method: 'POST',
        headers: slackHeaders(token),
        body: JSON.stringify(body),
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to send Slack message' }
      }

      const message = data.message ? mapMessage(data.message) : null
      return {
        success: true,
        output: {
          message,
          ts: data.ts || data.message?.ts,
          channel: data.channel,
        },
      }
    },

    slack_list_channels: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }

      const url = new URL(`${SLACK_API}/conversations.list`)
      const includePrivate = params.includePrivate !== false
      url.searchParams.append('types', includePrivate ? 'public_channel,private_channel' : 'public_channel')
      url.searchParams.append('exclude_archived', String(params.excludeArchived !== false))
      const limit = params.limit ? Math.min(Number(params.limit), 200) : 100
      url.searchParams.append('limit', String(limit))

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to list channels from Slack' }
      }

      const channels = (data.channels || []).map((ch: Record<string, unknown>) => ({
        id: ch.id,
        name: ch.name,
        is_private: ch.is_private || false,
        is_archived: ch.is_archived || false,
        is_member: ch.is_member || false,
        num_members: ch.num_members,
        topic: (ch.topic as Record<string, unknown>)?.value || '',
        purpose: (ch.purpose as Record<string, unknown>)?.value || '',
        created: ch.created,
        creator: ch.creator,
      }))

      return {
        success: true,
        output: {
          channels,
          ids: channels.map((c: Record<string, unknown>) => c.id),
          names: channels.map((c: Record<string, unknown>) => c.name),
          count: channels.length,
        },
      }
    },

    slack_list_users: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }

      const url = new URL(`${SLACK_API}/users.list`)
      const limit = params.limit ? Math.min(Number(params.limit), 200) : 100
      url.searchParams.append('limit', String(limit))

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to list users from Slack' }
      }

      const includeDeleted = params.includeDeleted === true
      const users = (data.members || [])
        .filter((user: Record<string, unknown>) => {
          if (user.id === 'USLACKBOT') return false
          if (!includeDeleted && user.deleted) return false
          return true
        })
        .map((user: Record<string, unknown>) => {
          const profile = (user.profile || {}) as Record<string, unknown>
          return {
            id: user.id,
            name: user.name,
            real_name: user.real_name || profile.real_name || '',
            display_name: profile.display_name || '',
            is_bot: user.is_bot || false,
            is_admin: user.is_admin || false,
            is_owner: user.is_owner || false,
            deleted: user.deleted || false,
            timezone: user.tz,
            avatar: profile.image_72 || profile.image_48 || '',
            status_text: profile.status_text || '',
            status_emoji: profile.status_emoji || '',
          }
        })

      return {
        success: true,
        output: {
          users,
          ids: users.map((u: Record<string, unknown>) => u.id),
          names: users.map((u: Record<string, unknown>) => u.name),
          count: users.length,
        },
      }
    },

    slack_get_user: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.userId) return { success: false, output: {}, error: 'Missing required parameter: userId' }

      const url = new URL(`${SLACK_API}/users.info`)
      url.searchParams.append('user', params.userId as string)

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to get user info from Slack' }
      }

      const user = data.user
      const profile = user.profile || {}

      return {
        success: true,
        output: {
          user: {
            id: user.id,
            name: user.name,
            real_name: user.real_name || profile.real_name || '',
            display_name: profile.display_name || '',
            first_name: profile.first_name || '',
            last_name: profile.last_name || '',
            title: profile.title || '',
            phone: profile.phone || '',
            skype: profile.skype || '',
            is_bot: user.is_bot || false,
            is_admin: user.is_admin || false,
            is_owner: user.is_owner || false,
            is_primary_owner: user.is_primary_owner || false,
            is_restricted: user.is_restricted || false,
            is_ultra_restricted: user.is_ultra_restricted || false,
            deleted: user.deleted || false,
            timezone: user.tz,
            timezone_label: user.tz_label,
            timezone_offset: user.tz_offset,
            avatar_24: profile.image_24,
            avatar_48: profile.image_48,
            avatar_72: profile.image_72,
            avatar_192: profile.image_192,
            avatar_512: profile.image_512,
            status_text: profile.status_text || '',
            status_emoji: profile.status_emoji || '',
            status_expiration: profile.status_expiration,
            updated: user.updated,
          },
        },
      }
    },

    slack_list_members: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.channel) return { success: false, output: {}, error: 'Missing required parameter: channel' }

      const url = new URL(`${SLACK_API}/conversations.members`)
      url.searchParams.append('channel', params.channel as string)
      const limit = params.limit ? Math.min(Number(params.limit), 200) : 100
      url.searchParams.append('limit', String(limit))

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to list channel members from Slack' }
      }

      const members = data.members || []
      return {
        success: true,
        output: { members, count: members.length },
      }
    },

    slack_message_reader: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }

      const isDM = params.destinationType === 'dm'
      let channel = isDM ? undefined : (params.channel as string)
      const userId = isDM ? (params.dmUserId as string) : undefined

      if (isDM && userId) {
        const openResp = await fetch(`${SLACK_API}/conversations.open`, {
          method: 'POST',
          headers: slackHeaders(token),
          body: JSON.stringify({ users: userId }),
        })
        const openData = await openResp.json()
        if (openData.ok && openData.channel?.id) {
          channel = openData.channel.id
        } else {
          return { success: false, output: {}, error: openData.error || 'Failed to open DM conversation' }
        }
      }

      if (!channel) {
        return { success: false, output: {}, error: 'Missing channel or user ID' }
      }

      const url = new URL(`${SLACK_API}/conversations.history`)
      url.searchParams.append('channel', channel)
      const limit = params.limit ? Math.min(Number(params.limit), 15) : 10
      url.searchParams.append('limit', String(limit))
      if (params.oldest) url.searchParams.append('oldest', params.oldest as string)
      if (params.latest) url.searchParams.append('latest', params.latest as string)

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to fetch messages from Slack' }
      }

      const messages = (data.messages || []).map((msg: Record<string, unknown>) => mapMessage(msg))
      return {
        success: true,
        output: { messages },
      }
    },

    slack_update_message: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.channel) return { success: false, output: {}, error: 'Missing required parameter: channel' }
      if (!params.timestamp) return { success: false, output: {}, error: 'Missing required parameter: timestamp' }
      if (!params.text) return { success: false, output: {}, error: 'Missing required parameter: text' }

      const resp = await fetch(`${SLACK_API}/chat.update`, {
        method: 'POST',
        headers: slackHeaders(token),
        body: JSON.stringify({
          channel: params.channel,
          ts: params.timestamp,
          text: params.text,
        }),
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to update message' }
      }

      const message = data.message ? mapMessage(data.message) : null
      return {
        success: true,
        output: {
          message,
          content: 'Message updated successfully',
          metadata: {
            channel: data.channel,
            timestamp: data.ts,
            text: data.text || (params.text as string),
          },
        },
      }
    },

    slack_delete_message: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.channel) return { success: false, output: {}, error: 'Missing required parameter: channel' }
      if (!params.timestamp) return { success: false, output: {}, error: 'Missing required parameter: timestamp' }

      const resp = await fetch(`${SLACK_API}/chat.delete`, {
        method: 'POST',
        headers: slackHeaders(token),
        body: JSON.stringify({
          channel: params.channel,
          ts: params.timestamp,
        }),
      })
      const data = await resp.json()

      if (!data.ok) {
        return {
          success: false,
          output: {
            content: data.error || 'Failed to delete message',
            metadata: { channel: '', timestamp: '' },
          },
          error: data.error,
        }
      }

      return {
        success: true,
        output: {
          content: 'Message deleted successfully',
          metadata: {
            channel: data.channel,
            timestamp: data.ts,
          },
        },
      }
    },

    slack_add_reaction: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.channel) return { success: false, output: {}, error: 'Missing required parameter: channel' }
      if (!params.timestamp) return { success: false, output: {}, error: 'Missing required parameter: timestamp' }
      if (!params.name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const resp = await fetch(`${SLACK_API}/reactions.add`, {
        method: 'POST',
        headers: slackHeaders(token),
        body: JSON.stringify({
          channel: params.channel,
          timestamp: params.timestamp,
          name: params.name,
        }),
      })
      const data = await resp.json()

      if (!data.ok) {
        return {
          success: false,
          output: {
            content: data.error || 'Failed to add reaction',
            metadata: { channel: '', timestamp: '', reaction: '' },
          },
          error: data.error,
        }
      }

      return {
        success: true,
        output: {
          content: `Reaction :${params.name}: added successfully`,
          metadata: {
            channel: params.channel as string,
            timestamp: params.timestamp as string,
            reaction: params.name as string,
          },
        },
      }
    },

    slack_get_message: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.channel) return { success: false, output: {}, error: 'Missing required parameter: channel' }
      if (!params.timestamp) return { success: false, output: {}, error: 'Missing required parameter: timestamp' }

      const url = new URL(`${SLACK_API}/conversations.history`)
      url.searchParams.append('channel', (params.channel as string).trim())
      url.searchParams.append('oldest', (params.timestamp as string).trim())
      url.searchParams.append('limit', '1')
      url.searchParams.append('inclusive', 'true')

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to get message from Slack' }
      }

      const messages = data.messages || []
      if (messages.length === 0) {
        return { success: false, output: {}, error: 'Message not found' }
      }

      return {
        success: true,
        output: { message: mapMessage(messages[0]) },
      }
    },

    slack_get_thread: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.channel) return { success: false, output: {}, error: 'Missing required parameter: channel' }
      if (!params.threadTs) return { success: false, output: {}, error: 'Missing required parameter: threadTs' }

      const url = new URL(`${SLACK_API}/conversations.replies`)
      url.searchParams.append('channel', (params.channel as string).trim())
      url.searchParams.append('ts', (params.threadTs as string).trim())
      url.searchParams.append('inclusive', 'true')
      const limit = params.limit ? Math.min(Number(params.limit), 200) : 100
      url.searchParams.append('limit', String(limit))

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to get thread from Slack' }
      }

      const rawMessages = data.messages || []
      if (rawMessages.length === 0) {
        return { success: false, output: {}, error: 'Thread not found' }
      }

      const messages = rawMessages.map((msg: Record<string, unknown>) => mapMessage(msg))
      const parentMessage = messages[0]
      const replies = messages.slice(1)

      return {
        success: true,
        output: {
          parentMessage,
          replies,
          messages,
          replyCount: replies.length,
          hasMore: data.has_more ?? false,
        },
      }
    },

    slack_canvas: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.channel) return { success: false, output: {}, error: 'Missing required parameter: channel' }
      if (!params.title) return { success: false, output: {}, error: 'Missing required parameter: title' }
      if (!params.content) return { success: false, output: {}, error: 'Missing required parameter: content' }

      const body: Record<string, unknown> = {
        title: params.title,
        channel_id: params.channel,
      }

      if (params.document_content) {
        body.document_content = params.document_content
      } else {
        body.document_content = {
          type: 'markdown',
          markdown: params.content,
        }
      }

      const resp = await fetch(`${SLACK_API}/canvases.create`, {
        method: 'POST',
        headers: slackHeaders(token),
        body: JSON.stringify(body),
      })
      const data = await resp.json()

      if (!data.ok) {
        return { success: false, output: {}, error: data.error || 'Failed to create canvas' }
      }

      return {
        success: true,
        output: {
          canvas_id: data.canvas_id || data.id,
          channel: data.channel || '',
          title: data.title || '',
        },
      }
    },

    slack_download: async (params, ctx) => {
      const token = resolveToken(params, ctx)
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.fileId) return { success: false, output: {}, error: 'Missing required parameter: fileId' }

      const infoResp = await fetch(`${SLACK_API}/files.info?file=${params.fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const infoData = await infoResp.json()

      if (!infoData.ok) {
        return { success: false, output: {}, error: infoData.error || 'Failed to get file info' }
      }

      const file = infoData.file
      return {
        success: true,
        output: {
          file: {
            id: file.id,
            name: (params.fileName as string) || file.name,
            mimetype: file.mimetype,
            size: file.size,
            url_private: file.url_private,
            permalink: file.permalink,
          },
        },
      }
    },
  },
}

export default handler
