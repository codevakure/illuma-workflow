import type { ToolHandler } from '../../sdk/types'

/**
 * Resolve the Atlassian Cloud ID from the domain via the accessible-resources endpoint.
 * If a cloudId param is already provided, it is returned directly.
 */
async function getJiraCloudId(domain: string, accessToken: string): Promise<string> {
  const resp = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const resources = await resp.json()
  if (Array.isArray(resources) && resources.length > 0) {
    const normalizedInput = `https://${domain}`.toLowerCase()
    const matched = resources.find((r: Record<string, unknown>) =>
      (r.url as string).toLowerCase() === normalizedInput
    )
    if (matched) return matched.id as string
    return resources[0].id as string
  }
  throw new Error('No Jira resources found for the provided domain')
}

async function resolveCloudId(
  params: Record<string, unknown>,
  accessToken: string
): Promise<string> {
  if (params.cloudId) return params.cloudId as string
  return getJiraCloudId(params.domain as string, accessToken)
}

/**
 * Build the base URL for the JSM Service Desk API.
 */
function jsmBaseUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi`
}

/**
 * Build common headers for JSM API requests, including the experimental API opt-in.
 */
function jsmHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-ExperimentalApi': 'opt-in',
  }
}

/**
 * Build a URL with optional query parameters, omitting undefined/null values.
 */
function buildUrl(base: string, queryParams?: Record<string, unknown>): string {
  if (!queryParams) return base
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value))
    }
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/**
 * Parse a comma-separated string into a trimmed array, filtering out empty entries.
 */
function parseCommaSeparated(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

const handler: ToolHandler = {
  operations: {
    /**
     * Get all service desks from JSM.
     * GET /servicedesk
     */
    jsm_get_service_desks: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(`${jsmBaseUrl(cloudId)}/servicedesk`, {
        expand: params.expand,
        start: params.start,
        limit: params.limit ?? params.maxResults,
      })

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          serviceDesks: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Get request types for a service desk.
     * GET /servicedesk/{serviceDeskId}/requesttype
     */
    jsm_get_request_types: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.serviceDeskId) return { success: false, output: {}, error: 'Missing required parameter: serviceDeskId' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/servicedesk/${params.serviceDeskId}/requesttype`,
        {
          searchQuery: params.searchQuery,
          groupId: params.groupId,
          expand: params.expand,
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          requestTypes: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Create a new service request.
     * POST /request
     */
    jsm_create_request: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.serviceDeskId) return { success: false, output: {}, error: 'Missing required parameter: serviceDeskId' }
      if (!params.requestTypeId) return { success: false, output: {}, error: 'Missing required parameter: requestTypeId' }
      if (!params.summary) return { success: false, output: {}, error: 'Missing required parameter: summary' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/request`

      const requestBody: Record<string, unknown> = {
        serviceDeskId: params.serviceDeskId,
        requestTypeId: params.requestTypeId,
        requestFieldValues: (params.requestFieldValues as Record<string, unknown>) || {
          summary: params.summary,
          ...(params.description && { description: params.description }),
        },
      }

      if (params.raiseOnBehalfOf) {
        requestBody.raiseOnBehalfOf = params.raiseOnBehalfOf
      }
      if (params.requestParticipants) {
        requestBody.requestParticipants = parseCommaSeparated(params.requestParticipants)
      }
      if (params.channel) {
        requestBody.channel = params.channel
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify(requestBody),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueId: data.issueId,
          issueKey: data.issueKey,
          requestTypeId: data.requestTypeId,
          serviceDeskId: data.serviceDeskId,
          createdDate: data.createdDate ?? null,
          currentStatus: data.currentStatus
            ? {
                status: data.currentStatus.status ?? null,
                statusCategory: data.currentStatus.statusCategory ?? null,
                statusDate: data.currentStatus.statusDate ?? null,
              }
            : null,
          reporter: data.reporter
            ? {
                accountId: data.reporter.accountId ?? null,
                displayName: data.reporter.displayName ?? null,
                emailAddress: data.reporter.emailAddress ?? null,
              }
            : null,
          success: true,
          url: `https://${params.domain}/browse/${data.issueKey}`,
        },
      }
    },

    /**
     * Get a single service request by issue ID or key.
     * GET /request/{issueIdOrKey}
     */
    jsm_get_request: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}`,
        { expand: params.expand }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueId: data.issueId ?? null,
          issueKey: data.issueKey ?? null,
          requestTypeId: data.requestTypeId ?? null,
          serviceDeskId: data.serviceDeskId ?? null,
          createdDate: data.createdDate ?? null,
          currentStatus: data.currentStatus
            ? {
                status: data.currentStatus.status ?? null,
                statusCategory: data.currentStatus.statusCategory ?? null,
                statusDate: data.currentStatus.statusDate ?? null,
              }
            : null,
          reporter: data.reporter
            ? {
                accountId: data.reporter.accountId ?? null,
                displayName: data.reporter.displayName ?? null,
                emailAddress: data.reporter.emailAddress ?? null,
                active: data.reporter.active ?? true,
              }
            : null,
          requestFieldValues: (data.requestFieldValues ?? []).map(
            (fv: Record<string, unknown>) => ({
              fieldId: fv.fieldId ?? null,
              label: fv.label ?? null,
              value: fv.value ?? null,
            })
          ),
          url: `https://${params.domain}/browse/${data.issueKey}`,
          request: data,
        },
      }
    },

    /**
     * Get multiple service requests with optional filters.
     * GET /request
     */
    jsm_get_requests: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(`${jsmBaseUrl(cloudId)}/request`, {
        serviceDeskId: params.serviceDeskId,
        requestOwnership: params.requestOwnership,
        requestStatus: params.requestStatus,
        requestTypeId: params.requestTypeId,
        searchTerm: params.searchTerm,
        expand: params.expand,
        start: params.start,
        limit: params.limit ?? params.maxResults,
      })

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          requests: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Add a comment (public or internal) to a service request.
     * POST /request/{issueIdOrKey}/comment
     */
    jsm_add_comment: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }
      if (!params.commentBody) return { success: false, output: {}, error: 'Missing required parameter: commentBody' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/comment`

      const isPublic = params.isPublic === 'true' || params.isPublic === true
      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify({
          body: params.commentBody,
          public: isPublic,
        }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          commentId: data.id,
          body: data.body,
          isPublic: data.public,
          author: data.author
            ? {
                accountId: data.author.accountId ?? null,
                displayName: data.author.displayName ?? null,
                emailAddress: data.author.emailAddress ?? null,
              }
            : null,
          createdDate: data.created ?? null,
          success: true,
        },
      }
    },

    /**
     * Get comments for a service request.
     * GET /request/{issueIdOrKey}/comment
     */
    jsm_get_comments: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/comment`,
        {
          public: params.isPublic !== undefined ? String(params.isPublic) : undefined,
          internal: params.internal !== undefined ? String(params.internal) : undefined,
          expand: params.expand,
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          comments: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Get customers for a service desk.
     * GET /servicedesk/{serviceDeskId}/customer
     */
    jsm_get_customers: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.serviceDeskId) return { success: false, output: {}, error: 'Missing required parameter: serviceDeskId' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/servicedesk/${params.serviceDeskId}/customer`,
        {
          query: params.customerQuery,
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          customers: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Add customers to a service desk by account IDs or email addresses.
     * POST /servicedesk/{serviceDeskId}/customer
     */
    jsm_add_customer: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.serviceDeskId) return { success: false, output: {}, error: 'Missing required parameter: serviceDeskId' }

      const emails = params.emails ? parseCommaSeparated(params.emails) : []
      const accountIds = params.accountIds ? parseCommaSeparated(params.accountIds) : []
      if (emails.length === 0 && accountIds.length === 0) {
        return { success: false, output: {}, error: 'Either emails or accountIds must be provided' }
      }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/servicedesk/${params.serviceDeskId}/customer`

      const requestBody: Record<string, unknown> = {}
      if (accountIds.length > 0) {
        requestBody.accountIds = accountIds
      }
      if (emails.length > 0) {
        requestBody.accountIds = emails
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify(requestBody),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          serviceDeskId: params.serviceDeskId as string,
          success: true,
        },
      }
    },

    /**
     * Get organizations for a service desk.
     * GET /servicedesk/{serviceDeskId}/organization
     */
    jsm_get_organizations: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.serviceDeskId) return { success: false, output: {}, error: 'Missing required parameter: serviceDeskId' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/servicedesk/${params.serviceDeskId}/organization`,
        {
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          organizations: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Create a new organization.
     * POST /organization
     */
    jsm_create_organization: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.organizationName) return { success: false, output: {}, error: 'Missing required parameter: organizationName' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/organization`

      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify({ name: params.organizationName }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          organizationId: data.id,
          name: data.name,
          success: true,
        },
      }
    },

    /**
     * Add an organization to a service desk.
     * POST /servicedesk/{serviceDeskId}/organization
     */
    jsm_add_organization: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.serviceDeskId) return { success: false, output: {}, error: 'Missing required parameter: serviceDeskId' }
      if (!params.organizationId) return { success: false, output: {}, error: 'Missing required parameter: organizationId' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/servicedesk/${params.serviceDeskId}/organization`

      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify({
          organizationId: Number.parseInt(params.organizationId as string, 10),
        }),
      })
      if (resp.status === 204 || resp.ok) {
        return {
          success: true,
          output: {
            ts: new Date().toISOString(),
            serviceDeskId: params.serviceDeskId as string,
            organizationId: params.organizationId as string,
            success: true,
          },
        }
      }

      const err = await resp.text().catch(() => '')
      return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
    },

    /**
     * Get queues for a service desk.
     * GET /servicedesk/{serviceDeskId}/queue
     */
    jsm_get_queues: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.serviceDeskId) return { success: false, output: {}, error: 'Missing required parameter: serviceDeskId' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/servicedesk/${params.serviceDeskId}/queue`,
        {
          includeCount: params.includeCount,
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          queues: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Get SLA information for a service request.
     * GET /request/{issueIdOrKey}/sla
     */
    jsm_get_sla: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/sla`,
        {
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          slas: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Get available transitions for a service request.
     * GET /request/{issueIdOrKey}/transition
     */
    jsm_get_transitions: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/transition`,
        {
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          transitions: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Transition a service request to a new status.
     * POST /request/{issueIdOrKey}/transition
     */
    jsm_transition_request: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }
      if (!params.transitionId) return { success: false, output: {}, error: 'Missing required parameter: transitionId' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/transition`

      const body: Record<string, unknown> = {
        id: params.transitionId,
      }
      const comment = params.transitionComment || params.comment
      if (comment) {
        body.additionalComment = { body: comment }
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          transitionId: params.transitionId as string,
          success: true,
        },
      }
    },

    /**
     * Get participants for a request.
     * GET /request/{issueIdOrKey}/participant
     */
    jsm_get_participants: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/participant`,
        {
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          participants: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Add participants to a request.
     * POST /request/{issueIdOrKey}/participant
     */
    jsm_add_participants: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }
      if (!params.participantAccountIds) return { success: false, output: {}, error: 'Missing required parameter: participantAccountIds' }

      const accountIds = parseCommaSeparated(params.participantAccountIds)
      if (accountIds.length === 0) {
        return { success: false, output: {}, error: 'No valid account IDs provided' }
      }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/participant`

      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify({ accountIds }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          participants: data.values || [],
          success: true,
        },
      }
    },

    /**
     * Get approvals for a request.
     * GET /request/{issueIdOrKey}/approval
     */
    jsm_get_approvals: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = buildUrl(
        `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/approval`,
        {
          start: params.start,
          limit: params.limit ?? params.maxResults,
        }
      )

      const resp = await fetch(url, { method: 'GET', headers: jsmHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          approvals: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      }
    },

    /**
     * Approve or decline an approval request.
     * POST /request/{issueIdOrKey}/approval/{approvalId}
     */
    jsm_answer_approval: async (params, ctx) => {
      const accessToken = ctx.accessToken as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }
      if (!params.issueIdOrKey) return { success: false, output: {}, error: 'Missing required parameter: issueIdOrKey' }
      if (!params.approvalId) return { success: false, output: {}, error: 'Missing required parameter: approvalId' }
      if (!params.approvalDecision) return { success: false, output: {}, error: 'Missing required parameter: approvalDecision' }

      const cloudId = await resolveCloudId(params, accessToken)
      const url = `${jsmBaseUrl(cloudId)}/request/${params.issueIdOrKey}/approval/${params.approvalId}`

      const resp = await fetch(url, {
        method: 'POST',
        headers: jsmHeaders(accessToken),
        body: JSON.stringify({ decision: params.approvalDecision }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `JSM API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey: params.issueIdOrKey as string,
          approvalId: params.approvalId as string,
          decision: params.approvalDecision as string,
          id: data.id ?? null,
          name: data.name ?? null,
          finalDecision: data.finalDecision ?? null,
          canAnswerApproval: data.canAnswerApproval ?? null,
          approvers: (data.approvers ?? []).map((a: Record<string, unknown>) => {
            const approver = a.approver as Record<string, unknown> | undefined
            return {
              approver: {
                accountId: approver?.accountId ?? null,
                displayName: approver?.displayName ?? null,
                emailAddress: approver?.emailAddress ?? null,
                active: approver?.active ?? null,
              },
              approverDecision: a.approverDecision ?? null,
            }
          }),
          createdDate: data.createdDate ?? null,
          completedDate: data.completedDate ?? null,
          approval: data,
          success: true,
        },
      }
    },
  },
}

export default handler
