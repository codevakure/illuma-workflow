import type { ToolHandler } from '../../sdk/types'

const BASE_URL = 'https://api.airtable.com/v0'

const handler: ToolHandler = {
  operations: {
    airtable_list_records: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const baseId = params.baseId as string
      const tableId = params.tableId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!baseId) return { success: false, output: {}, error: 'Missing required parameter: baseId' }
      if (!tableId) return { success: false, output: {}, error: 'Missing required parameter: tableId' }

      const url = new URL(`${BASE_URL}/${baseId}/${tableId}`)
      if (params.maxRecords) url.searchParams.set('maxRecords', String(params.maxRecords))
      if (params.filterFormula) url.searchParams.set('filterByFormula', params.filterFormula as string)

      const resp = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Airtable API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          records: data.records || [],
          metadata: {
            offset: data.offset,
            totalRecords: (data.records || []).length,
          },
        },
      }
    },

    airtable_get_record: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const baseId = params.baseId as string
      const tableId = params.tableId as string
      const recordId = params.recordId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!baseId || !tableId || !recordId) {
        return { success: false, output: {}, error: 'Missing required parameters: baseId, tableId, recordId' }
      }

      const resp = await fetch(`${BASE_URL}/${baseId}/${tableId}/${recordId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Airtable API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          record: data,
          metadata: { recordCount: 1 },
        },
      }
    },

    airtable_create_records: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const baseId = params.baseId as string
      const tableId = params.tableId as string
      let records = params.records
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!baseId || !tableId) return { success: false, output: {}, error: 'Missing required parameters' }

      if (typeof records === 'string') {
        try { records = JSON.parse(records) } catch {
          return { success: false, output: {}, error: 'Invalid JSON for records' }
        }
      }

      const resp = await fetch(`${BASE_URL}/${baseId}/${tableId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Airtable API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          records: data.records || [],
          metadata: { recordCount: (data.records || []).length },
        },
      }
    },

    airtable_update_record: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const baseId = params.baseId as string
      const tableId = params.tableId as string
      const recordId = params.recordId as string
      let fields = params.fields
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!baseId || !tableId || !recordId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      if (typeof fields === 'string') {
        try { fields = JSON.parse(fields) } catch {
          return { success: false, output: {}, error: 'Invalid JSON for fields' }
        }
      }

      const resp = await fetch(`${BASE_URL}/${baseId}/${tableId}/${recordId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Airtable API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          record: data,
          metadata: {
            recordCount: 1,
            updatedFields: Object.keys(data.fields || {}),
          },
        },
      }
    },

    airtable_update_multiple_records: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const baseId = params.baseId as string
      const tableId = params.tableId as string
      let records = params.records
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!baseId || !tableId) return { success: false, output: {}, error: 'Missing required parameters' }

      if (typeof records === 'string') {
        try { records = JSON.parse(records) } catch {
          return { success: false, output: {}, error: 'Invalid JSON for records' }
        }
      }

      const resp = await fetch(`${BASE_URL}/${baseId}/${tableId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Airtable API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          records: data.records || [],
          metadata: {
            recordCount: (data.records || []).length,
            updatedRecordIds: (data.records || []).map((r: any) => r.id),
          },
        },
      }
    },
  },
}

export default handler
