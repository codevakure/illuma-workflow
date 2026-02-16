import type { ToolHandler } from '../../sdk/types'

function zdUrl(subdomain: string, path: string): string {
  return `https://${subdomain}.zendesk.com/api/v2${path}`
}

function zdHeaders(email: string, apiToken: string): Record<string, string> {
  const credentials = `${email}/token:${apiToken}`
  const base64Credentials = Buffer.from(credentials).toString('base64')
  return {
    Authorization: `Basic ${base64Credentials}`,
    'Content-Type': 'application/json',
  }
}

function parseTags(tags: unknown): string[] {
  if (!tags) return []
  return (tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
}

function parseCustomFields(customFields: unknown): Record<string, unknown> | null {
  if (!customFields) return null
  try {
    return typeof customFields === 'string' ? JSON.parse(customFields) : customFields as Record<string, unknown>
  } catch {
    return null
  }
}

function parseJson(value: unknown): unknown[] {
  if (!value) throw new Error('Missing JSON parameter')
  try {
    return typeof value === 'string' ? JSON.parse(value as string) : value as unknown[]
  } catch {
    throw new Error('Invalid JSON format')
  }
}

const handler: ToolHandler = {
  operations: {
    zendesk_create_ticket: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters: email, apiToken, subdomain' }
      }

      const ticket: Record<string, unknown> = {
        subject: params.subject,
        comment: { body: params.description },
      }
      if (params.priority) ticket.priority = params.priority
      if (params.status) ticket.status = params.status
      if (params.type) ticket.type = params.type
      if (params.assigneeId) ticket.assignee_id = params.assigneeId
      if (params.groupId) ticket.group_id = params.groupId
      if (params.requesterId) ticket.requester_id = params.requesterId
      if (params.tags) ticket.tags = parseTags(params.tags)
      const cf = parseCustomFields(params.customFields)
      if (cf) ticket.custom_fields = Object.entries(cf).map(([id, value]) => ({ id, value }))

      const response = await fetch(zdUrl(subdomain, '/tickets'), {
        method: 'POST',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ ticket }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || err.description || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { ticket: data.ticket, ticket_id: data.ticket?.id } }
    },

    zendesk_get_ticket: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const ticketId = params.ticketId as string
      if (!email || !apiToken || !subdomain || !ticketId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(zdUrl(subdomain, `/tickets/${ticketId}`), {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { ticket: data.ticket, ticket_id: data.ticket?.id } }
    },

    zendesk_get_tickets: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const hasFilters = params.status || params.priority || params.type || params.assigneeId || params.organizationId

      let url: string
      if (hasFilters) {
        const searchTerms: string[] = ['type:ticket']
        if (params.status) searchTerms.push(`status:${params.status}`)
        if (params.priority) searchTerms.push(`priority:${params.priority}`)
        if (params.type) searchTerms.push(`ticket_type:${params.type}`)
        if (params.assigneeId) searchTerms.push(`assignee_id:${params.assigneeId}`)
        if (params.organizationId) searchTerms.push(`organization_id:${params.organizationId}`)

        const qp = new URLSearchParams()
        qp.append('query', searchTerms.join(' '))
        if (params.sortBy) qp.append('sort_by', params.sortBy as string)
        if (params.sortOrder) qp.append('sort_order', params.sortOrder as string)
        if (params.page) qp.append('page', params.page as string)
        if (params.perPage) qp.append('per_page', params.perPage as string)
        url = `${zdUrl(subdomain, '/search')}?${qp.toString()}`
      } else {
        const qp = new URLSearchParams()
        if (params.sortBy) qp.append('sort_by', params.sortBy as string)
        if (params.sortOrder) qp.append('sort_order', params.sortOrder as string)
        if (params.page) qp.append('page', params.page as string)
        if (params.perPage) qp.append('per_page', params.perPage as string)
        const qs = qp.toString()
        url = qs ? `${zdUrl(subdomain, '/tickets')}?${qs}` : zdUrl(subdomain, '/tickets')
      }

      const response = await fetch(url, { headers: zdHeaders(email, apiToken) })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      const tickets = data.tickets || data.results || []
      return {
        success: true,
        output: {
          tickets,
          paging: {
            next_page: data.next_page ?? null,
            previous_page: data.previous_page ?? null,
            count: data.count || tickets.length,
          },
          metadata: { total_returned: tickets.length, has_more: !!data.next_page },
        },
      }
    },

    zendesk_update_ticket: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const ticketId = params.ticketId as string
      if (!email || !apiToken || !subdomain || !ticketId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const ticket: Record<string, unknown> = {}
      if (params.subject) ticket.subject = params.subject
      if (params.priority) ticket.priority = params.priority
      if (params.status) ticket.status = params.status
      if (params.type) ticket.type = params.type
      if (params.assigneeId) ticket.assignee_id = params.assigneeId
      if (params.groupId) ticket.group_id = params.groupId
      if (params.tags) ticket.tags = parseTags(params.tags)
      if (params.comment) ticket.comment = { body: params.comment }
      const cf = parseCustomFields(params.customFields)
      if (cf) ticket.custom_fields = Object.entries(cf).map(([id, value]) => ({ id, value }))

      const response = await fetch(zdUrl(subdomain, `/tickets/${ticketId}`), {
        method: 'PUT',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ ticket }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { ticket: data.ticket, ticket_id: data.ticket?.id } }
    },

    zendesk_delete_ticket: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const ticketId = params.ticketId as string
      if (!email || !apiToken || !subdomain || !ticketId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(zdUrl(subdomain, `/tickets/${ticketId}`), {
        method: 'DELETE',
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      return { success: true, output: { deleted: true, ticket_id: ticketId } }
    },

    zendesk_create_user: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const user: Record<string, unknown> = {}
      if (params.name) user.name = params.name
      if (params.userEmail) user.email = params.userEmail
      if (params.role) user.role = params.role
      if (params.phone) user.phone = params.phone
      if (params.organizationId) user.organization_id = params.organizationId
      if (params.verified) user.verified = params.verified === 'true'
      if (params.tags) user.tags = parseTags(params.tags)
      const cf = parseCustomFields(params.customFields)
      if (cf) user.user_fields = cf

      const response = await fetch(zdUrl(subdomain, '/users'), {
        method: 'POST',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ user }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { user: data.user, user_id: data.user?.id } }
    },

    zendesk_get_user: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const userId = params.userId as string
      if (!email || !apiToken || !subdomain || !userId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(zdUrl(subdomain, `/users/${userId}`), {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { user: data.user, user_id: data.user?.id } }
    },

    zendesk_get_users: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.role) qp.append('role', params.role as string)
      if (params.permissionSet) qp.append('permission_set', params.permissionSet as string)
      if (params.page) qp.append('page', params.page as string)
      if (params.perPage) qp.append('per_page', params.perPage as string)

      const qs = qp.toString()
      const url = qs ? `${zdUrl(subdomain, '/users')}?${qs}` : zdUrl(subdomain, '/users')

      const response = await fetch(url, { headers: zdHeaders(email, apiToken) })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      const users = data.users || []
      return {
        success: true,
        output: {
          users,
          paging: { next_page: data.next_page ?? null, previous_page: data.previous_page ?? null, count: data.count || users.length },
          metadata: { total_returned: users.length, has_more: !!data.next_page },
        },
      }
    },

    zendesk_update_user: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const userId = params.userId as string
      if (!email || !apiToken || !subdomain || !userId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const user: Record<string, unknown> = {}
      if (params.name) user.name = params.name
      if (params.userEmail) user.email = params.userEmail
      if (params.role) user.role = params.role
      if (params.phone) user.phone = params.phone
      if (params.organizationId) user.organization_id = params.organizationId
      if (params.verified) user.verified = params.verified === 'true'
      if (params.tags) user.tags = parseTags(params.tags)
      const cf = parseCustomFields(params.customFields)
      if (cf) user.user_fields = cf

      const response = await fetch(zdUrl(subdomain, `/users/${userId}`), {
        method: 'PUT',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ user }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { user: data.user, user_id: data.user?.id } }
    },

    zendesk_delete_user: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const userId = params.userId as string
      if (!email || !apiToken || !subdomain || !userId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(zdUrl(subdomain, `/users/${userId}`), {
        method: 'DELETE',
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      return { success: true, output: { deleted: true, user_id: userId } }
    },

    zendesk_get_current_user: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(zdUrl(subdomain, '/users/me'), {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { user: data.user, user_id: data.user?.id } }
    },

    zendesk_create_organization: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const organization: Record<string, unknown> = { name: params.name }
      if (params.domainNames) organization.domain_names = (params.domainNames as string).split(',').map((d: string) => d.trim())
      if (params.details) organization.details = params.details
      if (params.notes) organization.notes = params.notes
      if (params.tags) organization.tags = parseTags(params.tags)
      const cf = parseCustomFields(params.customFields)
      if (cf) organization.organization_fields = cf

      const response = await fetch(zdUrl(subdomain, '/organizations'), {
        method: 'POST',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ organization }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { organization: data.organization, organization_id: data.organization?.id } }
    },

    zendesk_get_organization: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const organizationId = params.organizationId as string
      if (!email || !apiToken || !subdomain || !organizationId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(zdUrl(subdomain, `/organizations/${organizationId}`), {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { organization: data.organization, organization_id: data.organization?.id } }
    },

    zendesk_get_organizations: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.page) qp.append('page', params.page as string)
      if (params.perPage) qp.append('per_page', params.perPage as string)

      const qs = qp.toString()
      const url = qs ? `${zdUrl(subdomain, '/organizations')}?${qs}` : zdUrl(subdomain, '/organizations')

      const response = await fetch(url, { headers: zdHeaders(email, apiToken) })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      const organizations = data.organizations || []
      return {
        success: true,
        output: {
          organizations,
          paging: { next_page: data.next_page ?? null, previous_page: data.previous_page ?? null, count: data.count || organizations.length },
          metadata: { total_returned: organizations.length, has_more: !!data.next_page },
        },
      }
    },

    zendesk_update_organization: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const organizationId = params.organizationId as string
      if (!email || !apiToken || !subdomain || !organizationId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const organization: Record<string, unknown> = {}
      if (params.name) organization.name = params.name
      if (params.domainNames) organization.domain_names = (params.domainNames as string).split(',').map((d: string) => d.trim())
      if (params.details) organization.details = params.details
      if (params.notes) organization.notes = params.notes
      if (params.tags) organization.tags = parseTags(params.tags)
      const cf = parseCustomFields(params.customFields)
      if (cf) organization.organization_fields = cf

      const response = await fetch(zdUrl(subdomain, `/organizations/${organizationId}`), {
        method: 'PUT',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ organization }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { organization: data.organization, organization_id: data.organization?.id } }
    },

    zendesk_delete_organization: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const organizationId = params.organizationId as string
      if (!email || !apiToken || !subdomain || !organizationId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(zdUrl(subdomain, `/organizations/${organizationId}`), {
        method: 'DELETE',
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      return { success: true, output: { deleted: true, organization_id: organizationId } }
    },

    zendesk_autocomplete_organizations: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const name = params.name as string
      if (!email || !apiToken || !subdomain || !name) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      qp.append('name', name)
      if (params.page) qp.append('page', params.page as string)
      if (params.perPage) qp.append('per_page', params.perPage as string)

      const response = await fetch(`${zdUrl(subdomain, '/organizations/autocomplete')}?${qp.toString()}`, {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      const organizations = data.organizations || []
      return {
        success: true,
        output: {
          organizations,
          paging: { next_page: data.next_page ?? null, previous_page: data.previous_page ?? null, count: data.count || organizations.length },
          metadata: { total_returned: organizations.length, has_more: !!data.next_page },
        },
      }
    },

    zendesk_search: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const query = params.query as string
      if (!email || !apiToken || !subdomain || !query) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      qp.append('query', query)
      if (params.sortBy) qp.append('sort_by', params.sortBy as string)
      if (params.sortOrder) qp.append('sort_order', params.sortOrder as string)
      if (params.page) qp.append('page', params.page as string)
      if (params.perPage) qp.append('per_page', params.perPage as string)

      const response = await fetch(`${zdUrl(subdomain, '/search')}?${qp.toString()}`, {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      const results = data.results || []
      return {
        success: true,
        output: {
          results,
          paging: { next_page: data.next_page ?? null, previous_page: data.previous_page ?? null, count: data.count || results.length },
          metadata: { total_returned: results.length, has_more: !!data.next_page },
        },
      }
    },

    zendesk_search_count: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const query = params.query as string
      if (!email || !apiToken || !subdomain || !query) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      qp.append('query', query)

      const response = await fetch(`${zdUrl(subdomain, '/search/count')}?${qp.toString()}`, {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { count: data.count || 0 } }
    },

    zendesk_search_users: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.query) qp.append('query', params.query as string)
      if (params.externalId) qp.append('external_id', params.externalId as string)
      if (params.page) qp.append('page', params.page as string)
      if (params.perPage) qp.append('per_page', params.perPage as string)

      const response = await fetch(`${zdUrl(subdomain, '/users/search')}?${qp.toString()}`, {
        headers: zdHeaders(email, apiToken),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      const users = data.users || []
      return {
        success: true,
        output: {
          users,
          paging: { next_page: data.next_page ?? null, previous_page: data.previous_page ?? null, count: data.count || users.length },
          metadata: { total_returned: users.length, has_more: !!data.next_page },
        },
      }
    },

    zendesk_merge_tickets: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const targetTicketId = params.targetTicketId as string
      const sourceTicketIds = params.sourceTicketIds as string
      if (!email || !apiToken || !subdomain || !targetTicketId || !sourceTicketIds) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const ids = sourceTicketIds.split(',').map((id: string) => id.trim())
      const body: Record<string, unknown> = { ids }
      if (params.targetComment) {
        body.target_comment = { body: params.targetComment, public: true }
      }

      const response = await fetch(zdUrl(subdomain, `/tickets/${targetTicketId}/merge`), {
        method: 'POST',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { job_status: data.job_status, job_id: data.job_status?.id, target_ticket_id: targetTicketId } }
    },

    zendesk_create_tickets_bulk: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let tickets: unknown[]
      try { tickets = parseJson(params.tickets) } catch (e) {
        return { success: false, output: {}, error: 'Invalid tickets JSON format' }
      }

      const response = await fetch(zdUrl(subdomain, '/tickets/create_many'), {
        method: 'POST',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ tickets }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { job_status: data.job_status, job_id: data.job_status?.id } }
    },

    zendesk_update_tickets_bulk: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      const ticketIds = params.ticketIds as string
      if (!email || !apiToken || !subdomain || !ticketIds) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const ids = ticketIds.split(',').map((id: string) => id.trim())
      const ticket: Record<string, unknown> = {}
      if (params.status) ticket.status = params.status
      if (params.priority) ticket.priority = params.priority
      if (params.assigneeId) ticket.assignee_id = params.assigneeId
      if (params.groupId) ticket.group_id = params.groupId
      if (params.tags) ticket.tags = parseTags(params.tags)

      const response = await fetch(zdUrl(subdomain, `/tickets/update_many?ids=${ids.join(',')}`), {
        method: 'PUT',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ ticket }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { job_status: data.job_status, job_id: data.job_status?.id } }
    },

    zendesk_create_users_bulk: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let users: unknown[]
      try { users = parseJson(params.users) } catch (e) {
        return { success: false, output: {}, error: 'Invalid users JSON format' }
      }

      const response = await fetch(zdUrl(subdomain, '/users/create_many'), {
        method: 'POST',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ users }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { job_status: data.job_status, job_id: data.job_status?.id } }
    },

    zendesk_update_users_bulk: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let users: unknown[]
      try { users = parseJson(params.users) } catch (e) {
        return { success: false, output: {}, error: 'Invalid users JSON format' }
      }

      const response = await fetch(zdUrl(subdomain, '/users/update_many'), {
        method: 'PUT',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ users }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { job_status: data.job_status, job_id: data.job_status?.id } }
    },

    zendesk_create_organizations_bulk: async (params) => {
      const email = params.email as string
      const apiToken = params.apiToken as string
      const subdomain = params.subdomain as string
      if (!email || !apiToken || !subdomain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let organizations: unknown[]
      try { organizations = parseJson(params.organizations) } catch (e) {
        return { success: false, output: {}, error: 'Invalid organizations JSON format' }
      }

      const response = await fetch(zdUrl(subdomain, '/organizations/create_many'), {
        method: 'POST',
        headers: zdHeaders(email, apiToken),
        body: JSON.stringify({ organizations }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: err.error || `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { job_status: data.job_status, job_id: data.job_status?.id } }
    },
  },
}

export default handler
