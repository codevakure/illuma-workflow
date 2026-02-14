import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('TwilioHandler')

const GetRecordingSchema = z.object({
  accountSid: z.string().min(1, 'Account SID is required'),
  authToken: z.string().min(1, 'Auth token is required'),
  recordingSid: z.string().min(1, 'Recording SID is required'),
})

/** Map common MIME types to file extensions. */
const MIME_TO_EXTENSION: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
} as const

/**
 * Get a Twilio recording by SID, including metadata, media content,
 * and any available transcriptions.
 */
const handleGetRecording: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = GetRecordingSchema.parse(body)

    if (!validated.accountSid.startsWith('AC')) {
      return {
        success: false,
        output: {},
        error: `Invalid Account SID format. Account SID must start with "AC" (you provided: ${validated.accountSid.substring(0, 2)}...)`,
      }
    }

    const twilioAuth = Buffer.from(
      `${validated.accountSid}:${validated.authToken}`
    ).toString('base64')

    logger.info(`[${requestId}] Getting recording info from Twilio`, {
      recordingSid: validated.recordingSid,
    })

    const infoUrl = `https://api.twilio.com/2010-04-01/Accounts/${validated.accountSid}/Recordings/${validated.recordingSid}.json`

    const infoResponse = await fetch(infoUrl, {
      method: 'GET',
      headers: { Authorization: `Basic ${twilioAuth}` },
    })

    if (!infoResponse.ok) {
      const errorData = await infoResponse.json().catch(() => ({}))
      const errorMessage =
        (errorData as Record<string, string>).message ||
        `Twilio API error: ${infoResponse.status}`
      throw new Error(errorMessage)
    }

    const data = await infoResponse.json()

    if (data.error_code) {
      return {
        success: false,
        output: {},
        error: data.message || data.error_message || 'Failed to retrieve recording',
      }
    }

    const baseUrl = 'https://api.twilio.com'
    const mediaUrl = data.uri ? `${baseUrl}${data.uri.replace('.json', '')}` : undefined

    let transcriptionText: string | undefined
    let transcriptionStatus: string | undefined
    let transcriptionPrice: string | undefined
    let transcriptionPriceUnit: string | undefined
    let file:
      | { name: string; mimeType: string; data: string; size: number }
      | undefined

    try {
      const transcriptionUrl = `https://api.twilio.com/2010-04-01/Accounts/${validated.accountSid}/Transcriptions.json?RecordingSid=${data.sid}`
      logger.info(`[${requestId}] Checking for transcriptions`)

      const transcriptionResponse = await fetch(transcriptionUrl, {
        method: 'GET',
        headers: { Authorization: `Basic ${twilioAuth}` },
      })

      if (transcriptionResponse.ok) {
        const transcriptionData = await transcriptionResponse.json()

        if (transcriptionData.transcriptions && transcriptionData.transcriptions.length > 0) {
          const transcription = transcriptionData.transcriptions[0]
          transcriptionText = transcription.transcription_text
          transcriptionStatus = transcription.status
          transcriptionPrice = transcription.price
          transcriptionPriceUnit = transcription.price_unit
          logger.info(`[${requestId}] Transcription found`, {
            status: transcriptionStatus,
            textLength: transcriptionText?.length,
          })
        }
      }
    } catch (error) {
      logger.warn(`[${requestId}] Failed to fetch transcription:`, error)
    }

    if (mediaUrl) {
      try {
        const mediaResponse = await fetch(mediaUrl, {
          method: 'GET',
          headers: { Authorization: `Basic ${twilioAuth}` },
        })

        if (mediaResponse.ok) {
          const contentType =
            mediaResponse.headers.get('content-type') || 'application/octet-stream'
          const extension = MIME_TO_EXTENSION[contentType] || 'dat'
          const arrayBuffer = await mediaResponse.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const fileName = `${data.sid || validated.recordingSid}.${extension}`

          file = {
            name: fileName,
            mimeType: contentType,
            data: buffer.toString('base64'),
            size: buffer.length,
          }
        }
      } catch (error) {
        logger.warn(`[${requestId}] Failed to download recording media:`, error)
      }
    }

    logger.info(`[${requestId}] Twilio recording fetched successfully`, {
      recordingSid: data.sid,
      hasFile: !!file,
      hasTranscription: !!transcriptionText,
    })

    return {
      success: true,
      output: {
        success: true,
        recordingSid: data.sid,
        callSid: data.call_sid,
        duration: data.duration ? Number.parseInt(data.duration, 10) : undefined,
        status: data.status,
        channels: data.channels,
        source: data.source,
        mediaUrl,
        file,
        price: data.price,
        priceUnit: data.price_unit,
        uri: data.uri,
        transcriptionText,
        transcriptionStatus,
        transcriptionPrice,
        transcriptionPriceUnit,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Twilio recording:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Twilio recording',
    }
  }
}

export const twilioHandlers: Record<string, ToolProxyHandler> = {
  'get-recording': handleGetRecording,
}
