import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import {
  base64UrlEncode,
  buildMimeMessage,
  buildSimpleEmailMessage,
  fetchThreadingHeaders,
  GMAIL_API_BASE,
} from '@/tools/gmail/utils'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('GmailProxyHandler')

/**
 * Build an RFC 2822 MIME message and return it as a base64url-encoded string.
 * If files are present, the message uses multipart/mixed with base64-encoded attachments.
 */
function buildMimeMessageEncoded(options: {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  inReplyTo?: string
  references?: string
  isHtml?: boolean
  files?: Array<{ name: string; mimeType: string; content: Buffer }>
}): string {
  const { to, subject, body, cc, bcc, inReplyTo, references, isHtml, files } = options
  const contentType = isHtml ? 'html' : 'text'

  if (files && files.length > 0) {
    const mimeMessage = buildMimeMessage({
      to,
      cc,
      bcc,
      subject,
      body,
      contentType,
      inReplyTo,
      references,
      attachments: files.map((f) => ({
        filename: f.name,
        mimeType: f.mimeType,
        content: f.content,
      })),
    })
    return base64UrlEncode(mimeMessage)
  }

  return buildSimpleEmailMessage({
    to,
    cc,
    bcc,
    subject,
    body,
    contentType,
    inReplyTo,
    references,
  })
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GmailSendSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  to: z.string().min(1, 'Recipient email is required'),
  subject: z.string().optional().nullable(),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  threadId: z.string().optional().nullable(),
  replyToMessageId: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  isHtml: z.boolean().optional().nullable(),
  file: z.union([RawFileInputArraySchema, z.any()]).optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

const GmailMessageIdSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  messageId: z.string().min(1, 'Message ID is required'),
})

const GmailLabelCreateSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  labelName: z.string().min(1, 'Label name is required'),
  labelListVisibility: z.string().optional().default('labelShow'),
  messageListVisibility: z.string().optional().default('show'),
})

const GmailLabelsListSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
})

const GmailLabelModifySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  labelIds: z.string().min(1, 'At least one label ID is required'),
})

const GmailMoveSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  addLabelIds: z.string().min(1, 'At least one label to add is required'),
  removeLabelIds: z.string().optional().nullable(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a comma-separated label string into an array of trimmed, non-empty IDs
 */
function parseLabelIds(labelIds: string): string[] {
  return labelIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

/**
 * Process file attachments from the request body, downloading each from storage
 */
async function processAttachments(
  rawFiles: unknown[],
  requestId: string
): Promise<Array<{ name: string; mimeType: string; content: Buffer }>> {
  const userFiles = processFilesToUserFiles(rawFiles as any, requestId, logger)

  if (userFiles.length === 0) {
    logger.warn(`[${requestId}] No valid attachments found after processing`)
    return []
  }

  const totalSize = userFiles.reduce((sum, file) => sum + file.size, 0)
  const maxSize = 25 * 1024 * 1024

  if (totalSize > maxSize) {
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2)
    throw new Error(`Total attachment size (${sizeMB}MB) exceeds Gmail's limit of 25MB`)
  }

  return Promise.all(
    userFiles.map(async (file) => {
      logger.info(`[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`)
      const buffer = await downloadFileFromStorage(file, requestId, logger)
      return {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: buffer,
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Send an email via the Gmail API, optionally with file attachments.
 */
const handleSend: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailSendSchema.parse(body)

    const rawAttachments = validatedData.file || validatedData.attachments
    const hasAttachments = Array.isArray(rawAttachments) && rawAttachments.length > 0

    logger.info(`[${requestId}] Sending Gmail email`, {
      to: validatedData.to,
      subject: validatedData.subject || '',
      hasAttachments,
      attachmentCount: hasAttachments ? rawAttachments.length : 0,
    })

    const threadingHeaders = validatedData.replyToMessageId
      ? await fetchThreadingHeaders(validatedData.replyToMessageId, validatedData.accessToken)
      : {}

    const originalMessageId = threadingHeaders.messageId
    const originalReferences = threadingHeaders.references
    const originalSubject = threadingHeaders.subject

    let files: Array<{ name: string; mimeType: string; content: Buffer }> | undefined

    if (hasAttachments) {
      logger.info(`[${requestId}] Processing ${rawAttachments.length} attachment(s)`)
      files = await processAttachments(rawAttachments, requestId)
      if (files.length > 0) {
        logger.info(`[${requestId}] Prepared ${files.length} attachment(s) for MIME message`)
      }
    }

    const isHtml =
      validatedData.isHtml === true || validatedData.contentType === 'html' || false

    const rawMessage = buildMimeMessageEncoded({
      to: validatedData.to,
      subject: validatedData.subject || originalSubject || '',
      body: validatedData.body,
      cc: validatedData.cc ?? undefined,
      bcc: validatedData.bcc ?? undefined,
      inReplyTo: originalMessageId,
      references: originalReferences,
      isHtml,
      files: files && files.length > 0 ? files : undefined,
    })

    const requestBody: { raw: string; threadId?: string } = { raw: rawMessage }
    if (validatedData.threadId) {
      requestBody.threadId = validatedData.threadId
    }

    const gmailResponse = await fetch(`${GMAIL_API_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Email sent successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error sending Gmail email:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Create a draft email via the Gmail API, optionally with file attachments.
 */
const handleDraft: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailSendSchema.parse(body)

    const rawAttachments = validatedData.file || validatedData.attachments
    const hasAttachments = Array.isArray(rawAttachments) && rawAttachments.length > 0

    logger.info(`[${requestId}] Creating Gmail draft`, {
      to: validatedData.to,
      subject: validatedData.subject || '',
      hasAttachments,
      attachmentCount: hasAttachments ? rawAttachments.length : 0,
    })

    const threadingHeaders = validatedData.replyToMessageId
      ? await fetchThreadingHeaders(validatedData.replyToMessageId, validatedData.accessToken)
      : {}

    const originalMessageId = threadingHeaders.messageId
    const originalReferences = threadingHeaders.references
    const originalSubject = threadingHeaders.subject

    let files: Array<{ name: string; mimeType: string; content: Buffer }> | undefined

    if (hasAttachments) {
      logger.info(`[${requestId}] Processing ${rawAttachments.length} attachment(s)`)
      files = await processAttachments(rawAttachments, requestId)
      if (files.length > 0) {
        logger.info(`[${requestId}] Prepared ${files.length} attachment(s) for MIME message`)
      }
    }

    const isHtml =
      validatedData.isHtml === true || validatedData.contentType === 'html' || false

    const rawMessage = buildMimeMessageEncoded({
      to: validatedData.to,
      subject: validatedData.subject || originalSubject || '',
      body: validatedData.body,
      cc: validatedData.cc ?? undefined,
      bcc: validatedData.bcc ?? undefined,
      inReplyTo: originalMessageId,
      references: originalReferences,
      isHtml,
      files: files && files.length > 0 ? files : undefined,
    })

    const draftMessage: { raw: string; threadId?: string } = { raw: rawMessage }
    if (validatedData.threadId) {
      draftMessage.threadId = validatedData.threadId
    }

    const gmailResponse = await fetch(`${GMAIL_API_BASE}/drafts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: draftMessage }),
    })

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Draft created successfully`, { draftId: data.id })

    return {
      success: true,
      output: {
        draftId: data.id,
        messageId: data.message?.id,
        threadId: data.message?.threadId,
        labelIds: data.message?.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error creating Gmail draft:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Delete (trash) a Gmail message.
 */
const handleDelete: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailMessageIdSchema.parse(body)

    logger.info(`[${requestId}] Deleting Gmail email`, { messageId: validatedData.messageId })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/trash`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Email deleted successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error deleting Gmail email:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Archive a Gmail message by removing the INBOX label.
 */
const handleArchive: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailMessageIdSchema.parse(body)

    logger.info(`[${requestId}] Archiving Gmail email`, { messageId: validatedData.messageId })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Email archived successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error archiving Gmail email:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Unarchive a Gmail message by adding the INBOX label.
 */
const handleUnarchive: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailMessageIdSchema.parse(body)

    logger.info(`[${requestId}] Unarchiving Gmail email`, { messageId: validatedData.messageId })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ addLabelIds: ['INBOX'] }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Email unarchived successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error unarchiving Gmail email:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Create a new Gmail label.
 */
const handleLabel: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailLabelCreateSchema.parse(body)

    logger.info(`[${requestId}] Creating Gmail label`, { labelName: validatedData.labelName })

    const gmailResponse = await fetch(`${GMAIL_API_BASE}/labels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: validatedData.labelName,
        labelListVisibility: validatedData.labelListVisibility,
        messageListVisibility: validatedData.messageListVisibility,
      }),
    })

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Label created successfully`, { labelId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        type: data.type,
        labelListVisibility: data.labelListVisibility,
        messageListVisibility: data.messageListVisibility,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error creating Gmail label:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * List all Gmail labels for the authenticated user.
 */
const handleLabels: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailLabelsListSchema.parse(body)

    logger.info(`[${requestId}] Fetching Gmail labels`)

    const gmailResponse = await fetch(`${GMAIL_API_BASE}/labels`, {
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
    })

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()

    if (!Array.isArray(data.labels)) {
      logger.error(`[${requestId}] Unexpected labels response structure:`, data)
      return { success: false, output: {}, error: 'Invalid labels response from Gmail API' }
    }

    const labels = data.labels.map(
      (label: { id: string; name: string; type: string; messagesTotal?: number; messagesUnread?: number }) => ({
        id: label.id,
        name: label.type === 'system'
          ? label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase()
          : label.name,
        type: label.type,
        messagesTotal: label.messagesTotal || 0,
        messagesUnread: label.messagesUnread || 0,
      })
    )

    logger.info(`[${requestId}] Fetched ${labels.length} labels`)

    return {
      success: true,
      output: { labels },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error fetching Gmail labels:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Add label(s) to a Gmail message.
 */
const handleAddLabel: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailLabelModifySchema.parse(body)
    const labelIds = parseLabelIds(validatedData.labelIds)

    logger.info(`[${requestId}] Adding label(s) to Gmail email`, {
      messageId: validatedData.messageId,
      labelIds,
    })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ addLabelIds: labelIds }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Label(s) added successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error adding label to Gmail email:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Remove label(s) from a Gmail message.
 */
const handleRemoveLabel: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailLabelModifySchema.parse(body)
    const labelIds = parseLabelIds(validatedData.labelIds)

    logger.info(`[${requestId}] Removing label(s) from Gmail email`, {
      messageId: validatedData.messageId,
      labelIds,
    })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ removeLabelIds: labelIds }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Label(s) removed successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error removing label from Gmail email:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Mark a Gmail message as read by removing the UNREAD label.
 */
const handleMarkRead: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailMessageIdSchema.parse(body)

    logger.info(`[${requestId}] Marking Gmail email as read`, {
      messageId: validatedData.messageId,
    })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Email marked as read successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error marking Gmail email as read:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Mark a Gmail message as unread by adding the UNREAD label.
 */
const handleMarkUnread: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailMessageIdSchema.parse(body)

    logger.info(`[${requestId}] Marking Gmail email as unread`, {
      messageId: validatedData.messageId,
    })

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ addLabelIds: ['UNREAD'] }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Email marked as unread successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error marking Gmail email as unread:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

/**
 * Move a Gmail message between labels/folders by adding and optionally removing labels.
 */
const handleMove: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()

  try {
    const validatedData = GmailMoveSchema.parse(body)

    const addLabelIds = parseLabelIds(validatedData.addLabelIds)
    const removeLabelIds = validatedData.removeLabelIds
      ? parseLabelIds(validatedData.removeLabelIds)
      : []

    logger.info(`[${requestId}] Moving Gmail email`, {
      messageId: validatedData.messageId,
      addLabelIds,
      removeLabelIds,
    })

    const modifyBody: { addLabelIds?: string[]; removeLabelIds?: string[] } = {}
    if (addLabelIds.length > 0) {
      modifyBody.addLabelIds = addLabelIds
    }
    if (removeLabelIds.length > 0) {
      modifyBody.removeLabelIds = removeLabelIds
    }

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${validatedData.messageId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(modifyBody),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return {
        success: false,
        output: {},
        error: `Gmail API error: ${gmailResponse.statusText}`,
      }
    }

    const data = await gmailResponse.json()
    logger.info(`[${requestId}] Email moved successfully`, { messageId: data.id })

    return {
      success: true,
      output: {
        id: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return { success: false, output: {}, error: 'Invalid request data' }
    }
    logger.error(`[${requestId}] Error moving Gmail email:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Internal server error',
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const gmailHandlers: Record<string, ToolProxyHandler> = {
  'send': handleSend,
  'draft': handleDraft,
  'delete': handleDelete,
  'archive': handleArchive,
  'unarchive': handleUnarchive,
  'label': handleLabel,
  'labels': handleLabels,
  'add-label': handleAddLabel,
  'remove-label': handleRemoveLabel,
  'mark-read': handleMarkRead,
  'mark-unread': handleMarkUnread,
  'move': handleMove,
}
