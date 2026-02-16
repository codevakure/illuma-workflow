import type { ToolHandler } from '../../sdk/types'

const WEALTHBOX_API_BASE = 'https://api.crmworkspace.com/v1'

async function wealthboxRequest(
  url: string,
  method: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  }
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Wealthbox API error: ${response.status} ${response.statusText} - ${errorText}`)
  }
  return response.json()
}

const handler: ToolHandler = {
  operations: {
    wealthbox_read_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const contactId = (params.contactId as string)?.trim()
      const url = contactId
        ? `${WEALTHBOX_API_BASE}/contacts/${contactId}`
        : `${WEALTHBOX_API_BASE}/contacts`

      const data = await wealthboxRequest(url, 'GET', accessToken)
      const contact = data as Record<string, unknown>

      let content = `Contact: ${contact.first_name || ''} ${contact.last_name || ''}`.trim()
      if (contact.company_name) content += `\nCompany: ${contact.company_name}`
      if (contact.background_information) content += `\nBackground: ${contact.background_information}`

      const emails = contact.email_addresses as Array<Record<string, unknown>> | undefined
      if (emails && emails.length > 0) {
        content += '\nEmail Addresses:'
        for (const email of emails) {
          content += `\n  - ${email.address}${email.principal ? ' (Primary)' : ''} (${email.kind})`
        }
      }

      const phones = contact.phone_numbers as Array<Record<string, unknown>> | undefined
      if (phones && phones.length > 0) {
        content += '\nPhone Numbers:'
        for (const phone of phones) {
          content += `\n  - ${phone.address}${phone.extension ? ` ext. ${phone.extension}` : ''}${phone.principal ? ' (Primary)' : ''} (${phone.kind})`
        }
      }

      return {
        success: true,
        output: {
          content,
          contact,
          metadata: {
            itemId: contact.id?.toString() ?? null,
            contactId: contact.id?.toString() ?? null,
            itemType: 'contact',
          },
        },
      }
    },

    wealthbox_read_note: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const noteId = (params.noteId as string)?.trim()
      const url = noteId
        ? `${WEALTHBOX_API_BASE}/notes/${noteId}`
        : `${WEALTHBOX_API_BASE}/notes`

      const data = await wealthboxRequest(url, 'GET', accessToken)
      const note = data as Record<string, unknown>

      let content = `Note Content: ${note.content || 'No content available'}`
      if (note.created_at) content += `\nCreated: ${new Date(note.created_at as string).toLocaleString()}`
      if (note.updated_at) content += `\nUpdated: ${new Date(note.updated_at as string).toLocaleString()}`
      if (note.visible_to) content += `\nVisible to: ${note.visible_to}`

      const linkedTo = note.linked_to as Array<Record<string, unknown>> | undefined
      if (linkedTo && linkedTo.length > 0) {
        content += '\nLinked to:'
        for (const link of linkedTo) {
          content += `\n  - ${link.name} (${link.type})`
        }
      }

      const tags = note.tags as Array<Record<string, unknown>> | undefined
      if (tags && tags.length > 0) {
        content += '\nTags:'
        for (const tag of tags) {
          content += `\n  - ${tag.name}`
        }
      }

      return {
        success: true,
        output: {
          content,
          note,
          metadata: {
            itemId: note.id?.toString() ?? null,
            noteId: note.id?.toString() ?? null,
            itemType: 'note',
          },
        },
      }
    },

    wealthbox_read_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const taskId = (params.taskId as string)?.trim()
      const url = taskId
        ? `${WEALTHBOX_API_BASE}/tasks/${taskId}`
        : `${WEALTHBOX_API_BASE}/tasks`

      const data = await wealthboxRequest(url, 'GET', accessToken)
      const task = data as Record<string, unknown>

      let content = `Task: ${task.name || 'Unnamed task'}`
      if (task.due_date) content += `\nDue Date: ${new Date(task.due_date as string).toLocaleDateString()}`
      if (task.complete !== undefined) content += `\nStatus: ${task.complete ? 'Complete' : 'Incomplete'}`
      if (task.priority) content += `\nPriority: ${task.priority}`
      if (task.category) content += `\nCategory: ${task.category}`
      if (task.visible_to) content += `\nVisible to: ${task.visible_to}`

      const linkedTo = task.linked_to as Array<Record<string, unknown>> | undefined
      if (linkedTo && linkedTo.length > 0) {
        content += '\nLinked to:'
        for (const link of linkedTo) {
          content += `\n  - ${link.name} (${link.type})`
        }
      }

      return {
        success: true,
        output: {
          content,
          task,
          metadata: {
            itemId: task.id?.toString() ?? null,
            taskId: task.id?.toString() ?? null,
            itemType: 'task',
          },
        },
      }
    },

    wealthbox_write_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const firstName = ((params.firstName as string) || '').trim()
      const lastName = ((params.lastName as string) || '').trim()
      if (!firstName) {
        return { success: false, output: {}, error: 'First name is required' }
      }
      if (!lastName) {
        return { success: false, output: {}, error: 'Last name is required' }
      }

      const body: Record<string, unknown> = {
        first_name: firstName,
        last_name: lastName,
      }

      const emailAddress = ((params.emailAddress as string) || '').trim()
      if (emailAddress) {
        body.email_addresses = [{ address: emailAddress, kind: 'email', principal: true }]
      }

      const backgroundInformation = ((params.backgroundInformation as string) || '').trim()
      if (backgroundInformation) {
        body.background_information = backgroundInformation
      }

      const data = await wealthboxRequest(`${WEALTHBOX_API_BASE}/contacts`, 'POST', accessToken, body)
      const contact = data as Record<string, unknown>

      let content = `Contact created: ${contact.first_name || ''} ${contact.last_name || ''}`.trim()
      if (contact.background_information) content += `\nBackground: ${contact.background_information}`

      return {
        success: true,
        output: {
          content,
          contact,
          success: true,
          metadata: {
            itemId: contact.id?.toString() ?? null,
            contactId: contact.id?.toString() ?? null,
            itemType: 'contact',
          },
        },
      }
    },

    wealthbox_write_note: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      let content: string
      if (params.content === null || params.content === undefined) {
        return { success: false, output: {}, error: 'Note content is required' }
      }
      content = typeof params.content === 'string' ? params.content : JSON.stringify(params.content)
      content = content.trim()
      if (!content) {
        return { success: false, output: {}, error: 'Note content is required' }
      }

      const body: Record<string, unknown> = { content }
      const contactId = ((params.contactId as string) || '').trim()
      if (contactId) {
        body.linked_to = [{ id: parseInt(contactId, 10), type: 'Contact' }]
      }

      const data = await wealthboxRequest(`${WEALTHBOX_API_BASE}/notes`, 'POST', accessToken, body)
      const note = data as Record<string, unknown>

      return {
        success: true,
        output: {
          note,
          success: true,
          metadata: {
            itemId: note.id?.toString() ?? null,
            noteId: note.id?.toString() ?? null,
            itemType: 'note',
          },
        },
      }
    },

    wealthbox_write_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const title = ((params.title as string) || '').trim()
      const dueDate = ((params.dueDate as string) || '').trim()
      if (!title) {
        return { success: false, output: {}, error: 'Task title is required' }
      }
      if (!dueDate) {
        return { success: false, output: {}, error: 'Due date is required' }
      }

      const body: Record<string, unknown> = {
        name: title,
        due_date: dueDate,
      }

      const description = ((params.description as string) || '').trim()
      if (description) body.description = description
      if (params.complete !== undefined) body.complete = params.complete
      if (params.category !== undefined) body.category = params.category

      const contactId = ((params.contactId as string) || '').trim()
      if (contactId) {
        body.linked_to = [{ id: parseInt(contactId, 10), type: 'Contact' }]
      }

      const taskId = ((params.taskId as string) || '').trim()
      const url = taskId
        ? `${WEALTHBOX_API_BASE}/tasks/${taskId}`
        : `${WEALTHBOX_API_BASE}/tasks`

      const data = await wealthboxRequest(url, 'POST', accessToken, body)
      const task = data as Record<string, unknown>

      return {
        success: true,
        output: {
          task,
          success: true,
          metadata: {
            itemId: task.id?.toString() ?? null,
            taskId: task.id?.toString() ?? null,
            itemType: 'task',
          },
        },
      }
    },
  },
}

export default handler
