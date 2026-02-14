import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('GoogleDriveProxyHandler')

const GOOGLE_DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

/**
 * Builds a multipart/related body for the Google Drive upload API.
 */
function buildMultipartBody(
  metadata: Record<string, unknown>,
  fileBuffer: Buffer,
  mimeType: string,
  boundary: string
): string {
  const parts: string[] = []

  parts.push(`--${boundary}`)
  parts.push('Content-Type: application/json; charset=UTF-8')
  parts.push('')
  parts.push(JSON.stringify(metadata))

  parts.push(`--${boundary}`)
  parts.push(`Content-Type: ${mimeType}`)
  parts.push('Content-Transfer-Encoding: base64')
  parts.push('')
  parts.push(fileBuffer.toString('base64'))

  parts.push(`--${boundary}--`)

  return parts.join('\r\n')
}

/**
 * Uploads a file to Google Drive via multipart upload.
 */
const handleUpload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    fileName: z.string().min(1, 'File name is required'),
    file: z.any(),
    mimeType: z.string().optional().nullable(),
    folderId: z.string().optional().nullable(),
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

  const uploadMimeType = validated.mimeType || userFile.type || 'application/octet-stream'

  const metadata: Record<string, unknown> = {
    name: validated.fileName,
    mimeType: uploadMimeType,
  }

  if (validated.folderId && validated.folderId.trim() !== '') {
    metadata.parents = [validated.folderId.trim()]
  }

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(7)}`
  const multipartBody = buildMultipartBody(metadata, fileBuffer, uploadMimeType, boundary)

  logger.info(`[${requestId}] Uploading to Google Drive via multipart upload`, {
    fileName: validated.fileName,
    size: fileBuffer.length,
    mimeType: uploadMimeType,
  })

  const uploadResponse = await fetch(
    `${GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(multipartBody, 'utf-8').toString(),
      },
      body: multipartBody,
    }
  )

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    logger.error(`[${requestId}] Google Drive API error:`, {
      status: uploadResponse.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Google Drive API error: ${uploadResponse.statusText}`,
    }
  }

  const uploadData = await uploadResponse.json()
  const fileId = uploadData.id

  const finalFileResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents`,
    {
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  const finalFile = await finalFileResponse.json()

  logger.info(`[${requestId}] Upload complete`, { fileId: finalFile.id })

  return {
    success: true,
    output: {
      file: {
        id: finalFile.id,
        name: finalFile.name,
        mimeType: finalFile.mimeType,
        webViewLink: finalFile.webViewLink,
        webContentLink: finalFile.webContentLink,
        size: finalFile.size,
        createdTime: finalFile.createdTime,
        modifiedTime: finalFile.modifiedTime,
        parents: finalFile.parents,
      },
    },
  }
}

/**
 * Downloads a file from Google Drive and returns its content as base64.
 */
const handleDownload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    fileId: z.string().min(1, 'File ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Downloading file from Google Drive`, { fileId: validated.fileId })

  const downloadResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${validated.fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  if (!downloadResponse.ok) {
    const errorText = await downloadResponse.text()
    logger.error(`[${requestId}] Google Drive download error:`, {
      status: downloadResponse.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Failed to download file: ${downloadResponse.statusText}`,
    }
  }

  const arrayBuffer = await downloadResponse.arrayBuffer()
  const content = Buffer.from(arrayBuffer).toString('base64')
  const mimeType = downloadResponse.headers.get('content-type') || 'application/octet-stream'

  logger.info(`[${requestId}] File downloaded successfully`, {
    fileId: validated.fileId,
    size: arrayBuffer.byteLength,
    mimeType,
  })

  return {
    success: true,
    output: {
      content,
      mimeType,
    },
  }
}

export const googleDriveHandlers: Record<string, ToolProxyHandler> = {
  'upload': handleUpload,
  'download': handleDownload,
}
