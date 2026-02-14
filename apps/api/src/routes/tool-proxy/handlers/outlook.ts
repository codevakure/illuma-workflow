import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('OutlookProxyHandler')

const OUTLOOK_API_BASE = 'https://graph.microsoft.com/v1.0/me'

/**
 * Builds the Outlook message JSON structure from validated parameters.
 */
function buildOutlookMessage(params: {
  to: string
  subject: string
  body: string
  contentType?: string | null
  cc?: string | null
  bcc?: string | null
  attachments?: Array<{
    '@odata.type': string
    name: string
    contentType: string
    contentBytes: string
  }>
}): Record<string, unknown> {
  const toRecipients = params.to.split(',').map((email) => ({
    emailAddress: { address: email.trim() },
  }))

  const ccRecipients = params.cc
    ? params.cc.split(',').map((email) => ({
        emailAddress: { address: email.trim() },
      }))
    : undefined

  const bccRecipients = params.bcc
    ? params.bcc.split(',').map((email) => ({
        emailAddress: { address: email.trim() },
      }))
    : undefined

  const message: Record<string, unknown> = {
    subject: params.subject,
    body: {
      contentType: params.contentType === 'html' ? 'HTML' : 'Text',
      content: params.body,
    },
    toRecipients,
  }

  if (ccRecipients) {
    message.ccRecipients = ccRecipients
  }

  if (bccRecipients) {
    message.bccRecipients = bccRecipients
  }

  if (params.attachments && params.attachments.length > 0) {
    message.attachments = params.attachments
  }

  return message
}

/**
 * Downloads files from storage and converts them to Outlook attachment format.
 */
async function processOutlookAttachments(
  rawAttachments: unknown[],
  requestId: string
): Promise<
  Array<{
    '@odata.type': string
    name: string
    contentType: string
    contentBytes: string
  }>
> {
  const userFiles = processFilesToUserFiles(rawAttachments as any[], requestId, logger)

  if (userFiles.length === 0) {
    return []
  }

  return Promise.all(
    userFiles.map(async (file) => {
      logger.info(`[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`)
      const buffer = await downloadFileFromStorage(file, requestId, logger)

      return {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBytes: buffer.toString('base64'),
      }
    })
  )
}

/**
 * Sends an email via Outlook (Microsoft Graph).
 */
const handleSend: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    to: z.string().min(1, 'Recipient email is required'),
    subject: z.string().min(1, 'Subject is required'),
    body: z.string().min(1, 'Email body is required'),
    cc: z.string().optional().nullable(),
    bcc: z.string().optional().nullable(),
    isHtml: z.boolean().optional().nullable(),
    contentType: z.enum(['text', 'html']).optional().nullable(),
    file: RawFileInputArraySchema.optional().nullable(),
  })

  const validated = schema.parse(body)
  const contentType = validated.isHtml ? 'html' : (validated.contentType || 'text')

  logger.info(`[${requestId}] Sending Outlook email`, {
    to: validated.to,
    subject: validated.subject,
    hasAttachments: !!(validated.file && validated.file.length > 0),
  })

  let attachments: Array<{
    '@odata.type': string
    name: string
    contentType: string
    contentBytes: string
  }> = []

  if (validated.file && validated.file.length > 0) {
    attachments = await processOutlookAttachments(validated.file, requestId)
    logger.info(`[${requestId}] Converted ${attachments.length} attachments to base64`)
  }

  const message = buildOutlookMessage({
    to: validated.to,
    subject: validated.subject,
    body: validated.body,
    contentType,
    cc: validated.cc,
    bcc: validated.bcc,
    attachments: attachments.length > 0 ? attachments : undefined,
  })

  const graphResponse = await fetch(`${OUTLOOK_API_BASE}/sendMail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify({
      message,
      saveToSentItems: true,
    }),
  })

  if (!graphResponse.ok) {
    const errorData = await graphResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to send email',
    }
  }

  logger.info(`[${requestId}] Email sent successfully`)
  return {
    success: true,
    output: {
      message: 'Email sent successfully',
      status: 'sent',
      timestamp: new Date().toISOString(),
      attachmentCount: attachments.length,
    },
  }
}

/**
 * Creates a draft email in Outlook.
 */
const handleDraft: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    to: z.string().min(1, 'Recipient email is required'),
    subject: z.string().min(1, 'Subject is required'),
    body: z.string().min(1, 'Email body is required'),
    cc: z.string().optional().nullable(),
    bcc: z.string().optional().nullable(),
    isHtml: z.boolean().optional().nullable(),
    contentType: z.enum(['text', 'html']).optional().nullable(),
    file: RawFileInputArraySchema.optional().nullable(),
  })

  const validated = schema.parse(body)
  const contentType = validated.isHtml ? 'html' : (validated.contentType || 'text')

  logger.info(`[${requestId}] Creating Outlook draft`, {
    to: validated.to,
    subject: validated.subject,
    hasAttachments: !!(validated.file && validated.file.length > 0),
  })

  let attachments: Array<{
    '@odata.type': string
    name: string
    contentType: string
    contentBytes: string
  }> = []

  if (validated.file && validated.file.length > 0) {
    attachments = await processOutlookAttachments(validated.file, requestId)
    logger.info(`[${requestId}] Converted ${attachments.length} attachments to base64`)
  }

  const message = buildOutlookMessage({
    to: validated.to,
    subject: validated.subject,
    body: validated.body,
    contentType,
    cc: validated.cc,
    bcc: validated.bcc,
    attachments: attachments.length > 0 ? attachments : undefined,
  })

  const graphResponse = await fetch(`${OUTLOOK_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validated.accessToken}`,
    },
    body: JSON.stringify(message),
  })

  if (!graphResponse.ok) {
    const errorData = await graphResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to create draft',
    }
  }

  const responseData = await graphResponse.json()
  logger.info(`[${requestId}] Draft created successfully, ID: ${responseData.id}`)

  return {
    success: true,
    output: {
      message: 'Draft created successfully',
      messageId: responseData.id,
      subject: responseData.subject,
      attachmentCount: attachments.length,
    },
  }
}

/**
 * Deletes an email in Outlook.
 */
const handleDelete: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    messageId: z.string().min(1, 'Message ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Deleting Outlook email`, {
    messageId: validated.messageId,
  })

  const graphResponse = await fetch(
    `${OUTLOOK_API_BASE}/messages/${validated.messageId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  if (!graphResponse.ok) {
    const errorData = await graphResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to delete email',
    }
  }

  logger.info(`[${requestId}] Email deleted successfully`, {
    messageId: validated.messageId,
  })

  return {
    success: true,
    output: {
      message: 'Email moved to Deleted Items successfully',
      messageId: validated.messageId,
      status: 'deleted',
    },
  }
}

/**
 * Copies an email to a destination folder in Outlook.
 */
const handleCopy: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    messageId: z.string().min(1, 'Message ID is required'),
    destinationId: z.string().min(1, 'Destination folder ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Copying Outlook email`, {
    messageId: validated.messageId,
    destinationId: validated.destinationId,
  })

  const graphResponse = await fetch(
    `${OUTLOOK_API_BASE}/messages/${validated.messageId}/copy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validated.accessToken}`,
      },
      body: JSON.stringify({
        destinationId: validated.destinationId,
      }),
    }
  )

  if (!graphResponse.ok) {
    const errorData = await graphResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to copy email',
    }
  }

  const responseData = await graphResponse.json()
  logger.info(`[${requestId}] Email copied successfully`, {
    originalMessageId: validated.messageId,
    copiedMessageId: responseData.id,
  })

  return {
    success: true,
    output: {
      message: 'Email copied successfully',
      originalMessageId: validated.messageId,
      copiedMessageId: responseData.id,
      destinationFolderId: responseData.parentFolderId,
    },
  }
}

/**
 * Moves an email to a destination folder in Outlook.
 */
const handleMove: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    messageId: z.string().min(1, 'Message ID is required'),
    destinationId: z.string().min(1, 'Destination folder ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Moving Outlook email`, {
    messageId: validated.messageId,
    destinationId: validated.destinationId,
  })

  const graphResponse = await fetch(
    `${OUTLOOK_API_BASE}/messages/${validated.messageId}/move`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validated.accessToken}`,
      },
      body: JSON.stringify({
        destinationId: validated.destinationId,
      }),
    }
  )

  if (!graphResponse.ok) {
    const errorData = await graphResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to move email',
    }
  }

  const responseData = await graphResponse.json()
  logger.info(`[${requestId}] Email moved successfully`, {
    messageId: responseData.id,
    parentFolderId: responseData.parentFolderId,
  })

  return {
    success: true,
    output: {
      message: 'Email moved successfully',
      messageId: responseData.id,
      newFolderId: responseData.parentFolderId,
    },
  }
}

/**
 * Lists mail folders in Outlook.
 */
const handleFolders: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching Outlook mail folders`)

  const response = await fetch(`${OUTLOOK_API_BASE}/mailFolders`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to retrieve folders',
    }
  }

  const data = await response.json()
  const folders = (data.value || []).map(
    (folder: {
      id: string
      displayName: string
      totalItemCount?: number
      unreadItemCount?: number
    }) => ({
      id: folder.id,
      name: folder.displayName,
      type: 'folder',
      messagesTotal: folder.totalItemCount || 0,
      messagesUnread: folder.unreadItemCount || 0,
    })
  )

  logger.info(`[${requestId}] Successfully fetched ${folders.length} folders`)
  return { success: true, output: { folders } }
}

/**
 * Marks an email as read in Outlook.
 */
const handleMarkRead: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    messageId: z.string().min(1, 'Message ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Marking Outlook email as read`, {
    messageId: validated.messageId,
  })

  const graphResponse = await fetch(
    `${OUTLOOK_API_BASE}/messages/${validated.messageId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validated.accessToken}`,
      },
      body: JSON.stringify({ isRead: true }),
    }
  )

  if (!graphResponse.ok) {
    const errorData = await graphResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to mark email as read',
    }
  }

  const responseData = await graphResponse.json()
  logger.info(`[${requestId}] Email marked as read successfully`, {
    messageId: responseData.id,
  })

  return {
    success: true,
    output: {
      message: 'Email marked as read successfully',
      messageId: responseData.id,
      isRead: responseData.isRead,
    },
  }
}

/**
 * Marks an email as unread in Outlook.
 */
const handleMarkUnread: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    messageId: z.string().min(1, 'Message ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Marking Outlook email as unread`, {
    messageId: validated.messageId,
  })

  const graphResponse = await fetch(
    `${OUTLOOK_API_BASE}/messages/${validated.messageId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validated.accessToken}`,
      },
      body: JSON.stringify({ isRead: false }),
    }
  )

  if (!graphResponse.ok) {
    const errorData = await graphResponse.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to mark email as unread',
    }
  }

  const responseData = await graphResponse.json()
  logger.info(`[${requestId}] Email marked as unread successfully`, {
    messageId: responseData.id,
  })

  return {
    success: true,
    output: {
      message: 'Email marked as unread successfully',
      messageId: responseData.id,
      isRead: responseData.isRead,
    },
  }
}

export const outlookHandlers: Record<string, ToolProxyHandler> = {
  'send': handleSend,
  'draft': handleDraft,
  'delete': handleDelete,
  'copy': handleCopy,
  'move': handleMove,
  'folders': handleFolders,
  'mark-read': handleMarkRead,
  'mark-unread': handleMarkUnread,
}
