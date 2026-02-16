import type { ToolHandler } from '../../sdk/types'

const BASE_URL = 'https://api.hubapi.com/crm/v3/objects'

function hubspotHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

function parseJsonParam(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

function buildListUrl(
  objectType: string,
  params: Record<string, unknown>
): string {
  const baseUrl = `${BASE_URL}/${objectType}`
  const query = new URLSearchParams()
  if (params.limit) query.append('limit', String(params.limit))
  if (params.after) query.append('after', params.after as string)
  if (params.properties) query.append('properties', params.properties as string)
  if (params.associations) query.append('associations', params.associations as string)
  const qs = query.toString()
  return qs ? `${baseUrl}?${qs}` : baseUrl
}

function buildGetUrl(
  objectType: string,
  id: string,
  params: Record<string, unknown>
): string {
  const baseUrl = `${BASE_URL}/${objectType}/${id}`
  const query = new URLSearchParams()
  if (params.idProperty) query.append('idProperty', params.idProperty as string)
  if (params.properties) query.append('properties', params.properties as string)
  if (params.associations) query.append('associations', params.associations as string)
  const qs = query.toString()
  return qs ? `${baseUrl}?${qs}` : baseUrl
}

function buildSearchBody(params: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}

  if (params.filterGroups) {
    const parsed = parseJsonParam(params.filterGroups)
    if (Array.isArray(parsed) && parsed.length > 0) {
      body.filterGroups = parsed
    }
  }
  if (params.sorts) {
    const parsed = parseJsonParam(params.sorts)
    if (Array.isArray(parsed) && parsed.length > 0) {
      body.sorts = parsed
    }
  }
  if (params.query) body.query = params.query
  if (params.properties) {
    const parsed = parseJsonParam(params.properties)
    if (Array.isArray(parsed) && parsed.length > 0) {
      body.properties = parsed
    }
  }
  if (params.limit) body.limit = params.limit
  if (params.after) body.after = params.after

  return body
}

const handler: ToolHandler = {
  operations: {
    hubspot_get_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.contactId) return { success: false, output: {}, error: 'Missing required parameter: contactId' }

      const url = buildGetUrl('contacts', params.contactId as string, params)
      const resp = await fetch(url, { headers: hubspotHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { contact: data, contactId: data.id, success: true },
      }
    },

    hubspot_list_contacts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const url = buildListUrl('contacts', params)
      const resp = await fetch(url, { headers: hubspotHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          contacts: data.results || [],
          paging: data.paging ?? null,
          metadata: {
            totalReturned: data.results?.length || 0,
            hasMore: !!data.paging?.next,
          },
          success: true,
        },
      }
    },

    hubspot_create_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.properties) return { success: false, output: {}, error: 'Missing required parameter: properties' }

      const properties = parseJsonParam(params.properties)
      const body: Record<string, unknown> = { properties }
      if (Array.isArray(params.associations) && params.associations.length > 0) {
        body.associations = params.associations
      }

      const resp = await fetch(`${BASE_URL}/contacts`, {
        method: 'POST',
        headers: hubspotHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { contact: data, contactId: data.id, success: true },
      }
    },

    hubspot_update_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.contactId) return { success: false, output: {}, error: 'Missing required parameter: contactId' }
      if (!params.properties) return { success: false, output: {}, error: 'Missing required parameter: properties' }

      const properties = parseJsonParam(params.properties)
      let url = `${BASE_URL}/contacts/${params.contactId}`
      if (params.idProperty) url += `?idProperty=${params.idProperty}`

      const resp = await fetch(url, {
        method: 'PATCH',
        headers: hubspotHeaders(accessToken),
        body: JSON.stringify({ properties }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { contact: data, contactId: data.id, success: true },
      }
    },

    hubspot_search_contacts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const body = buildSearchBody(params)
      const resp = await fetch(`${BASE_URL}/contacts/search`, {
        method: 'POST',
        headers: hubspotHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          contacts: data.results || [],
          total: data.total ?? null,
          paging: data.paging ?? null,
          metadata: {
            totalReturned: data.results?.length || 0,
            hasMore: !!data.paging?.next,
          },
          success: true,
        },
      }
    },

    hubspot_get_company: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.companyId) return { success: false, output: {}, error: 'Missing required parameter: companyId' }

      const url = buildGetUrl('companies', params.companyId as string, params)
      const resp = await fetch(url, { headers: hubspotHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { company: data, companyId: data.id, success: true },
      }
    },

    hubspot_list_companies: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const url = buildListUrl('companies', params)
      const resp = await fetch(url, { headers: hubspotHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          companies: data.results || [],
          paging: data.paging ?? null,
          metadata: {
            totalReturned: data.results?.length || 0,
            hasMore: !!data.paging?.next,
          },
          success: true,
        },
      }
    },

    hubspot_create_company: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.properties) return { success: false, output: {}, error: 'Missing required parameter: properties' }

      const properties = parseJsonParam(params.properties)
      const body: Record<string, unknown> = { properties }
      if (Array.isArray(params.associations) && params.associations.length > 0) {
        body.associations = params.associations
      }

      const resp = await fetch(`${BASE_URL}/companies`, {
        method: 'POST',
        headers: hubspotHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { company: data, companyId: data.id, success: true },
      }
    },

    hubspot_update_company: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.companyId) return { success: false, output: {}, error: 'Missing required parameter: companyId' }
      if (!params.properties) return { success: false, output: {}, error: 'Missing required parameter: properties' }

      const properties = parseJsonParam(params.properties)
      let url = `${BASE_URL}/companies/${params.companyId}`
      if (params.idProperty) url += `?idProperty=${params.idProperty}`

      const resp = await fetch(url, {
        method: 'PATCH',
        headers: hubspotHeaders(accessToken),
        body: JSON.stringify({ properties }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { company: data, companyId: data.id, success: true },
      }
    },

    hubspot_search_companies: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const body = buildSearchBody(params)
      const resp = await fetch(`${BASE_URL}/companies/search`, {
        method: 'POST',
        headers: hubspotHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          companies: data.results || [],
          total: data.total ?? null,
          paging: data.paging ?? null,
          metadata: {
            totalReturned: data.results?.length || 0,
            hasMore: !!data.paging?.next,
          },
          success: true,
        },
      }
    },

    hubspot_list_deals: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const url = buildListUrl('deals', params)
      const resp = await fetch(url, { headers: hubspotHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          deals: data.results || [],
          paging: data.paging ?? null,
          metadata: {
            totalReturned: data.results?.length || 0,
            hasMore: !!data.paging?.next,
          },
          success: true,
        },
      }
    },

    hubspot_get_users: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const baseUrl = `${BASE_URL}/users`
      const query = new URLSearchParams()
      if (params.limit) query.append('limit', String(params.limit))
      const qs = query.toString()
      const url = qs ? `${baseUrl}?${qs}` : baseUrl

      const resp = await fetch(url, { headers: hubspotHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `HubSpot API error: ${resp.status}` }
      }

      const data = await resp.json()
      const users = data.results || []
      return {
        success: true,
        output: { users, totalItems: users.length, success: true },
      }
    },
  },
}

export default handler
