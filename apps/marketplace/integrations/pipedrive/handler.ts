import type { ToolHandler } from '../../sdk/types'

const PIPEDRIVE_V1 = 'https://api.pipedrive.com/v1'
const PIPEDRIVE_V2 = 'https://api.pipedrive.com/api/v2'

function pipedriveHeaders(accessToken: string, includeContentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
  if (includeContentType) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

async function pipedriveRequest(
  url: string,
  method: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const options: RequestInit = {
    method,
    headers: pipedriveHeaders(accessToken, method !== 'GET'),
  }
  if (body && method !== 'GET' && method !== 'DELETE') {
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as Record<string, string>
    throw new Error(errorData.error || `Pipedrive API error: ${response.status}`)
  }
  const data = await response.json()
  if (data.success === false) {
    throw new Error((data as Record<string, string>).error || 'Pipedrive API request failed')
  }
  return data
}

const handler: ToolHandler = {
  operations: {
    pipedrive_get_all_deals: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const queryParams = new URLSearchParams()
      if (params.status) queryParams.append('status', params.status as string)
      if (params.person_id) queryParams.append('person_id', params.person_id as string)
      if (params.org_id) queryParams.append('org_id', params.org_id as string)
      if (params.pipeline_id) queryParams.append('pipeline_id', params.pipeline_id as string)
      if (params.updated_since) queryParams.append('updated_since', params.updated_since as string)
      if (params.limit) queryParams.append('limit', params.limit as string)

      const qs = queryParams.toString()
      const url = `${PIPEDRIVE_V2}/deals${qs ? `?${qs}` : ''}`
      const data = await pipedriveRequest(url, 'GET', accessToken)

      return {
        success: true,
        output: {
          deals: (data.data as unknown[]) || [],
          metadata: {
            total_items: ((data.data as unknown[]) || []).length,
            has_more: !!(data.additional_data as Record<string, unknown>)?.pagination,
          },
          success: true,
        },
      }
    },

    pipedrive_get_deal: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.deal_id) {
        return { success: false, output: {}, error: 'Missing required parameter: deal_id' }
      }

      const data = await pipedriveRequest(`${PIPEDRIVE_V2}/deals/${params.deal_id}`, 'GET', accessToken)

      return {
        success: true,
        output: {
          deal: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_create_deal: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.title) {
        return { success: false, output: {}, error: 'Missing required parameter: title' }
      }

      const body: Record<string, unknown> = { title: params.title }
      if (params.value) body.value = Number(params.value)
      if (params.currency) body.currency = params.currency
      if (params.person_id) body.person_id = Number(params.person_id)
      if (params.org_id) body.org_id = Number(params.org_id)
      if (params.pipeline_id) body.pipeline_id = Number(params.pipeline_id)
      if (params.stage_id) body.stage_id = Number(params.stage_id)
      if (params.status) body.status = params.status
      if (params.expected_close_date) body.expected_close_date = params.expected_close_date

      const data = await pipedriveRequest(`${PIPEDRIVE_V2}/deals`, 'POST', accessToken, body)

      return {
        success: true,
        output: {
          deal: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_update_deal: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.deal_id) {
        return { success: false, output: {}, error: 'Missing required parameter: deal_id' }
      }

      const body: Record<string, unknown> = {}
      if (params.title) body.title = params.title
      if (params.value) body.value = Number(params.value)
      if (params.status) body.status = params.status
      if (params.stage_id) body.stage_id = Number(params.stage_id)
      if (params.expected_close_date) body.expected_close_date = params.expected_close_date

      const data = await pipedriveRequest(
        `${PIPEDRIVE_V2}/deals/${params.deal_id}`,
        'PATCH',
        accessToken,
        body
      )

      return {
        success: true,
        output: {
          deal: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_get_leads: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      if (params.lead_id) {
        const data = await pipedriveRequest(`${PIPEDRIVE_V1}/leads/${params.lead_id}`, 'GET', accessToken)
        return {
          success: true,
          output: {
            lead: data.data ?? null,
            success: true,
          },
        }
      }

      const queryParams = new URLSearchParams()
      if (params.archived) queryParams.append('archived_status', params.archived as string)
      if (params.owner_id) queryParams.append('owner_id', params.owner_id as string)
      if (params.person_id) queryParams.append('person_id', params.person_id as string)
      if (params.organization_id) queryParams.append('organization_id', params.organization_id as string)
      if (params.limit) queryParams.append('limit', params.limit as string)

      const qs = queryParams.toString()
      const data = await pipedriveRequest(`${PIPEDRIVE_V1}/leads${qs ? `?${qs}` : ''}`, 'GET', accessToken)

      return {
        success: true,
        output: {
          leads: (data.data as unknown[]) || [],
          total_items: ((data.data as unknown[]) || []).length,
          success: true,
        },
      }
    },

    pipedrive_create_lead: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.title) {
        return { success: false, output: {}, error: 'Missing required parameter: title' }
      }
      if (!params.person_id && !params.organization_id) {
        return { success: false, output: {}, error: 'Either person_id or organization_id is required' }
      }

      const body: Record<string, unknown> = { title: params.title }
      if (params.person_id) body.person_id = Number(params.person_id)
      if (params.organization_id) body.organization_id = Number(params.organization_id)
      if (params.owner_id) body.owner_id = Number(params.owner_id)
      if (params.value_amount && params.value_currency) {
        body.value = { amount: Number(params.value_amount), currency: params.value_currency }
      }
      if (params.expected_close_date) body.expected_close_date = params.expected_close_date
      if (params.visible_to) body.visible_to = Number(params.visible_to)

      const data = await pipedriveRequest(`${PIPEDRIVE_V1}/leads`, 'POST', accessToken, body)

      return {
        success: true,
        output: {
          lead: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_update_lead: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.lead_id) {
        return { success: false, output: {}, error: 'Missing required parameter: lead_id' }
      }

      const body: Record<string, unknown> = {}
      if (params.title) body.title = params.title
      if (params.person_id) body.person_id = Number(params.person_id)
      if (params.organization_id) body.organization_id = Number(params.organization_id)
      if (params.owner_id) body.owner_id = Number(params.owner_id)
      if (params.value_amount && params.value_currency) {
        body.value = { amount: Number(params.value_amount), currency: params.value_currency }
      }
      if (params.expected_close_date) body.expected_close_date = params.expected_close_date
      if (params.is_archived) body.is_archived = params.is_archived === 'true'

      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/leads/${params.lead_id}`,
        'PATCH',
        accessToken,
        body
      )

      return {
        success: true,
        output: {
          lead: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_delete_lead: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.lead_id) {
        return { success: false, output: {}, error: 'Missing required parameter: lead_id' }
      }

      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/leads/${params.lead_id}`,
        'DELETE',
        accessToken
      )

      return {
        success: true,
        output: {
          data: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_get_activities: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const queryParams = new URLSearchParams()
      if (params.deal_id) queryParams.append('deal_id', params.deal_id as string)
      if (params.person_id) queryParams.append('person_id', params.person_id as string)
      if (params.org_id) queryParams.append('org_id', params.org_id as string)
      if (params.type) queryParams.append('type', params.type as string)
      if (params.done) queryParams.append('done', params.done as string)
      if (params.limit) queryParams.append('limit', params.limit as string)

      const qs = queryParams.toString()
      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/activities${qs ? `?${qs}` : ''}`,
        'GET',
        accessToken
      )

      const activities = (data.data as unknown[]) || []
      return {
        success: true,
        output: {
          activities,
          total_items: activities.length,
          success: true,
        },
      }
    },

    pipedrive_create_activity: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.subject || !params.type || !params.due_date) {
        return { success: false, output: {}, error: 'Missing required parameters: subject, type, due_date' }
      }

      const body: Record<string, unknown> = {
        subject: params.subject,
        type: params.type,
        due_date: params.due_date,
      }
      if (params.due_time) body.due_time = params.due_time
      if (params.duration) body.duration = params.duration
      if (params.deal_id) body.deal_id = Number(params.deal_id)
      if (params.person_id) body.person_id = Number(params.person_id)
      if (params.org_id) body.org_id = Number(params.org_id)
      if (params.note) body.note = params.note

      const data = await pipedriveRequest(`${PIPEDRIVE_V1}/activities`, 'POST', accessToken, body)

      return {
        success: true,
        output: {
          activity: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_update_activity: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.activity_id) {
        return { success: false, output: {}, error: 'Missing required parameter: activity_id' }
      }

      const body: Record<string, unknown> = {}
      if (params.subject) body.subject = params.subject
      if (params.due_date) body.due_date = params.due_date
      if (params.due_time) body.due_time = params.due_time
      if (params.duration) body.duration = params.duration
      if (params.done) body.done = Number(params.done)
      if (params.note) body.note = params.note

      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/activities/${params.activity_id}`,
        'PUT',
        accessToken,
        body
      )

      return {
        success: true,
        output: {
          activity: data.data ?? null,
          success: true,
        },
      }
    },

    pipedrive_get_files: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const queryParams = new URLSearchParams()
      if (params.deal_id) queryParams.append('deal_id', params.deal_id as string)
      if (params.person_id) queryParams.append('person_id', params.person_id as string)
      if (params.org_id) queryParams.append('org_id', params.org_id as string)
      if (params.limit) queryParams.append('limit', params.limit as string)

      const qs = queryParams.toString()
      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/files${qs ? `?${qs}` : ''}`,
        'GET',
        accessToken
      )

      const files = (data.data as unknown[]) || []
      return {
        success: true,
        output: {
          files,
          total_items: files.length,
          success: true,
        },
      }
    },

    pipedrive_get_mail_messages: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const queryParams = new URLSearchParams()
      if (params.folder) queryParams.append('folder', params.folder as string)
      if (params.limit) queryParams.append('limit', params.limit as string)

      const qs = queryParams.toString()
      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/mailbox/mailMessages${qs ? `?${qs}` : ''}`,
        'GET',
        accessToken
      )

      const messages = (data.data as unknown[]) || []
      return {
        success: true,
        output: {
          messages,
          total_items: messages.length,
          success: true,
        },
      }
    },

    pipedrive_get_mail_thread: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.thread_id) {
        return { success: false, output: {}, error: 'Missing required parameter: thread_id' }
      }

      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/mailbox/mailThreads/${params.thread_id}/mailMessages`,
        'GET',
        accessToken
      )

      const messages = (data.data as unknown[]) || []
      return {
        success: true,
        output: {
          messages,
          metadata: {
            thread_id: params.thread_id as string,
            total_items: messages.length,
          },
          success: true,
        },
      }
    },

    pipedrive_get_pipelines: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const queryParams = new URLSearchParams()
      if (params.sort_by) queryParams.append('sort_by', params.sort_by as string)
      if (params.sort_direction) queryParams.append('sort_direction', params.sort_direction as string)
      if (params.limit) queryParams.append('limit', params.limit as string)
      if (params.cursor) queryParams.append('cursor', params.cursor as string)

      const qs = queryParams.toString()
      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/pipelines${qs ? `?${qs}` : ''}`,
        'GET',
        accessToken
      )

      const pipelines = (data.data as unknown[]) || []
      return {
        success: true,
        output: {
          pipelines,
          total_items: pipelines.length,
          success: true,
        },
      }
    },

    pipedrive_get_pipeline_deals: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.pipeline_id) {
        return { success: false, output: {}, error: 'Missing required parameter: pipeline_id' }
      }

      const queryParams = new URLSearchParams()
      if (params.stage_id) queryParams.append('stage_id', params.stage_id as string)
      if (params.status) queryParams.append('status', params.status as string)
      if (params.limit) queryParams.append('limit', params.limit as string)

      const qs = queryParams.toString()
      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/pipelines/${params.pipeline_id}/deals${qs ? `?${qs}` : ''}`,
        'GET',
        accessToken
      )

      const deals = (data.data as unknown[]) || []
      return {
        success: true,
        output: {
          deals,
          metadata: {
            pipeline_id: params.pipeline_id as string,
            total_items: deals.length,
          },
          success: true,
        },
      }
    },

    pipedrive_get_projects: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      if (params.project_id) {
        const data = await pipedriveRequest(
          `${PIPEDRIVE_V1}/projects/${params.project_id}`,
          'GET',
          accessToken
        )
        return {
          success: true,
          output: {
            project: data.data ?? null,
            success: true,
          },
        }
      }

      const queryParams = new URLSearchParams()
      if (params.status) queryParams.append('status', params.status as string)
      if (params.limit) queryParams.append('limit', params.limit as string)

      const qs = queryParams.toString()
      const data = await pipedriveRequest(
        `${PIPEDRIVE_V1}/projects${qs ? `?${qs}` : ''}`,
        'GET',
        accessToken
      )

      const projects = (data.data as unknown[]) || []
      return {
        success: true,
        output: {
          projects,
          total_items: projects.length,
          success: true,
        },
      }
    },

    pipedrive_create_project: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      if (!params.title) {
        return { success: false, output: {}, error: 'Missing required parameter: title' }
      }

      const body: Record<string, unknown> = { title: params.title }
      if (params.description) body.description = params.description
      if (params.start_date) body.start_date = params.start_date
      if (params.end_date) body.end_date = params.end_date

      const data = await pipedriveRequest(`${PIPEDRIVE_V1}/projects`, 'POST', accessToken, body)

      return {
        success: true,
        output: {
          project: data.data ?? null,
          success: true,
        },
      }
    },
  },
}

export default handler
