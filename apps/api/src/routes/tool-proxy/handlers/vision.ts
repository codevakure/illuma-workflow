import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('VisionProxyHandler')

/**
 * Analyzes an image using a vision-capable LLM (OpenAI or Anthropic).
 */
const handleAnalyze: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    apiKey: z.string().min(1, 'API key is required'),
    imageUrl: z.string().optional().nullable(),
    imageBase64: z.string().optional().nullable(),
    prompt: z.string().optional().default('Describe this image'),
    model: z.string().optional().default('gpt-4o'),
    provider: z.string().optional().default('openai'),
  })

  const validated = schema.parse(body)

  if (!validated.imageUrl && !validated.imageBase64) {
    return { success: false, output: {}, error: 'Either imageUrl or imageBase64 is required' }
  }

  const imageSource = validated.imageBase64
    ? `data:image/jpeg;base64,${validated.imageBase64}`
    : validated.imageUrl!

  logger.info(`[${requestId}] Analyzing image`, {
    provider: validated.provider,
    model: validated.model,
    hasUrl: !!validated.imageUrl,
    hasBase64: !!validated.imageBase64,
  })

  if (validated.provider === 'anthropic') {
    let requestBody: Record<string, unknown>

    if (imageSource.startsWith('data:')) {
      const base64Match = imageSource.match(/^data:([^;]+);base64,(.+)$/)
      if (!base64Match) {
        return { success: false, output: {}, error: 'Invalid base64 image format' }
      }
      const [, mediaType, base64Data] = base64Match

      requestBody = {
        model: validated.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: validated.prompt },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
      }
    } else {
      requestBody = {
        model: validated.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: validated.prompt },
              {
                type: 'image',
                source: { type: 'url', url: imageSource },
              },
            ],
          },
        ],
      }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': validated.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error(`[${requestId}] Anthropic API error:`, errorData)
      return {
        success: false,
        output: {},
        error: (errorData as Record<string, unknown>).error?.toString() || 'Failed to analyze image',
      }
    }

    const data = await response.json()
    const description = data.content?.[0]?.text || ''

    logger.info(`[${requestId}] Image analyzed successfully via Anthropic`)

    return {
      success: true,
      output: { description },
    }
  }

  // Default: OpenAI
  const requestBody = {
    model: validated.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: validated.prompt },
          {
            type: 'image_url',
            image_url: {
              url: imageSource,
            },
          },
        ],
      },
    ],
    max_completion_tokens: 1000,
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] OpenAI API error:`, errorData)
    return {
      success: false,
      output: {},
      error: (errorData as Record<string, unknown>).error?.toString() || 'Failed to analyze image',
    }
  }

  const data = await response.json()
  const description = data.choices?.[0]?.message?.content || ''

  logger.info(`[${requestId}] Image analyzed successfully via OpenAI`)

  return {
    success: true,
    output: { description },
  }
}

export const visionHandlers: Record<string, ToolProxyHandler> = {
  'analyze': handleAnalyze,
}
