import type { ToolHandler } from '../../sdk/types'

const MAILGUN_API_BASE = 'https://api.mailgun.net/v3'

function mailgunAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`
}

const handler: ToolHandler = {
  operations: {
    mailgun_send_message: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const domain = params.domain as string
      const from = params.from as string
      const to = params.to as string
      const subject = params.subject as string
      const text = params.text as string
      if (!domain || !from || !to || !subject) {
        return { success: false, output: {}, error: 'Missing required parameters: domain, from, to, subject' }
      }

      const formData = new FormData()
      formData.append('from', from)
      formData.append('to', to)
      formData.append('subject', subject)
      if (text) formData.append('text', text)
      if (params.html) formData.append('html', params.html as string)
      if (params.cc) formData.append('cc', params.cc as string)
      if (params.bcc) formData.append('bcc', params.bcc as string)
      if (params.tag) formData.append('o:tag', params.tag as string)
      if (params.tracking !== undefined) formData.append('o:tracking', String(params.tracking))

      const response = await fetch(`${MAILGUN_API_BASE}/${domain}/messages`, {
        method: 'POST',
        headers: { Authorization: mailgunAuthHeader(apiKey) },
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          message: data.message || 'Message sent successfully',
          id: data.id,
        },
      }
    },

    mailgun_list_domains: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', String(params.limit))
      if (params.skip) queryParams.append('skip', String(params.skip))

      const query = queryParams.toString()
      const url = query ? `${MAILGUN_API_BASE}/domains?${query}` : `${MAILGUN_API_BASE}/domains`

      const response = await fetch(url, {
        headers: { Authorization: mailgunAuthHeader(apiKey) },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          domains: data.items || [],
          total_count: data.total_count || 0,
        },
      }
    },

    mailgun_get_domain: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const domain = params.domain as string
      if (!domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }

      const response = await fetch(`${MAILGUN_API_BASE}/domains/${domain}`, {
        headers: { Authorization: mailgunAuthHeader(apiKey) },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          domain: data.domain || data,
          receiving_dns_records: data.receiving_dns_records || [],
          sending_dns_records: data.sending_dns_records || [],
        },
      }
    },

    mailgun_list_messages: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const domain = params.domain as string
      if (!domain) return { success: false, output: {}, error: 'Missing required parameter: domain' }

      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', String(params.limit))
      if (params.event) queryParams.append('event', params.event as string)
      if (params.begin) queryParams.append('begin', params.begin as string)
      if (params.end) queryParams.append('end', params.end as string)

      const query = queryParams.toString()
      const url = query
        ? `${MAILGUN_API_BASE}/${domain}/events?${query}`
        : `${MAILGUN_API_BASE}/${domain}/events`

      const response = await fetch(url, {
        headers: { Authorization: mailgunAuthHeader(apiKey) },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          events: data.items || [],
          paging: data.paging || {},
        },
      }
    },

    mailgun_get_message: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const domain = params.domain as string
      const messageKey = params.messageKey as string
      if (!domain || !messageKey) {
        return { success: false, output: {}, error: 'Missing required parameters: domain, messageKey' }
      }

      const response = await fetch(`${MAILGUN_API_BASE}/domains/${domain}/messages/${messageKey}`, {
        headers: { Authorization: mailgunAuthHeader(apiKey) },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return { success: true, output: { message: data } }
    },

    mailgun_create_mailing_list: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const address = params.address as string
      if (!address) return { success: false, output: {}, error: 'Missing required parameter: address' }

      const formData = new FormData()
      formData.append('address', address)
      if (params.name) formData.append('name', params.name as string)
      if (params.description) formData.append('description', params.description as string)
      if (params.accessLevel) formData.append('access_level', params.accessLevel as string)

      const response = await fetch(`${MAILGUN_API_BASE}/lists`, {
        method: 'POST',
        headers: { Authorization: mailgunAuthHeader(apiKey) },
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return { success: true, output: { list: data.list || data, message: data.message || 'Mailing list created' } }
    },

    mailgun_get_mailing_list: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const address = params.address as string
      if (!address) return { success: false, output: {}, error: 'Missing required parameter: address' }

      const response = await fetch(`${MAILGUN_API_BASE}/lists/${address}`, {
        headers: { Authorization: mailgunAuthHeader(apiKey) },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return { success: true, output: { list: data.list || data } }
    },

    mailgun_add_list_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listAddress = params.listAddress as string
      const memberAddress = params.memberAddress as string
      if (!listAddress || !memberAddress) {
        return { success: false, output: {}, error: 'Missing required parameters: listAddress, memberAddress' }
      }

      const formData = new FormData()
      formData.append('address', memberAddress)
      if (params.name) formData.append('name', params.name as string)
      if (params.vars) formData.append('vars', params.vars as string)
      if (params.subscribed !== undefined) formData.append('subscribed', String(params.subscribed))
      if (params.upsert !== undefined) formData.append('upsert', String(params.upsert))

      const response = await fetch(`${MAILGUN_API_BASE}/lists/${listAddress}/members`, {
        method: 'POST',
        headers: { Authorization: mailgunAuthHeader(apiKey) },
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Mailgun API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return { success: true, output: { member: data.member || data, message: data.message || 'Member added' } }
    },
  },
}

export default handler
