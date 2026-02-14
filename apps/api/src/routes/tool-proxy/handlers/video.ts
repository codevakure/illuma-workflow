import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('VideoProxyHandler')

const MAX_POLL_RETRIES = 60
const POLL_INTERVAL_MS = 5000

/**
 * Sleeps for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generates a video from a text prompt using Replicate or another provider.
 */
const handleDefault: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    apiKey: z.string().min(1, 'API key is required'),
    prompt: z.string().min(1, 'Prompt is required'),
    model: z.string().optional().nullable(),
    provider: z.string().optional().default('replicate'),
    duration: z.number().optional().nullable(),
    aspectRatio: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Starting video generation`, {
    provider: validated.provider,
    model: validated.model,
    promptLength: validated.prompt.length,
  })

  if (validated.provider !== 'replicate') {
    return {
      success: false,
      output: {},
      error: `Unsupported video provider: ${validated.provider}. Currently only 'replicate' is supported.`,
    }
  }

  const modelVersion = validated.model || 'anotherjesse/zeroscope-v2-xl:9f747673945c62801b13b84701c783929c0ee784e4748ec062204894dda1a351'

  const createPayload: Record<string, unknown> = {
    version: modelVersion,
    input: {
      prompt: validated.prompt,
    },
  }

  if (validated.duration) {
    (createPayload.input as Record<string, unknown>).num_frames = Math.round(validated.duration * 8)
  }

  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${validated.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
  })

  if (!createResponse.ok) {
    const errorText = await createResponse.text()
    logger.error(`[${requestId}] Replicate API error:`, {
      status: createResponse.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Replicate API error: ${createResponse.statusText}`,
    }
  }

  const createData = await createResponse.json()
  const predictionId = createData.id

  logger.info(`[${requestId}] Replicate prediction created: ${predictionId}`)

  let attempts = 0
  while (attempts < MAX_POLL_RETRIES) {
    await sleep(POLL_INTERVAL_MS)

    const statusResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: {
          Authorization: `Token ${validated.apiKey}`,
        },
      }
    )

    if (!statusResponse.ok) {
      logger.error(`[${requestId}] Replicate status check failed: ${statusResponse.status}`)
      attempts++
      continue
    }

    const statusData = await statusResponse.json()

    if (statusData.status === 'succeeded') {
      const videoUrl = Array.isArray(statusData.output)
        ? statusData.output[0]
        : statusData.output

      logger.info(`[${requestId}] Video generation completed after ${attempts * (POLL_INTERVAL_MS / 1000)}s`)

      return {
        success: true,
        output: {
          videoUrl,
          status: 'succeeded',
          predictionId,
        },
      }
    }

    if (statusData.status === 'failed') {
      logger.error(`[${requestId}] Video generation failed:`, statusData.error)
      return {
        success: false,
        output: {},
        error: statusData.error || 'Video generation failed',
      }
    }

    attempts++
  }

  logger.error(`[${requestId}] Video generation timed out after ${MAX_POLL_RETRIES} retries`)

  return {
    success: false,
    output: {},
    error: 'Video generation timed out',
  }
}

export const videoHandlers: Record<string, ToolProxyHandler> = {
  'default': handleDefault,
}
