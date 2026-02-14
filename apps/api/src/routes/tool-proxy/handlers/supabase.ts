import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SupabaseProxyHandler')

/**
 * Uploads a file to Supabase Storage.
 */
const handleStorageUpload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    supabaseUrl: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    apiKey: z.string().min(1, 'API key is required'),
    bucket: z.string().min(1, 'Bucket name is required'),
    path: z.string().optional().nullable(),
    fileName: z.string().min(1, 'File name is required'),
    file: z.any().optional().nullable(),
    fileData: z.any().optional().nullable(),
    contentType: z.string().optional().nullable(),
    upsert: z.boolean().optional().default(false),
  })

  const validated = schema.parse(body)

  const rawFile = validated.file || validated.fileData
  if (!rawFile) {
    return { success: false, output: {}, error: 'File is required' }
  }

  let uploadBody: Buffer
  let uploadContentType: string

  if (typeof rawFile === 'string') {
    const dataUrlMatch = rawFile.match(/^data:([^;]+);base64,(.+)$/s)
    if (dataUrlMatch) {
      const [, mimeType, base64Data] = dataUrlMatch
      uploadBody = Buffer.from(base64Data, 'base64')
      uploadContentType = validated.contentType || mimeType
    } else {
      const cleanedContent = rawFile.replace(/[\s\r\n]/g, '')
      const isLikelyBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(cleanedContent) && cleanedContent.length >= 4

      if (isLikelyBase64) {
        uploadBody = Buffer.from(cleanedContent, 'base64')
      } else {
        uploadBody = Buffer.from(rawFile, 'utf-8')
      }
      uploadContentType = validated.contentType || 'application/octet-stream'
    }
  } else {
    let userFile
    try {
      userFile = processSingleFileToUserFile(rawFile, requestId, logger)
    } catch (error) {
      return {
        success: false,
        output: {},
        error: error instanceof Error ? error.message : 'Failed to process file',
      }
    }

    uploadBody = await downloadFileFromStorage(userFile, requestId, logger)
    uploadContentType = validated.contentType || userFile.type || 'application/octet-stream'
  }

  let fullPath = validated.fileName
  if (validated.path) {
    const folderPath = validated.path.endsWith('/')
      ? validated.path
      : `${validated.path}/`
    fullPath = `${folderPath}${validated.fileName}`
  }

  let baseUrl: string
  if (validated.supabaseUrl) {
    baseUrl = validated.supabaseUrl.replace(/\/$/, '')
  } else if (validated.projectId) {
    baseUrl = `https://${validated.projectId}.supabase.co`
  } else {
    return { success: false, output: {}, error: 'Either supabaseUrl or projectId is required' }
  }

  const uploadUrl = `${baseUrl}/storage/v1/object/${validated.bucket}/${fullPath}`

  const headers: Record<string, string> = {
    apikey: validated.apiKey,
    Authorization: `Bearer ${validated.apiKey}`,
    'Content-Type': uploadContentType,
  }

  if (validated.upsert) {
    headers['x-upsert'] = 'true'
  }

  logger.info(`[${requestId}] Uploading to Supabase Storage`, {
    bucket: validated.bucket,
    path: fullPath,
    size: uploadBody.length,
  })

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers,
    body: new Uint8Array(uploadBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorData: Record<string, unknown>
    try {
      errorData = JSON.parse(errorText)
    } catch {
      errorData = { message: errorText }
    }

    logger.error(`[${requestId}] Supabase Storage upload failed:`, {
      status: response.status,
      error: errorData,
    })

    return {
      success: false,
      output: {},
      error: (errorData.message as string) || (errorData.error as string) || `Upload failed: ${response.statusText}`,
    }
  }

  const result = await response.json()

  logger.info(`[${requestId}] File uploaded successfully to Supabase Storage`, {
    bucket: validated.bucket,
    path: fullPath,
  })

  const publicUrl = `${baseUrl}/storage/v1/object/public/${validated.bucket}/${fullPath}`

  return {
    success: true,
    output: {
      key: result.Key || fullPath,
      path: fullPath,
      bucket: validated.bucket,
      publicUrl,
    },
  }
}

export const supabaseHandlers: Record<string, ToolProxyHandler> = {
  'storage-upload': handleStorageUpload,
}
