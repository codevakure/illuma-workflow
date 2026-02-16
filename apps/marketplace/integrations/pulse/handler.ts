import type { ToolHandler } from '../../sdk/types'

const PULSE_API_URL = 'https://api.runpulse.com/extract'

const handler: ToolHandler = {
  operations: {
    pulse_parser: async (params, ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      /**
       * Resolve the file URL from various input shapes.
       * Priority: file object with url/path > filePath string > fileUpload object
       */
      let fileUrl: string | undefined

      const fileInput = params.file as { url?: string; path?: string; name?: string } | undefined
      const fileUpload = params.fileUpload as { url?: string; path?: string; name?: string } | undefined
      const filePath = params.filePath as string | undefined

      if (fileInput && typeof fileInput === 'object') {
        fileUrl = fileInput.url || fileInput.path
      }

      if (!fileUrl && filePath && filePath !== 'null' && filePath.trim() !== '') {
        fileUrl = filePath.trim()
      }

      if (!fileUrl && fileUpload && typeof fileUpload === 'object') {
        fileUrl = fileUpload.url || fileUpload.path
      }

      /** If we have a UserFile-style object, use the downloadFile helper from context */
      if (!fileUrl && ctx.downloadFile) {
        const rawFile = fileInput || fileUpload
        if (rawFile) {
          try {
            const buffer = await ctx.downloadFile(rawFile)
            /** Pulse expects a URL, so we cannot send a raw buffer directly.
             *  Fall through to the error below when no URL is available. */
            if (buffer) {
              /** Build a multipart form with the raw file bytes */
              const formData = new FormData()
              const blob = new Blob([buffer], { type: 'application/octet-stream' })
              formData.append('file', blob, (rawFile as any).name || 'document')

              if (params.pages) formData.append('pages', String(params.pages))
              if (params.extractFigure !== undefined) formData.append('extract_figure', String(params.extractFigure))
              if (params.figureDescription !== undefined) formData.append('figure_description', String(params.figureDescription))
              if (params.returnHtml !== undefined) formData.append('return_html', String(params.returnHtml))
              if (params.chunking) formData.append('chunking', String(params.chunking))
              if (params.chunkSize !== undefined) formData.append('chunk_size', String(params.chunkSize))

              const resp = await fetch(PULSE_API_URL, {
                method: 'POST',
                headers: { 'x-api-key': apiKey },
                body: formData,
              })

              if (!resp.ok) {
                const errorText = await resp.text().catch(() => '')
                return { success: false, output: {}, error: `Pulse API error: ${resp.statusText} ${errorText}` }
              }

              const pulseData = await resp.json()
              return {
                success: true,
                output: {
                  markdown: pulseData.markdown ?? '',
                  page_count: pulseData.page_count ?? 0,
                  job_id: pulseData.job_id ?? '',
                  'plan-info': pulseData['plan-info'] ?? { pages_used: 0, tier: 'unknown' },
                  bounding_boxes: pulseData.bounding_boxes ?? null,
                  extraction_url: pulseData.extraction_url ?? null,
                  html: pulseData.html ?? null,
                  structured_output: pulseData.structured_output ?? null,
                  chunks: pulseData.chunks ?? null,
                  figures: pulseData.figures ?? null,
                },
              }
            }
          } catch {
            /** Fall through to URL-based approach */
          }
        }
      }

      if (!fileUrl) {
        return { success: false, output: {}, error: 'Missing file input: Please provide a document URL or upload a file' }
      }

      /** Validate URL */
      if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://') && !fileUrl.startsWith('/')) {
        return { success: false, output: {}, error: 'Invalid file URL: must be an HTTP/HTTPS URL' }
      }

      /** Build multipart form with file_url */
      const formData = new FormData()
      formData.append('file_url', fileUrl)

      if (params.pages) formData.append('pages', String(params.pages))
      if (params.extractFigure !== undefined) formData.append('extract_figure', String(params.extractFigure))
      if (params.figureDescription !== undefined) formData.append('figure_description', String(params.figureDescription))
      if (params.returnHtml !== undefined) formData.append('return_html', String(params.returnHtml))
      if (params.chunking) formData.append('chunking', String(params.chunking))
      if (params.chunkSize !== undefined) formData.append('chunk_size', String(params.chunkSize))

      const resp = await fetch(PULSE_API_URL, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: formData,
      })

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Pulse API error: ${resp.statusText} ${errorText}` }
      }

      const pulseData = await resp.json()
      return {
        success: true,
        output: {
          markdown: pulseData.markdown ?? '',
          page_count: pulseData.page_count ?? 0,
          job_id: pulseData.job_id ?? '',
          'plan-info': pulseData['plan-info'] ?? { pages_used: 0, tier: 'unknown' },
          bounding_boxes: pulseData.bounding_boxes ?? null,
          extraction_url: pulseData.extraction_url ?? null,
          html: pulseData.html ?? null,
          structured_output: pulseData.structured_output ?? null,
          chunks: pulseData.chunks ?? null,
          figures: pulseData.figures ?? null,
        },
      }
    },
  },
}

export default handler
