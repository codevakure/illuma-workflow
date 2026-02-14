import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('PipedriveHandler')

const GetFilesSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  deal_id: z.string().optional().nullable(),
  person_id: z.string().optional().nullable(),
  org_id: z.string().optional().nullable(),
  limit: z.string().optional().nullable(),
  downloadFiles: z.boolean().optional().default(false),
})

/**
 * Get files from Pipedrive, optionally filtered by deal, person, or organization.
 * When downloadFiles is true, file content is fetched and returned as base64.
 */
const handleGetFiles: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = GetFilesSchema.parse(body)

    const baseUrl = 'https://api.pipedrive.com/v1/files'
    const queryParams = new URLSearchParams()

    if (validated.deal_id) queryParams.append('deal_id', validated.deal_id)
    if (validated.person_id) queryParams.append('person_id', validated.person_id)
    if (validated.org_id) queryParams.append('org_id', validated.org_id)
    if (validated.limit) queryParams.append('limit', validated.limit)

    const queryString = queryParams.toString()
    const apiUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl

    logger.info(`[${requestId}] Fetching files from Pipedrive`, {
      deal_id: validated.deal_id,
      person_id: validated.person_id,
      org_id: validated.org_id,
    })

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        (errorData as Record<string, string>).error || `Pipedrive API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const data = await response.json()

    if (!data.success) {
      logger.error(`[${requestId}] Pipedrive API request failed`, { data })
      throw new Error(data.error || 'Failed to fetch files from Pipedrive')
    }

    const files: Array<{ id?: number; name?: string; url?: string }> = data.data || []
    const downloadedFiles: Array<{
      name: string
      mimeType: string
      data: string
      size: number
    }> = []

    if (validated.downloadFiles) {
      for (const file of files) {
        if (!file?.url) continue

        try {
          const downloadResponse = await fetch(file.url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${validated.accessToken}` },
          })

          if (!downloadResponse.ok) continue

          const arrayBuffer = await downloadResponse.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const mimeType =
            downloadResponse.headers.get('content-type') || 'application/octet-stream'
          const fileName = file.name || `pipedrive-file-${file.id || Date.now()}`

          downloadedFiles.push({
            name: fileName,
            mimeType,
            data: buffer.toString('base64'),
            size: buffer.length,
          })
        } catch (error) {
          logger.warn(`[${requestId}] Failed to download file ${file.id}:`, error)
        }
      }
    }

    logger.info(`[${requestId}] Pipedrive files fetched successfully`, {
      fileCount: files.length,
      downloadedCount: downloadedFiles.length,
    })

    return {
      success: true,
      output: {
        files,
        downloadedFiles: downloadedFiles.length > 0 ? downloadedFiles : undefined,
        total_items: files.length,
        success: true,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Pipedrive files:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Pipedrive files',
    }
  }
}

export const pipedriveHandlers: Record<string, ToolProxyHandler> = {
  'get-files': handleGetFiles,
}
