import type { ToolHandler } from '../../sdk/types'

function grafanaHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function grafanaUrl(baseUrl: string, path: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '')
  return `${base}${path}`
}

const handler: ToolHandler = {
  operations: {
    grafana_get_dashboard: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const dashboardUid = params.dashboardUid as string
      if (!apiKey || !baseUrl || !dashboardUid) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, `/api/dashboards/uid/${dashboardUid}`), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { dashboard: data.dashboard, meta: data.meta } }
    },

    grafana_list_dashboards: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      if (!apiKey || !baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams({ type: 'dash-db' })
      if (params.query) qp.set('query', params.query as string)
      if (params.tag) qp.set('tag', params.tag as string)
      if (params.folderIds) qp.set('folderIds', params.folderIds as string)
      if (params.starred) qp.set('starred', 'true')
      if (params.limit) qp.set('limit', String(params.limit))

      const response = await fetch(grafanaUrl(baseUrl, `/api/search?${qp.toString()}`), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { dashboards: data } }
    },

    grafana_create_dashboard: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const title = params.title as string
      if (!apiKey || !baseUrl || !title) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const dashboard: Record<string, any> = { id: null, title, tags: [], panels: [], schemaVersion: 27 }
      if (params.tags) dashboard.tags = (params.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      if (params.timezone) dashboard.timezone = params.timezone
      if (params.refresh) dashboard.refresh = params.refresh
      if (params.panels) {
        try { dashboard.panels = JSON.parse(params.panels as string) } catch { /* skip */ }
      }

      const body: Record<string, any> = { dashboard, overwrite: params.overwrite ?? false }
      if (params.folderUid) body.folderUid = params.folderUid
      if (params.message) body.message = params.message

      const response = await fetch(grafanaUrl(baseUrl, '/api/dashboards/db'), {
        method: 'POST',
        headers: grafanaHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_update_dashboard: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const dashboardUid = params.dashboardUid as string
      if (!apiKey || !baseUrl || !dashboardUid) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const getResp = await fetch(grafanaUrl(baseUrl, `/api/dashboards/uid/${dashboardUid}`), {
        headers: grafanaHeaders(apiKey),
      })
      if (!getResp.ok) {
        return { success: false, output: {}, error: `Failed to fetch existing dashboard: ${getResp.status}` }
      }

      const existing = await getResp.json()
      const dashboard = existing.dashboard
      if (params.title) dashboard.title = params.title
      if (params.tags) dashboard.tags = (params.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      if (params.timezone) dashboard.timezone = params.timezone
      if (params.refresh) dashboard.refresh = params.refresh
      if (params.panels) {
        try { dashboard.panels = JSON.parse(params.panels as string) } catch { /* skip */ }
      }

      const body: Record<string, any> = { dashboard, overwrite: params.overwrite ?? true }
      if (params.folderUid) body.folderUid = params.folderUid
      if (params.message) body.message = params.message

      const response = await fetch(grafanaUrl(baseUrl, '/api/dashboards/db'), {
        method: 'POST',
        headers: grafanaHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_delete_dashboard: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const dashboardUid = params.dashboardUid as string
      if (!apiKey || !baseUrl || !dashboardUid) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, `/api/dashboards/uid/${dashboardUid}`), {
        method: 'DELETE',
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_list_alert_rules: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      if (!apiKey || !baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, '/api/v1/provisioning/alert-rules'), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { rules: data } }
    },

    grafana_get_alert_rule: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const alertRuleUid = params.alertRuleUid as string
      if (!apiKey || !baseUrl || !alertRuleUid) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, `/api/v1/provisioning/alert-rules/${alertRuleUid}`), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_create_alert_rule: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      if (!apiKey || !baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {
        title: params.title,
        folderUID: params.folderUid,
        ruleGroup: params.ruleGroup,
        condition: params.condition,
      }
      if (params.data) {
        try { body.data = JSON.parse(params.data as string) } catch { /* skip */ }
      }
      if (params.forDuration) body.for = params.forDuration
      if (params.noDataState) body.noDataState = params.noDataState
      if (params.execErrState) body.execErrState = params.execErrState
      if (params.annotations) {
        try { body.annotations = JSON.parse(params.annotations as string) } catch { /* skip */ }
      }
      if (params.labels) {
        try { body.labels = JSON.parse(params.labels as string) } catch { /* skip */ }
      }

      const response = await fetch(grafanaUrl(baseUrl, '/api/v1/provisioning/alert-rules'), {
        method: 'POST',
        headers: grafanaHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_update_alert_rule: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const alertRuleUid = params.alertRuleUid as string
      if (!apiKey || !baseUrl || !alertRuleUid) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {}
      if (params.title) body.title = params.title
      if (params.folderUid) body.folderUID = params.folderUid
      if (params.ruleGroup) body.ruleGroup = params.ruleGroup
      if (params.condition) body.condition = params.condition
      if (params.data) {
        try { body.data = JSON.parse(params.data as string) } catch { /* skip */ }
      }
      if (params.forDuration) body.for = params.forDuration
      if (params.noDataState) body.noDataState = params.noDataState
      if (params.execErrState) body.execErrState = params.execErrState
      if (params.annotations) {
        try { body.annotations = JSON.parse(params.annotations as string) } catch { /* skip */ }
      }
      if (params.labels) {
        try { body.labels = JSON.parse(params.labels as string) } catch { /* skip */ }
      }

      const response = await fetch(grafanaUrl(baseUrl, `/api/v1/provisioning/alert-rules/${alertRuleUid}`), {
        method: 'PUT',
        headers: grafanaHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_delete_alert_rule: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const alertRuleUid = params.alertRuleUid as string
      if (!apiKey || !baseUrl || !alertRuleUid) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, `/api/v1/provisioning/alert-rules/${alertRuleUid}`), {
        method: 'DELETE',
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      return { success: true, output: { message: 'Alert rule deleted successfully' } }
    },

    grafana_list_contact_points: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      if (!apiKey || !baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, '/api/v1/provisioning/contact-points'), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { contactPoints: data } }
    },

    grafana_create_annotation: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const text = params.text as string
      if (!apiKey || !baseUrl || !text) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = { text }
      if (params.tags) body.tags = (params.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      if (params.dashboardUid) body.dashboardUID = params.dashboardUid
      if (params.panelId) body.panelId = params.panelId
      if (params.time) body.time = params.time
      if (params.timeEnd) body.timeEnd = params.timeEnd

      const response = await fetch(grafanaUrl(baseUrl, '/api/annotations'), {
        method: 'POST',
        headers: grafanaHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_list_annotations: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      if (!apiKey || !baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.from) qp.set('from', String(params.from))
      if (params.to) qp.set('to', String(params.to))
      if (params.dashboardUid) qp.set('dashboardUID', params.dashboardUid as string)
      if (params.panelId) qp.set('panelId', String(params.panelId))
      if (params.tags) qp.set('tags', params.tags as string)
      if (params.type) qp.set('type', params.type as string)
      if (params.limit) qp.set('limit', String(params.limit))

      const qs = qp.toString()
      const response = await fetch(grafanaUrl(baseUrl, `/api/annotations${qs ? `?${qs}` : ''}`), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { annotations: data } }
    },

    grafana_update_annotation: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const annotationId = params.annotationId
      if (!apiKey || !baseUrl || !annotationId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = { text: params.text }
      if (params.tags) body.tags = (params.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
      if (params.time) body.time = params.time
      if (params.timeEnd) body.timeEnd = params.timeEnd

      const response = await fetch(grafanaUrl(baseUrl, `/api/annotations/${annotationId}`), {
        method: 'PUT',
        headers: grafanaHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_delete_annotation: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const annotationId = params.annotationId
      if (!apiKey || !baseUrl || !annotationId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, `/api/annotations/${annotationId}`), {
        method: 'DELETE',
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      return { success: true, output: { message: 'Annotation deleted successfully' } }
    },

    grafana_list_data_sources: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      if (!apiKey || !baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, '/api/datasources'), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { dataSources: data } }
    },

    grafana_get_data_source: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const dataSourceId = params.dataSourceId as string
      if (!apiKey || !baseUrl || !dataSourceId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(grafanaUrl(baseUrl, `/api/datasources/${dataSourceId}`), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },

    grafana_list_folders: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      if (!apiKey || !baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.page) qp.set('page', String(params.page))

      const qs = qp.toString()
      const response = await fetch(grafanaUrl(baseUrl, `/api/folders${qs ? `?${qs}` : ''}`), {
        headers: grafanaHeaders(apiKey),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { folders: data } }
    },

    grafana_create_folder: async (params) => {
      const apiKey = params.apiKey as string
      const baseUrl = params.baseUrl as string
      const title = params.title as string
      if (!apiKey || !baseUrl || !title) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = { title }
      if (params.uid) body.uid = params.uid

      const response = await fetch(grafanaUrl(baseUrl, '/api/folders'), {
        method: 'POST',
        headers: grafanaHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Grafana API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: data }
    },
  },
}

export default handler
