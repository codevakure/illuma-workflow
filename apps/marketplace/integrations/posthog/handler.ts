import type { ToolHandler } from '../../sdk/types'

function phUrl(region: unknown, path: string): string {
  const host = region === 'eu' ? 'eu.posthog.com' : 'app.posthog.com'
  return `https://${host}${path}`
}

function phHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

const handler: ToolHandler = {
  operations: {
    posthog_capture_event: async (params) => {
      const projectApiKey = params.projectApiKey as string
      const distinctId = params.distinctId as string
      const event = params.event as string
      if (!projectApiKey || !distinctId || !event) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {
        api_key: projectApiKey,
        distinct_id: distinctId,
        event,
      }
      if (params.properties) {
        try { body.properties = typeof params.properties === 'string' ? JSON.parse(params.properties as string) : params.properties } catch { /* skip */ }
      }
      if (params.timestamp) body.timestamp = params.timestamp

      const response = await fetch(phUrl(params.region, '/capture/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      return { success: true, output: { status: 'ok' } }
    },

    posthog_batch_events: async (params) => {
      const projectApiKey = params.projectApiKey as string
      if (!projectApiKey) return { success: false, output: {}, error: 'Missing required parameter: projectApiKey' }

      let batch: any[]
      try {
        batch = typeof params.batch === 'string' ? JSON.parse(params.batch as string) : params.batch as any[]
      } catch {
        return { success: false, output: {}, error: 'Invalid JSON in batch parameter' }
      }

      const response = await fetch(phUrl(params.region, '/batch/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: projectApiKey, batch }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      return { success: true, output: { status: 'ok' } }
    },

    posthog_list_persons: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const qp = new URLSearchParams()
      if (params.search) qp.set('search', params.search as string)
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.offset) qp.set('offset', String(params.offset))

      const qs = qp.toString()
      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/persons/${qs ? `?${qs}` : ''}`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, next: data.next, count: data.count } }
    },

    posthog_get_person: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const personId = params.personId as string
      if (!apiKey || !projectId || !personId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/persons/${personId}/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { person: data } }
    },

    posthog_delete_person: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const personId = params.personId as string
      if (!apiKey || !projectId || !personId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/persons/${personId}/`), {
        method: 'DELETE',
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      return { success: true, output: { deleted: true } }
    },

    posthog_query: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      let query: any
      try {
        query = typeof params.query === 'string' ? JSON.parse(params.query as string) : params.query
      } catch {
        return { success: false, output: {}, error: 'Invalid JSON in query parameter' }
      }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/query/`), {
        method: 'POST',
        headers: phHeaders(apiKey),
        body: JSON.stringify({ query }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    posthog_list_feature_flags: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/feature_flags/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },

    posthog_get_feature_flag: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const flagId = params.flagId as string
      if (!apiKey || !projectId || !flagId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/feature_flags/${flagId}/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { featureFlag: data } }
    },

    posthog_create_feature_flag: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, any> = { key: params.key, name: params.name }
      if (params.active !== undefined) body.active = params.active
      if (params.filters) {
        try { body.filters = typeof params.filters === 'string' ? JSON.parse(params.filters as string) : params.filters } catch { /* skip */ }
      }
      if (params.rolloutPercentage !== undefined) body.rollout_percentage = params.rolloutPercentage

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/feature_flags/`), {
        method: 'POST',
        headers: phHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { featureFlag: data } }
    },

    posthog_update_feature_flag: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const flagId = params.flagId as string
      if (!apiKey || !projectId || !flagId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, any> = {}
      if (params.name) body.name = params.name
      if (params.key) body.key = params.key
      if (params.active !== undefined) body.active = params.active
      if (params.filters) {
        try { body.filters = typeof params.filters === 'string' ? JSON.parse(params.filters as string) : params.filters } catch { /* skip */ }
      }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/feature_flags/${flagId}/`), {
        method: 'PATCH',
        headers: phHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { featureFlag: data } }
    },

    posthog_delete_feature_flag: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const flagId = params.flagId as string
      if (!apiKey || !projectId || !flagId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/feature_flags/${flagId}/`), {
        method: 'DELETE',
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      return { success: true, output: { deleted: true } }
    },

    posthog_evaluate_flags: async (params) => {
      const projectApiKey = params.projectApiKey as string
      const distinctId = params.distinctId as string
      if (!projectApiKey || !distinctId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, any> = { api_key: projectApiKey, distinct_id: distinctId }
      if (params.groups) {
        try { body.groups = typeof params.groups === 'string' ? JSON.parse(params.groups as string) : params.groups } catch { /* skip */ }
      }
      if (params.personProperties) {
        try { body.person_properties = typeof params.personProperties === 'string' ? JSON.parse(params.personProperties as string) : params.personProperties } catch { /* skip */ }
      }

      const response = await fetch(phUrl(params.region, '/decide/?v=3'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { featureFlags: data.featureFlags, errorsWhileComputingFlags: data.errorsWhileComputingFlags } }
    },

    posthog_list_insights: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/insights/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },

    posthog_get_insight: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const insightId = params.insightId as string
      if (!apiKey || !projectId || !insightId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/insights/${insightId}/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { insight: data } }
    },

    posthog_create_insight: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, any> = { name: params.name }
      if (params.filters) {
        try { body.filters = typeof params.filters === 'string' ? JSON.parse(params.filters as string) : params.filters } catch { /* skip */ }
      }
      if (params.query) {
        try { body.query = typeof params.query === 'string' ? JSON.parse(params.query as string) : params.query } catch { /* skip */ }
      }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/insights/`), {
        method: 'POST',
        headers: phHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { insight: data } }
    },

    posthog_list_dashboards: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/dashboards/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },

    posthog_get_dashboard: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const dashboardId = params.dashboardId as string
      if (!apiKey || !projectId || !dashboardId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/dashboards/${dashboardId}/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { dashboard: data } }
    },

    posthog_list_experiments: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/experiments/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },

    posthog_get_experiment: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const experimentId = params.experimentId as string
      if (!apiKey || !projectId || !experimentId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/experiments/${experimentId}/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { experiment: data } }
    },

    posthog_create_experiment: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, any> = {
        name: params.name,
        feature_flag_key: params.featureFlagKey,
      }
      if (params.description) body.description = params.description
      if (params.parameters) {
        try { body.parameters = typeof params.parameters === 'string' ? JSON.parse(params.parameters as string) : params.parameters } catch { /* skip */ }
      }
      if (params.filters) {
        try { body.filters = typeof params.filters === 'string' ? JSON.parse(params.filters as string) : params.filters } catch { /* skip */ }
      }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/experiments/`), {
        method: 'POST',
        headers: phHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { experiment: data } }
    },

    posthog_list_surveys: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/surveys/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },

    posthog_get_survey: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      const surveyId = params.surveyId as string
      if (!apiKey || !projectId || !surveyId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/surveys/${surveyId}/`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { survey: data } }
    },

    posthog_list_session_recordings: async (params) => {
      const apiKey = params.personalApiKey as string
      const projectId = params.projectId as string
      if (!apiKey || !projectId) return { success: false, output: {}, error: 'Missing required parameters' }

      const qp = new URLSearchParams()
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.offset) qp.set('offset', String(params.offset))

      const qs = qp.toString()
      const response = await fetch(phUrl(params.region, `/api/projects/${projectId}/session_recordings/${qs ? `?${qs}` : ''}`), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },

    posthog_list_projects: async (params) => {
      const apiKey = params.personalApiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: personalApiKey' }

      const response = await fetch(phUrl(params.region, '/api/projects/'), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },

    posthog_list_organizations: async (params) => {
      const apiKey = params.personalApiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: personalApiKey' }

      const response = await fetch(phUrl(params.region, '/api/organizations/'), {
        headers: phHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `PostHog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { results: data.results, count: data.count } }
    },
  },
}

export default handler
