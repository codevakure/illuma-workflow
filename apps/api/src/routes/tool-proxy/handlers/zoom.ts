import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('ZoomHandler')

const GetRecordingsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  meetingId: z.string().min(1, 'Meeting ID is required'),
  includeFolderItems: z.boolean().optional(),
  ttl: z.number().optional(),
  downloadFiles: z.boolean().optional().default(false),
})

/** Map common MIME types to file extensions. */
const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'text/vtt': 'vtt',
  'text/plain': 'txt',
  'application/json': 'json',
  'application/octet-stream': 'dat',
} as const

/**
 * Get recordings for a Zoom meeting, optionally downloading file content as base64.
 */
const handleGetRecordings: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = GetRecordingsSchema.parse(body)

    const baseUrl = `https://api.zoom.us/v2/meetings/${encodeURIComponent(validated.meetingId)}/recordings`
    const queryParams = new URLSearchParams()

    if (validated.includeFolderItems != null) {
      queryParams.append('include_folder_items', String(validated.includeFolderItems))
    }
    if (validated.ttl) {
      queryParams.append('ttl', String(validated.ttl))
    }

    const queryString = queryParams.toString()
    const apiUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl

    logger.info(`[${requestId}] Fetching recordings from Zoom`, {
      meetingId: validated.meetingId,
    })

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validated.accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const files: Array<{
      name: string
      mimeType: string
      data: string
      size: number
    }> = []

    if (validated.downloadFiles && Array.isArray(data.recording_files)) {
      for (const file of data.recording_files) {
        if (!file?.download_url) continue

        try {
          const downloadResponse = await fetch(file.download_url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${validated.accessToken}` },
          })

          if (!downloadResponse.ok) continue

          const contentType =
            downloadResponse.headers.get('content-type') || 'application/octet-stream'
          const arrayBuffer = await downloadResponse.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const extension =
            file.file_extension?.toString().toLowerCase() ||
            MIME_TO_EXTENSION[contentType] ||
            'dat'
          const fileName = `zoom-recording-${file.id || file.recording_start || Date.now()}.${extension}`

          files.push({
            name: fileName,
            mimeType: contentType,
            data: buffer.toString('base64'),
            size: buffer.length,
          })
        } catch (error) {
          logger.warn(`[${requestId}] Failed to download recording file:`, error)
        }
      }
    }

    logger.info(`[${requestId}] Zoom recordings fetched successfully`, {
      recordingCount: data.recording_files?.length || 0,
      downloadedCount: files.length,
    })

    return {
      success: true,
      output: {
        recording: {
          uuid: data.uuid,
          id: data.id,
          account_id: data.account_id,
          host_id: data.host_id,
          topic: data.topic,
          type: data.type,
          start_time: data.start_time,
          duration: data.duration,
          total_size: data.total_size,
          recording_count: data.recording_count,
          share_url: data.share_url,
          recording_files: (data.recording_files || []).map(
            (file: Record<string, unknown>) => ({
              id: file.id,
              meeting_id: file.meeting_id,
              recording_start: file.recording_start,
              recording_end: file.recording_end,
              file_type: file.file_type,
              file_extension: file.file_extension,
              file_size: file.file_size,
              play_url: file.play_url,
              download_url: file.download_url,
              status: file.status,
              recording_type: file.recording_type,
            })
          ),
        },
        files: files.length > 0 ? files : undefined,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Zoom recordings:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Zoom recordings',
    }
  }
}

export const zoomHandlers: Record<string, ToolProxyHandler> = {
  'get-recordings': handleGetRecordings,
}
