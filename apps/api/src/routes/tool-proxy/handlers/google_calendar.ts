import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('GoogleCalendarHandler')

const CalendarsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
})

/**
 * Fetch the list of calendars for the authenticated Google user.
 */
const handleCalendars: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = CalendarsSchema.parse(body)

    logger.info(`[${requestId}] Fetching Google Calendar list`)

    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
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
        `Google Calendar API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const calendars = (data.items || []) as Array<Record<string, unknown>>

    logger.info(`[${requestId}] Successfully fetched ${calendars.length} calendars`)

    return {
      success: true,
      output: { calendars },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Google calendars:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch calendars',
    }
  }
}

export const googleCalendarHandlers: Record<string, ToolProxyHandler> = {
  calendars: handleCalendars,
}
