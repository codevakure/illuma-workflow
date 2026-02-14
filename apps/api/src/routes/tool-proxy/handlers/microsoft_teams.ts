import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MicrosoftTeamsProxyHandler')

const MS_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

/**
 * Sends a message to a Microsoft Teams channel.
 */
const handleWriteChannel: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    teamId: z.string().min(1, 'Team ID is required'),
    channelId: z.string().min(1, 'Channel ID is required'),
    content: z.string().min(1, 'Message content is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Sending Teams channel message`, {
    teamId: validated.teamId,
    channelId: validated.channelId,
  })

  const teamsUrl = `${MS_GRAPH_BASE}/teams/${encodeURIComponent(validated.teamId)}/channels/${encodeURIComponent(validated.channelId)}/messages`

  const response = await fetch(teamsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify({
      body: { content: validated.content },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Teams API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to send Teams channel message',
    }
  }

  const responseData = await response.json()
  logger.info(`[${requestId}] Teams channel message sent successfully`, {
    messageId: responseData.id,
  })

  return {
    success: true,
    output: {
      updatedContent: true,
      metadata: {
        messageId: responseData.id,
        teamId: responseData.channelIdentity?.teamId || validated.teamId,
        channelId: responseData.channelIdentity?.channelId || validated.channelId,
        content: responseData.body?.content || validated.content,
        createdTime: responseData.createdDateTime || new Date().toISOString(),
        url: responseData.webUrl || '',
      },
    },
  }
}

/**
 * Sends a message to a Microsoft Teams chat.
 */
const handleWriteChat: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    chatId: z.string().min(1, 'Chat ID is required'),
    content: z.string().min(1, 'Message content is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Sending Teams chat message`, {
    chatId: validated.chatId,
  })

  const teamsUrl = `${MS_GRAPH_BASE}/chats/${encodeURIComponent(validated.chatId)}/messages`

  const response = await fetch(teamsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify({
      body: { content: validated.content },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Teams API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to send Teams message',
    }
  }

  const responseData = await response.json()
  logger.info(`[${requestId}] Teams chat message sent successfully`, {
    messageId: responseData.id,
  })

  return {
    success: true,
    output: {
      updatedContent: true,
      metadata: {
        messageId: responseData.id,
        chatId: responseData.chatId || validated.chatId,
        content: responseData.body?.content || validated.content,
        createdTime: responseData.createdDateTime || new Date().toISOString(),
        url: responseData.webUrl || '',
      },
    },
  }
}

/**
 * Soft-deletes a message from a Microsoft Teams chat.
 */
const handleDeleteChatMessage: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    chatId: z.string().min(1, 'Chat ID is required'),
    messageId: z.string().min(1, 'Message ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Deleting Teams chat message`, {
    chatId: validated.chatId,
    messageId: validated.messageId,
  })

  const meResponse = await fetch(`${MS_GRAPH_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
    },
  })

  if (!meResponse.ok) {
    const errorData = await meResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Failed to get user ID:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to get user information',
    }
  }

  const userData = await meResponse.json()
  const userId = userData.id

  logger.info(`[${requestId}] Retrieved user ID: ${userId}`)

  const deleteUrl = `${MS_GRAPH_BASE}/users/${encodeURIComponent(userId)}/chats/${encodeURIComponent(validated.chatId)}/messages/${encodeURIComponent(validated.messageId)}/softDelete`

  const deleteResponse = await fetch(deleteUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  if (!deleteResponse.ok) {
    const errorData = await deleteResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Teams API delete error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to delete Teams message',
    }
  }

  logger.info(`[${requestId}] Teams message deleted successfully`)

  return {
    success: true,
    output: {
      deleted: true,
      messageId: validated.messageId,
      metadata: {
        messageId: validated.messageId,
        chatId: validated.chatId,
      },
    },
  }
}

export const microsoftTeamsHandlers: Record<string, ToolProxyHandler> = {
  'write_channel': handleWriteChannel,
  'write_chat': handleWriteChat,
  'delete_chat_message': handleDeleteChatMessage,
}
