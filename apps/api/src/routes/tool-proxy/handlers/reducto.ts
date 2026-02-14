import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserId } from '@/middleware/auth'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('ReductoProxyHandler')

const ParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.array(z.number()).optional(),
  tableOutputFormat: z.enum(['html', 'md']).optional(),
})

/**
 * Parse a document using the Reducto API.
 * Supports file uploads, page ranges, and table output format configuration.
 */
const handleParse: ToolProxyHandler = async (body, c) => {
  const requestId = generateRequestId()

  try {
    const validated = ParseSchema.parse(body)
    const userId = getUserId(c)

    logger.info(`[${requestId}] Reducto parse request`, {
      hasFile: Boolean(validated.file),
      filePath: validated.filePath,
      userId,
    })

    const resolution = await resolveFileInputToUrl({
      file: validated.file,
      filePath: validated.filePath,
      userId,
      requestId,
      logger,
    })

    if (resolution.error) {
      return {
        success: false,
        output: {},
        error: resolution.error.message,
      }
    }

    const fileUrl = resolution.fileUrl
    if (!fileUrl) {
      return { success: false, output: {}, error: 'File input is required' }
    }

    const reductoBody: Record<string, unknown> = {
      input: fileUrl,
    }

    if (validated.pages && validated.pages.length > 0) {
      reductoBody.settings = {
        page_range: {
          start: Math.min(...validated.pages),
          end: Math.max(...validated.pages),
        },
      }
    }

    if (validated.tableOutputFormat) {
      reductoBody.formatting = {
        table_output_format: validated.tableOutputFormat,
      }
    }

    const response = await fetch('https://platform.reducto.ai/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${validated.apiKey}`,
      },
      body: JSON.stringify(reductoBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Reducto API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Reducto API error: ${response.statusText}`,
      }
    }

    const data = await response.json()

    logger.info(`[${requestId}] Reducto parse successful`)

    return {
      success: true,
      output: data,
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return {
        success: false,
        output: {},
        error: 'Invalid request data',
      }
    }

    logger.error(`[${requestId}] Error in Reducto parse:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to parse document with Reducto',
    }
  }
}

export const reductoHandlers: Record<string, ToolProxyHandler> = {
  parse: handleParse,
}
