import type { ToolHandler } from '../../sdk/types'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

function parseAttendees(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((e: string) => e && e.trim().length > 0)
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.split(',').map((e) => e.trim()).filter((e) => e.length > 0)
  }
  return []
}

function mapEvent(data: Record<string, unknown>) {
  return {
    id: data.id,
    htmlLink: data.htmlLink,
    status: data.status,
    summary: data.summary ?? null,
    description: data.description ?? null,
    location: data.location ?? null,
    start: data.start,
    end: data.end,
    attendees: data.attendees ?? null,
    creator: data.creator,
    organizer: data.organizer,
  }
}

const handler: ToolHandler = {
  operations: {
    google_calendar_list: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const calendarId = (params.calendarId as string) || 'primary'
      const qp = new URLSearchParams()
      if (params.timeMin) qp.append('timeMin', params.timeMin as string)
      if (params.timeMax) qp.append('timeMax', params.timeMax as string)
      qp.append('singleEvents', 'true')
      if (params.orderBy) qp.append('orderBy', params.orderBy as string)
      if (params.showDeleted !== undefined) qp.append('showDeleted', String(params.showDeleted))

      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${qp.toString()}`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      const data = await response.json()
      const events = (data.items || []).map((e: Record<string, unknown>) => mapEvent(e))

      return {
        success: true,
        output: {
          nextPageToken: data.nextPageToken ?? null,
          timeZone: data.timeZone ?? null,
          events,
        },
      }
    },

    google_calendar_list_v2: async (params, ctx) => {
      return handler.operations.google_calendar_list(params, ctx)
    },

    google_calendar_get: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const eventId = params.eventId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!eventId) return { success: false, output: {}, error: 'Missing eventId' }

      const calendarId = (params.calendarId as string) || 'primary'
      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      return { success: true, output: mapEvent(await response.json()) }
    },

    google_calendar_get_v2: async (params, ctx) => {
      return handler.operations.google_calendar_get(params, ctx)
    },

    google_calendar_create: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const summary = params.summary as string
      const startDateTime = params.startDateTime as string
      const endDateTime = params.endDateTime as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!summary) return { success: false, output: {}, error: 'Missing summary' }
      if (!startDateTime || !endDateTime) return { success: false, output: {}, error: 'Missing start/end datetime' }

      const calendarId = (params.calendarId as string) || 'primary'
      const timeZone = (params.timeZone as string) || 'America/Los_Angeles'
      const needsTz = !startDateTime.includes('+') && !startDateTime.includes('-', 10)

      const eventBody: Record<string, unknown> = {
        summary,
        start: { dateTime: startDateTime, ...(needsTz ? { timeZone } : {}) },
        end: { dateTime: endDateTime, ...(needsTz ? { timeZone } : {}) },
      }
      if (params.description) eventBody.description = params.description
      if (params.location) eventBody.location = params.location
      if (params.timeZone) {
        (eventBody.start as Record<string, unknown>).timeZone = params.timeZone
        ;(eventBody.end as Record<string, unknown>).timeZone = params.timeZone
      }
      const attendeeList = parseAttendees(params.attendees)
      if (attendeeList.length > 0) eventBody.attendees = attendeeList.map((email) => ({ email }))

      const qp = new URLSearchParams()
      if (params.sendUpdates) qp.append('sendUpdates', params.sendUpdates as string)

      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${qp.toString() ? `?${qp.toString()}` : ''}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      return { success: true, output: mapEvent(await response.json()) }
    },

    google_calendar_create_v2: async (params, ctx) => {
      return handler.operations.google_calendar_create(params, ctx)
    },

    google_calendar_update: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const eventId = params.eventId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!eventId) return { success: false, output: {}, error: 'Missing eventId' }

      const calendarId = (params.calendarId as string) || 'primary'
      const updateData: Record<string, unknown> = {}
      if (params.summary !== undefined) updateData.summary = params.summary
      if (params.description !== undefined) updateData.description = params.description
      if (params.location !== undefined) updateData.location = params.location
      if (params.startDateTime !== undefined) {
        const needsTz = !(params.startDateTime as string).includes('+') && !(params.startDateTime as string).includes('-', 10)
        updateData.start = { dateTime: params.startDateTime, ...(needsTz && params.timeZone ? { timeZone: params.timeZone } : {}) }
      }
      if (params.endDateTime !== undefined) {
        const needsTz = !(params.endDateTime as string).includes('+') && !(params.endDateTime as string).includes('-', 10)
        updateData.end = { dateTime: params.endDateTime, ...(needsTz && params.timeZone ? { timeZone: params.timeZone } : {}) }
      }
      if (params.attendees !== undefined) {
        updateData.attendees = parseAttendees(params.attendees).map((email) => ({ email }))
      }

      const qp = new URLSearchParams()
      if (params.sendUpdates) qp.append('sendUpdates', params.sendUpdates as string)

      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qp.toString() ? `?${qp.toString()}` : ''}`
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      return { success: true, output: mapEvent(await response.json()) }
    },

    google_calendar_update_v2: async (params, ctx) => {
      return handler.operations.google_calendar_update(params, ctx)
    },

    google_calendar_delete: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const eventId = params.eventId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!eventId) return { success: false, output: {}, error: 'Missing eventId' }

      const calendarId = (params.calendarId as string) || 'primary'
      const qp = new URLSearchParams()
      if (params.sendUpdates) qp.append('sendUpdates', params.sendUpdates as string)

      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qp.toString() ? `?${qp.toString()}` : ''}`
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok && response.status !== 204) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      return { success: true, output: { eventId, deleted: true } }
    },

    google_calendar_delete_v2: async (params, ctx) => {
      return handler.operations.google_calendar_delete(params, ctx)
    },

    google_calendar_quick_add: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const text = params.text as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!text) return { success: false, output: {}, error: 'Missing text' }

      const calendarId = (params.calendarId as string) || 'primary'
      const qp = new URLSearchParams()
      qp.append('text', text)
      if (params.sendUpdates) qp.append('sendUpdates', params.sendUpdates as string)

      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?${qp.toString()}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }

      let eventData = await response.json()

      const attendeeList = parseAttendees(params.attendees)
      if (attendeeList.length > 0) {
        const updateQp = new URLSearchParams()
        if (params.sendUpdates) updateQp.append('sendUpdates', params.sendUpdates as string)
        const updateUrl = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventData.id}${updateQp.toString() ? `?${updateQp.toString()}` : ''}`
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ attendees: attendeeList.map((email) => ({ email })) }),
        })
        if (updateResp.ok) eventData = await updateResp.json()
      }

      return { success: true, output: mapEvent(eventData) }
    },

    google_calendar_quick_add_v2: async (params, ctx) => {
      return handler.operations.google_calendar_quick_add(params, ctx)
    },

    google_calendar_invite: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const eventId = params.eventId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!eventId) return { success: false, output: {}, error: 'Missing eventId' }

      const calendarId = (params.calendarId as string) || 'primary'

      const getUrl = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      const getResp = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!getResp.ok) {
        return { success: false, output: {}, error: `Failed to fetch event: ${getResp.status}` }
      }
      const existingEvent = await getResp.json()

      const newAttendees = parseAttendees(params.attendees)
      const existingAttendees = existingEvent.attendees || []
      const shouldReplace = params.replaceExisting === true || params.replaceExisting === 'true'

      let finalAttendees: Array<Record<string, unknown>>
      if (shouldReplace) {
        finalAttendees = newAttendees.map((email) => ({ email, responseStatus: 'needsAction' }))
      } else {
        finalAttendees = [...existingAttendees]
        const existingEmails = new Set(existingAttendees.map((a: Record<string, unknown>) => (a.email as string)?.toLowerCase()))
        for (const email of newAttendees) {
          if (!existingEmails.has(email.toLowerCase())) {
            finalAttendees.push({ email, responseStatus: 'needsAction' })
          }
        }
      }

      const updatedEvent = { ...existingEvent, attendees: finalAttendees }
      for (const field of ['id', 'etag', 'kind', 'created', 'updated', 'htmlLink', 'iCalUID', 'sequence', 'creator', 'organizer']) {
        delete updatedEvent[field]
      }

      const qp = new URLSearchParams()
      if (params.sendUpdates) qp.append('sendUpdates', params.sendUpdates as string)
      const putUrl = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qp.toString() ? `?${qp.toString()}` : ''}`

      const putResp = await fetch(putUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedEvent),
      })
      if (!putResp.ok) {
        const err = await putResp.text().catch(() => '')
        return { success: false, output: {}, error: `Failed to update event: ${putResp.status} ${err}` }
      }

      return { success: true, output: mapEvent(await putResp.json()) }
    },

    google_calendar_invite_v2: async (params, ctx) => {
      return handler.operations.google_calendar_invite(params, ctx)
    },

    google_calendar_move: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const eventId = params.eventId as string
      const destinationCalendarId = params.destinationCalendarId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!eventId) return { success: false, output: {}, error: 'Missing eventId' }
      if (!destinationCalendarId) return { success: false, output: {}, error: 'Missing destinationCalendarId' }

      const calendarId = (params.calendarId as string) || 'primary'
      const qp = new URLSearchParams()
      qp.append('destination', destinationCalendarId)
      if (params.sendUpdates) qp.append('sendUpdates', params.sendUpdates as string)

      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move?${qp.toString()}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      return { success: true, output: mapEvent(await response.json()) }
    },

    google_calendar_move_v2: async (params, ctx) => {
      return handler.operations.google_calendar_move(params, ctx)
    },

    google_calendar_instances: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const eventId = params.eventId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!eventId) return { success: false, output: {}, error: 'Missing eventId' }

      const calendarId = (params.calendarId as string) || 'primary'
      const qp = new URLSearchParams()
      if (params.timeMin) qp.append('timeMin', params.timeMin as string)
      if (params.timeMax) qp.append('timeMax', params.timeMax as string)
      if (params.maxResults) qp.append('maxResults', String(params.maxResults))
      if (params.pageToken) qp.append('pageToken', params.pageToken as string)
      if (params.showDeleted !== undefined) qp.append('showDeleted', String(params.showDeleted))

      const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/instances${qp.toString() ? `?${qp.toString()}` : ''}`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          nextPageToken: data.nextPageToken ?? null,
          timeZone: data.timeZone ?? null,
          instances: (data.items || []).map((inst: Record<string, unknown>) => ({
            ...mapEvent(inst),
            recurringEventId: inst.recurringEventId,
            originalStartTime: inst.originalStartTime,
          })),
        },
      }
    },

    google_calendar_instances_v2: async (params, ctx) => {
      return handler.operations.google_calendar_instances(params, ctx)
    },

    google_calendar_list_calendars: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const qp = new URLSearchParams()
      if (params.minAccessRole) qp.append('minAccessRole', params.minAccessRole as string)
      if (params.maxResults) qp.append('maxResults', String(params.maxResults))
      if (params.pageToken) qp.append('pageToken', params.pageToken as string)
      if (params.showDeleted !== undefined) qp.append('showDeleted', String(params.showDeleted))
      if (params.showHidden !== undefined) qp.append('showHidden', String(params.showHidden))

      const url = `${CALENDAR_API}/users/me/calendarList${qp.toString() ? `?${qp.toString()}` : ''}`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Calendar API error: ${response.status} ${err}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          nextPageToken: data.nextPageToken ?? null,
          calendars: (data.items || []).map((cal: Record<string, unknown>) => ({
            id: cal.id,
            summary: cal.summaryOverride || cal.summary,
            description: cal.description ?? null,
            location: cal.location ?? null,
            timeZone: cal.timeZone,
            accessRole: cal.accessRole,
            backgroundColor: cal.backgroundColor,
            foregroundColor: cal.foregroundColor,
            primary: cal.primary ?? null,
            hidden: cal.hidden ?? null,
            selected: cal.selected ?? null,
          })),
        },
      }
    },

    google_calendar_list_calendars_v2: async (params, ctx) => {
      return handler.operations.google_calendar_list_calendars(params, ctx)
    },
  },
}

export default handler
