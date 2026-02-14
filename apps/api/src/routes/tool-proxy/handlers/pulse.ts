import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserId } from '@/middleware/auth'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('PulseProxyHandler')

const ParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.string().optional(),
  extractFigure: z.boolean().optional(),
  figureDescription: z.boolean().optional(),
  returnHtml: z.boolean().optional(),
  chunking: z.string().optional(),
  chunkSize: z.number().optional(),
})

/**
 * Parse a document using the Pulse API.
 * Sends a multipart/form-data request with file URL and optional extraction parameters.
 */
const handleParse: ToolProxyHandler = async (body, c) => {
  const requestId = generateRequestId()

  try {
    const validated = ParseSchema.parse(body)
    const userId = getUserId(c)

    logger.info(`[${requestId}] Pulse parse request`, {
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

    const formData = new FormData()
    formData.append('file_url', fileUrl)

    if (validated.pages) {
      formData.append('pages', validated.pages)
    }
    if (validated.extractFigure !== undefined) {
      formData.append('extract_figure', String(validated.extractFigure))
    }
    if (validated.figureDescription !== undefined) {
      formData.append('figure_description', String(validated.figureDescription))
    }
    if (validated.returnHtml !== undefined) {
      formData.append('return_html', String(validated.returnHtml))
    }
    if (validated.chunking) {
      formData.append('chunking', validated.chunking)
    }
    if (validated.chunkSize !== undefined) {
      formData.append('chunk_size', String(validated.chunkSize))
    }

    const pulsePayload = new Response(formData)
    const contentType = pulsePayload.headers.get('content-type') || 'multipart/form-data'
    const bodyBuffer = Buffer.from(await pulsePayload.arrayBuffer())

    const response = await fetch('https://api.runpulse.com/extract', {
      method: 'POST',
      headers: {
        'x-api-key': validated.apiKey,
        'Content-Type': contentType,
      },
      body: bodyBuffer,
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Pulse API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Pulse API error: ${response.statusText}`,
      }
    }

    const data = await response.json()

    logger.info(`[${requestId}] Pulse parse successful`)

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

    logger.error(`[${requestId}] Error in Pulse parse:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to parse document with Pulse',
    }
  }
}

export const pulseHandlers: Record<string, ToolProxyHandler> = {
  parse: handleParse,
}
