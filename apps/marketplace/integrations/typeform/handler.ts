import type { ToolHandler } from '../../sdk/types'

const TYPEFORM_API_BASE = 'https://api.typeform.com'

function typeformHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function typeformRequest(
  url: string,
  method: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const options: RequestInit = {
    method,
    headers: typeformHeaders(apiKey),
  }
  if (body && method !== 'GET' && method !== 'DELETE') {
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Typeform API error: ${response.status} - ${errorText}`)
  }
  if (method === 'DELETE' && response.status === 204) {
    return { deleted: true }
  }
  return response.json()
}

const handler: ToolHandler = {
  operations: {
    typeform_create_form: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.title) return { success: false, output: {}, error: 'Missing required parameter: title' }

      const body: Record<string, unknown> = { title: params.title }
      if (params.type) body.type = params.type
      if (params.workspaceId) {
        body.workspace = { href: `${TYPEFORM_API_BASE}/workspaces/${params.workspaceId}` }
      }
      if (params.fields) body.fields = params.fields
      if (params.settings) body.settings = params.settings
      if (params.themeId) {
        body.theme = { href: `${TYPEFORM_API_BASE}/themes/${params.themeId}` }
      }

      const data = await typeformRequest(`${TYPEFORM_API_BASE}/forms`, 'POST', apiKey, body)
      return { success: true, output: data }
    },

    typeform_get_form: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.formId) return { success: false, output: {}, error: 'Missing required parameter: formId' }

      const data = await typeformRequest(`${TYPEFORM_API_BASE}/forms/${params.formId}`, 'GET', apiKey)
      return { success: true, output: data }
    },

    typeform_list_forms: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.workspaceId) qp.append('workspace_id', params.workspaceId as string)
      if (params.search) qp.append('search', params.search as string)
      if (params.page) qp.append('page', String(params.page))
      if (params.page_size) qp.append('page_size', String(params.page_size))

      const qs = qp.toString()
      const data = await typeformRequest(
        `${TYPEFORM_API_BASE}/forms${qs ? `?${qs}` : ''}`, 'GET', apiKey
      )
      return { success: true, output: data }
    },

    typeform_update_form: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.formId) return { success: false, output: {}, error: 'Missing required parameter: formId' }

      const body: Record<string, unknown> = {}
      if (params.title) body.title = params.title
      if (params.fields) body.fields = params.fields
      if (params.settings) body.settings = params.settings
      if (params.themeId) {
        body.theme = { href: `${TYPEFORM_API_BASE}/themes/${params.themeId}` }
      }

      const data = await typeformRequest(
        `${TYPEFORM_API_BASE}/forms/${params.formId}`, 'PATCH', apiKey, body
      )
      return { success: true, output: data }
    },

    typeform_delete_form: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.formId) return { success: false, output: {}, error: 'Missing required parameter: formId' }

      await typeformRequest(`${TYPEFORM_API_BASE}/forms/${params.formId}`, 'DELETE', apiKey)
      return { success: true, output: { deleted: true, formId: params.formId } }
    },

    typeform_responses: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.formId) return { success: false, output: {}, error: 'Missing required parameter: formId' }

      const qp = new URLSearchParams()
      if (params.page_size) qp.append('page_size', String(params.page_size))
      if (params.since) qp.append('since', params.since as string)
      if (params.until) qp.append('until', params.until as string)
      if (params.after) qp.append('after', params.after as string)
      if (params.before) qp.append('before', params.before as string)
      if (params.completed !== undefined) qp.append('completed', String(params.completed))
      if (params.sort) qp.append('sort', params.sort as string)
      if (params.query) qp.append('query', params.query as string)
      if (params.fields) qp.append('fields', (params.fields as string[]).join(','))

      const qs = qp.toString()
      const data = await typeformRequest(
        `${TYPEFORM_API_BASE}/forms/${params.formId}/responses${qs ? `?${qs}` : ''}`, 'GET', apiKey
      )
      return { success: true, output: data }
    },

    typeform_insights: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.formId) return { success: false, output: {}, error: 'Missing required parameter: formId' }

      const data = await typeformRequest(
        `${TYPEFORM_API_BASE}/insights/${params.formId}/summary`, 'GET', apiKey
      )
      return { success: true, output: data }
    },

    typeform_files: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.formId) return { success: false, output: {}, error: 'Missing required parameter: formId' }

      const response = await fetch(
        `${TYPEFORM_API_BASE}/forms/${params.formId}/responses`,
        { method: 'GET', headers: typeformHeaders(apiKey) }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Typeform API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      const items = (data.items as Array<Record<string, unknown>>) || []
      const files: Array<Record<string, unknown>> = []

      for (const item of items) {
        const answers = (item.answers as Array<Record<string, unknown>>) || []
        for (const answer of answers) {
          if (answer.type === 'file_url') {
            files.push({
              responseId: item.response_id,
              fieldId: (answer.field as Record<string, unknown>)?.id,
              fileUrl: answer.file_url,
            })
          }
        }
      }

      return {
        success: true,
        output: {
          files,
          totalFiles: files.length,
          formId: params.formId,
        },
      }
    },
  },
}

export default handler
