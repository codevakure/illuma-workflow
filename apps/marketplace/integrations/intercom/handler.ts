import type { ToolHandler } from '../../sdk/types'

const INTERCOM_API_BASE = 'https://api.intercom.io'

function intercomHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Intercom-Version': '2.14',
  }
}

function tryParseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const handler: ToolHandler = {
  operations: {
    /** Contact operations */
    intercom_create_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const body: Record<string, unknown> = {}
      if (params.role) body.role = params.role
      if (params.email) body.email = params.email
      if (params.external_id) body.external_id = params.external_id
      if (params.phone) body.phone = params.phone
      if (params.name) body.name = params.name
      if (params.avatar) body.avatar = params.avatar
      if (params.signed_up_at) body.signed_up_at = params.signed_up_at
      if (params.last_seen_at) body.last_seen_at = params.last_seen_at
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.unsubscribed_from_emails !== undefined) body.unsubscribed_from_emails = params.unsubscribed_from_emails
      if (params.company_id) body.company_id = params.company_id

      const customAttributes = tryParseJSON(params.custom_attributes)
      if (customAttributes) body.custom_attributes = customAttributes

      const response = await fetch(`${INTERCOM_API_BASE}/contacts`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to create contact' }
      }

      const data = await response.json()
      return { success: true, output: { contact: data, contactId: data.id } }
    },

    intercom_get_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      if (!contactId) return { success: false, output: {}, error: 'Missing required parameter: contactId' }

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}`, {
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to get contact' }
      }

      const data = await response.json()
      return { success: true, output: { contact: data, contactId: data.id } }
    },

    intercom_update_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      if (!contactId) return { success: false, output: {}, error: 'Missing required parameter: contactId' }

      const body: Record<string, unknown> = {}
      if (params.role) body.role = params.role
      if (params.email) body.email = params.email
      if (params.external_id) body.external_id = params.external_id
      if (params.phone) body.phone = params.phone
      if (params.name) body.name = params.name
      if (params.avatar) body.avatar = params.avatar
      if (params.signed_up_at) body.signed_up_at = params.signed_up_at
      if (params.last_seen_at) body.last_seen_at = params.last_seen_at
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.unsubscribed_from_emails !== undefined) body.unsubscribed_from_emails = params.unsubscribed_from_emails

      const customAttributes = tryParseJSON(params.custom_attributes)
      if (customAttributes) body.custom_attributes = customAttributes

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}`, {
        method: 'PUT',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to update contact' }
      }

      const data = await response.json()
      return { success: true, output: { contact: data, contactId: data.id } }
    },

    intercom_delete_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      if (!contactId) return { success: false, output: {}, error: 'Missing required parameter: contactId' }

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}`, {
        method: 'DELETE',
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to delete contact' }
      }

      const data = await response.json()
      return { success: true, output: { deleted: true, id: data.id } }
    },

    intercom_list_contacts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const queryParams = new URLSearchParams()
      if (params.per_page) queryParams.append('per_page', String(params.per_page))
      if (params.starting_after) queryParams.append('starting_after', params.starting_after as string)

      const query = queryParams.toString()
      const url = query ? `${INTERCOM_API_BASE}/contacts?${query}` : `${INTERCOM_API_BASE}/contacts`

      const response = await fetch(url, { headers: intercomHeaders(accessToken) })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to list contacts' }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          contacts: data.data || [],
          pages: data.pages,
          total_count: data.total_count,
        },
      }
    },

    intercom_search_contacts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const query = params.query as string
      if (!query) return { success: false, output: {}, error: 'Missing required parameter: query' }

      const body: Record<string, unknown> = {}
      const parsedQuery = tryParseJSON(query)
      if (parsedQuery) {
        body.query = parsedQuery
      } else {
        body.query = { field: 'email', operator: '=', value: query }
      }

      if (params.per_page) body.pagination = { per_page: Number(params.per_page) }
      if (params.starting_after) {
        body.pagination = { ...(body.pagination as Record<string, unknown> || {}), starting_after: params.starting_after }
      }
      if (params.sort_field) {
        body.sort = { field: params.sort_field, order: params.sort_order || 'descending' }
      }

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/search`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to search contacts' }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          contacts: data.data || [],
          pages: data.pages,
          total_count: data.total_count,
        },
      }
    },

    /** Company operations */
    intercom_create_company: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const company_id = params.company_id as string
      if (!company_id) return { success: false, output: {}, error: 'Missing required parameter: company_id' }

      const body: Record<string, unknown> = { company_id }
      if (params.name) body.name = params.name
      if (params.website) body.website = params.website
      if (params.plan) body.plan = params.plan
      if (params.size) body.size = Number(params.size)
      if (params.industry) body.industry = params.industry
      if (params.monthly_spend) body.monthly_spend = Number(params.monthly_spend)
      if (params.remote_created_at) body.remote_created_at = params.remote_created_at

      const customAttributes = tryParseJSON(params.custom_attributes)
      if (customAttributes) body.custom_attributes = customAttributes

      const response = await fetch(`${INTERCOM_API_BASE}/companies`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to create company' }
      }

      const data = await response.json()
      return { success: true, output: { company: data, companyId: data.id } }
    },

    intercom_get_company: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const companyId = params.companyId as string
      if (!companyId) return { success: false, output: {}, error: 'Missing required parameter: companyId' }

      const response = await fetch(`${INTERCOM_API_BASE}/companies/${companyId}`, {
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to get company' }
      }

      const data = await response.json()
      return { success: true, output: { company: data, companyId: data.id } }
    },

    intercom_list_companies: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const queryParams = new URLSearchParams()
      if (params.per_page) queryParams.append('per_page', String(params.per_page))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      const url = query ? `${INTERCOM_API_BASE}/companies?${query}` : `${INTERCOM_API_BASE}/companies`

      const response = await fetch(url, { headers: intercomHeaders(accessToken) })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to list companies' }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          companies: data.data || [],
          pages: data.pages,
          total_count: data.total_count,
        },
      }
    },

    intercom_attach_contact_to_company: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      const companyId = params.companyId as string
      if (!contactId || !companyId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}/companies`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify({ id: companyId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to attach contact to company' }
      }

      const data = await response.json()
      return { success: true, output: { company: data } }
    },

    intercom_detach_contact_from_company: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      const companyId = params.companyId as string
      if (!contactId || !companyId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}/companies/${companyId}`, {
        method: 'DELETE',
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to detach contact from company' }
      }

      const data = await response.json()
      return { success: true, output: { company: data } }
    },

    /** Conversation operations */
    intercom_list_conversations: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const queryParams = new URLSearchParams()
      if (params.per_page) queryParams.append('per_page', String(params.per_page))
      if (params.starting_after) queryParams.append('starting_after', params.starting_after as string)

      const query = queryParams.toString()
      const url = query ? `${INTERCOM_API_BASE}/conversations?${query}` : `${INTERCOM_API_BASE}/conversations`

      const response = await fetch(url, { headers: intercomHeaders(accessToken) })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to list conversations' }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          conversations: data.conversations || [],
          pages: data.pages,
          total_count: data.total_count,
        },
      }
    },

    intercom_get_conversation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const conversationId = params.conversationId as string
      if (!conversationId) return { success: false, output: {}, error: 'Missing required parameter: conversationId' }

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/${conversationId}`, {
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to get conversation' }
      }

      const data = await response.json()
      return { success: true, output: { conversation: data, conversationId: data.id } }
    },

    intercom_search_conversations: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const query = params.query as string
      if (!query) return { success: false, output: {}, error: 'Missing required parameter: query' }

      const body: Record<string, unknown> = {}
      const parsedQuery = tryParseJSON(query)
      if (parsedQuery) {
        body.query = parsedQuery
      } else {
        body.query = { field: 'source.body', operator: '~', value: query }
      }

      if (params.per_page) body.pagination = { per_page: Number(params.per_page) }
      if (params.sort_field) {
        body.sort = { field: params.sort_field, order: params.sort_order || 'descending' }
      }

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/search`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to search conversations' }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          conversations: data.conversations || [],
          pages: data.pages,
          total_count: data.total_count,
        },
      }
    },

    intercom_reply_conversation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const conversationId = params.conversationId as string
      const messageType = params.message_type as string
      const body = params.body as string
      if (!conversationId || !messageType || !body) {
        return { success: false, output: {}, error: 'Missing required parameters: conversationId, message_type, body' }
      }

      const requestBody: Record<string, unknown> = {
        message_type: messageType,
        type: 'admin',
        body,
      }

      if (params.admin_id) requestBody.admin_id = params.admin_id
      if (params.created_at) requestBody.created_at = params.created_at

      if (params.attachment_urls) {
        const urls = (params.attachment_urls as string).split(',').map((u: string) => u.trim()).filter(Boolean)
        if (urls.length > 0) requestBody.attachment_urls = urls
      }

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/${conversationId}/reply`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to reply to conversation' }
      }

      const data = await response.json()
      return { success: true, output: { conversation: data, conversationId: data.id } }
    },

    intercom_close_conversation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const conversationId = params.conversationId as string
      const adminId = params.admin_id as string
      if (!conversationId || !adminId) {
        return { success: false, output: {}, error: 'Missing required parameters: conversationId, admin_id' }
      }

      const requestBody: Record<string, unknown> = {
        message_type: 'close',
        type: 'admin',
        admin_id: adminId,
      }
      if (params.body) requestBody.body = params.body

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/${conversationId}/parts`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to close conversation' }
      }

      const data = await response.json()
      return { success: true, output: { conversation: data, conversationId: data.id } }
    },

    intercom_open_conversation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const conversationId = params.conversationId as string
      const adminId = params.admin_id as string
      if (!conversationId || !adminId) {
        return { success: false, output: {}, error: 'Missing required parameters: conversationId, admin_id' }
      }

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/${conversationId}/parts`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify({ message_type: 'open', type: 'admin', admin_id: adminId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to open conversation' }
      }

      const data = await response.json()
      return { success: true, output: { conversation: data, conversationId: data.id } }
    },

    intercom_snooze_conversation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const conversationId = params.conversationId as string
      const adminId = params.admin_id as string
      const snoozedUntil = params.snoozed_until as number
      if (!conversationId || !adminId || !snoozedUntil) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/${conversationId}/parts`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify({
          message_type: 'snoozed',
          type: 'admin',
          admin_id: adminId,
          snoozed_until: snoozedUntil,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to snooze conversation' }
      }

      const data = await response.json()
      return { success: true, output: { conversation: data, conversationId: data.id } }
    },

    intercom_assign_conversation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const conversationId = params.conversationId as string
      const adminId = params.admin_id as string
      const assigneeId = params.assignee_id as string
      if (!conversationId || !adminId || !assigneeId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const requestBody: Record<string, unknown> = {
        message_type: 'assignment',
        type: 'admin',
        admin_id: adminId,
        assignee_id: assigneeId,
      }
      if (params.body) requestBody.body = params.body

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/${conversationId}/parts`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to assign conversation' }
      }

      const data = await response.json()
      return { success: true, output: { conversation: data, conversationId: data.id } }
    },

    /** Message operations */
    intercom_create_message: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const messageType = params.message_type as string
      const subject = params.subject as string
      const body = params.body as string
      const from = params.from as string
      const to = params.to as string

      if (!messageType || !body || !from || !to) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const requestBody: Record<string, unknown> = {
        message_type: messageType,
        body,
      }

      if (subject) requestBody.subject = subject

      const parsedFrom = tryParseJSON(from)
      requestBody.from = parsedFrom || { type: 'admin', id: from }

      const parsedTo = tryParseJSON(to)
      requestBody.to = parsedTo || { type: 'user', id: to }

      if (params.template) requestBody.template = params.template

      const response = await fetch(`${INTERCOM_API_BASE}/messages`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to create message' }
      }

      const data = await response.json()
      return { success: true, output: { message: data, messageId: data.id } }
    },

    /** Tag operations */
    intercom_create_tag: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const name = params.name as string
      if (!name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const response = await fetch(`${INTERCOM_API_BASE}/tags`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to create tag' }
      }

      const data = await response.json()
      return { success: true, output: { tag: data, tagId: data.id } }
    },

    intercom_list_tags: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const response = await fetch(`${INTERCOM_API_BASE}/tags`, {
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to list tags' }
      }

      const data = await response.json()
      return { success: true, output: { tags: data.data || [] } }
    },

    intercom_tag_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      const tagId = params.tagId as string
      if (!contactId || !tagId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}/tags`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify({ id: tagId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to tag contact' }
      }

      const data = await response.json()
      return { success: true, output: { tag: data } }
    },

    intercom_untag_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      const tagId = params.tagId as string
      if (!contactId || !tagId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}/tags/${tagId}`, {
        method: 'DELETE',
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to untag contact' }
      }

      const data = await response.json()
      return { success: true, output: { tag: data } }
    },

    intercom_tag_conversation: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const conversationId = params.conversationId as string
      const tagId = params.tagId as string
      const adminId = params.admin_id as string
      if (!conversationId || !tagId || !adminId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(`${INTERCOM_API_BASE}/conversations/${conversationId}/tags`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify({ id: tagId, admin_id: adminId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to tag conversation' }
      }

      const data = await response.json()
      return { success: true, output: { tag: data } }
    },

    /** Note operations */
    intercom_create_note: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const contactId = params.contactId as string
      const body = params.body as string
      if (!contactId || !body) return { success: false, output: {}, error: 'Missing required parameters' }

      const requestBody: Record<string, unknown> = { body }
      if (params.admin_id) requestBody.admin_id = params.admin_id

      const response = await fetch(`${INTERCOM_API_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to create note' }
      }

      const data = await response.json()
      return { success: true, output: { note: data, noteId: data.id } }
    },

    /** Event operations */
    intercom_create_event: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const eventName = params.event_name as string
      if (!eventName) return { success: false, output: {}, error: 'Missing required parameter: event_name' }

      const body: Record<string, unknown> = { event_name: eventName }
      if (params.user_id) body.user_id = params.user_id
      if (params.email) body.email = params.email
      if (params.id) body.id = params.id
      if (params.created_at) body.created_at = params.created_at

      const metadata = tryParseJSON(params.metadata)
      if (metadata) body.metadata = metadata

      const response = await fetch(`${INTERCOM_API_BASE}/events`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok && response.status !== 202) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to create event' }
      }

      return { success: true, output: { message: 'Event created successfully' } }
    },

    /** Admin operations */
    intercom_list_admins: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const response = await fetch(`${INTERCOM_API_BASE}/admins`, {
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to list admins' }
      }

      const data = await response.json()
      return { success: true, output: { admins: data.admins || [] } }
    },

    /** Ticket operations */
    intercom_create_ticket: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const ticketTypeId = params.ticket_type_id as string
      const contacts = params.contacts as string
      const ticketAttributes = params.ticket_attributes as string
      if (!ticketTypeId || !contacts || !ticketAttributes) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, unknown> = { ticket_type_id: ticketTypeId }

      const parsedContacts = tryParseJSON(contacts)
      if (parsedContacts) body.contacts = parsedContacts

      const parsedAttributes = tryParseJSON(ticketAttributes)
      if (parsedAttributes) body.ticket_attributes = parsedAttributes

      if (params.company_id) body.company_id = params.company_id
      if (params.created_at) body.created_at = params.created_at
      if (params.conversation_to_link_id) body.conversation_to_link_id = params.conversation_to_link_id
      if (params.disable_notifications !== undefined) body.disable_notifications = params.disable_notifications

      const response = await fetch(`${INTERCOM_API_BASE}/tickets`, {
        method: 'POST',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to create ticket' }
      }

      const data = await response.json()
      return { success: true, output: { ticket: data, ticketId: data.id } }
    },

    intercom_get_ticket: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const ticketId = params.ticketId as string
      if (!ticketId) return { success: false, output: {}, error: 'Missing required parameter: ticketId' }

      const response = await fetch(`${INTERCOM_API_BASE}/tickets/${ticketId}`, {
        headers: intercomHeaders(accessToken),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to get ticket' }
      }

      const data = await response.json()
      return { success: true, output: { ticket: data, ticketId: data.id } }
    },

    intercom_update_ticket: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const ticketId = params.ticketId as string
      if (!ticketId) return { success: false, output: {}, error: 'Missing required parameter: ticketId' }

      const body: Record<string, unknown> = {}
      if (params.ticket_attributes) {
        const parsedAttributes = tryParseJSON(params.ticket_attributes)
        if (parsedAttributes) body.ticket_attributes = parsedAttributes
      }
      if (params.state) body.state = params.state
      if (params.open !== undefined) body.open = params.open
      if (params.is_shared !== undefined) body.is_shared = params.is_shared
      if (params.snoozed_until) body.snoozed_until = params.snoozed_until
      if (params.assignment) {
        const parsedAssignment = tryParseJSON(params.assignment)
        if (parsedAssignment) body.assignment = parsedAssignment
      }

      const response = await fetch(`${INTERCOM_API_BASE}/tickets/${ticketId}`, {
        method: 'PUT',
        headers: intercomHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const err = data as Record<string, Array<Record<string, string>>>
        return { success: false, output: {}, error: err.errors?.[0]?.message || 'Failed to update ticket' }
      }

      const data = await response.json()
      return { success: true, output: { ticket: data, ticketId: data.id } }
    },
  },
}

export default handler
