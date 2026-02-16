import type { ToolHandler } from '../../sdk/types'

const SENDGRID_API = 'https://api.sendgrid.com/v3'

async function sendgridRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: string
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const response = await fetch(`${SENDGRID_API}${path}`, {
    method,
    headers,
    body,
  })

  if (response.status === 204 || response.status === 202) {
    return { ok: true, data: {}, status: response.status }
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const errors = (data as Record<string, unknown>).errors as Array<Record<string, unknown>> | undefined
    const errorMsg = errors?.[0]?.message || `SendGrid API error: ${response.status}`
    return { ok: false, data: { error: errorMsg }, status: response.status }
  }
  return { ok: true, data: data as Record<string, unknown>, status: response.status }
}

const handler: ToolHandler = {
  operations: {
    sendgrid_send_mail: async (params) => {
      const apiKey = params.apiKey as string
      const from = params.from as string
      const to = params.to as string

      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!from) return { success: false, output: {}, error: 'Missing required parameter: from' }
      if (!to) return { success: false, output: {}, error: 'Missing required parameter: to' }

      const personalization: Record<string, unknown> = {
        to: [{ email: to, ...(params.toName ? { name: params.toName } : {}) }],
      }
      if (params.cc) personalization.cc = [{ email: params.cc }]
      if (params.bcc) personalization.bcc = [{ email: params.bcc }]
      if (params.dynamicTemplateData) {
        personalization.dynamic_template_data =
          typeof params.dynamicTemplateData === 'string'
            ? JSON.parse(params.dynamicTemplateData as string)
            : params.dynamicTemplateData
      }

      const mailBody: Record<string, unknown> = {
        personalizations: [personalization],
        from: { email: from, ...(params.fromName ? { name: params.fromName } : {}) },
      }

      if (params.subject) mailBody.subject = params.subject
      if (params.templateId) mailBody.template_id = params.templateId

      if (params.content) {
        const contentType = (params.contentType as string) || 'text/plain'
        mailBody.content = [{ type: contentType, value: params.content }]
      }

      if (params.replyTo) {
        mailBody.reply_to = { email: params.replyTo, ...(params.replyToName ? { name: params.replyToName } : {}) }
      }

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mailBody),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errors = (errorData as Record<string, unknown>).errors as Array<Record<string, unknown>> | undefined
        const errorMsg = errors?.[0]?.message || `SendGrid API error: ${response.status}`
        return { success: false, output: { success: false, messageId: undefined, to: '', subject: '' }, error: errorMsg as string }
      }

      const messageId = response.headers.get('X-Message-Id') || undefined

      return {
        success: true,
        output: {
          success: true,
          messageId,
          to,
          subject: (params.subject as string) || '',
        },
      }
    },

    sendgrid_add_contact: async (params) => {
      const apiKey = params.apiKey as string
      const email = params.email as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!email) return { success: false, output: {}, error: 'Missing required parameter: email' }

      const contact: Record<string, unknown> = { email }
      if (params.firstName) contact.first_name = params.firstName
      if (params.lastName) contact.last_name = params.lastName
      if (params.customFields) {
        const customFields = typeof params.customFields === 'string' ? JSON.parse(params.customFields as string) : params.customFields
        Object.assign(contact, customFields)
      }

      const body: Record<string, unknown> = { contacts: [contact] }
      if (params.listIds) {
        body.list_ids = (params.listIds as string).split(',').map((id) => id.trim())
      }

      const result = await sendgridRequest('PUT', '/marketing/contacts', apiKey, JSON.stringify(body))
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          jobId: result.data.job_id,
          email,
          firstName: params.firstName,
          lastName: params.lastName,
          message: 'Contact is being added. This is an asynchronous operation.',
        },
      }
    },

    sendgrid_get_contact: async (params) => {
      const apiKey = params.apiKey as string
      const contactId = params.contactId as string
      if (!apiKey || !contactId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('GET', `/marketing/contacts/${contactId}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          id: result.data.id,
          email: result.data.email,
          firstName: result.data.first_name,
          lastName: result.data.last_name,
          createdAt: result.data.created_at,
          updatedAt: result.data.updated_at,
          listIds: result.data.list_ids,
          customFields: result.data.custom_fields,
        },
      }
    },

    sendgrid_search_contacts: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('POST', '/marketing/contacts/search', apiKey, JSON.stringify({ query }))
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          contacts: result.data.result || [],
          contactCount: result.data.contact_count,
        },
      }
    },

    sendgrid_delete_contacts: async (params) => {
      const apiKey = params.apiKey as string
      const contactIds = params.contactIds as string
      if (!apiKey || !contactIds) return { success: false, output: {}, error: 'Missing required parameters' }

      const ids = contactIds.split(',').map((id) => id.trim()).join(',')
      const result = await sendgridRequest('DELETE', `/marketing/contacts?ids=${encodeURIComponent(ids)}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return { success: true, output: { jobId: result.data.job_id } }
    },

    sendgrid_create_list: async (params) => {
      const apiKey = params.apiKey as string
      const name = params.name as string
      if (!apiKey || !name) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('POST', '/marketing/lists', apiKey, JSON.stringify({ name }))
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          id: result.data.id,
          name: result.data.name,
          contactCount: result.data.contact_count,
        },
      }
    },

    sendgrid_get_list: async (params) => {
      const apiKey = params.apiKey as string
      const listId = params.listId as string
      if (!apiKey || !listId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('GET', `/marketing/lists/${listId}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          id: result.data.id,
          name: result.data.name,
          contactCount: result.data.contact_count,
        },
      }
    },

    sendgrid_delete_list: async (params) => {
      const apiKey = params.apiKey as string
      const listId = params.listId as string
      if (!apiKey || !listId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('DELETE', `/marketing/lists/${listId}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return { success: true, output: { message: 'List deleted successfully' } }
    },

    sendgrid_list_all_lists: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${SENDGRID_API}/marketing/lists`)
      if (params.pageSize) url.searchParams.append('page_size', String(params.pageSize))

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `SendGrid API error: ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { lists: data.result || [] } }
    },

    sendgrid_add_contacts_to_list: async (params) => {
      const apiKey = params.apiKey as string
      const listId = params.listId as string
      const contacts = params.contacts
      if (!apiKey || !listId || !contacts) return { success: false, output: {}, error: 'Missing required parameters' }

      const contactsArray = typeof contacts === 'string' ? JSON.parse(contacts as string) : contacts

      const result = await sendgridRequest('PUT', '/marketing/contacts', apiKey, JSON.stringify({
        list_ids: [listId],
        contacts: contactsArray,
      }))
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          jobId: result.data.job_id,
          message: 'Contacts are being added to the list. This is an asynchronous operation.',
        },
      }
    },

    sendgrid_remove_contacts_from_list: async (params) => {
      const apiKey = params.apiKey as string
      const listId = params.listId as string
      const contactIds = params.contactIds as string
      if (!apiKey || !listId || !contactIds) return { success: false, output: {}, error: 'Missing required parameters' }

      const ids = contactIds.split(',').map((id) => id.trim()).join(',')
      const result = await sendgridRequest(
        'DELETE',
        `/marketing/lists/${listId}/contacts?contact_ids=${encodeURIComponent(ids)}`,
        apiKey
      )
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return { success: true, output: { jobId: result.data.job_id } }
    },

    sendgrid_create_template: async (params) => {
      const apiKey = params.apiKey as string
      const name = params.name as string
      if (!apiKey || !name) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('POST', '/templates', apiKey, JSON.stringify({
        name,
        generation: (params.generation as string) || 'dynamic',
      }))
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          id: result.data.id,
          name: result.data.name,
          generation: result.data.generation,
          updatedAt: result.data.updated_at,
          versions: result.data.versions || [],
        },
      }
    },

    sendgrid_get_template: async (params) => {
      const apiKey = params.apiKey as string
      const templateId = params.templateId as string
      if (!apiKey || !templateId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('GET', `/templates/${templateId}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          id: result.data.id,
          name: result.data.name,
          generation: result.data.generation,
          updatedAt: result.data.updated_at,
          versions: result.data.versions || [],
        },
      }
    },

    sendgrid_delete_template: async (params) => {
      const apiKey = params.apiKey as string
      const templateId = params.templateId as string
      if (!apiKey || !templateId) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await sendgridRequest('DELETE', `/templates/${templateId}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return { success: true, output: {} }
    },

    sendgrid_list_templates: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${SENDGRID_API}/templates`)
      if (params.generations) url.searchParams.append('generations', params.generations as string)
      if (params.pageSize) url.searchParams.append('page_size', String(params.pageSize))

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `SendGrid API error: ${response.status}` }
      }

      const data = await response.json()
      return { success: true, output: { templates: data.result || data.templates || [] } }
    },

    sendgrid_create_template_version: async (params) => {
      const apiKey = params.apiKey as string
      const templateId = params.templateId as string
      const name = params.name as string
      const subject = params.subject as string
      if (!apiKey || !templateId || !name || !subject) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {
        name,
        subject,
        active: params.active !== undefined ? params.active : 1,
      }
      if (params.htmlContent) body.html_content = params.htmlContent
      if (params.plainContent) body.plain_content = params.plainContent

      const result = await sendgridRequest(
        'POST',
        `/templates/${templateId}/versions`,
        apiKey,
        JSON.stringify(body)
      )
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          id: result.data.id,
          templateId: result.data.template_id,
          name: result.data.name,
          subject: result.data.subject,
          active: result.data.active === 1,
          htmlContent: result.data.html_content,
          plainContent: result.data.plain_content,
          updatedAt: result.data.updated_at,
        },
      }
    },
  },
}

export default handler
