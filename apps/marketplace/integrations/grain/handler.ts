import type { ToolHandler } from '../../sdk/types'

const BASE_URL = 'https://api.grain.com/_/public-api/v2'
const API_VERSION = '2025-10-31'

function grainHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Public-Api-Version': API_VERSION,
  }
}

const handler: ToolHandler = {
  operations: {
    grain_list_recordings: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const body: Record<string, any> = {}

      if (params.cursor) body.cursor = params.cursor

      const filter: Record<string, any> = {}
      if (params.beforeDatetime) filter.before_datetime = params.beforeDatetime
      if (params.afterDatetime) filter.after_datetime = params.afterDatetime
      if (params.participantScope) filter.participant_scope = params.participantScope
      if (params.titleSearch) filter.title_search = params.titleSearch
      if (params.teamId) filter.team = params.teamId
      if (params.meetingTypeId) filter.meeting_type = params.meetingTypeId
      if (Object.keys(filter).length > 0) body.filter = filter

      const include: Record<string, any> = {}
      if (params.includeHighlights) include.highlights = true
      if (params.includeParticipants) include.participants = true
      if (params.includeAiSummary) include.ai_summary = true
      if (Object.keys(include).length > 0) body.include = include

      const resp = await fetch(`${BASE_URL}/recordings`, {
        method: 'POST',
        headers: grainHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          recordings: data.recordings || [],
          cursor: data.cursor || null,
        },
      }
    },

    grain_get_recording: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const recordingId = params.recordingId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!recordingId) return { success: false, output: {}, error: 'Missing required parameter: recordingId' }

      const include: Record<string, any> = {}
      if (params.includeHighlights) include.highlights = true
      if (params.includeParticipants) include.participants = true
      if (params.includeAiSummary) include.ai_summary = true
      if (params.includeCalendarEvent) include.calendar_event = true
      if (params.includeHubspot) include.hubspot = true

      const body = Object.keys(include).length > 0 ? { include } : {}

      const resp = await fetch(`${BASE_URL}/recordings/${recordingId}`, {
        method: 'POST',
        headers: grainHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      return { success: true, output: data }
    },

    grain_get_transcript: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const recordingId = params.recordingId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!recordingId) return { success: false, output: {}, error: 'Missing required parameter: recordingId' }

      const resp = await fetch(`${BASE_URL}/recordings/${recordingId}/transcript`, {
        method: 'GET',
        headers: grainHeaders(apiKey),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          transcript: Array.isArray(data) ? data : [],
        },
      }
    },

    grain_list_teams: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const resp = await fetch(`${BASE_URL}/teams`, {
        method: 'POST',
        headers: grainHeaders(apiKey),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { teams: data.teams || data || [] },
      }
    },

    grain_list_meeting_types: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const resp = await fetch(`${BASE_URL}/meeting_types`, {
        method: 'POST',
        headers: grainHeaders(apiKey),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { meeting_types: data.meeting_types || data || [] },
      }
    },

    grain_create_hook: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const hookUrl = params.hookUrl as string
      const hookType = params.hookType as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!hookUrl) return { success: false, output: {}, error: 'Missing required parameter: hookUrl' }
      if (!hookType) return { success: false, output: {}, error: 'Missing required parameter: hookType' }

      const body: Record<string, any> = {
        hook_url: hookUrl,
        hook_type: hookType,
      }

      const filter: Record<string, any> = {}
      if (params.filterBeforeDatetime) filter.before_datetime = params.filterBeforeDatetime
      if (params.filterAfterDatetime) filter.after_datetime = params.filterAfterDatetime
      if (params.filterParticipantScope) filter.participant_scope = params.filterParticipantScope
      if (params.filterTeamId) filter.team = params.filterTeamId
      if (params.filterMeetingTypeId) filter.meeting_type = params.filterMeetingTypeId
      if (Object.keys(filter).length > 0) body.filter = filter

      const include: Record<string, any> = {}
      if (params.includeHighlights) include.highlights = true
      if (params.includeParticipants) include.participants = true
      if (params.includeAiSummary) include.ai_summary = true
      if (Object.keys(include).length > 0) body.include = include

      const resp = await fetch(`${BASE_URL}/hooks/create`, {
        method: 'POST',
        headers: grainHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      return { success: true, output: data }
    },

    grain_list_hooks: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const resp = await fetch(`${BASE_URL}/hooks`, {
        method: 'POST',
        headers: grainHeaders(apiKey),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { hooks: data.hooks || data || [] },
      }
    },

    grain_delete_hook: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const hookId = params.hookId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!hookId) return { success: false, output: {}, error: 'Missing required parameter: hookId' }

      const resp = await fetch(`${BASE_URL}/hooks/${hookId}`, {
        method: 'DELETE',
        headers: grainHeaders(apiKey),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (data as any).error || (data as any).message || `Grain API error: ${resp.status}`,
        }
      }

      return { success: true, output: { success: true } }
    },
  },
}

export default handler
