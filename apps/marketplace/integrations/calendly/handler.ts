import type { ToolHandler } from '../../sdk/types'

const CALENDLY_API_BASE = 'https://api.calendly.com'

function calendlyHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function calendlyRequest(
  url: string,
  method: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const options: RequestInit = {
    method,
    headers: calendlyHeaders(apiKey),
  }
  if (body && method !== 'GET' && method !== 'DELETE') {
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Calendly API error: ${response.status} - ${errorText}`)
  }
  return response.json()
}

function extractUuid(uriOrUuid: string): string {
  return uriOrUuid.includes('/') ? uriOrUuid.split('/').pop()! : uriOrUuid
}

const handler: ToolHandler = {
  operations: {
    calendly_get_current_user: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const data = await calendlyRequest(`${CALENDLY_API_BASE}/users/me`, 'GET', apiKey)
      return { success: true, output: data }
    },

    calendly_list_event_types: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.user) qp.append('user', params.user as string)
      if (params.organization) qp.append('organization', params.organization as string)
      if (params.active !== undefined) qp.append('active', String(params.active))
      if (params.count) qp.append('count', String(params.count))
      if (params.page_token) qp.append('page_token', params.page_token as string)

      const qs = qp.toString()
      const data = await calendlyRequest(
        `${CALENDLY_API_BASE}/event_types${qs ? `?${qs}` : ''}`, 'GET', apiKey
      )
      return { success: true, output: data }
    },

    calendly_get_event_type: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.eventTypeUuid) return { success: false, output: {}, error: 'Missing required parameter: eventTypeUuid' }

      const uuid = extractUuid(params.eventTypeUuid as string)
      const data = await calendlyRequest(`${CALENDLY_API_BASE}/event_types/${uuid}`, 'GET', apiKey)
      return { success: true, output: data }
    },

    calendly_list_scheduled_events: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.user) qp.append('user', params.user as string)
      if (params.organization) qp.append('organization', params.organization as string)
      if (params.status) qp.append('status', params.status as string)
      if (params.min_start_time) qp.append('min_start_time', params.min_start_time as string)
      if (params.max_start_time) qp.append('max_start_time', params.max_start_time as string)
      if (params.count) qp.append('count', String(params.count))
      if (params.page_token) qp.append('page_token', params.page_token as string)
      if (params.sort) qp.append('sort', params.sort as string)
      if (params.invitee_email) qp.append('invitee_email', params.invitee_email as string)

      const qs = qp.toString()
      const data = await calendlyRequest(
        `${CALENDLY_API_BASE}/scheduled_events${qs ? `?${qs}` : ''}`, 'GET', apiKey
      )
      return { success: true, output: data }
    },

    calendly_get_scheduled_event: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.eventUuid) return { success: false, output: {}, error: 'Missing required parameter: eventUuid' }

      const uuid = extractUuid(params.eventUuid as string)
      const data = await calendlyRequest(`${CALENDLY_API_BASE}/scheduled_events/${uuid}`, 'GET', apiKey)
      return { success: true, output: data }
    },

    calendly_cancel_event: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.eventUuid) return { success: false, output: {}, error: 'Missing required parameter: eventUuid' }

      const uuid = extractUuid(params.eventUuid as string)
      const body: Record<string, unknown> = {}
      if (params.reason) body.reason = params.reason

      const data = await calendlyRequest(
        `${CALENDLY_API_BASE}/scheduled_events/${uuid}/cancellation`, 'POST', apiKey, body
      )
      return { success: true, output: data }
    },

    calendly_list_event_invitees: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.eventUuid) return { success: false, output: {}, error: 'Missing required parameter: eventUuid' }

      const uuid = extractUuid(params.eventUuid as string)
      const qp = new URLSearchParams()
      if (params.status) qp.append('status', params.status as string)
      if (params.count) qp.append('count', String(params.count))
      if (params.page_token) qp.append('page_token', params.page_token as string)
      if (params.sort) qp.append('sort', params.sort as string)
      if (params.email) qp.append('email', params.email as string)

      const qs = qp.toString()
      const data = await calendlyRequest(
        `${CALENDLY_API_BASE}/scheduled_events/${uuid}/invitees${qs ? `?${qs}` : ''}`, 'GET', apiKey
      )
      return { success: true, output: data }
    },

    calendly_create_webhook: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.url || !params.events || !params.organization || !params.scope) {
        return { success: false, output: {}, error: 'Missing required parameters: url, events, organization, scope' }
      }

      const body: Record<string, unknown> = {
        url: params.url,
        events: params.events,
        organization: params.organization,
        scope: params.scope,
      }
      if (params.user) body.user = params.user
      if (params.signing_key) body.signing_key = params.signing_key

      const data = await calendlyRequest(`${CALENDLY_API_BASE}/webhook_subscriptions`, 'POST', apiKey, body)
      return { success: true, output: data }
    },

    calendly_list_webhooks: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.organization) qp.append('organization', params.organization as string)
      if (params.user) qp.append('user', params.user as string)
      if (params.scope) qp.append('scope', params.scope as string)
      if (params.count) qp.append('count', String(params.count))
      if (params.page_token) qp.append('page_token', params.page_token as string)

      const qs = qp.toString()
      const data = await calendlyRequest(
        `${CALENDLY_API_BASE}/webhook_subscriptions${qs ? `?${qs}` : ''}`, 'GET', apiKey
      )
      return { success: true, output: data }
    },

    calendly_delete_webhook: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.webhookUuid) return { success: false, output: {}, error: 'Missing required parameter: webhookUuid' }

      const uuid = extractUuid(params.webhookUuid as string)
      const response = await fetch(`${CALENDLY_API_BASE}/webhook_subscriptions/${uuid}`, {
        method: 'DELETE',
        headers: calendlyHeaders(apiKey),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Calendly API error: ${response.status} - ${errorText}`)
      }

      return {
        success: true,
        output: { deleted: true, webhookUuid: uuid },
      }
    },
  },
}

export default handler
