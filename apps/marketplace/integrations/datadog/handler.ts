import type { ToolHandler } from '../../sdk/types'

function ddHeaders(apiKey: string, applicationKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'DD-API-KEY': apiKey,
  }
  if (applicationKey) headers['DD-APPLICATION-KEY'] = applicationKey
  return headers
}

function ddUrl(site: unknown, path: string): string {
  const s = (site as string) || 'datadoghq.com'
  return `https://api.${s}${path}`
}

const handler: ToolHandler = {
  operations: {
    datadog_submit_metrics: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      let series: any[]
      try {
        series = typeof params.series === 'string' ? JSON.parse(params.series as string) : params.series as any[]
      } catch {
        return { success: false, output: {}, error: 'Invalid JSON in series parameter' }
      }

      const formattedSeries = series.map((s: any) => ({
        metric: s.metric,
        type: s.type === 'gauge' ? 0 : s.type === 'rate' ? 1 : s.type === 'count' ? 2 : 3,
        points: s.points.map((p: any) => ({ timestamp: p.timestamp, value: p.value })),
        tags: s.tags || [],
        unit: s.unit,
        resources: s.resources || [{ name: 'host', type: 'host' }],
      }))

      const response = await fetch(ddUrl(params.site, '/api/v2/series'), {
        method: 'POST',
        headers: ddHeaders(apiKey),
        body: JSON.stringify({ series: formattedSeries }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return { success: false, output: { success: false }, error: errorData.errors?.[0] || `HTTP ${response.status}` }
      }

      const data = await response.json().catch(() => ({}))
      return { success: true, output: { success: true, errors: data.errors || [] } }
    },

    datadog_query_timeseries: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      const query = params.query as string
      if (!apiKey || !applicationKey || !query) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams({
        query,
        from: String(params.from),
        to: String(params.to),
      })

      const response = await fetch(ddUrl(params.site, `/api/v1/query?${qp.toString()}`), {
        headers: ddHeaders(apiKey, applicationKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const series = (data.series || []).map((s: any) => ({
        metric: s.metric,
        tags: s.tag_set || [],
        points: (s.pointlist || []).map((p: any) => ({ timestamp: p[0], value: p[1] })),
      }))

      return { success: true, output: { series, status: data.status || 'ok' } }
    },

    datadog_create_event: async (params) => {
      const apiKey = params.apiKey as string
      const title = params.title as string
      const text = params.text as string
      if (!apiKey || !title || !text) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = { title, text }
      if (params.alertType) body.alert_type = params.alertType
      if (params.priority) body.priority = params.priority
      if (params.host) body.host = params.host
      if (params.tags) body.tags = (params.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      if (params.aggregationKey) body.aggregation_key = params.aggregationKey
      if (params.sourceTypeName) body.source_type_name = params.sourceTypeName
      if (params.dateHappened) body.date_happened = params.dateHappened

      const response = await fetch(ddUrl(params.site, '/api/v1/events'), {
        method: 'POST',
        headers: ddHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { event: data.event } }
    },

    datadog_create_monitor: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      if (!apiKey || !applicationKey) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {
        name: params.name,
        type: params.type,
        query: params.query,
      }
      if (params.message) body.message = params.message
      if (params.priority) body.priority = params.priority
      if (params.tags) body.tags = (params.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      if (params.options) {
        try { body.options = typeof params.options === 'string' ? JSON.parse(params.options as string) : params.options } catch { /* skip */ }
      }

      const response = await fetch(ddUrl(params.site, '/api/v1/monitor'), {
        method: 'POST',
        headers: ddHeaders(apiKey, applicationKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          monitor: {
            id: data.id, name: data.name, type: data.type, query: data.query,
            message: data.message, tags: data.tags, priority: data.priority,
            options: data.options, overall_state: data.overall_state,
            created: data.created, modified: data.modified, creator: data.creator,
          },
        },
      }
    },

    datadog_get_monitor: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      const monitorId = params.monitorId as string
      if (!apiKey || !applicationKey || !monitorId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.groupStates) qp.set('group_states', params.groupStates as string)
      if (params.withDowntimes) qp.set('with_downtimes', 'true')

      const qs = qp.toString()
      const response = await fetch(ddUrl(params.site, `/api/v1/monitor/${monitorId}${qs ? `?${qs}` : ''}`), {
        headers: ddHeaders(apiKey, applicationKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { monitor: data } }
    },

    datadog_list_monitors: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      if (!apiKey || !applicationKey) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.groupStates) qp.set('group_states', params.groupStates as string)
      if (params.name) qp.set('name', params.name as string)
      if (params.tags) qp.set('tags', params.tags as string)
      if (params.monitorTags) qp.set('monitor_tags', params.monitorTags as string)
      if (params.withDowntimes) qp.set('with_downtimes', 'true')
      if (params.page) qp.set('page', String(params.page))
      if (params.pageSize) qp.set('page_size', String(params.pageSize))

      const qs = qp.toString()
      const response = await fetch(ddUrl(params.site, `/api/v1/monitor${qs ? `?${qs}` : ''}`), {
        headers: ddHeaders(apiKey, applicationKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { monitors: data } }
    },

    datadog_mute_monitor: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      const monitorId = params.monitorId as string
      if (!apiKey || !applicationKey || !monitorId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {}
      if (params.scope) body.scope = params.scope
      if (params.end) body.end = params.end

      const response = await fetch(ddUrl(params.site, `/api/v1/monitor/${monitorId}/mute`), {
        method: 'POST',
        headers: ddHeaders(apiKey, applicationKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      return { success: true, output: { success: true } }
    },

    datadog_query_logs: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      if (!apiKey || !applicationKey) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {
        filter: { query: params.query, from: params.from, to: params.to },
        page: { limit: params.limit || 50 },
      }
      if (params.sort) body.sort = params.sort
      if (params.indexes) {
        body.filter.indexes = (params.indexes as string).split(',').map((i: string) => i.trim()).filter(Boolean)
      }

      const response = await fetch(ddUrl(params.site, '/api/v2/logs/events/search'), {
        method: 'POST',
        headers: ddHeaders(apiKey, applicationKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const logs = (data.data || []).map((log: any) => ({
        id: log.id,
        content: {
          timestamp: log.attributes?.timestamp,
          host: log.attributes?.host,
          service: log.attributes?.service,
          message: log.attributes?.message,
          status: log.attributes?.status,
          attributes: log.attributes?.attributes,
          tags: log.attributes?.tags,
        },
      }))

      return { success: true, output: { logs, nextLogId: data.meta?.page?.after } }
    },

    datadog_send_logs: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      let logs: any[]
      try {
        logs = typeof params.logs === 'string' ? JSON.parse(params.logs as string) : params.logs as any[]
      } catch {
        return { success: false, output: {}, error: 'Invalid JSON in logs parameter' }
      }

      const response = await fetch(ddUrl(params.site, '/api/v2/logs'), {
        method: 'POST',
        headers: ddHeaders(apiKey),
        body: JSON.stringify(logs),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      return { success: true, output: { success: true } }
    },

    datadog_create_downtime: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      const scope = params.scope as string
      if (!apiKey || !applicationKey || !scope) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = { scope }
      if (params.message) body.message = params.message
      if (params.start) body.start = params.start
      if (params.end) body.end = params.end
      if (params.timezone) body.timezone = params.timezone
      if (params.monitorId) body.monitor_id = Number(params.monitorId)
      if (params.monitorTags) body.monitor_tags = (params.monitorTags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      if (params.recurrence) {
        try { body.recurrence = JSON.parse(params.recurrence as string) } catch { /* skip */ }
      }

      const response = await fetch(ddUrl(params.site, '/api/v1/downtime'), {
        method: 'POST',
        headers: ddHeaders(apiKey, applicationKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { downtime: data } }
    },

    datadog_list_downtimes: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      if (!apiKey || !applicationKey) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.currentOnly) qp.set('current_only', 'true')
      if (params.withCreator) qp.set('with_creator', 'true')
      if (params.monitorId) qp.set('monitor_id', String(params.monitorId))

      const qs = qp.toString()
      const response = await fetch(ddUrl(params.site, `/api/v1/downtime${qs ? `?${qs}` : ''}`), {
        headers: ddHeaders(apiKey, applicationKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { downtimes: data } }
    },

    datadog_cancel_downtime: async (params) => {
      const apiKey = params.apiKey as string
      const applicationKey = params.applicationKey as string
      const downtimeId = params.downtimeId as string
      if (!apiKey || !applicationKey || !downtimeId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(ddUrl(params.site, `/api/v1/downtime/${downtimeId}`), {
        method: 'DELETE',
        headers: ddHeaders(apiKey, applicationKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Datadog API error: ${response.status} ${err}` }
      }

      return { success: true, output: { success: true } }
    },
  },
}

export default handler
