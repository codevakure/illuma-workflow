import type { ToolHandler } from '../../sdk/types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

function extractMessageBody(payload: Record<string, unknown>): string {
  const body = payload.body as Record<string, unknown> | undefined
  if (body?.data) {
    return Buffer.from(body.data as string, 'base64').toString()
  }

  const parts = payload.parts as Array<Record<string, unknown>> | undefined
  if (!parts || parts.length === 0) {
    return ''
  }

  const textPart = parts.find((p) => p.mimeType === 'text/plain')
  if (textPart) {
    const textBody = textPart.body as Record<string, unknown> | undefined
    if (textBody?.data) {
      return Buffer.from(textBody.data as string, 'base64').toString()
    }
  }

  const htmlPart = parts.find((p) => p.mimeType === 'text/html')
  if (htmlPart) {
    const htmlBody = htmlPart.body as Record<string, unknown> | undefined
    if (htmlBody?.data) {
      return Buffer.from(htmlBody.data as string, 'base64').toString()
    }
  }

  for (const part of parts) {
    if (part.parts) {
      const nested = extractMessageBody(part)
      if (nested) return nested
    }
  }

  return ''
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function buildSimpleEmailMessage(params: {
  to: string
  cc?: string
  bcc?: string
  subject?: string
  body: string
  contentType?: string
  inReplyTo?: string
  references?: string
}): string {
  const mimeContentType = params.contentType === 'html' ? 'text/html' : 'text/plain'
  const emailHeaders = [
    `Content-Type: ${mimeContentType}; charset="UTF-8"`,
    'MIME-Version: 1.0',
    `To: ${params.to}`,
  ]

  if (params.cc) emailHeaders.push(`Cc: ${params.cc}`)
  if (params.bcc) emailHeaders.push(`Bcc: ${params.bcc}`)
  emailHeaders.push(`Subject: ${params.subject || ''}`)

  if (params.inReplyTo) {
    emailHeaders.push(`In-Reply-To: ${params.inReplyTo}`)
    const referencesChain = params.references
      ? `${params.references} ${params.inReplyTo}`
      : params.inReplyTo
    emailHeaders.push(`References: ${referencesChain}`)
  }

  emailHeaders.push('', params.body)
  return Buffer.from(emailHeaders.join('\n')).toString('base64url')
}

async function fetchThreadingHeaders(
  messageId: string,
  accessToken: string
): Promise<{ messageId?: string; references?: string; subject?: string }> {
  try {
    const response = await fetch(
      `${GMAIL_API_BASE}/messages/${messageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (response.ok) {
      const data = await response.json()
      const headers = data.payload?.headers || []
      return {
        messageId: headers.find((h: Record<string, string>) => h.name.toLowerCase() === 'message-id')?.value,
        references: headers.find((h: Record<string, string>) => h.name.toLowerCase() === 'references')?.value,
        subject: headers.find((h: Record<string, string>) => h.name.toLowerCase() === 'subject')?.value,
      }
    }
  } catch {
    // Continue without threading headers
  }
  return {}
}

function parseLabelIds(labelIds: string): string[] {
  return labelIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

const handler: ToolHandler = {
  operations: {
    gmail_send: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing access token' }
      }
      const to = params.to as string
      const body = params.body as string
      if (!to || !body) {
        return { success: false, output: {}, error: 'Missing required parameters: to, body' }
      }

      const threadingHeaders = params.replyToMessageId
        ? await fetchThreadingHeaders(params.replyToMessageId as string, accessToken)
        : {}

      const rawMessage = buildSimpleEmailMessage({
        to,
        subject: (params.subject as string) || threadingHeaders.subject || '',
        body,
        contentType: (params.contentType as string) || 'text',
        cc: params.cc as string | undefined,
        bcc: params.bcc as string | undefined,
        inReplyTo: threadingHeaders.messageId,
        references: threadingHeaders.references,
      })

      const requestBody: Record<string, unknown> = { raw: rawMessage }
      if (params.threadId) requestBody.threadId = params.threadId

      const response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText} - ${errorText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_read: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing access token' }
      }

      const messageId = params.messageId as string | undefined
      const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

      if (messageId) {
        const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}?format=full`, {
          headers: authHeaders,
        })
        if (!response.ok) {
          return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
        }
        const message = await response.json()
        const headers = message.payload?.headers || []
        const content = extractMessageBody(message.payload || {})
        return {
          success: true,
          output: {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds,
            from: getHeader(headers, 'from'),
            to: getHeader(headers, 'to'),
            subject: getHeader(headers, 'subject'),
            date: getHeader(headers, 'date'),
            body: content || 'No content found',
          },
        }
      }

      const folder = (params.folder as string) || 'INBOX'
      const maxResults = Math.min(Number(params.maxResults) || 1, 10)
      const queryParts: string[] = []
      if (params.unreadOnly) queryParts.push('is:unread')
      if (['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM'].includes(folder)) {
        queryParts.push(`in:${folder.toLowerCase()}`)
      } else {
        queryParts.push(`label:${folder}`)
      }

      const url = new URL(`${GMAIL_API_BASE}/messages`)
      url.searchParams.append('q', queryParts.join(' '))
      url.searchParams.append('maxResults', String(maxResults))

      const listResponse = await fetch(url.toString(), { headers: authHeaders })
      if (!listResponse.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${listResponse.statusText}` }
      }

      const listData = await listResponse.json()
      const messages = listData.messages || []
      if (messages.length === 0) {
        return { success: true, output: { body: 'No messages found.', results: [] } }
      }

      const results = await Promise.all(
        messages.slice(0, maxResults).map(async (msg: Record<string, string>) => {
          const msgResp = await fetch(`${GMAIL_API_BASE}/messages/${msg.id}?format=full`, {
            headers: authHeaders,
          })
          if (!msgResp.ok) return { id: msg.id, threadId: msg.threadId }
          const detail = await msgResp.json()
          const hdrs = detail.payload?.headers || []
          return {
            id: detail.id,
            threadId: detail.threadId,
            subject: getHeader(hdrs, 'subject'),
            from: getHeader(hdrs, 'from'),
            to: getHeader(hdrs, 'to'),
            date: getHeader(hdrs, 'date'),
            snippet: detail.snippet,
          }
        })
      )

      return { success: true, output: { results } }
    },

    gmail_search: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      const query = params.query as string
      if (!query) return { success: false, output: {}, error: 'Missing required parameter: query' }

      const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      const searchParams = new URLSearchParams({ q: query })
      if (params.maxResults) searchParams.append('maxResults', String(params.maxResults))

      const response = await fetch(`${GMAIL_API_BASE}/messages?${searchParams.toString()}`, {
        headers: authHeaders,
      })
      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      if (!data.messages || data.messages.length === 0) {
        return { success: true, output: { results: [] } }
      }

      const results = await Promise.all(
        data.messages.map(async (msg: Record<string, string>) => {
          const msgResp = await fetch(`${GMAIL_API_BASE}/messages/${msg.id}?format=full`, {
            headers: authHeaders,
          })
          if (!msgResp.ok) return { id: msg.id, threadId: msg.threadId }
          const detail = await msgResp.json()
          const hdrs = detail.payload?.headers || []
          return {
            id: detail.id,
            threadId: detail.threadId,
            subject: getHeader(hdrs, 'subject'),
            from: getHeader(hdrs, 'from'),
            date: getHeader(hdrs, 'date'),
            snippet: detail.snippet,
          }
        })
      )

      return { success: true, output: { results } }
    },

    gmail_draft: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      const to = params.to as string
      const body = params.body as string
      if (!to || !body) return { success: false, output: {}, error: 'Missing required parameters: to, body' }

      const threadingHeaders = params.replyToMessageId
        ? await fetchThreadingHeaders(params.replyToMessageId as string, accessToken)
        : {}

      const rawMessage = buildSimpleEmailMessage({
        to,
        subject: (params.subject as string) || threadingHeaders.subject || '',
        body,
        contentType: (params.contentType as string) || 'text',
        cc: params.cc as string | undefined,
        bcc: params.bcc as string | undefined,
        inReplyTo: threadingHeaders.messageId,
        references: threadingHeaders.references,
      })

      const draftMessage: Record<string, unknown> = { raw: rawMessage }
      if (params.threadId) draftMessage.threadId = params.threadId

      const response = await fetch(`${GMAIL_API_BASE}/drafts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: draftMessage }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText} - ${errorText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          draftId: data.id,
          messageId: data.message?.id,
          threadId: data.message?.threadId,
          labelIds: data.message?.labelIds,
        },
      }
    },

    gmail_delete: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/trash`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_archive: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_unarchive: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['INBOX'] }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_mark_read: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_mark_unread: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      if (!accessToken || !messageId) {
        return { success: false, output: {}, error: 'Missing access token or messageId' }
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['UNREAD'] }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_move: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      const addLabelIds = params.addLabelIds as string
      if (!accessToken || !messageId || !addLabelIds) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const modifyBody: Record<string, string[]> = {}
      const addIds = parseLabelIds(addLabelIds)
      if (addIds.length > 0) modifyBody.addLabelIds = addIds
      if (params.removeLabelIds) {
        const removeIds = parseLabelIds(params.removeLabelIds as string)
        if (removeIds.length > 0) modifyBody.removeLabelIds = removeIds
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(modifyBody),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_add_label: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      const labelIds = params.labelIds as string
      if (!accessToken || !messageId || !labelIds) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: parseLabelIds(labelIds) }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },

    gmail_remove_label: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const messageId = params.messageId as string
      const labelIds = params.labelIds as string
      if (!accessToken || !messageId || !labelIds) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: parseLabelIds(labelIds) }),
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Gmail API error: ${response.statusText}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
      }
    },
  },
}

export default handler
