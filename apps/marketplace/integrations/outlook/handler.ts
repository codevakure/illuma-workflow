import type { ToolHandler } from '../../sdk/types'

const OUTLOOK_API_BASE = 'https://graph.microsoft.com/v1.0/me'

function buildOutlookMessage(params: {
  to: string
  subject: string
  body: string
  contentType?: string
  cc?: string
  bcc?: string
}): Record<string, unknown> {
  const toRecipients = params.to.split(',').map((email) => ({
    emailAddress: { address: email.trim() },
  }))

  const message: Record<string, unknown> = {
    subject: params.subject,
    body: {
      contentType: params.contentType === 'html' ? 'HTML' : 'Text',
      content: params.body,
    },
    toRecipients,
  }

  if (params.cc) {
    message.ccRecipients = params.cc.split(',').map((email) => ({
      emailAddress: { address: email.trim() },
    }))
  }

  if (params.bcc) {
    message.bccRecipients = params.bcc.split(',').map((email) => ({
      emailAddress: { address: email.trim() },
    }))
  }

  return message
}

const handler: ToolHandler = {
  operations: {
    outlook_send: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const to = params.to as string
      const subject = params.subject as string
      const body = params.body as string
      if (!to || !subject || !body) {
        return { success: false, output: {}, error: 'Missing required parameters: to, subject, body' }
      }

      const message = buildOutlookMessage({
        to,
        subject,
        body,
        contentType: params.contentType as string,
        cc: params.cc as string,
        bcc: params.bcc as string,
      })

      const response = await fetch(`${OUTLOOK_API_BASE}/sendMail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>).error?.message || 'Failed to send email',
        }
      }

      return {
        success: true,
        output: {
          message: 'Email sent successfully',
          status: 'sent',
          timestamp: new Date().toISOString(),
        },
      }
    },

    outlook_read: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const maxResults = Math.max(1, Math.min(Number(params.maxResults) || 1, 10))
      const folder = params.folder as string | undefined

      const url = folder
        ? `${OUTLOOK_API_BASE}/mailFolders/${folder}/messages?$top=${maxResults}&$orderby=createdDateTime desc`
        : `${OUTLOOK_API_BASE}/messages?$top=${maxResults}&$orderby=createdDateTime desc`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>).error?.message || 'Failed to read emails',
        }
      }

      const data = await response.json()
      const messages = data.value || []

      if (messages.length === 0) {
        return { success: true, output: { message: 'No mail found.', results: [] } }
      }

      const results = messages.map((msg: Record<string, unknown>) => ({
        id: msg.id,
        subject: msg.subject,
        bodyPreview: msg.bodyPreview,
        body: msg.body,
        sender: (msg.sender as Record<string, unknown>)?.emailAddress,
        from: (msg.from as Record<string, unknown>)?.emailAddress,
        toRecipients: ((msg.toRecipients as Array<Record<string, unknown>>) || []).map(
          (r) => r.emailAddress
        ),
        receivedDateTime: msg.receivedDateTime,
        sentDateTime: msg.sentDateTime,
        hasAttachments: msg.hasAttachments,
        isRead: msg.isRead,
        importance: msg.importance,
      }))

      return {
        success: true,
        output: { message: `Successfully read ${results.length} email(s).`, results },
      }
    },

    outlook_draft: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const to = params.to as string
      const subject = params.subject as string
      const body = params.body as string
      if (!to || !subject || !body) {
        return { success: false, output: {}, error: 'Missing required parameters: to, subject, body' }
      }

      const message = buildOutlookMessage({
        to,
        subject,
        body,
        contentType: params.contentType as string,
        cc: params.cc as string,
        bcc: params.bcc as string,
      })

      const response = await fetch(`${OUTLOOK_API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>).error?.message || 'Failed to create draft',
        }
      }

      const responseData = await response.json()
      return {
        success: true,
        output: {
          message: 'Draft created successfully',
          messageId: responseData.id,
          subject: responseData.subject,
        },
      }
    },

    outlook_delete: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${OUTLOOK_API_BASE}/messages/${messageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>).error?.message || 'Failed to delete email',
        }
      }

      return {
        success: true,
        output: { message: 'Email moved to Deleted Items successfully', messageId, status: 'deleted' },
      }
    },

    outlook_forward: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      const to = params.to as string
      if (!accessToken || !messageId || !to) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const toRecipients = to.split(',').map((email) => ({
        emailAddress: { address: email.trim() },
      }))

      const response = await fetch(
        `${OUTLOOK_API_BASE}/messages/${messageId}/forward`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            comment: (params.comment as string) || '',
            toRecipients,
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>).error?.message || 'Failed to forward email',
        }
      }

      return {
        success: true,
        output: { message: 'Email forwarded successfully', status: 'forwarded' },
      }
    },

    outlook_copy: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      const destinationId = params.destinationId as string
      if (!accessToken || !messageId || !destinationId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(`${OUTLOOK_API_BASE}/messages/${messageId}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ destinationId }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>).error?.message || 'Failed to copy email',
        }
      }

      const responseData = await response.json()
      return {
        success: true,
        output: {
          message: 'Email copied successfully',
          originalMessageId: messageId,
          copiedMessageId: responseData.id,
          destinationFolderId: responseData.parentFolderId,
        },
      }
    },

    outlook_move: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      const destinationId = params.destinationId as string
      if (!accessToken || !messageId || !destinationId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(`${OUTLOOK_API_BASE}/messages/${messageId}/move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ destinationId }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>).error?.message || 'Failed to move email',
        }
      }

      const responseData = await response.json()
      return {
        success: true,
        output: {
          message: 'Email moved successfully',
          messageId: responseData.id,
          newFolderId: responseData.parentFolderId,
        },
      }
    },

    outlook_mark_read: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${OUTLOOK_API_BASE}/messages/${messageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ isRead: true }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: 'Failed to mark email as read' }
      }

      const responseData = await response.json()
      return {
        success: true,
        output: {
          message: 'Email marked as read successfully',
          messageId: responseData.id,
          isRead: responseData.isRead,
        },
      }
    },

    outlook_mark_unread: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${OUTLOOK_API_BASE}/messages/${messageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ isRead: false }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: 'Failed to mark email as unread' }
      }

      const responseData = await response.json()
      return {
        success: true,
        output: {
          message: 'Email marked as unread successfully',
          messageId: responseData.id,
          isRead: responseData.isRead,
        },
      }
    },
  },
}

export default handler
