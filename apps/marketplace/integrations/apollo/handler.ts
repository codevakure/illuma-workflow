import type { ToolHandler } from '../../sdk/types'

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1'

function apolloHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Api-Key': apiKey,
  }
}

async function apolloRequest(
  url: string,
  method: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const options: RequestInit = {
    method,
    headers: apolloHeaders(apiKey),
  }
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
  }
  return response.json()
}

const handler: ToolHandler = {
  operations: {
    apollo_people_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {
        page: (params.page as number) || 1,
        per_page: Math.min((params.per_page as number) || 25, 100),
      }
      if (params.person_titles && (params.person_titles as string[]).length > 0) {
        body.person_titles = params.person_titles
      }
      if (params.person_locations && (params.person_locations as string[]).length > 0) {
        body.person_locations = params.person_locations
      }
      if (params.person_seniorities && (params.person_seniorities as string[]).length > 0) {
        body.person_seniorities = params.person_seniorities
      }
      if (params.organization_names && (params.organization_names as string[]).length > 0) {
        body.organization_names = params.organization_names
      }
      if (params.q_keywords) {
        body.q_keywords = params.q_keywords
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/mixed_people/search`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          people: (data.people as unknown[]) || [],
          page: (data.pagination as Record<string, unknown>)?.page || 1,
          per_page: (data.pagination as Record<string, unknown>)?.per_page || 25,
          total_entries: (data.pagination as Record<string, unknown>)?.total_entries || 0,
        },
      }
    },

    apollo_people_enrich: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {}
      if (params.first_name) body.first_name = params.first_name
      if (params.last_name) body.last_name = params.last_name
      if (params.email) body.email = params.email
      if (params.organization_name) body.organization_name = params.organization_name
      if (params.domain) body.domain = params.domain
      if (params.linkedin_url) body.linkedin_url = params.linkedin_url
      if (params.reveal_personal_emails !== undefined) body.reveal_personal_emails = params.reveal_personal_emails
      if (params.reveal_phone_number !== undefined) body.reveal_phone_number = params.reveal_phone_number

      const data = await apolloRequest(`${APOLLO_API_BASE}/people/match`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          person: data.person || {},
          enriched: !!data.person,
        },
      }
    },

    apollo_people_bulk_enrich: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const people = params.people as unknown[]
      if (!people || !Array.isArray(people)) {
        return { success: false, output: {}, error: 'Missing required parameter: people' }
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/people/bulk_match`, 'POST', apiKey, {
        details: people.slice(0, 10),
        reveal_personal_emails: params.reveal_personal_emails,
        reveal_phone_number: params.reveal_phone_number,
      })

      const matches = (data.matches as unknown[]) || []
      return {
        success: true,
        output: {
          people: matches,
          total: matches.length,
          enriched: matches.filter((p) => p).length,
        },
      }
    },

    apollo_organization_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {
        page: (params.page as number) || 1,
        per_page: Math.min((params.per_page as number) || 25, 100),
      }
      if (params.organization_locations && (params.organization_locations as string[]).length > 0) {
        body.organization_locations = params.organization_locations
      }
      if (params.organization_num_employees_ranges && (params.organization_num_employees_ranges as string[]).length > 0) {
        body.organization_num_employees_ranges = params.organization_num_employees_ranges
      }
      if (params.q_organization_keyword_tags && (params.q_organization_keyword_tags as string[]).length > 0) {
        body.q_organization_keyword_tags = params.q_organization_keyword_tags
      }
      if (params.q_organization_name) {
        body.q_organization_name = params.q_organization_name
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/mixed_companies/search`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          organizations: (data.organizations as unknown[]) || [],
          page: (data.pagination as Record<string, unknown>)?.page || 1,
          per_page: (data.pagination as Record<string, unknown>)?.per_page || 25,
          total_entries: (data.pagination as Record<string, unknown>)?.total_entries || 0,
        },
      }
    },

    apollo_organization_enrich: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.organization_name && !params.domain) {
        return { success: false, output: {}, error: 'At least one of organization_name or domain is required' }
      }

      const body: Record<string, unknown> = {}
      if (params.organization_name) body.name = params.organization_name
      if (params.domain) body.domain = params.domain

      const data = await apolloRequest(`${APOLLO_API_BASE}/organizations/enrich`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          organization: data.organization || {},
          enriched: !!data.organization,
        },
      }
    },

    apollo_organization_bulk_enrich: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const organizations = params.organizations as unknown[]
      if (!organizations || !Array.isArray(organizations)) {
        return { success: false, output: {}, error: 'Missing required parameter: organizations' }
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/organizations/bulk_enrich`, 'POST', apiKey, {
        details: organizations.slice(0, 10),
      })

      const matches = (data.matches as unknown[]) || []
      return {
        success: true,
        output: {
          organizations: matches,
          total: matches.length,
          enriched: matches.filter((o) => o).length,
        },
      }
    },

    apollo_contact_create: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.first_name || !params.last_name) {
        return { success: false, output: {}, error: 'Missing required parameters: first_name and last_name' }
      }

      const body: Record<string, unknown> = {
        first_name: params.first_name,
        last_name: params.last_name,
      }
      if (params.email) body.email = params.email
      if (params.title) body.title = params.title
      if (params.account_id) body.account_id = params.account_id
      if (params.owner_id) body.owner_id = params.owner_id

      const data = await apolloRequest(`${APOLLO_API_BASE}/contacts`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          contact: data.contact ?? null,
          created: !!data.contact,
        },
      }
    },

    apollo_contact_update: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.contact_id) {
        return { success: false, output: {}, error: 'Missing required parameter: contact_id' }
      }

      const body: Record<string, unknown> = {}
      if (params.first_name) body.first_name = params.first_name
      if (params.last_name) body.last_name = params.last_name
      if (params.email) body.email = params.email
      if (params.title) body.title = params.title
      if (params.account_id) body.account_id = params.account_id
      if (params.owner_id) body.owner_id = params.owner_id

      const data = await apolloRequest(
        `${APOLLO_API_BASE}/contacts/${params.contact_id}`,
        'PATCH',
        apiKey,
        body
      )

      return {
        success: true,
        output: {
          contact: data.contact ?? null,
          updated: !!data.contact,
        },
      }
    },

    apollo_contact_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {
        page: (params.page as number) || 1,
        per_page: Math.min((params.per_page as number) || 25, 100),
      }
      if (params.q_keywords) body.q_keywords = params.q_keywords
      if (params.contact_stage_ids && (params.contact_stage_ids as string[]).length > 0) {
        body.contact_stage_ids = params.contact_stage_ids
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/contacts/search`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          contacts: data.contacts ?? null,
          pagination: data.pagination ?? null,
        },
      }
    },

    apollo_contact_bulk_create: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const contacts = params.contacts as unknown[]
      if (!contacts || !Array.isArray(contacts)) {
        return { success: false, output: {}, error: 'Missing required parameter: contacts' }
      }

      const body: Record<string, unknown> = {
        contacts: contacts.slice(0, 100),
      }
      if (params.run_dedupe !== undefined) {
        body.run_dedupe = params.run_dedupe
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/contacts/bulk_create`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          created_contacts: (data.contacts as unknown[]) || (data.created_contacts as unknown[]) || [],
          existing_contacts: (data.existing_contacts as unknown[]) || [],
          total_submitted: ((data.contacts as unknown[]) || []).length,
          created: ((data.created_contacts as unknown[]) || (data.contacts as unknown[]) || []).length,
          existing: ((data.existing_contacts as unknown[]) || []).length,
        },
      }
    },

    apollo_contact_bulk_update: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const contacts = params.contacts as unknown[]
      if (!contacts || !Array.isArray(contacts)) {
        return { success: false, output: {}, error: 'Missing required parameter: contacts' }
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/contacts/bulk_update`, 'POST', apiKey, {
        contacts: contacts.slice(0, 100),
      })

      return {
        success: true,
        output: {
          updated_contacts: (data.contacts as unknown[]) || (data.updated_contacts as unknown[]) || [],
          failed_contacts: (data.failed_contacts as unknown[]) || [],
          total_submitted: ((data.contacts as unknown[]) || []).length,
          updated: ((data.updated_contacts as unknown[]) || (data.contacts as unknown[]) || []).length,
          failed: ((data.failed_contacts as unknown[]) || []).length,
        },
      }
    },

    apollo_account_create: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.name) {
        return { success: false, output: {}, error: 'Missing required parameter: name' }
      }

      const body: Record<string, unknown> = { name: params.name }
      if (params.website_url) body.website_url = params.website_url
      if (params.phone) body.phone = params.phone
      if (params.owner_id) body.owner_id = params.owner_id

      const data = await apolloRequest(`${APOLLO_API_BASE}/accounts`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          account: data.account ?? null,
          created: !!data.account,
        },
      }
    },

    apollo_account_update: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.account_id) {
        return { success: false, output: {}, error: 'Missing required parameter: account_id' }
      }

      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.website_url) body.website_url = params.website_url
      if (params.phone) body.phone = params.phone
      if (params.owner_id) body.owner_id = params.owner_id

      const data = await apolloRequest(
        `${APOLLO_API_BASE}/accounts/${params.account_id}`,
        'PATCH',
        apiKey,
        body
      )

      return {
        success: true,
        output: {
          account: data.account ?? null,
          updated: !!data.account,
        },
      }
    },

    apollo_account_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {
        page: (params.page as number) || 1,
        per_page: Math.min((params.per_page as number) || 25, 100),
      }
      if (params.q_keywords) body.q_keywords = params.q_keywords
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.account_stage_ids && (params.account_stage_ids as string[]).length > 0) {
        body.account_stage_ids = params.account_stage_ids
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/accounts/search`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          accounts: data.accounts ?? null,
          pagination: data.pagination ?? null,
        },
      }
    },

    apollo_account_bulk_create: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const accounts = params.accounts as unknown[]
      if (!accounts || !Array.isArray(accounts)) {
        return { success: false, output: {}, error: 'Missing required parameter: accounts' }
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/accounts/bulk_create`, 'POST', apiKey, {
        accounts: accounts.slice(0, 100),
      })

      return {
        success: true,
        output: {
          created_accounts: (data.accounts as unknown[]) || (data.created_accounts as unknown[]) || [],
          failed_accounts: (data.failed_accounts as unknown[]) || [],
          total_submitted: ((data.accounts as unknown[]) || []).length,
          created: ((data.created_accounts as unknown[]) || (data.accounts as unknown[]) || []).length,
          failed: ((data.failed_accounts as unknown[]) || []).length,
        },
      }
    },

    apollo_account_bulk_update: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const accounts = params.accounts as unknown[]
      if (!accounts || !Array.isArray(accounts)) {
        return { success: false, output: {}, error: 'Missing required parameter: accounts' }
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/accounts/bulk_update`, 'POST', apiKey, {
        accounts: accounts.slice(0, 1000),
      })

      return {
        success: true,
        output: {
          updated_accounts: (data.accounts as unknown[]) || (data.updated_accounts as unknown[]) || [],
          failed_accounts: (data.failed_accounts as unknown[]) || [],
          total_submitted: ((data.accounts as unknown[]) || []).length,
          updated: ((data.updated_accounts as unknown[]) || (data.accounts as unknown[]) || []).length,
          failed: ((data.failed_accounts as unknown[]) || []).length,
        },
      }
    },

    apollo_sequence_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {
        page: (params.page as number) || 1,
        per_page: Math.min((params.per_page as number) || 25, 100),
      }
      if (params.q_name) body.q_name = params.q_name
      if (params.active !== undefined) body.active = params.active

      const data = await apolloRequest(`${APOLLO_API_BASE}/emailer_campaigns/search`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          sequences: (data.emailer_campaigns as unknown[]) || [],
          page: (data.pagination as Record<string, unknown>)?.page || 1,
          per_page: (data.pagination as Record<string, unknown>)?.per_page || 25,
          total_entries: (data.pagination as Record<string, unknown>)?.total_entries || 0,
        },
      }
    },

    apollo_sequence_add_contacts: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.sequence_id) {
        return { success: false, output: {}, error: 'Missing required parameter: sequence_id' }
      }

      const contactIds = params.contact_ids as string[]
      if (!contactIds || !Array.isArray(contactIds)) {
        return { success: false, output: {}, error: 'Missing required parameter: contact_ids' }
      }

      const body: Record<string, unknown> = {
        contact_ids: contactIds,
      }
      if (params.emailer_campaign_id) body.emailer_campaign_id = params.emailer_campaign_id
      if (params.send_email_from_user_id) body.send_email_from_user_id = params.send_email_from_user_id

      const data = await apolloRequest(
        `${APOLLO_API_BASE}/emailer_campaigns/${params.sequence_id}/add_contact_ids`,
        'POST',
        apiKey,
        body
      )

      return {
        success: true,
        output: {
          contacts_added: (data.contacts as unknown[]) || contactIds,
          sequence_id: params.sequence_id as string,
          total_added: ((data.contacts as unknown[]) || contactIds).length,
        },
      }
    },

    apollo_task_create: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.note) {
        return { success: false, output: {}, error: 'Missing required parameter: note' }
      }

      const body: Record<string, unknown> = { note: params.note }
      if (params.contact_id) body.contact_id = params.contact_id
      if (params.account_id) body.account_id = params.account_id
      if (params.due_at) body.due_at = params.due_at
      if (params.priority) body.priority = params.priority
      if (params.type) body.type = params.type

      const data = await apolloRequest(`${APOLLO_API_BASE}/tasks/bulk_create`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          task: (data.task as Record<string, unknown>) ?? null,
          created: data === true || !!data.task,
        },
      }
    },

    apollo_task_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {
        page: (params.page as number) || 1,
        per_page: Math.min((params.per_page as number) || 25, 100),
      }
      if (params.contact_id) body.contact_id = params.contact_id
      if (params.account_id) body.account_id = params.account_id
      if (params.completed !== undefined) body.completed = params.completed

      const data = await apolloRequest(`${APOLLO_API_BASE}/tasks/search`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          tasks: data.tasks ?? null,
          pagination: data.pagination ?? null,
        },
      }
    },

    apollo_email_accounts: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const data = await apolloRequest(`${APOLLO_API_BASE}/email_accounts`, 'GET', apiKey)

      return {
        success: true,
        output: {
          email_accounts: (data.email_accounts as unknown[]) || [],
          total: ((data.email_accounts as unknown[]) || []).length,
        },
      }
    },

    apollo_opportunity_create: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.name || !params.account_id) {
        return { success: false, output: {}, error: 'Missing required parameters: name and account_id' }
      }

      const body: Record<string, unknown> = {
        name: params.name,
        account_id: params.account_id,
      }
      if (params.amount !== undefined) body.amount = params.amount
      if (params.stage_id) body.stage_id = params.stage_id
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.close_date) body.close_date = params.close_date
      if (params.description) body.description = params.description

      const data = await apolloRequest(`${APOLLO_API_BASE}/opportunities`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          opportunity: data.opportunity ?? null,
          created: !!data.opportunity,
        },
      }
    },

    apollo_opportunity_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const body: Record<string, unknown> = {
        page: (params.page as number) || 1,
        per_page: Math.min((params.per_page as number) || 25, 100),
      }
      if (params.q_keywords) body.q_keywords = params.q_keywords
      if (params.account_ids && (params.account_ids as string[]).length > 0) body.account_ids = params.account_ids
      if (params.stage_ids && (params.stage_ids as string[]).length > 0) body.stage_ids = params.stage_ids
      if (params.owner_ids && (params.owner_ids as string[]).length > 0) body.owner_ids = params.owner_ids

      const data = await apolloRequest(`${APOLLO_API_BASE}/opportunities/search`, 'POST', apiKey, body)

      return {
        success: true,
        output: {
          opportunities: (data.opportunities as unknown[]) || [],
          page: (data.pagination as Record<string, unknown>)?.page || 1,
          per_page: (data.pagination as Record<string, unknown>)?.per_page || 25,
          total_entries: (data.pagination as Record<string, unknown>)?.total_entries || 0,
        },
      }
    },

    apollo_opportunity_get: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.opportunity_id) {
        return { success: false, output: {}, error: 'Missing required parameter: opportunity_id' }
      }

      const data = await apolloRequest(
        `${APOLLO_API_BASE}/opportunities/${params.opportunity_id}`,
        'GET',
        apiKey
      )

      return {
        success: true,
        output: {
          opportunity: data.opportunity || {},
          found: !!data.opportunity,
        },
      }
    },

    apollo_opportunity_update: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.opportunity_id) {
        return { success: false, output: {}, error: 'Missing required parameter: opportunity_id' }
      }

      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.amount !== undefined) body.amount = params.amount
      if (params.stage_id) body.stage_id = params.stage_id
      if (params.owner_id) body.owner_id = params.owner_id
      if (params.close_date) body.close_date = params.close_date
      if (params.description) body.description = params.description

      const data = await apolloRequest(
        `${APOLLO_API_BASE}/opportunities/${params.opportunity_id}`,
        'PATCH',
        apiKey,
        body
      )

      return {
        success: true,
        output: {
          opportunity: data.opportunity ?? null,
          updated: !!data.opportunity,
        },
      }
    },
  },
}

export default handler
