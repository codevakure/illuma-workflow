import type { ToolHandler } from '../../sdk/types'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

function processValues(raw: unknown): unknown[][] {
  let values: unknown[] = Array.isArray(raw) ? raw : []

  if (typeof raw === 'string') {
    try {
      values = JSON.parse(raw)
    } catch {
      try {
        values = JSON.parse(
          (raw as string).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
        )
      } catch {
        values = [[raw]]
      }
    }
  }

  if (!Array.isArray(values)) {
    values = [[values]]
  }

  if (
    values.length > 0 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    !Array.isArray(values[0])
  ) {
    const allKeys = new Set<string>()
    for (const obj of values) {
      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj as Record<string, unknown>)) {
          allKeys.add(key)
        }
      }
    }
    const headers = Array.from(allKeys)
    const rows = values.map((obj) => {
      if (!obj || typeof obj !== 'object') return Array(headers.length).fill('')
      return headers.map((key) => {
        const value = (obj as Record<string, unknown>)[key]
        if (value !== null && typeof value === 'object') return JSON.stringify(value)
        return value === undefined ? '' : value
      })
    })
    return [headers, ...rows]
  }

  if (!values.every((item) => Array.isArray(item))) {
    return values.map((row) => (Array.isArray(row) ? row : [row]))
  }

  return values as unknown[][]
}

const handler: ToolHandler = {
  operations: {
    google_sheets_read: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }

      const range = (params.range as string)?.trim() || 'A1:Z1000'
      const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          data: { range: data.range || '', values: data.values || [] },
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_read_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const sheetName = (params.sheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!sheetName) return { success: false, output: {}, error: 'Missing sheetName' }

      const cellRange = (params.cellRange as string)?.trim() || 'A1:Z1000'
      const fullRange = `${sheetName}!${cellRange}`
      const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(fullRange)}`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          sheetName,
          range: data.range ?? '',
          values: data.values ?? [],
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_write: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }

      const range = (params.range as string) || 'Sheet1!A2'
      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`

      const values = processValues(params.values)

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          updatedRange: data.updatedRange,
          updatedRows: data.updatedRows,
          updatedColumns: data.updatedColumns,
          updatedCells: data.updatedCells,
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_write_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const sheetName = (params.sheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!sheetName) return { success: false, output: {}, error: 'Missing sheetName' }

      const cellRange = (params.cellRange as string)?.trim() || 'A1'
      const fullRange = `${sheetName}!${cellRange}`
      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(fullRange)}?valueInputOption=${valueInputOption}`

      const values = processValues(params.values)

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          updatedRange: data.updatedRange ?? null,
          updatedRows: data.updatedRows ?? 0,
          updatedColumns: data.updatedColumns ?? 0,
          updatedCells: data.updatedCells ?? 0,
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_update: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }

      const range = (params.range as string) || 'Sheet1!A2'
      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`

      const values = processValues(params.values)

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          updatedRange: data.updatedRange,
          updatedRows: data.updatedRows,
          updatedColumns: data.updatedColumns,
          updatedCells: data.updatedCells,
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_update_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const sheetName = (params.sheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!sheetName) return { success: false, output: {}, error: 'Missing sheetName' }

      const cellRange = (params.cellRange as string)?.trim() || 'A1'
      const fullRange = `${sheetName}!${cellRange}`
      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(fullRange)}?valueInputOption=${valueInputOption}`

      const values = processValues(params.values)

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          updatedRange: data.updatedRange ?? null,
          updatedRows: data.updatedRows ?? 0,
          updatedColumns: data.updatedColumns ?? 0,
          updatedCells: data.updatedCells ?? 0,
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_append: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }

      const range = (params.range as string) || 'Sheet1'
      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      const url = new URL(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append`)
      url.searchParams.append('valueInputOption', valueInputOption)
      if (params.insertDataOption) url.searchParams.append('insertDataOption', params.insertDataOption as string)

      const values = processValues(params.values)

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          tableRange: data.tableRange || '',
          updatedRange: data.updates?.updatedRange || '',
          updatedRows: data.updates?.updatedRows || 0,
          updatedColumns: data.updates?.updatedColumns || 0,
          updatedCells: data.updates?.updatedCells || 0,
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_append_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const sheetName = (params.sheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!sheetName) return { success: false, output: {}, error: 'Missing sheetName' }

      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      const url = new URL(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append`)
      url.searchParams.append('valueInputOption', valueInputOption)
      if (params.insertDataOption) url.searchParams.append('insertDataOption', params.insertDataOption as string)

      const values = processValues(params.values)

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          tableRange: data.tableRange ?? '',
          updatedRange: data.updates?.updatedRange ?? '',
          updatedRows: data.updates?.updatedRows ?? 0,
          updatedColumns: data.updates?.updatedColumns ?? 0,
          updatedCells: data.updates?.updatedCells ?? 0,
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_clear_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const sheetName = (params.sheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!sheetName) return { success: false, output: {}, error: 'Missing sheetName' }

      const cellRange = (params.cellRange as string)?.trim()
      const fullRange = cellRange ? `${sheetName}!${cellRange}` : sheetName
      const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(fullRange)}:clear`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          clearedRange: data.clearedRange ?? '',
          sheetName,
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_get_spreadsheet_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }

      const includeGridData = params.includeGridData ? 'true' : 'false'
      const url = `${SHEETS_API}/${spreadsheetId}?includeGridData=${includeGridData}`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      const sheets = (data.sheets ?? []).map((sheet: Record<string, unknown>) => {
        const props = sheet.properties as Record<string, unknown> | undefined
        const gridProps = props?.gridProperties as Record<string, unknown> | undefined
        return {
          sheetId: props?.sheetId ?? 0,
          title: props?.title ?? '',
          index: props?.index ?? 0,
          rowCount: gridProps?.rowCount ?? null,
          columnCount: gridProps?.columnCount ?? null,
          hidden: props?.hidden ?? false,
        }
      })

      return {
        success: true,
        output: {
          spreadsheetId: data.spreadsheetId ?? '',
          title: data.properties?.title ?? '',
          locale: data.properties?.locale ?? null,
          timeZone: data.properties?.timeZone ?? null,
          spreadsheetUrl: data.spreadsheetUrl ?? '',
          sheets,
        },
      }
    },

    google_sheets_create_spreadsheet_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const title = (params.title as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!title) return { success: false, output: {}, error: 'Missing title' }

      const sheetTitles = (params.sheetTitles as string[]) ?? ['Sheet1']
      const sheets = sheetTitles.map((t: string, i: number) => ({
        properties: { title: t, index: i },
      }))

      const body: Record<string, unknown> = { properties: { title }, sheets }
      if (params.locale) (body.properties as Record<string, unknown>).locale = params.locale
      if (params.timeZone) (body.properties as Record<string, unknown>).timeZone = params.timeZone

      const response = await fetch(SHEETS_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          spreadsheetId: data.spreadsheetId ?? '',
          title: data.properties?.title ?? '',
          spreadsheetUrl: data.spreadsheetUrl ?? '',
          sheets: (data.sheets ?? []).map((s: Record<string, unknown>) => {
            const p = s.properties as Record<string, unknown>
            return { sheetId: p?.sheetId ?? 0, title: p?.title ?? '', index: p?.index ?? 0 }
          }),
        },
      }
    },

    google_sheets_batch_get_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const ranges = params.ranges as string[]
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!ranges || !Array.isArray(ranges) || ranges.length === 0) {
        return { success: false, output: {}, error: 'At least one range is required' }
      }

      const qp = new URLSearchParams()
      for (const r of ranges) qp.append('ranges', r)
      if (params.majorDimension) qp.append('majorDimension', params.majorDimension as string)
      if (params.valueRenderOption) qp.append('valueRenderOption', params.valueRenderOption as string)

      const url = `${SHEETS_API}/${spreadsheetId}/values:batchGet?${qp.toString()}`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          spreadsheetId: data.spreadsheetId ?? spreadsheetId,
          valueRanges: (data.valueRanges ?? []).map((vr: Record<string, unknown>) => ({
            range: vr.range ?? '',
            majorDimension: vr.majorDimension ?? 'ROWS',
            values: vr.values ?? [],
          })),
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_batch_update_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const dataRanges = params.data as Array<{ range: string; values: unknown[][] }>
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!dataRanges || !Array.isArray(dataRanges) || dataRanges.length === 0) {
        return { success: false, output: {}, error: 'At least one data range is required' }
      }

      const url = `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: (params.valueInputOption as string) ?? 'USER_ENTERED',
          data: dataRanges.map((item) => ({ range: item.range, values: item.values })),
        }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          spreadsheetId: data.spreadsheetId ?? spreadsheetId,
          totalUpdatedRows: data.totalUpdatedRows ?? 0,
          totalUpdatedColumns: data.totalUpdatedColumns ?? 0,
          totalUpdatedCells: data.totalUpdatedCells ?? 0,
          totalUpdatedSheets: data.totalUpdatedSheets ?? 0,
          responses: (data.responses ?? []).map((r: Record<string, unknown>) => ({
            spreadsheetId: r.spreadsheetId ?? '',
            updatedRange: r.updatedRange ?? '',
            updatedRows: r.updatedRows ?? 0,
            updatedColumns: r.updatedColumns ?? 0,
            updatedCells: r.updatedCells ?? 0,
          })),
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_batch_clear_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const ranges = params.ranges as string[]
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!ranges || !Array.isArray(ranges) || ranges.length === 0) {
        return { success: false, output: {}, error: 'At least one range is required' }
      }

      const url = `${SHEETS_API}/${spreadsheetId}/values:batchClear`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ranges }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          spreadsheetId: data.spreadsheetId ?? spreadsheetId,
          clearedRanges: data.clearedRanges ?? [],
          metadata: {
            spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          },
        },
      }
    },

    google_sheets_copy_sheet_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const sourceSpreadsheetId = (params.sourceSpreadsheetId as string)?.trim()
      const sheetId = params.sheetId as number
      const destinationSpreadsheetId = (params.destinationSpreadsheetId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!sourceSpreadsheetId) return { success: false, output: {}, error: 'Missing sourceSpreadsheetId' }
      if (sheetId === undefined || sheetId === null) return { success: false, output: {}, error: 'Missing sheetId' }
      if (!destinationSpreadsheetId) return { success: false, output: {}, error: 'Missing destinationSpreadsheetId' }

      const url = `${SHEETS_API}/${sourceSpreadsheetId}/sheets/${sheetId}:copyTo`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destinationSpreadsheetId }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Sheets API error: ${response.status} ${err}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          sheetId: data.sheetId ?? 0,
          title: data.title ?? '',
          index: data.index ?? 0,
          sheetType: data.sheetType ?? 'GRID',
          destinationSpreadsheetId,
          destinationSpreadsheetUrl: `https://docs.google.com/spreadsheets/d/${destinationSpreadsheetId}`,
        },
      }
    },
  },
}

export default handler
