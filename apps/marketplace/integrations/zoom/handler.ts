import type { ToolHandler } from '../../sdk/types'

const ZOOM_API_BASE = 'https://api.zoom.us/v2'

function zoomHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

const handler: ToolHandler = {
  operations: {
    zoom_create_meeting: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const userId = (params.userId as string) || 'me'
      const topic = params.topic as string
      if (!topic) return { success: false, output: {}, error: 'Missing required parameter: topic' }

      const body: Record<string, unknown> = {
        topic,
        type: Number(params.type) || 2,
      }

      if (params.startTime) body.start_time = params.startTime
      if (params.duration) body.duration = Number(params.duration)
      if (params.timezone) body.timezone = params.timezone
      if (params.agenda) body.agenda = params.agenda
      if (params.password) body.password = params.password

      if (params.settings) {
        try {
          body.settings = JSON.parse(params.settings as string)
        } catch {
          // ignore parse error
        }
      }

      const response = await fetch(`${ZOOM_API_BASE}/users/${userId}/meetings`, {
        method: 'POST',
        headers: zoomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          id: data.id,
          topic: data.topic,
          type: data.type,
          status: data.status,
          startTime: data.start_time,
          duration: data.duration,
          timezone: data.timezone,
          joinUrl: data.join_url,
          startUrl: data.start_url,
          password: data.password,
          hostEmail: data.host_email,
          createdAt: data.created_at,
        },
      }
    },

    zoom_list_meetings: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const userId = (params.userId as string) || 'me'

      const queryParams = new URLSearchParams()
      if (params.type) queryParams.append('type', params.type as string)
      if (params.pageSize) queryParams.append('page_size', String(params.pageSize))
      if (params.nextPageToken) queryParams.append('next_page_token', params.nextPageToken as string)
      if (params.pageNumber) queryParams.append('page_number', String(params.pageNumber))

      const query = queryParams.toString()
      const url = query
        ? `${ZOOM_API_BASE}/users/${userId}/meetings?${query}`
        : `${ZOOM_API_BASE}/users/${userId}/meetings`

      const response = await fetch(url, { headers: zoomHeaders(accessToken) })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          meetings: data.meetings || [],
          pageCount: data.page_count,
          pageNumber: data.page_number,
          pageSize: data.page_size,
          totalRecords: data.total_records,
          nextPageToken: data.next_page_token,
        },
      }
    },

    zoom_get_meeting: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const meetingId = params.meetingId as string
      if (!meetingId) return { success: false, output: {}, error: 'Missing required parameter: meetingId' }

      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
        headers: zoomHeaders(accessToken),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          id: data.id,
          topic: data.topic,
          type: data.type,
          status: data.status,
          startTime: data.start_time,
          duration: data.duration,
          timezone: data.timezone,
          agenda: data.agenda,
          joinUrl: data.join_url,
          startUrl: data.start_url,
          password: data.password,
          hostEmail: data.host_email,
          createdAt: data.created_at,
          settings: data.settings,
        },
      }
    },

    zoom_update_meeting: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const meetingId = params.meetingId as string
      if (!meetingId) return { success: false, output: {}, error: 'Missing required parameter: meetingId' }

      const body: Record<string, unknown> = {}
      if (params.topic) body.topic = params.topic
      if (params.type) body.type = Number(params.type)
      if (params.startTime) body.start_time = params.startTime
      if (params.duration) body.duration = Number(params.duration)
      if (params.timezone) body.timezone = params.timezone
      if (params.agenda) body.agenda = params.agenda
      if (params.password) body.password = params.password

      if (params.settings) {
        try {
          body.settings = JSON.parse(params.settings as string)
        } catch {
          // ignore parse error
        }
      }

      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: zoomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      return {
        success: true,
        output: { message: 'Meeting updated successfully', meetingId },
      }
    },

    zoom_delete_meeting: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const meetingId = params.meetingId as string
      if (!meetingId) return { success: false, output: {}, error: 'Missing required parameter: meetingId' }

      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: zoomHeaders(accessToken),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      return {
        success: true,
        output: { message: 'Meeting deleted successfully', meetingId },
      }
    },

    zoom_list_recordings: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const userId = (params.userId as string) || 'me'

      const queryParams = new URLSearchParams()
      if (params.from) queryParams.append('from', params.from as string)
      if (params.to) queryParams.append('to', params.to as string)
      if (params.pageSize) queryParams.append('page_size', String(params.pageSize))
      if (params.nextPageToken) queryParams.append('next_page_token', params.nextPageToken as string)
      if (params.trashType) queryParams.append('trash_type', params.trashType as string)

      const query = queryParams.toString()
      const url = query
        ? `${ZOOM_API_BASE}/users/${userId}/recordings?${query}`
        : `${ZOOM_API_BASE}/users/${userId}/recordings`

      const response = await fetch(url, { headers: zoomHeaders(accessToken) })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          meetings: data.meetings || [],
          from: data.from,
          to: data.to,
          pageCount: data.page_count,
          pageSize: data.page_size,
          totalRecords: data.total_records,
          nextPageToken: data.next_page_token,
        },
      }
    },

    zoom_get_meeting_invitation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const meetingId = params.meetingId as string
      if (!meetingId) return { success: false, output: {}, error: 'Missing required parameter: meetingId' }

      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}/invitation`, {
        headers: zoomHeaders(accessToken),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: { invitation: data.invitation },
      }
    },

    zoom_get_meeting_recordings: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const meetingId = params.meetingId as string
      if (!meetingId) return { success: false, output: {}, error: 'Missing required parameter: meetingId' }

      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}/recordings`, {
        headers: zoomHeaders(accessToken),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          id: data.id,
          topic: data.topic,
          startTime: data.start_time,
          duration: data.duration,
          totalSize: data.total_size,
          recordingFiles: data.recording_files || [],
          shareUrl: data.share_url,
          password: data.password,
        },
      }
    },

    zoom_list_past_participants: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const meetingId = params.meetingId as string
      if (!meetingId) return { success: false, output: {}, error: 'Missing required parameter: meetingId' }

      const queryParams = new URLSearchParams()
      if (params.pageSize) queryParams.append('page_size', String(params.pageSize))
      if (params.nextPageToken) queryParams.append('next_page_token', params.nextPageToken as string)

      const query = queryParams.toString()
      const url = query
        ? `${ZOOM_API_BASE}/past_meetings/${meetingId}/participants?${query}`
        : `${ZOOM_API_BASE}/past_meetings/${meetingId}/participants`

      const response = await fetch(url, { headers: zoomHeaders(accessToken) })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          participants: data.participants || [],
          pageCount: data.page_count,
          pageSize: data.page_size,
          totalRecords: data.total_records,
          nextPageToken: data.next_page_token,
        },
      }
    },

    zoom_delete_recording: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const meetingId = params.meetingId as string
      if (!meetingId) return { success: false, output: {}, error: 'Missing required parameter: meetingId' }

      let url = `${ZOOM_API_BASE}/meetings/${meetingId}/recordings`
      if (params.recordingId) url += `/${params.recordingId}`
      if (params.action) url += `?action=${params.action}`

      const response = await fetch(url, {
        method: 'DELETE',
        headers: zoomHeaders(accessToken),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Zoom API error: ${response.status}`,
        }
      }

      return {
        success: true,
        output: { message: 'Recording deleted successfully' },
      }
    },
  },
}

export default handler
