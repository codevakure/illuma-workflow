import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('DiscordProxyHandler')

/**
 * Sends a message to a Discord channel, with optional file attachments.
 */
const handleSendMessage: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Bot token is required'),
    channelId: z.string().min(1, 'Channel ID is required'),
    content: z.string().optional().nullable(),
    file: RawFileInputArraySchema.optional().nullable(),
  })

  const validated = schema.parse(body)

  const discordApiUrl = `https://discord.com/api/v10/channels/${validated.channelId}/messages`

  logger.info(`[${requestId}] Sending Discord message`, {
    channelId: validated.channelId,
    hasFiles: !!(validated.file && validated.file.length > 0),
    fileCount: validated.file?.length || 0,
  })

  if (!validated.file || validated.file.length === 0) {
    logger.info(`[${requestId}] No files, using JSON POST`)

    const response = await fetch(discordApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${validated.accessToken}`,
      },
      body: JSON.stringify({
        content: validated.content || '',
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error(`[${requestId}] Discord API error:`, errorData)
      return {
        success: false,
        output: {},
        error: errorData.message || 'Failed to send message',
      }
    }

    const data = await response.json()
    logger.info(`[${requestId}] Message sent successfully`)
    return {
      success: true,
      output: {
        message: data.content,
        data,
      },
    }
  }

  logger.info(`[${requestId}] Processing ${validated.file.length} file(s)`)

  const userFiles = processFilesToUserFiles(validated.file, requestId, logger)

  if (userFiles.length === 0) {
    logger.warn(`[${requestId}] No valid files to upload, falling back to text-only`)
    const response = await fetch(discordApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${validated.accessToken}`,
      },
      body: JSON.stringify({
        content: validated.content || '',
      }),
    })

    const data = await response.json()
    return {
      success: true,
      output: {
        message: data.content,
        data,
      },
    }
  }

  const formData = new FormData()
  formData.append('payload_json', JSON.stringify({ content: validated.content || '' }))

  const filesOutput: Array<{ name: string; mimeType: string; data: string; size: number }> = []

  for (let i = 0; i < userFiles.length; i++) {
    const userFile = userFiles[i]
    logger.info(`[${requestId}] Downloading file ${i}: ${userFile.name}`)

    const buffer = await downloadFileFromStorage(userFile, requestId, logger)
    filesOutput.push({
      name: userFile.name,
      mimeType: userFile.type || 'application/octet-stream',
      data: buffer.toString('base64'),
      size: buffer.length,
    })

    const blob = new Blob([new Uint8Array(buffer)], { type: userFile.type })
    formData.append(`files[${i}]`, blob, userFile.name)
    logger.info(`[${requestId}] Added file ${i}: ${userFile.name} (${buffer.length} bytes)`)
  }

  logger.info(`[${requestId}] Sending multipart request with ${userFiles.length} file(s)`)

  const response = await fetch(discordApiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${validated.accessToken}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Discord API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.message || 'Failed to send message with files',
    }
  }

  const data = await response.json()
  logger.info(`[${requestId}] Message with files sent successfully`)

  return {
    success: true,
    output: {
      message: data.content,
      data,
      fileCount: userFiles.length,
      files: filesOutput,
    },
  }
}

/**
 * Lists text channels in a Discord guild.
 */
const handleChannels: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Bot token is required'),
    guildId: z.string().min(1, 'Guild ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching Discord channels for guild: ${validated.guildId}`)

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${validated.guildId}/channels`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bot ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    logger.warn(`[${requestId}] Discord API returned non-OK for channels`, {
      status: response.status,
      statusText: response.statusText,
    })
    return { success: true, output: { channels: [] } }
  }

  const channels = await response.json()
  const textChannels = channels.filter(
    (channel: { type: number }) => channel.type === 0
  )

  logger.info(`[${requestId}] Successfully fetched ${textChannels.length} text channels`)

  return {
    success: true,
    output: {
      channels: textChannels.map((channel: { id: string; name: string; type: number }) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      })),
    },
  }
}

/**
 * Lists guilds (servers) the bot has access to.
 */
const handleServers: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Bot token is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching Discord guilds`)

  const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    method: 'GET',
    headers: {
      Authorization: `Bot ${validated.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    logger.warn(`[${requestId}] Discord API returned non-OK for guilds`, {
      status: response.status,
      statusText: response.statusText,
    })
    return { success: true, output: { guilds: [] } }
  }

  const guilds = await response.json()
  logger.info(`[${requestId}] Successfully fetched ${guilds.length} guilds`)

  return {
    success: true,
    output: { guilds },
  }
}

export const discordHandlers: Record<string, ToolProxyHandler> = {
  'send-message': handleSendMessage,
  'channels': handleChannels,
  'servers': handleServers,
}
