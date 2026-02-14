import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('TelegramProxyHandler')

/**
 * Sends a document to a Telegram chat via the Bot API.
 */
const handleSendDocument: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    botToken: z.string().min(1, 'Bot token is required'),
    chatId: z.string().min(1, 'Chat ID is required'),
    file: RawFileInputArraySchema.optional().nullable(),
    caption: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Sending Telegram document`, {
    chatId: validated.chatId,
    hasFiles: !!(validated.file && validated.file.length > 0),
    fileCount: validated.file?.length || 0,
  })

  if (!validated.file || validated.file.length === 0) {
    return {
      success: false,
      output: {},
      error: 'At least one document file is required for sendDocument operation',
    }
  }

  const userFiles = processFilesToUserFiles(validated.file, requestId, logger)

  if (userFiles.length === 0) {
    logger.warn(`[${requestId}] No valid files to upload`)
    return {
      success: false,
      output: {},
      error: 'No valid files provided for upload',
    }
  }

  const maxSize = 50 * 1024 * 1024
  const tooLargeFiles = userFiles.filter((file) => file.size > maxSize)

  if (tooLargeFiles.length > 0) {
    const filesInfo = tooLargeFiles
      .map((f) => `${f.name} (${(f.size / (1024 * 1024)).toFixed(2)}MB)`)
      .join(', ')
    return {
      success: false,
      output: {},
      error: `The following files exceed Telegram's 50MB limit: ${filesInfo}`,
    }
  }

  const userFile = userFiles[0]
  logger.info(`[${requestId}] Uploading document: ${userFile.name}`)

  const buffer = await downloadFileFromStorage(userFile, requestId, logger)
  const filesOutput = [
    {
      name: userFile.name,
      mimeType: userFile.type || 'application/octet-stream',
      data: buffer.toString('base64'),
      size: buffer.length,
    },
  ]

  logger.info(`[${requestId}] Downloaded file: ${buffer.length} bytes`)

  const formData = new FormData()
  formData.append('chat_id', validated.chatId)

  const blob = new Blob([new Uint8Array(buffer)], { type: userFile.type })
  formData.append('document', blob, userFile.name)

  if (validated.caption) {
    formData.append('caption', validated.caption)
  }

  const telegramApiUrl = `https://api.telegram.org/bot${validated.botToken}/sendDocument`
  logger.info(`[${requestId}] Sending request to Telegram API`)

  const response = await fetch(telegramApiUrl, {
    method: 'POST',
    body: formData,
  })

  const data = await response.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Telegram API error:`, data)
    return {
      success: false,
      output: {},
      error: data.description || 'Failed to send document to Telegram',
    }
  }

  logger.info(`[${requestId}] Document sent successfully`)

  return {
    success: true,
    output: {
      message: 'Document sent successfully',
      data: data.result,
      files: filesOutput,
    },
  }
}

export const telegramHandlers: Record<string, ToolProxyHandler> = {
  'send-document': handleSendDocument,
}
