import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('DropboxProxyHandler')

/**
 * Uploads a file to Dropbox.
 */
const handleUpload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    path: z.string().min(1, 'Destination path is required'),
    file: z.any(),
    mode: z.enum(['add', 'overwrite']).optional().nullable(),
    autorename: z.boolean().optional().nullable(),
    mute: z.boolean().optional().nullable(),
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

  let finalPath = validated.path
  if (finalPath.endsWith('/')) {
    finalPath = `${finalPath}${userFile.name}`
  }

  logger.info(`[${requestId}] Uploading to Dropbox: ${finalPath} (${fileBuffer.length} bytes)`)

  const dropboxApiArg = {
    path: finalPath,
    mode: validated.mode || 'add',
    autorename: validated.autorename ?? true,
    mute: validated.mute ?? false,
  }

  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify(dropboxApiArg),
    },
    body: new Uint8Array(fileBuffer),
  })

  const data = await response.json()

  if (!response.ok) {
    const errorMessage = data.error_summary || data.error?.message || 'Failed to upload file'
    logger.error(`[${requestId}] Dropbox API error:`, { status: response.status, data })
    return { success: false, output: {}, error: errorMessage }
  }

  logger.info(`[${requestId}] File uploaded successfully to ${data.path_display}`)

  return {
    success: true,
    output: {
      file: data,
    },
  }
}

export const dropboxHandlers: Record<string, ToolProxyHandler> = {
  'upload': handleUpload,
}
