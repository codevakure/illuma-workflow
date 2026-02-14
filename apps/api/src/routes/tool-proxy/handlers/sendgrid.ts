import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SendGridProxyHandler')

/**
 * Sends an email via SendGrid, with optional file attachments.
 */
const handleSendMail: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    apiKey: z.string().min(1, 'API key is required'),
    to: z.string().min(1, 'To email is required'),
    toName: z.string().optional().nullable(),
    from: z.string().min(1, 'From email is required'),
    fromName: z.string().optional().nullable(),
    subject: z.string().optional().nullable(),
    text: z.string().optional().nullable(),
    html: z.string().optional().nullable(),
    content: z.string().optional().nullable(),
    contentType: z.string().optional().nullable(),
    cc: z.string().optional().nullable(),
    bcc: z.string().optional().nullable(),
    replyTo: z.string().optional().nullable(),
    replyToName: z.string().optional().nullable(),
    templateId: z.string().optional().nullable(),
    dynamicTemplateData: z.any().optional().nullable(),
    file: RawFileInputArraySchema.optional().nullable(),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Sending SendGrid email`, {
    to: validated.to,
    subject: validated.subject || '(template)',
    hasAttachments: !!(validated.file && validated.file.length > 0),
    attachmentCount: validated.file?.length || 0,
  })

  const personalizations: Record<string, unknown> = {
    to: [
      {
        email: validated.to,
        ...(validated.toName && { name: validated.toName }),
      },
    ],
  }

  if (validated.cc) {
    personalizations.cc = [{ email: validated.cc }]
  }

  if (validated.bcc) {
    personalizations.bcc = [{ email: validated.bcc }]
  }

  if (validated.templateId && validated.dynamicTemplateData) {
    personalizations.dynamic_template_data =
      typeof validated.dynamicTemplateData === 'string'
        ? JSON.parse(validated.dynamicTemplateData)
        : validated.dynamicTemplateData
  }

  const mailBody: Record<string, unknown> = {
    personalizations: [personalizations],
    from: {
      email: validated.from,
      ...(validated.fromName && { name: validated.fromName }),
    },
    subject: validated.subject,
  }

  if (validated.templateId) {
    mailBody.template_id = validated.templateId
  } else {
    const contentValue = validated.html || validated.text || validated.content || ''
    const contentTypeValue = validated.html
      ? 'text/html'
      : (validated.contentType || 'text/plain')
    mailBody.content = [
      {
        type: contentTypeValue,
        value: contentValue,
      },
    ]
  }

  if (validated.replyTo) {
    mailBody.reply_to = {
      email: validated.replyTo,
      ...(validated.replyToName && { name: validated.replyToName }),
    }
  }

  if (validated.file && validated.file.length > 0) {
    logger.info(`[${requestId}] Processing ${validated.file.length} attachment(s)`)
    const userFiles = processFilesToUserFiles(validated.file, requestId, logger)

    if (userFiles.length > 0) {
      const sendGridAttachments = await Promise.all(
        userFiles.map(async (file) => {
          logger.info(
            `[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`
          )
          const buffer = await downloadFileFromStorage(file, requestId, logger)

          return {
            content: buffer.toString('base64'),
            filename: file.name,
            type: file.type || 'application/octet-stream',
            disposition: 'attachment',
          }
        })
      )

      mailBody.attachments = sendGridAttachments
    }
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mailBody),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData.errors?.[0]?.message || errorData.message || 'Failed to send email'
    logger.error(`[${requestId}] SendGrid API error:`, { status: response.status, errorData })
    return { success: false, output: {}, error: errorMessage }
  }

  const messageId = response.headers.get('X-Message-Id')
  logger.info(`[${requestId}] Email sent successfully`, { messageId })

  return {
    success: true,
    output: {
      success: true,
      messageId: messageId || undefined,
      to: validated.to,
      subject: validated.subject || '',
    },
  }
}

export const sendgridHandlers: Record<string, ToolProxyHandler> = {
  'send-mail': handleSendMail,
}
