import type { ToolHandler } from '../../sdk/types'

function snUrl(instanceUrl: string, path: string): string {
  const baseUrl = (instanceUrl as string).replace(/\/$/, '')
  return `${baseUrl}${path}`
}

function snHeaders(username: string, password: string, includeContentType = false): Record<string, string> {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64')
  const headers: Record<string, string> = {
    Authorization: `Basic ${credentials}`,
    Accept: 'application/json',
  }
  if (includeContentType) headers['Content-Type'] = 'application/json'
  return headers
}

const handler: ToolHandler = {
  operations: {
    servicenow_create_record: async (params) => {
      const instanceUrl = params.instanceUrl as string
      const username = params.username as string
      const password = params.password as string
      const tableName = params.tableName as string
      if (!instanceUrl || !username || !password || !tableName) {
        return { success: false, output: {}, error: 'Missing required parameters: instanceUrl, username, password, tableName' }
      }

      let fields: Record<string, unknown>
      try {
        fields = typeof params.fields === 'string' ? JSON.parse(params.fields as string) : params.fields as Record<string, unknown>
      } catch {
        return { success: false, output: {}, error: 'Fields must be a valid JSON object' }
      }

      if (!fields || typeof fields !== 'object') {
        return { success: false, output: {}, error: 'Fields must be a JSON object' }
      }

      const response = await fetch(snUrl(instanceUrl, `/api/now/table/${tableName}`), {
        method: 'POST',
        headers: snHeaders(username, password, true),
        body: JSON.stringify(fields),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        const errorMsg = err.error?.message || err.error || `HTTP ${response.status}`
        return { success: false, output: {}, error: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg) }
      }

      const data = await response.json()
      return { success: true, output: { record: data.result, metadata: { recordCount: 1 } } }
    },

    servicenow_read_record: async (params) => {
      const instanceUrl = params.instanceUrl as string
      const username = params.username as string
      const password = params.password as string
      const tableName = params.tableName as string
      if (!instanceUrl || !username || !password || !tableName) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let url = snUrl(instanceUrl, `/api/now/table/${tableName}`)
      const qp = new URLSearchParams()

      if (params.sysId) {
        url = `${url}/${params.sysId}`
      } else if (params.number) {
        const numberQuery = `number=${params.number}`
        const existingQuery = params.query as string | undefined
        qp.append('sysparm_query', existingQuery ? `${existingQuery}^${numberQuery}` : numberQuery)
      } else if (params.query) {
        qp.append('sysparm_query', params.query as string)
      }

      if (params.limit) qp.append('sysparm_limit', String(params.limit))
      if (params.fields) qp.append('sysparm_fields', params.fields as string)

      const qs = qp.toString()
      if (qs) url = `${url}?${qs}`

      const response = await fetch(url, {
        headers: snHeaders(username, password),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        const errorMsg = err.error?.message || err.error || `HTTP ${response.status}`
        return { success: false, output: {}, error: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg) }
      }

      const data = await response.json()
      const records = Array.isArray(data.result) ? data.result : [data.result]
      return { success: true, output: { records, metadata: { recordCount: records.length } } }
    },

    servicenow_update_record: async (params) => {
      const instanceUrl = params.instanceUrl as string
      const username = params.username as string
      const password = params.password as string
      const tableName = params.tableName as string
      const sysId = params.sysId as string
      if (!instanceUrl || !username || !password || !tableName || !sysId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let fields: Record<string, unknown>
      try {
        fields = typeof params.fields === 'string' ? JSON.parse(params.fields as string) : params.fields as Record<string, unknown>
      } catch {
        return { success: false, output: {}, error: 'Fields must be a valid JSON object' }
      }

      if (!fields || typeof fields !== 'object') {
        return { success: false, output: {}, error: 'Fields must be a JSON object' }
      }

      const response = await fetch(snUrl(instanceUrl, `/api/now/table/${tableName}/${sysId}`), {
        method: 'PATCH',
        headers: snHeaders(username, password, true),
        body: JSON.stringify(fields),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        const errorMsg = err.error?.message || err.error || `HTTP ${response.status}`
        return { success: false, output: {}, error: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg) }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          record: data.result,
          metadata: { recordCount: 1, updatedFields: Object.keys(fields) },
        },
      }
    },

    servicenow_delete_record: async (params) => {
      const instanceUrl = params.instanceUrl as string
      const username = params.username as string
      const password = params.password as string
      const tableName = params.tableName as string
      const sysId = params.sysId as string
      if (!instanceUrl || !username || !password || !tableName || !sysId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(snUrl(instanceUrl, `/api/now/table/${tableName}/${sysId}`), {
        method: 'DELETE',
        headers: snHeaders(username, password),
      })

      if (!response.ok) {
        let errorMsg: string
        try {
          const err = await response.json()
          errorMsg = err.error?.message || JSON.stringify(err)
        } catch {
          errorMsg = `HTTP ${response.status} ${response.statusText}`
        }
        return { success: false, output: {}, error: errorMsg }
      }

      return { success: true, output: { success: true, metadata: { deletedSysId: sysId } } }
    },
  },
}

export default handler
