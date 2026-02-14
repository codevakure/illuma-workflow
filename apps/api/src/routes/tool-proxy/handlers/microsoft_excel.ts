import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MicrosoftExcelHandler')

const SheetsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  workbookId: z.string().min(1, 'Workbook ID is required'),
})

/**
 * Fetch worksheets from a Microsoft Excel workbook via the Graph API.
 * Returns sheets sorted by position with name used as the addressing ID.
 */
const handleSheets: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = SheetsSchema.parse(body)

    const url = `https://graph.microsoft.com/v1.0/me/drive/items/${validated.workbookId}/workbook/worksheets`

    logger.info(`[${requestId}] Fetching Microsoft Excel worksheets`, {
      workbookId: validated.workbookId,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response
        .text()
        .then((text) => JSON.parse(text))
        .catch(() => ({ error: { message: 'Unknown error' } }))
      const errorMessage =
        (errorData as Record<string, Record<string, string>>).error?.message ||
        `Microsoft Graph API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const worksheets: Array<{
      id: string
      name: string
      position: number
      visibility: string
    }> = data.value || []

    worksheets.sort((a, b) => a.position - b.position)

    logger.info(`[${requestId}] Successfully fetched ${worksheets.length} Excel worksheets`)

    return {
      success: true,
      output: {
        sheets: worksheets.map((worksheet) => ({
          id: worksheet.name,
          name: worksheet.name,
          worksheetId: worksheet.id,
          position: worksheet.position,
          visibility: worksheet.visibility,
        })),
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Excel worksheets:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Excel worksheets',
    }
  }
}

export const microsoftExcelHandlers: Record<string, ToolProxyHandler> = {
  sheets: handleSheets,
}
