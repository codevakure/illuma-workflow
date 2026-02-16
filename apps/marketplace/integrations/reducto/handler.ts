import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    reducto_parser: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const filePath = params.filePath as string | undefined
      const file = params.file as Record<string, unknown> | undefined

      let documentUrl: string | undefined

      if (filePath && typeof filePath === 'string' && filePath.trim() !== '' && filePath !== 'null') {
        documentUrl = filePath.trim()
      }

      if (!documentUrl && !file) {
        return { success: false, output: {}, error: 'Missing file input: provide a PDF URL (filePath) or file object' }
      }

      const requestBody: Record<string, unknown> = {}

      if (documentUrl) {
        requestBody.document_url = documentUrl
      } else if (file) {
        requestBody.document_url = file
      }

      if (params.tableOutputFormat && ['html', 'md'].includes(params.tableOutputFormat as string)) {
        requestBody.advanced_options = {
          table_output_format: params.tableOutputFormat,
        }
      }

      if (params.pages && Array.isArray(params.pages) && (params.pages as number[]).length > 0) {
        requestBody.options = {
          ...(requestBody.options as Record<string, unknown> || {}),
          pages: params.pages,
        }
      }

      const response = await fetch('https://platform.reducto.ai/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reducto API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          job_id: data.job_id,
          duration: data.duration,
          usage: data.usage,
          result: data.result,
          pdf_url: data.pdf_url ?? null,
          studio_link: data.studio_link ?? null,
        },
      }
    },
  },
}

export default handler
