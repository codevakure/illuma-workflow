import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SlackProxyHandler')

/**
 * Opens a DM channel with a Slack user and returns the channel ID.
 */
async function openDMChannel(accessToken: string, userId: string, requestId: string): Promise<string> {
  const response = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ users: userId }),
  })

  const data = await response.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Failed to open DM channel:`, data.error)
    throw new Error(data.error || 'Failed to open DM channel with user')
  }

  logger.info(`[${requestId}] Opened DM channel: ${data.channel.id}`)
  return data.channel.id
}

/**
 * Sends a message to a Slack channel or user, with optional file attachments.
 */
const handleSendMessage: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z
    .object({
      accessToken: z.string().min(1, 'Access token is required'),
      channel: z.string().optional().nullable(),
      userId: z.string().optional().nullable(),
      text: z.string().min(1, 'Message text is required'),
      file: z.array(z.any()).optional().nullable(),
    })
    .refine((data) => data.channel || data.userId, {
      message: 'Either channel or userId is required',
    })

  const validated = schema.parse(body)

  let channel = validated.channel ?? undefined

  if (validated.userId && !channel) {
    channel = await openDMChannel(validated.accessToken, validated.userId, requestId)
  }

  if (!channel) {
    return { success: false, output: {}, error: 'Either channel or userId is required' }
  }

  if (validated.file && validated.file.length > 0) {
    const userFiles = processFilesToUserFiles(validated.file, requestId, logger)
    const uploadedFileIds: string[] = []

    for (const userFile of userFiles) {
      logger.info(`[${requestId}] Uploading file: ${userFile.name}`)

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      const getUrlResponse = await fetch('https://slack.com/api/files.getUploadURLExternal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${validated.accessToken}`,
        },
        body: new URLSearchParams({
          filename: userFile.name,
          length: buffer.length.toString(),
        }),
      })

      const urlData = await getUrlResponse.json()

      if (!urlData.ok) {
        logger.error(`[${requestId}] Failed to get upload URL:`, urlData.error)
        continue
      }

      logger.info(`[${requestId}] Got upload URL for ${userFile.name}, file_id: ${urlData.file_id}`)

      const uploadResponse = await fetch(urlData.upload_url, {
        method: 'PUT',
        body: new Uint8Array(buffer),
      })

      if (!uploadResponse.ok) {
        logger.error(`[${requestId}] Failed to upload file data: ${uploadResponse.status}`)
        continue
      }

      logger.info(`[${requestId}] File data uploaded successfully`)
      uploadedFileIds.push(urlData.file_id)
    }

    if (uploadedFileIds.length > 0) {
      const completeResponse = await fetch('https://slack.com/api/files.completeUploadExternal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validated.accessToken}`,
        },
        body: JSON.stringify({
          files: uploadedFileIds.map((id) => ({ id, title: id })),
          channel_id: channel,
          initial_comment: validated.text,
        }),
      })

      const completeData = await completeResponse.json()

      if (!completeData.ok) {
        logger.error(`[${requestId}] Failed to complete upload:`, completeData.error)
        return {
          success: false,
          output: {},
          error: completeData.error || 'Failed to complete file upload',
        }
      }

      logger.info(`[${requestId}] Files uploaded and shared successfully`)
      return {
        success: true,
        output: {
          content: validated.text,
          metadata: {
            channel,
            fileCount: uploadedFileIds.length,
          },
        },
      }
    }

    logger.warn(`[${requestId}] No valid files uploaded, falling back to text-only message`)
  }

  const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify({
      channel,
      text: validated.text,
    }),
  })

  const data = await slackResponse.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Slack API error:`, data.error)
    return { success: false, output: {}, error: data.error || 'Failed to send message' }
  }

  logger.info(`[${requestId}] Message sent successfully`)
  return {
    success: true,
    output: {
      content: validated.text,
      metadata: {
        channel,
        timestamp: data.ts,
      },
    },
  }
}

/**
 * Lists available Slack channels (public and private, excluding archived).
 */
const handleChannels: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
  })

  const validated = schema.parse(body)

  const response = await fetch(
    'https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  const data = await response.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Slack API error:`, data.error)
    return { success: false, output: {}, error: data.error || 'Failed to fetch channels' }
  }

  const channels = (data.channels || []).map(
    (ch: { id: string; name: string; is_private: boolean; num_members: number }) => ({
      id: ch.id,
      name: ch.name,
      is_private: ch.is_private,
      num_members: ch.num_members,
    })
  )

  logger.info(`[${requestId}] Successfully fetched ${channels.length} channels`)
  return { success: true, output: { channels } }
}

/**
 * Retrieves Slack user information. Fetches a single user when userId is provided,
 * or lists all non-deleted, non-bot users.
 */
const handleUsers: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    userId: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  if (validated.userId) {
    const response = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(validated.userId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validated.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    const data = await response.json()

    if (!data.ok) {
      logger.error(`[${requestId}] Slack API error:`, data.error)
      return { success: false, output: {}, error: data.error || 'Failed to fetch user' }
    }

    const user = {
      id: data.user.id,
      name: data.user.name,
      real_name: data.user.real_name || data.user.name,
    }

    logger.info(`[${requestId}] Successfully fetched user: ${validated.userId}`)
    return { success: true, output: { user } }
  }

  const response = await fetch('https://slack.com/api/users.list?limit=200', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  const data = await response.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Slack API error:`, data.error)
    return { success: false, output: {}, error: data.error || 'Failed to fetch users' }
  }

  const users = (data.members || [])
    .filter((u: { deleted: boolean; is_bot: boolean }) => !u.deleted && !u.is_bot)
    .map((u: { id: string; name: string; real_name: string }) => ({
      id: u.id,
      name: u.name,
      real_name: u.real_name || u.name,
    }))

  logger.info(`[${requestId}] Successfully fetched ${users.length} users`)
  return { success: true, output: { users } }
}

/**
 * Adds an emoji reaction to a Slack message.
 */
const handleAddReaction: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().min(1, 'Channel is required'),
    timestamp: z.string().min(1, 'Message timestamp is required'),
    name: z.string().min(1, 'Emoji name is required'),
  })

  const validated = schema.parse(body)

  const slackResponse = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify({
      channel: validated.channel,
      timestamp: validated.timestamp,
      name: validated.name,
    }),
  })

  const data = await slackResponse.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Slack API error:`, data.error)
    return { success: false, output: {}, error: data.error || 'Failed to add reaction' }
  }

  logger.info(`[${requestId}] Reaction added successfully`)
  return {
    success: true,
    output: {
      content: `Successfully added :${validated.name}: reaction`,
      metadata: {
        channel: validated.channel,
        timestamp: validated.timestamp,
        reaction: validated.name,
      },
    },
  }
}

/**
 * Deletes a message from a Slack channel.
 */
const handleDeleteMessage: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().min(1, 'Channel is required'),
    timestamp: z.string().min(1, 'Message timestamp is required'),
  })

  const validated = schema.parse(body)

  const slackResponse = await fetch('https://slack.com/api/chat.delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify({
      channel: validated.channel,
      ts: validated.timestamp,
    }),
  })

  const data = await slackResponse.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Slack API error:`, data.error)
    return { success: false, output: {}, error: data.error || 'Failed to delete message' }
  }

  logger.info(`[${requestId}] Message deleted successfully`)
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
}

/**
 * Reads message history from a Slack channel or DM conversation.
 */
const handleReadMessages: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z
    .object({
      accessToken: z.string().min(1, 'Access token is required'),
      channel: z.string().optional().nullable(),
      userId: z.string().optional().nullable(),
      limit: z.coerce
        .number()
        .min(1, 'Limit must be at least 1')
        .max(15, 'Limit cannot exceed 15')
        .optional()
        .nullable(),
      oldest: z.string().optional().nullable(),
      latest: z.string().optional().nullable(),
    })
    .refine((data) => data.channel || data.userId, {
      message: 'Either channel or userId is required',
    })

  const validated = schema.parse(body)

  let channel = validated.channel ?? undefined

  if (!channel && validated.userId) {
    channel = await openDMChannel(validated.accessToken, validated.userId, requestId)
  }

  if (!channel) {
    return { success: false, output: {}, error: 'Either channel or userId is required' }
  }

  const limit = validated.limit ?? 10
  const url = new URL('https://slack.com/api/conversations.history')
  url.searchParams.append('channel', channel)
  url.searchParams.append('limit', String(limit))

  if (validated.oldest) {
    url.searchParams.append('oldest', validated.oldest)
  }
  if (validated.latest) {
    url.searchParams.append('latest', validated.latest)
  }

  logger.info(`[${requestId}] Reading Slack messages`, { channel, limit })

  const slackResponse = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
  })

  const data = await slackResponse.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Slack API error:`, data.error)
    return { success: false, output: {}, error: data.error || 'Failed to fetch messages' }
  }

  const messages = data.messages || []

  logger.info(`[${requestId}] Successfully read ${messages.length} messages`)
  return { success: true, output: { messages } }
}

/**
 * Updates an existing message in a Slack channel.
 */
const handleUpdateMessage: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().min(1, 'Channel is required'),
    timestamp: z.string().min(1, 'Message timestamp is required'),
    text: z.string().min(1, 'Message text is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Updating Slack message`, {
    channel: validated.channel,
    timestamp: validated.timestamp,
  })

  const slackResponse = await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify({
      channel: validated.channel,
      ts: validated.timestamp,
      text: validated.text,
    }),
  })

  const data = await slackResponse.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Slack API error:`, data.error)
    return { success: false, output: {}, error: data.error || 'Failed to update message' }
  }

  const messageObj = data.message || {
    type: 'message',
    ts: data.ts,
    text: data.text || validated.text,
    channel: data.channel,
  }

  logger.info(`[${requestId}] Message updated successfully`)
  return {
    success: true,
    output: {
      message: messageObj,
      content: 'Message updated successfully',
      metadata: {
        channel: data.channel,
        timestamp: data.ts,
        text: data.text || validated.text,
      },
    },
  }
}

/**
 * Downloads a file from Slack using a private file URL and returns its base64-encoded content.
 */
const handleDownload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    fileUrl: z.string().min(1, 'File URL is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Downloading file from Slack`)

  const downloadResponse = await fetch(validated.fileUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
    },
  })

  if (!downloadResponse.ok) {
    logger.error(`[${requestId}] Failed to download file: ${downloadResponse.status}`)
    return { success: false, output: {}, error: 'Failed to download file' }
  }

  const arrayBuffer = await downloadResponse.arrayBuffer()
  const base64Data = Buffer.from(arrayBuffer).toString('base64')

  logger.info(`[${requestId}] File downloaded successfully`, { size: arrayBuffer.byteLength })
  return {
    success: true,
    output: {
      content: base64Data,
    },
  }
}

export const slackHandlers: Record<string, ToolProxyHandler> = {
  'send-message': handleSendMessage,
  'channels': handleChannels,
  'users': handleUsers,
  'add-reaction': handleAddReaction,
  'delete-message': handleDeleteMessage,
  'read-messages': handleReadMessages,
  'update-message': handleUpdateMessage,
  'download': handleDownload,
}
