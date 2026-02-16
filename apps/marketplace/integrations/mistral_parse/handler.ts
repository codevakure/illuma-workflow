import type { ToolHandler } from '../../sdk/types'

/** Image file extensions used to determine document type for the Mistral OCR API. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']

/**
 * Determines the MIME type from a filename when the type is missing or generic.
 */
function resolveMimeType(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'application/pdf'
}

/**
 * Checks whether a URL or filename points to an image based on its extension.
 */
function isImagePath(path: string): boolean {
  try {
    const pathname = new URL(path).pathname.toLowerCase()
    return IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext))
  } catch {
    const lower = path.toLowerCase()
    return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
  }
}

/**
 * Strips markdown formatting to produce plain text output.
 */
function markdownToText(markdown: string): string {
  return markdown
    .replace(/##*\s/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
}

const handler: ToolHandler = {
  operations: {
    mistral_parser: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const inputMethod = params.inputMethod as string | undefined
      const filePath = params.filePath as string | undefined
      const fileUpload = params.fileUpload as Record<string, unknown> | undefined
      const resultType = (params.resultType as string) || 'markdown'
      const pagesParam = params.pages as string | number[] | undefined

      const hasFilePath =
        filePath && typeof filePath === 'string' && filePath.trim() !== '' && filePath !== 'null'
      const hasFileUpload = fileUpload && typeof fileUpload === 'object'

      if (!hasFilePath && !hasFileUpload) {
        return {
          success: false,
          output: {},
          error: 'Missing file input: provide a PDF URL (filePath) or upload a file (fileUpload)',
        }
      }

      const mistralBody: Record<string, unknown> = {
        model: 'mistral-ocr-latest',
      }

      if (hasFileUpload) {
        if (!ctx.downloadFile) {
          return {
            success: false,
            output: {},
            error: 'Cannot process uploaded file without download helper',
          }
        }

        const buffer = await ctx.downloadFile(fileUpload)
        const base64 = buffer.toString('base64')

        let mimeType = (fileUpload as Record<string, string>).mimeType ||
          (fileUpload as Record<string, string>).type ||
          ''

        if (!mimeType || mimeType === 'application/octet-stream') {
          const filename = ((fileUpload as Record<string, string>).name || '').toLowerCase()
          mimeType = resolveMimeType(filename)
        }

        const base64Payload = `data:${mimeType};base64,${base64}`
        const isImage = mimeType.startsWith('image/')

        if (isImage) {
          mistralBody.document = { type: 'image_url', image_url: base64Payload }
        } else {
          mistralBody.document = { type: 'document_url', document_url: base64Payload }
        }
      } else if (hasFilePath) {
        const url = filePath!.trim()

        if (isImagePath(url)) {
          mistralBody.document = { type: 'image_url', image_url: url }
        } else {
          mistralBody.document = { type: 'document_url', document_url: url }
        }
      }

      // Parse pages parameter (comma-separated string or array)
      if (pagesParam) {
        let pages: number[] = []

        if (Array.isArray(pagesParam)) {
          pages = pagesParam
            .map((p) => Number(p))
            .filter((p) => Number.isInteger(p) && p >= 0)
        } else if (typeof pagesParam === 'string' && pagesParam.trim() !== '') {
          pages = pagesParam
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((p) => Number.isInteger(p) && p >= 0)
        }

        if (pages.length > 0) {
          mistralBody.pages = pages
        }
      }

      const response = await fetch('https://api.mistral.ai/v1/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(mistralBody),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `Mistral OCR API error: ${response.status} ${errorText}`,
        }
      }

      const data = await response.json()

      // Extract content from pages
      const pages = Array.isArray(data.pages) ? data.pages : []
      let content = ''

      if (pages.length > 0) {
        content = pages
          .map((page: Record<string, unknown>) =>
            page && typeof page.markdown === 'string' ? page.markdown : ''
          )
          .filter(Boolean)
          .join('\n\n')
      } else {
        content = JSON.stringify(data, null, 2)
      }

      // Apply result type transformation
      if (resultType === 'text') {
        content = markdownToText(content)
      } else if (resultType === 'json') {
        content = JSON.stringify(data, null, 2)
      }

      return {
        success: true,
        output: {
          content,
        },
      }
    },
  },
}

export default handler
