import type { ToolHandler } from '../../sdk/types'

const CALCOM_API_BASE = 'https://api.cal.com/v2'

function calcomHeaders(accessToken: string, apiVersion = '2024-08-13'): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'cal-api-version': apiVersion,
  }
}

async function calcomRequest(
  url: string,
  method: string,
  accessToken: string,
  body?: Record<string, unknown>,
  apiVersion?: string
): Promise<Record<string, unknown>> {
  const options: RequestInit = {
    method,
    headers: calcomHeaders(accessToken, apiVersion),
  }
  if (body && method !== 'GET' && method !== 'DELETE') {
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok) {
    const errMsg = (data as Record<string, Record<string, string>>).error?.message ||
      (data as Record<string, string>).message ||
      `Cal.com API error: ${response.status}`
    throw new Error(errMsg)
  }
  return data
}

const handler: ToolHandler = {
  operations: {
    calcom_create_booking: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.eventTypeId || !params.start || !params.attendee) {
        return { success: false, output: {}, error: 'Missing required parameters: eventTypeId, start, attendee' }
      }

      const body: Record<string, unknown> = {
        eventTypeId: params.eventTypeId,
        start: params.start,
        attendee: params.attendee,
      }
      if (params.guests && (params.guests as string[]).length > 0) body.guests = params.guests
      if (params.lengthInMinutes !== undefined) body.lengthInMinutes = params.lengthInMinutes
      if (params.metadata) body.metadata = params.metadata

      const data = await calcomRequest(`${CALCOM_API_BASE}/bookings`, 'POST', accessToken, body)
      return { success: true, output: data }
    },

    calcom_get_booking: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.bookingUid) return { success: false, output: {}, error: 'Missing required parameter: bookingUid' }

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/bookings/${encodeURIComponent(params.bookingUid as string)}`,
        'GET', accessToken
      )
      return { success: true, output: data }
    },

    calcom_list_bookings: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }

      const qp = new URLSearchParams()
      if (params.status) qp.append('status', params.status as string)
      if (params.afterStart) qp.append('afterStart', params.afterStart as string)
      if (params.beforeEnd) qp.append('beforeEnd', params.beforeEnd as string)
      if (params.take) qp.append('take', String(params.take))
      if (params.skip) qp.append('skip', String(params.skip))
      if (params.sortStart) qp.append('sortStart', params.sortStart as string)
      if (params.sortEnd) qp.append('sortEnd', params.sortEnd as string)
      if (params.sortCreated) qp.append('sortCreated', params.sortCreated as string)

      const qs = qp.toString()
      const data = await calcomRequest(
        `${CALCOM_API_BASE}/bookings${qs ? `?${qs}` : ''}`, 'GET', accessToken
      )
      return { success: true, output: data }
    },

    calcom_cancel_booking: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.bookingUid) return { success: false, output: {}, error: 'Missing required parameter: bookingUid' }

      const body: Record<string, unknown> = {}
      if (params.cancellationReason) body.cancellationReason = params.cancellationReason

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/bookings/${encodeURIComponent(params.bookingUid as string)}/cancel`,
        'POST', accessToken, body
      )
      return { success: true, output: data }
    },

    calcom_confirm_booking: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.bookingUid) return { success: false, output: {}, error: 'Missing required parameter: bookingUid' }

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/bookings/${encodeURIComponent(params.bookingUid as string)}/confirm`,
        'POST', accessToken, {}
      )
      return { success: true, output: data }
    },

    calcom_decline_booking: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.bookingUid) return { success: false, output: {}, error: 'Missing required parameter: bookingUid' }

      const body: Record<string, unknown> = {}
      if (params.reason) body.reason = params.reason

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/bookings/${encodeURIComponent(params.bookingUid as string)}/decline`,
        'POST', accessToken, body
      )
      return { success: true, output: data }
    },

    calcom_reschedule_booking: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.bookingUid || !params.start) {
        return { success: false, output: {}, error: 'Missing required parameters: bookingUid, start' }
      }

      const body: Record<string, unknown> = { start: params.start }
      if (params.reschedulingReason) body.reschedulingReason = params.reschedulingReason

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/bookings/${encodeURIComponent(params.bookingUid as string)}/reschedule`,
        'POST', accessToken, body
      )
      return { success: true, output: data }
    },

    calcom_create_event_type: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.title || !params.slug || params.lengthInMinutes === undefined) {
        return { success: false, output: {}, error: 'Missing required parameters: title, slug, lengthInMinutes' }
      }

      const body: Record<string, unknown> = {
        title: (params.title as string).trim(),
        slug: (params.slug as string).trim(),
        lengthInMinutes: params.lengthInMinutes,
      }
      if (params.description) body.description = params.description
      if (params.slotInterval !== undefined) body.slotInterval = params.slotInterval
      if (params.minimumBookingNotice !== undefined) body.minimumBookingNotice = params.minimumBookingNotice
      if (params.beforeEventBuffer !== undefined) body.beforeEventBuffer = params.beforeEventBuffer
      if (params.afterEventBuffer !== undefined) body.afterEventBuffer = params.afterEventBuffer
      if (params.scheduleId !== undefined) body.scheduleId = params.scheduleId
      if (params.disableGuests !== undefined) body.disableGuests = params.disableGuests

      const data = await calcomRequest(`${CALCOM_API_BASE}/event-types`, 'POST', accessToken, body, '2024-06-14')
      return { success: true, output: data }
    },

    calcom_get_event_type: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.eventTypeId) return { success: false, output: {}, error: 'Missing required parameter: eventTypeId' }

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/event-types/${params.eventTypeId}`, 'GET', accessToken, undefined, '2024-06-14'
      )
      return { success: true, output: data }
    },

    calcom_list_event_types: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }

      const data = await calcomRequest(`${CALCOM_API_BASE}/event-types`, 'GET', accessToken, undefined, '2024-06-14')
      return { success: true, output: data }
    },

    calcom_update_event_type: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.eventTypeId) return { success: false, output: {}, error: 'Missing required parameter: eventTypeId' }

      const body: Record<string, unknown> = {}
      if (params.title) body.title = params.title
      if (params.slug) body.slug = params.slug
      if (params.lengthInMinutes !== undefined) body.lengthInMinutes = params.lengthInMinutes
      if (params.description) body.description = params.description
      if (params.slotInterval !== undefined) body.slotInterval = params.slotInterval
      if (params.minimumBookingNotice !== undefined) body.minimumBookingNotice = params.minimumBookingNotice
      if (params.disableGuests !== undefined) body.disableGuests = params.disableGuests

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/event-types/${params.eventTypeId}`, 'PATCH', accessToken, body, '2024-06-14'
      )
      return { success: true, output: data }
    },

    calcom_delete_event_type: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.eventTypeId) return { success: false, output: {}, error: 'Missing required parameter: eventTypeId' }

      const data = await calcomRequest(
        `${CALCOM_API_BASE}/event-types/${params.eventTypeId}`, 'DELETE', accessToken, undefined, '2024-06-14'
      )
      return { success: true, output: data }
    },

    calcom_create_schedule: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const body: Record<string, unknown> = {
        name: params.name,
        timeZone: params.timeZone || 'America/New_York',
      }
      if (params.isDefault !== undefined) body.isDefault = params.isDefault
      if (params.availability) body.availability = params.availability

      const data = await calcomRequest(`${CALCOM_API_BASE}/schedules`, 'POST', accessToken, body)
      return { success: true, output: data }
    },

    calcom_get_schedule: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.scheduleId) return { success: false, output: {}, error: 'Missing required parameter: scheduleId' }

      const data = await calcomRequest(`${CALCOM_API_BASE}/schedules/${params.scheduleId}`, 'GET', accessToken)
      return { success: true, output: data }
    },

    calcom_get_default_schedule: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }

      const data = await calcomRequest(`${CALCOM_API_BASE}/schedules/default`, 'GET', accessToken)
      return { success: true, output: data }
    },

    calcom_list_schedules: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }

      const data = await calcomRequest(`${CALCOM_API_BASE}/schedules`, 'GET', accessToken)
      return { success: true, output: data }
    },

    calcom_update_schedule: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.scheduleId) return { success: false, output: {}, error: 'Missing required parameter: scheduleId' }

      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.timeZone) body.timeZone = params.timeZone
      if (params.isDefault !== undefined) body.isDefault = params.isDefault
      if (params.availability) body.availability = params.availability

      const data = await calcomRequest(`${CALCOM_API_BASE}/schedules/${params.scheduleId}`, 'PATCH', accessToken, body)
      return { success: true, output: data }
    },

    calcom_delete_schedule: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.scheduleId) return { success: false, output: {}, error: 'Missing required parameter: scheduleId' }

      const data = await calcomRequest(`${CALCOM_API_BASE}/schedules/${params.scheduleId}`, 'DELETE', accessToken)
      return { success: true, output: data }
    },

    calcom_get_slots: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.startTime || !params.endTime) {
        return { success: false, output: {}, error: 'Missing required parameters: startTime, endTime' }
      }

      const qp = new URLSearchParams({
        startTime: params.startTime as string,
        endTime: params.endTime as string,
      })
      if (params.eventTypeId) qp.append('eventTypeId', String(params.eventTypeId))
      if (params.eventTypeSlug) qp.append('eventTypeSlug', params.eventTypeSlug as string)
      if (params.usernameList) qp.append('usernameList', (params.usernameList as string[]).join(','))
      if (params.timeZone) qp.append('timeZone', params.timeZone as string)

      const data = await calcomRequest(`${CALCOM_API_BASE}/slots?${qp.toString()}`, 'GET', accessToken)
      return { success: true, output: data }
    },
  },
}

export default handler
