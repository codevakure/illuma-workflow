import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    hunter_domain_search: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }

      const url = new URL('https://api.hunter.io/v2/domain-search')
      url.searchParams.append('domain', domain)
      url.searchParams.append('api_key', apiKey)

      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.offset) url.searchParams.append('offset', String(params.offset))
      if (params.type && params.type !== 'all') url.searchParams.append('type', params.type as string)
      if (params.seniority && params.seniority !== 'all')
        url.searchParams.append('seniority', params.seniority as string)
      if (params.department) url.searchParams.append('department', params.department as string)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Hunter API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          domain: data.data?.domain || '',
          disposable: data.data?.disposable || false,
          webmail: data.data?.webmail || false,
          accept_all: data.data?.accept_all || false,
          pattern: data.data?.pattern || '',
          organization: data.data?.organization || '',
          description: data.data?.description || '',
          industry: data.data?.industry || '',
          twitter: data.data?.twitter || '',
          facebook: data.data?.facebook || '',
          linkedin: data.data?.linkedin || '',
          instagram: data.data?.instagram || '',
          youtube: data.data?.youtube || '',
          technologies: data.data?.technologies || [],
          country: data.data?.country || '',
          state: data.data?.state || '',
          city: data.data?.city || '',
          postal_code: data.data?.postal_code || '',
          street: data.data?.street || '',
          emails:
            data.data?.emails?.map((email: Record<string, unknown>) => ({
              value: email.value || '',
              type: email.type || '',
              confidence: email.confidence || 0,
              sources: email.sources || [],
              first_name: email.first_name || '',
              last_name: email.last_name || '',
              position: email.position || '',
              seniority: email.seniority || '',
              department: email.department || '',
              linkedin: email.linkedin || '',
              twitter: email.twitter || '',
              phone_number: email.phone_number || '',
              verification: email.verification || {},
            })) || [],
        },
      }
    },

    hunter_email_finder: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string
      const firstName = params.first_name as string
      const lastName = params.last_name as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }
      if (!firstName) {
        return { success: false, output: {}, error: 'Missing required parameter: first_name' }
      }
      if (!lastName) {
        return { success: false, output: {}, error: 'Missing required parameter: last_name' }
      }

      const url = new URL('https://api.hunter.io/v2/email-finder')
      url.searchParams.append('domain', domain)
      url.searchParams.append('first_name', firstName)
      url.searchParams.append('last_name', lastName)
      url.searchParams.append('api_key', apiKey)

      if (params.company) url.searchParams.append('company', params.company as string)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Hunter API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          email: data.data?.email || '',
          score: data.data?.score || 0,
          sources: data.data?.sources || [],
          verification: data.data?.verification || {},
        },
      }
    },

    hunter_email_verifier: async (params) => {
      const apiKey = params.apiKey as string
      const email = params.email as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!email) {
        return { success: false, output: {}, error: 'Missing required parameter: email' }
      }

      const url = new URL('https://api.hunter.io/v2/email-verifier')
      url.searchParams.append('email', email)
      url.searchParams.append('api_key', apiKey)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Hunter API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          result: data.data?.result || 'unknown',
          score: data.data?.score || 0,
          email: data.data?.email || '',
          regexp: data.data?.regexp || false,
          gibberish: data.data?.gibberish || false,
          disposable: data.data?.disposable || false,
          webmail: data.data?.webmail || false,
          mx_records: data.data?.mx_records || false,
          smtp_server: data.data?.smtp_server || false,
          smtp_check: data.data?.smtp_check || false,
          accept_all: data.data?.accept_all || false,
          block: data.data?.block || false,
          status: data.data?.status || 'unknown',
          sources: data.data?.sources || [],
        },
      }
    },

    hunter_email_count: async (params) => {
      const apiKey = params.apiKey as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.domain && !params.company) {
        return {
          success: false,
          output: {},
          error: 'Either domain or company must be provided',
        }
      }

      const url = new URL('https://api.hunter.io/v2/email-count')
      url.searchParams.append('api_key', apiKey)

      if (params.domain) url.searchParams.append('domain', params.domain as string)
      if (params.company) url.searchParams.append('company', params.company as string)
      if (params.type && params.type !== 'all') url.searchParams.append('type', params.type as string)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Hunter API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          total: data.data?.total || 0,
          personal_emails: data.data?.personal_emails || 0,
          generic_emails: data.data?.generic_emails || 0,
          department: data.data?.department || {
            executive: 0, it: 0, finance: 0, management: 0,
            sales: 0, legal: 0, support: 0, hr: 0,
            marketing: 0, communication: 0, education: 0,
            design: 0, health: 0, operations: 0,
          },
          seniority: data.data?.seniority || {
            junior: 0, senior: 0, executive: 0,
          },
        },
      }
    },

    hunter_companies_find: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }

      const url = new URL('https://api.hunter.io/v2/companies/find')
      url.searchParams.append('api_key', apiKey)
      url.searchParams.append('domain', domain)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Hunter API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          person: undefined,
          company: data.data
            ? {
                name: data.data.name || '',
                domain: data.data.domain || '',
                industry: data.data.industry || '',
                size: data.data.size || '',
                country: data.data.country || '',
                linkedin: data.data.linkedin || '',
                twitter: data.data.twitter || '',
              }
            : undefined,
        },
      }
    },

    hunter_discover: async (params) => {
      const apiKey = params.apiKey as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (
        !params.query &&
        !params.domain &&
        !params.headcount &&
        !params.company_type &&
        !params.technology
      ) {
        return {
          success: false,
          output: {},
          error: 'At least one search parameter (query, domain, headcount, company_type, or technology) must be provided',
        }
      }

      const url = new URL('https://api.hunter.io/v2/discover')
      url.searchParams.append('api_key', apiKey)

      const body: Record<string, unknown> = {}
      if (params.query) body.query = params.query
      if (params.domain) body.organization = { domain: [params.domain] }
      if (params.headcount) body.headcount = params.headcount
      if (params.company_type) body.company_type = params.company_type
      if (params.technology) body.technology = { include: [params.technology] }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Hunter API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          results:
            data.data?.map((company: Record<string, unknown>) => ({
              domain: company.domain || '',
              name: company.organization || '',
              headcount: company.headcount,
              technologies: company.technologies || [],
              email_count:
                (company.emails_count as Record<string, unknown>)?.total || 0,
            })) || [],
        },
      }
    },
  },
}

export default handler
