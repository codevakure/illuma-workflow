import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('GoogleSheetsHandler')

const SheetsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID is required'),
})

/**
 * Fetch the list of sheets (tabs) from a Google Spreadsheet.
 */
const handleSheets: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = SheetsSchema.parse(body)

    logger.info(`[${requestId}] Fetching Google Sheets tabs`, {
      spreadsheetId: validated.spreadsheetId,
    })

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${validated.spreadsheetId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validated.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      const errorMessage =
        (errorData as Record<string, Record<string, string>>).error?.message ||
        `Google Sheets API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const sheets = ((data.sheets || []) as Array<Record<string, Record<string, unknown>>>).map(
      (sheet) => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
        index: sheet.properties?.index,
      })
    )

    logger.info(`[${requestId}] Successfully fetched ${sheets.length} sheets`)

    return {
      success: true,
      output: { sheets },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Google Sheets:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch sheets',
    }
  }
}

export const googleSheetsHandlers: Record<string, ToolProxyHandler> = {
  sheets: handleSheets,
}
