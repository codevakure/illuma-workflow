import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SttProxyHandler')

/**
 * Transcribes audio to text using OpenAI Whisper or another provider.
 */
const handleDefault: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    apiKey: z.string().min(1, 'API key is required'),
    audioUrl: z.string().optional().nullable(),
    audioBase64: z.string().optional().nullable(),
    model: z.string().optional().default('whisper-1'),
    provider: z.string().optional().default('openai'),
    language: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  if (!validated.audioUrl && !validated.audioBase64) {
    return { success: false, output: {}, error: 'Either audioUrl or audioBase64 is required' }
  }

  logger.info(`[${requestId}] Transcribing audio`, {
    provider: validated.provider,
    model: validated.model,
    hasUrl: !!validated.audioUrl,
    hasBase64: !!validated.audioBase64,
  })

  let audioBuffer: Buffer
  let audioFileName = 'audio.mp3'
  let audioMimeType = 'audio/mpeg'

  if (validated.audioBase64) {
    audioBuffer = Buffer.from(validated.audioBase64, 'base64')
  } else if (validated.audioUrl) {
    logger.info(`[${requestId}] Downloading audio from URL: ${validated.audioUrl}`)

    const response = await fetch(validated.audioUrl)
    if (!response.ok) {
      return {
        success: false,
        output: {},
        error: `Failed to download audio from URL: ${response.statusText}`,
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    audioBuffer = Buffer.from(arrayBuffer)
    audioFileName = validated.audioUrl.split('/').pop() || 'audio.mp3'
    audioMimeType = response.headers.get('content-type') || 'audio/mpeg'
  } else {
    return { success: false, output: {}, error: 'No audio source provided' }
  }

  // Default: OpenAI Whisper
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: audioMimeType })
  formData.append('file', blob, audioFileName)
  formData.append('model', validated.model)

  if (validated.language) {
    formData.append('language', validated.language)
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Transcription API error:`, errorData)
    return {
      success: false,
      output: {},
      error: (errorData as Record<string, unknown>).error?.toString() || 'Failed to transcribe audio',
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Audio transcribed successfully`)

  return {
    success: true,
    output: {
      text: data.text,
    },
  }
}

export const sttHandlers: Record<string, ToolProxyHandler> = {
  'default': handleDefault,
}
