import type { ToolHandler } from '../../sdk/types'

type CellValue = string | number | boolean | null

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

/** Trim trailing empty rows and columns from a 2D matrix */
function trimTrailingEmptyRowsAndColumns(matrix: CellValue[][]): CellValue[][] {
  if (!Array.isArray(matrix) || matrix.length === 0) return []

  const isEmpty = (v: CellValue) => v === null || v === ''

  let lastRowIdx = -1
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || []
    if (row.some((cell: CellValue) => !isEmpty(cell))) lastRowIdx = r
  }
  if (lastRowIdx === -1) return []

  const trimmedRows = matrix.slice(0, lastRowIdx + 1)

  let lastColIdx = -1
  for (let r = 0; r < trimmedRows.length; r++) {
    const row = trimmedRows[r] || []
    for (let c = 0; c < row.length; c++) {
      if (!isEmpty(row[c]) && c > lastColIdx) lastColIdx = c
    }
  }
  if (lastColIdx === -1) return []

  return trimmedRows.map((row) => (row || []).slice(0, lastColIdx + 1))
}

/** Fetch the browser-accessible web URL for an Excel spreadsheet */
async function getSpreadsheetWebUrl(spreadsheetId: string, accessToken: string): Promise<string> {
  try {
    const response = await fetch(
      `${GRAPH_BASE}/me/drive/items/${spreadsheetId}?$select=id,webUrl`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!response.ok) {
      return `${GRAPH_BASE}/me/drive/items/${spreadsheetId}`
    }
    const data = await response.json()
    return data.webUrl || `${GRAPH_BASE}/me/drive/items/${spreadsheetId}`
  } catch {
    return `${GRAPH_BASE}/me/drive/items/${spreadsheetId}`
  }
}

/** Convert array-of-objects to 2D array with header row */
function processValues(values: unknown): CellValue[][] {
  let processed: unknown[] = Array.isArray(values) ? values : []

  if (typeof values === 'string') {
    try {
      const parsed = JSON.parse(values)
      if (Array.isArray(parsed)) processed = parsed
    } catch {
      return []
    }
  }

  if (
    processed.length > 0 &&
    typeof processed[0] === 'object' &&
    processed[0] !== null &&
    !Array.isArray(processed[0])
  ) {
    const allKeys = new Set<string>()
    for (const obj of processed) {
      if (obj && typeof obj === 'object') {
        Object.keys(obj as Record<string, unknown>).forEach((key) => allKeys.add(key))
      }
    }
    const headers = Array.from(allKeys)
    const rows = processed.map((obj: unknown) => {
      if (!obj || typeof obj !== 'object') return Array(headers.length).fill('')
      return headers.map((key) => {
        const value = (obj as Record<string, unknown>)[key]
        if (value !== null && typeof value === 'object') return JSON.stringify(value)
        return (value === undefined ? '' : value) as CellValue
      })
    })
    return [headers, ...rows]
  }

  return processed as CellValue[][]
}

const handler: ToolHandler = {
  operations: {
    microsoft_excel_read: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }

      const range = (params.range as string)?.trim()

      if (!range) {
        // No range: fetch first worksheet name, then read its usedRange
        const wsUrl = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets?$select=name&$orderby=position&$top=1`
        const wsResp = await fetch(wsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!wsResp.ok) return { success: false, output: {}, error: `API error: ${wsResp.status}` }
        const wsData = await wsResp.json()
        const firstSheetName: string | undefined = wsData?.value?.[0]?.name
        if (!firstSheetName) return { success: false, output: {}, error: 'No worksheets found in the workbook' }

        const rangeUrl = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodeURIComponent(firstSheetName)}')/usedRange(valuesOnly=true)`
        const rangeResp = await fetch(rangeUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!rangeResp.ok) {
          return { success: false, output: {}, error: 'Invalid range or worksheet not found' }
        }
        const data = await rangeResp.json()
        const address: string = data.address || data.addressLocal || `${firstSheetName}!A1`
        const values = trimTrailingEmptyRowsAndColumns(data.values || [])
        const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

        return {
          success: true,
          output: {
            data: { range: address, values },
            metadata: { spreadsheetId, spreadsheetUrl: webUrl },
          },
        }
      }

      // Range provided
      let url: string
      if (!range.includes('!')) {
        // Sheet name only - fetch usedRange
        url = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodeURIComponent(range)}')/usedRange(valuesOnly=true)`
      } else {
        const match = range.match(/^([^!]+)!(.+)$/)
        if (!match) {
          return { success: false, output: {}, error: `Invalid range format: "${range}". Use "Sheet1!A1:B2" or just "Sheet1"` }
        }
        url = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodeURIComponent(match[1])}')/range(address='${encodeURIComponent(match[2])}')`
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      const address: string = data.address || data.addressLocal || data.range || ''
      const values = trimTrailingEmptyRowsAndColumns(data.values || [])
      const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

      return {
        success: true,
        output: {
          data: { range: address, values },
          metadata: { spreadsheetId, spreadsheetUrl: webUrl },
        },
      }
    },

    microsoft_excel_read_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const sheetName = (params.sheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!sheetName) return { success: false, output: {}, error: 'Missing sheetName' }

      const cellRange = (params.cellRange as string)?.trim()
      const encodedSheet = encodeURIComponent(sheetName)

      let url: string
      if (!cellRange) {
        url = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodedSheet}')/usedRange(valuesOnly=true)`
      } else {
        url = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodedSheet}')/range(address='${encodeURIComponent(cellRange)}')`
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      const address: string = data.address || data.addressLocal || ''
      const values = trimTrailingEmptyRowsAndColumns(data.values || [])
      const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

      return {
        success: true,
        output: {
          sheetName: sheetName || address.split('!')[0] || '',
          range: address,
          values,
          metadata: { spreadsheetId, spreadsheetUrl: webUrl },
        },
      }
    },

    microsoft_excel_write: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const range = (params.range as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }

      const match = range?.match(/^([^!]+)!(.+)$/)
      if (!match) {
        return { success: false, output: {}, error: `Invalid range format: "${params.range}". Use "Sheet1!A1:B2"` }
      }

      const sheetName = encodeURIComponent(match[1])
      const address = encodeURIComponent(match[2])
      const processed = processValues(params.values)

      const url = new URL(
        `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets('${sheetName}')/range(address='${address}')`
      )
      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)
      if (params.includeValuesInResponse) url.searchParams.append('includeValuesInResponse', 'true')

      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          majorDimension: (params.majorDimension as string) || 'ROWS',
          values: processed,
          ...(params.range ? { range: params.range } : {}),
        }),
      })

      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

      return {
        success: true,
        output: {
          updatedRange: data.updatedRange,
          updatedRows: data.updatedRows,
          updatedColumns: data.updatedColumns,
          updatedCells: data.updatedCells,
          metadata: { spreadsheetId, spreadsheetUrl: webUrl },
        },
      }
    },

    microsoft_excel_write_v2: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const sheetName = (params.sheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!sheetName) return { success: false, output: {}, error: 'Missing sheetName' }

      const cellRange = (params.cellRange as string)?.trim() || 'A1'
      const encodedSheet = encodeURIComponent(sheetName)
      const encodedAddress = encodeURIComponent(cellRange)
      const processed = processValues(params.values)

      const url = new URL(
        `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodedSheet}')/range(address='${encodedAddress}')`
      )
      const valueInputOption = (params.valueInputOption as string) || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)
      if (params.includeValuesInResponse) url.searchParams.append('includeValuesInResponse', 'true')

      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          majorDimension: (params.majorDimension as string) || 'ROWS',
          values: processed,
        }),
      })

      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

      return {
        success: true,
        output: {
          updatedRange: data.address ?? null,
          updatedRows: data.rowCount ?? 0,
          updatedColumns: data.columnCount ?? 0,
          updatedCells: (data.rowCount ?? 0) * (data.columnCount ?? 0),
          metadata: { spreadsheetId, spreadsheetUrl: webUrl },
        },
      }
    },

    microsoft_excel_table_add: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const tableName = (params.tableName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!tableName) return { success: false, output: {}, error: 'Missing tableName' }

      let processed: unknown[] = Array.isArray(params.values) ? (params.values as unknown[]) : []

      if (typeof params.values === 'string') {
        try {
          const parsed = JSON.parse(params.values as string)
          if (Array.isArray(parsed)) processed = parsed
        } catch {
          return { success: false, output: {}, error: 'Invalid JSON format for values' }
        }
      }

      // Handle array of objects (no header row for table add)
      if (
        processed.length > 0 &&
        typeof processed[0] === 'object' &&
        processed[0] !== null &&
        !Array.isArray(processed[0])
      ) {
        const allKeys = new Set<string>()
        for (const obj of processed) {
          if (obj && typeof obj === 'object') {
            Object.keys(obj as Record<string, unknown>).forEach((key) => allKeys.add(key))
          }
        }
        const headers = Array.from(allKeys)
        processed = processed.map((obj: unknown) => {
          if (!obj || typeof obj !== 'object') return Array(headers.length).fill('')
          return headers.map((key) => {
            const value = (obj as Record<string, unknown>)[key]
            if (value !== null && typeof value === 'object') return JSON.stringify(value)
            return value === undefined ? '' : value
          })
        })
      }

      if (!Array.isArray(processed) || processed.length === 0) {
        return { success: false, output: {}, error: 'Values must be a non-empty array' }
      }

      // Ensure 2D array
      if (!Array.isArray(processed[0])) {
        processed = [processed]
      }

      const encodedTable = encodeURIComponent(tableName)
      const url = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/tables('${encodedTable}')/rows/add`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: processed }),
      })

      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

      return {
        success: true,
        output: {
          index: data.index || 0,
          values: data.values || [],
          metadata: { spreadsheetId, spreadsheetUrl: webUrl },
        },
      }
    },

    microsoft_excel_worksheet_add: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const spreadsheetId = (params.spreadsheetId as string)?.trim()
      const worksheetName = (params.worksheetName as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!spreadsheetId) return { success: false, output: {}, error: 'Missing spreadsheetId' }
      if (!worksheetName) return { success: false, output: {}, error: 'Missing worksheetName' }

      if (worksheetName.length > 31) {
        return { success: false, output: {}, error: 'Worksheet name cannot exceed 31 characters' }
      }

      const invalidChars = ['\\', '/', '?', '*', '[', ']', ':']
      for (const char of invalidChars) {
        if (worksheetName.includes(char)) {
          return { success: false, output: {}, error: 'Worksheet name cannot contain \\ / ? * [ ] :' }
        }
      }

      const url = `${GRAPH_BASE}/me/drive/items/${spreadsheetId}/workbook/worksheets/add`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: worksheetName }),
      })

      if (!response.ok) {
        if (response.status === 409) {
          return { success: false, output: {}, error: 'A worksheet with this name already exists' }
        }
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = (errorData as Record<string, unknown>)?.error
          ? String((errorData as Record<string, Record<string, unknown>>).error?.message || `API error: ${response.status}`)
          : `API error: ${response.status}`
        return { success: false, output: {}, error: errorMessage }
      }

      const data = await response.json()
      const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

      return {
        success: true,
        output: {
          worksheet: {
            id: data.id || '',
            name: data.name || '',
            position: data.position ?? 0,
            visibility: data.visibility || 'Visible',
          },
          metadata: { spreadsheetId, spreadsheetUrl: webUrl },
        },
      }
    },
  },
}

export default handler
