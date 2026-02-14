import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserId } from '@/middleware/auth'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { isInternalFileUrl, processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MistralProxyHandler')

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']

const ParseSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required').optional(),
  fileData: FileInputSchema.optional(),
  file: FileInputSchema.optional(),
  resultType: z.string().optional(),
  pages: z.array(z.number()).optional(),
  includeImageBase64: z.boolean().optional(),
  imageLimit: z.number().optional(),
  imageMinSize: z.number().optional(),
})

/**
 * Infer MIME type from filename when the provided type is missing or generic.
 */
function inferMimeType(mimeType: string | undefined, filename: string): string {
  if (mimeType && mimeType !== 'application/octet-stream') {
    return mimeType
  }

  const name = filename.toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.webp')) return 'image/webp'
  return 'application/pdf'
}

/**
 * Parse a document using the Mistral OCR API.
 * Supports file object uploads (base64), file path URLs, image/document detection,
 * page selection, and image extraction options.
 */
const handleParse: ToolProxyHandler = async (body, c) => {
  const requestId = generateRequestId()

  try {
    const validated = ParseSchema.parse(body)
    const userId = getUserId(c)

    const fileData = validated.file || validated.fileData
    const filePath = typeof fileData === 'string' ? fileData : validated.filePath

    if (!fileData && (!filePath || filePath.trim() === '')) {
      return {
        success: false,
        output: {},
        error: 'File input is required',
      }
    }

    logger.info(`[${requestId}] Mistral parse request`, {
      hasFileData: Boolean(fileData),
      filePath,
      isWorkspaceFile: filePath ? isInternalFileUrl(filePath) : false,
      userId,
    })

    const mistralBody: Record<string, unknown> = {
      model: 'mistral-ocr-latest',
    }

    if (fileData && typeof fileData === 'object') {
      const userFile = processSingleFileToUserFile(fileData, requestId, logger)

      const mimeType = inferMimeType(userFile.type, userFile.name || '')
      let base64 = userFile.base64
      if (!base64) {
        const buffer = await downloadFileFromStorage(userFile, requestId, logger)
        base64 = buffer.toString('base64')
      }

      const base64Payload = base64.startsWith('data:')
        ? base64
        : `data:${mimeType};base64,${base64}`

      const isImage = mimeType.startsWith('image/')
      if (isImage) {
        mistralBody.document = {
          type: 'image_url',
          image_url: base64Payload,
        }
      } else {
        mistralBody.document = {
          type: 'document_url',
          document_url: base64Payload,
        }
      }
    } else if (filePath) {
      let fileUrl = filePath

      if (isInternalFileUrl(filePath)) {
        const resolution = await resolveInternalFileUrl(filePath, userId, requestId, logger)
        if (resolution.error) {
          return {
            success: false,
            output: {},
            error: resolution.error.message,
          }
        }
        fileUrl = resolution.fileUrl || fileUrl
      } else if (filePath.startsWith('/')) {
        logger.warn(`[${requestId}] Invalid internal path`, {
          userId,
          path: filePath.substring(0, 50),
        })
        return {
          success: false,
          output: {},
          error: 'Invalid file path. Only uploaded files are supported for internal paths.',
        }
      }

      const pathname = new URL(fileUrl).pathname.toLowerCase()
      const isImageUrl = IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext))

      if (isImageUrl) {
        mistralBody.document = {
          type: 'image_url',
          image_url: fileUrl,
        }
      } else {
        mistralBody.document = {
          type: 'document_url',
          document_url: fileUrl,
        }
      }
    }

    if (validated.pages) {
      mistralBody.pages = validated.pages
    }
    if (validated.includeImageBase64 !== undefined) {
      mistralBody.include_image_base64 = validated.includeImageBase64
    }
    if (validated.imageLimit) {
      mistralBody.image_limit = validated.imageLimit
    }
    if (validated.imageMinSize) {
      mistralBody.image_min_size = validated.imageMinSize
    }

    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${validated.apiKey}`,
      },
      body: JSON.stringify(mistralBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Mistral API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Mistral API error: ${response.statusText}`,
      }
    }

    const data = await response.json()

    logger.info(`[${requestId}] Mistral parse successful`)

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

    logger.error(`[${requestId}] Error in Mistral parse:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to parse document with Mistral',
    }
  }
}

export const mistralHandlers: Record<string, ToolProxyHandler> = {
  parse: handleParse,
}
