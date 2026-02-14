import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('GoogleVaultHandler')

const DownloadExportFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectName: z.string().min(1, 'Object name is required'),
  fileName: z.string().optional().nullable(),
})

/**
 * Download an export file from Google Vault via Google Cloud Storage.
 * Fetches the file content from a GCS bucket and returns it as base64.
 */
const handleDownloadExportFile: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = DownloadExportFileSchema.parse(body)

    const bucket = encodeURIComponent(validated.bucketName)
    const object = encodeURIComponent(validated.objectName)
    const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`

    logger.info(`[${requestId}] Downloading file from Google Vault`, {
      bucketName: validated.bucketName,
      objectName: validated.objectName,
    })

    const downloadResponse = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    })

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text().catch(() => '')
      const errorMessage = `Failed to download file: ${errorText || downloadResponse.statusText}`
      logger.error(`[${requestId}] Failed to download Vault export file`, {
        status: downloadResponse.status,
        error: errorText,
      })
      throw new Error(errorMessage)
    }

    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream'
    const disposition = downloadResponse.headers.get('content-disposition') || ''
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/)

    let resolvedName = validated.fileName
    if (!resolvedName) {
      if (match?.[1]) {
        try {
          resolvedName = decodeURIComponent(match[1])
        } catch {
          resolvedName = match[1]
        }
      } else if (match?.[2]) {
        resolvedName = match[2]
      } else if (validated.objectName) {
        const parts = validated.objectName.split('/')
        resolvedName = parts[parts.length - 1] || 'vault-export.bin'
      } else {
        resolvedName = 'vault-export.bin'
      }
    }

    const arrayBuffer = await downloadResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    logger.info(`[${requestId}] Vault export file downloaded successfully`, {
      name: resolvedName,
      size: buffer.length,
      mimeType: contentType,
    })

    return {
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType: contentType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error downloading Google Vault export file:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to download export file',
    }
  }
}

export const googleVaultHandlers: Record<string, ToolProxyHandler> = {
  'download-export-file': handleDownloadExportFile,
}
