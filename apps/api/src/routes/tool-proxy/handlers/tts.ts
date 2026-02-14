import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('TtsProxyHandler')

/**
 * Generates speech audio from text using OpenAI or ElevenLabs.
 */
const handleDefault: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    apiKey: z.string().min(1, 'API key is required'),
    text: z.string().min(1, 'Text is required'),
    voice: z.string().optional().nullable(),
    voiceId: z.string().optional().nullable(),
    model: z.string().optional().nullable(),
    modelId: z.string().optional().nullable(),
    provider: z.string().optional().default('openai'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Generating TTS audio`, {
    provider: validated.provider,
    textLength: validated.text.length,
  })

  if (validated.provider === 'elevenlabs') {
    const voiceId = validated.voiceId || validated.voice || '21m00Tcm4TlvDq8ikWAM'
    const modelId = validated.modelId || validated.model || 'eleven_monolingual_v1'

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': validated.apiKey,
      },
      body: JSON.stringify({
        text: validated.text,
        model_id: modelId,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error(`[${requestId}] ElevenLabs TTS error:`, errorData)
      return {
        success: false,
        output: {},
        error: (errorData as Record<string, unknown>).detail?.toString() || 'Failed to generate TTS',
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    const audio = Buffer.from(arrayBuffer).toString('base64')

    logger.info(`[${requestId}] TTS audio generated successfully via ElevenLabs`, {
      size: arrayBuffer.byteLength,
    })

    return {
      success: true,
      output: {
        audio,
        contentType: 'audio/mpeg',
      },
    }
  }

  // Default: OpenAI
  const voice = validated.voice || 'alloy'
  const model = validated.model || 'tts-1'

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: validated.text,
      voice,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] OpenAI TTS error:`, errorData)
    return {
      success: false,
      output: {},
      error: (errorData as Record<string, unknown>).error?.toString() || 'Failed to generate TTS',
    }
  }

  const arrayBuffer = await response.arrayBuffer()
  const audio = Buffer.from(arrayBuffer).toString('base64')
  const contentType = response.headers.get('content-type') || 'audio/mpeg'

  logger.info(`[${requestId}] TTS audio generated successfully via OpenAI`, {
    size: arrayBuffer.byteLength,
  })

  return {
    success: true,
    output: {
      audio,
      contentType,
    },
  }
}

/**
 * Unified TTS handler with explicit provider parameter.
 * Delegates to the same logic as the default handler.
 */
const handleUnified: ToolProxyHandler = async (body, c) => {
  return handleDefault(body, c)
}

export const ttsHandlers: Record<string, ToolProxyHandler> = {
  'default': handleDefault,
  'unified': handleUnified,
}
