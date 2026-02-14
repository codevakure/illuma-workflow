import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('StagehandHandler')

const STAGEHAND_API_BASE = 'https://api.stagehand.dev/v1'

const AgentSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  instruction: z.string().min(1, 'Instruction is required'),
  url: z.string().optional(),
  maxSteps: z.number().optional().default(10),
})

const ExtractSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  url: z.string().min(1, 'URL is required'),
  instruction: z.string().min(1, 'Instruction is required'),
  schema: z.record(z.unknown()).optional(),
})

/**
 * Run a Stagehand agent with the given instruction and optional URL.
 */
const handleAgent: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = AgentSchema.parse(body)

    logger.info(`[${requestId}] Running Stagehand agent`, {
      hasUrl: !!validated.url,
      maxSteps: validated.maxSteps,
    })

    const response = await fetch(`${STAGEHAND_API_BASE}/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validated.apiKey}`,
      },
      body: JSON.stringify({
        instruction: validated.instruction,
        url: validated.url,
        maxSteps: validated.maxSteps,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Stagehand API error ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    logger.info(`[${requestId}] Stagehand agent completed successfully`)

    return {
      success: true,
      output: {
        result: data.result ?? data,
        steps: data.steps,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error running Stagehand agent:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to run Stagehand agent',
    }
  }
}

/**
 * Extract structured data from a web page using Stagehand.
 */
const handleExtract: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = ExtractSchema.parse(body)

    logger.info(`[${requestId}] Running Stagehand extraction`, {
      url: validated.url,
      hasSchema: !!validated.schema,
    })

    const response = await fetch(`${STAGEHAND_API_BASE}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validated.apiKey}`,
      },
      body: JSON.stringify({
        url: validated.url,
        instruction: validated.instruction,
        schema: validated.schema,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Stagehand API error ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    logger.info(`[${requestId}] Stagehand extraction completed successfully`)

    return {
      success: true,
      output: { data: data.data ?? data },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error running Stagehand extraction:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to run Stagehand extraction',
    }
  }
}

export const stagehandHandlers: Record<string, ToolProxyHandler> = {
  agent: handleAgent,
  extract: handleExtract,
}
