import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('WordPressProxyHandler')

/**
 * Uploads a media file to WordPress.
 */
const handleUpload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    siteUrl: z.string().optional().nullable(),
    siteId: z.string().optional().nullable(),
    accessToken: z.string().optional().nullable(),
    username: z.string().optional().nullable(),
    password: z.string().optional().nullable(),
    file: z.any(),
    filename: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    caption: z.string().optional().nullable(),
    altText: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  if (!validated.file) {
    return { success: false, output: {}, error: 'File is required' }
  }

  let userFile
  try {
    userFile = processSingleFileToUserFile(validated.file, requestId, logger)
  } catch (error) {
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to process file',
    }
  }

  logger.info(`[${requestId}] Downloading file from storage`, {
    fileName: userFile.name,
    key: userFile.key,
  })

  let fileBuffer: Buffer
  try {
    fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
  } catch (error) {
    logger.error(`[${requestId}] Failed to download file:`, error)
    return {
      success: false,
      output: {},
      error: `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }

  const filename = validated.filename || userFile.name
  const mimeType = userFile.type || getMimeTypeFromExtension(getFileExtension(filename))

  const formData = new FormData()
  const uint8Array = new Uint8Array(fileBuffer)
  const blob = new Blob([uint8Array], { type: mimeType })
  formData.append('file', blob, filename)

  if (validated.title) formData.append('title', validated.title)
  if (validated.caption) formData.append('caption', validated.caption)
  if (validated.altText) formData.append('alt_text', validated.altText)
  if (validated.description) formData.append('description', validated.description)

  let uploadUrl: string
  const headers: Record<string, string> = {}

  if (validated.siteUrl && validated.username && validated.password) {
    uploadUrl = `${validated.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`
    const credentials = Buffer.from(`${validated.username}:${validated.password}`).toString('base64')
    headers.Authorization = `Basic ${credentials}`
    headers['Content-Disposition'] = `attachment; filename="${filename}"`
  } else if (validated.siteId && validated.accessToken) {
    uploadUrl = `https://public-api.wordpress.com/wp/v2/sites/${validated.siteId}/media`
    headers.Authorization = `Bearer ${validated.accessToken}`
  } else {
    return {
      success: false,
      output: {},
      error: 'Either siteUrl with username/password, or siteId with accessToken is required',
    }
  }

  logger.info(`[${requestId}] Uploading to WordPress`, {
    filename,
    mimeType,
    size: fileBuffer.length,
  })

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    let errorMessage = `WordPress API error: ${uploadResponse.statusText}`
    try {
      const errorJson = JSON.parse(errorText)
      errorMessage = errorJson.message || errorJson.error || errorMessage
    } catch {
      // Use default error message
    }

    logger.error(`[${requestId}] WordPress API error:`, {
      status: uploadResponse.status,
      error: errorText,
    })
    return { success: false, output: {}, error: errorMessage }
  }

  const uploadData = await uploadResponse.json()

  logger.info(`[${requestId}] File uploaded successfully`, {
    mediaId: uploadData.id,
    sourceUrl: uploadData.source_url,
  })

  return {
    success: true,
    output: {
      media: {
        id: uploadData.id,
        date: uploadData.date,
        slug: uploadData.slug,
        type: uploadData.type,
        link: uploadData.link,
        title: uploadData.title,
        caption: uploadData.caption,
        alt_text: uploadData.alt_text,
        media_type: uploadData.media_type,
        mime_type: uploadData.mime_type,
        source_url: uploadData.source_url,
        media_details: uploadData.media_details,
      },
    },
  }
}

export const wordpressHandlers: Record<string, ToolProxyHandler> = {
  'upload': handleUpload,
}
