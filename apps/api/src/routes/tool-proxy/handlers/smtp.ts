import { createLogger } from '@sim/logger'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SmtpProxyHandler')

/**
 * Sends an email via SMTP using nodemailer, with optional file attachments.
 */
const handleSend: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    host: z.string().min(1, 'SMTP host is required'),
    port: z.coerce.number().min(1).max(65535, 'Port must be between 1 and 65535'),
    username: z.string().min(1, 'SMTP username is required'),
    password: z.string().min(1, 'SMTP password is required'),
    secure: z.enum(['TLS', 'SSL', 'None']).optional().nullable(),
    from: z.string().min(1, 'From address is required'),
    fromName: z.string().optional().nullable(),
    to: z.string().min(1, 'To email is required'),
    subject: z.string().min(1, 'Subject is required'),
    text: z.string().optional().nullable(),
    html: z.string().optional().nullable(),
    cc: z.string().optional().nullable(),
    bcc: z.string().optional().nullable(),
    replyTo: z.string().optional().nullable(),
    contentType: z.enum(['text', 'html']).optional().nullable(),
    file: RawFileInputArraySchema.optional().nullable(),
  })

  const validated = schema.parse(body)
  const secureMode = validated.secure || 'TLS'

  logger.info(`[${requestId}] Sending email via SMTP`, {
    host: validated.host,
    port: validated.port,
    to: validated.to,
    subject: validated.subject,
    secure: secureMode,
  })

  const transporter = nodemailer.createTransport({
    host: validated.host,
    port: validated.port,
    secure: secureMode === 'SSL',
    auth: {
      user: validated.username,
      pass: validated.password,
    },
    tls:
      secureMode === 'None'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true },
  })

  const fromAddress = validated.fromName
    ? `"${validated.fromName}" <${validated.from}>`
    : validated.from

  const mailOptions: nodemailer.SendMailOptions = {
    from: fromAddress,
    to: validated.to,
    subject: validated.subject,
  }

  if (validated.html) {
    mailOptions.html = validated.html
  } else if (validated.text) {
    mailOptions.text = validated.text
  } else if (validated.contentType === 'html') {
    mailOptions.html = ''
  }

  if (validated.cc) {
    mailOptions.cc = validated.cc
  }
  if (validated.bcc) {
    mailOptions.bcc = validated.bcc
  }
  if (validated.replyTo) {
    mailOptions.replyTo = validated.replyTo
  }

  if (validated.file && validated.file.length > 0) {
    logger.info(`[${requestId}] Processing ${validated.file.length} attachment(s)`)
    const userFiles = processFilesToUserFiles(validated.file, requestId, logger)

    if (userFiles.length > 0) {
      const totalSize = userFiles.reduce((sum, file) => sum + file.size, 0)
      const maxSize = 25 * 1024 * 1024

      if (totalSize > maxSize) {
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(2)
        return {
          success: false,
          output: {},
          error: `Total attachment size (${sizeMB}MB) exceeds SMTP limit of 25MB`,
        }
      }

      const attachmentBuffers = await Promise.all(
        userFiles.map(async (file) => {
          logger.info(
            `[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`
          )
          const buffer = await downloadFileFromStorage(file, requestId, logger)

          return {
            filename: file.name,
            content: buffer,
            contentType: file.type || 'application/octet-stream',
          }
        })
      )

      logger.info(`[${requestId}] Processed ${attachmentBuffers.length} attachment(s)`)
      mailOptions.attachments = attachmentBuffers
    }
  }

  try {
    const result = await transporter.sendMail(mailOptions)

    logger.info(`[${requestId}] Email sent successfully via SMTP`, {
      messageId: result.messageId,
      to: validated.to,
    })

    return {
      success: true,
      output: {
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      },
    }
  } catch (error: unknown) {
    const isNodeError = (err: unknown): err is NodeJS.ErrnoException => {
      return err instanceof Error && 'code' in err
    }

    let errorMessage = 'Failed to send email via SMTP'

    if (isNodeError(error)) {
      if (error.code === 'EAUTH') {
        errorMessage = 'SMTP authentication failed - check username and password'
      } else if (error.code === 'ECONNECTION' || error.code === 'ECONNREFUSED') {
        errorMessage = 'Could not connect to SMTP server - check host and port'
      } else if (error.code === 'ECONNRESET') {
        errorMessage = 'Connection was reset by SMTP server'
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'SMTP server connection timeout'
      }
    }

    const hasResponseCode = (err: unknown): err is { responseCode: number } => {
      return typeof err === 'object' && err !== null && 'responseCode' in err
    }

    if (hasResponseCode(error)) {
      if (error.responseCode >= 500) {
        errorMessage = 'SMTP server error - please try again later'
      } else if (error.responseCode >= 400) {
        errorMessage = 'Email rejected by SMTP server - check recipient addresses'
      }
    }

    logger.error(`[${requestId}] Error sending email via SMTP:`, {
      error: error instanceof Error ? error.message : String(error),
      code: isNodeError(error) ? error.code : undefined,
      responseCode: hasResponseCode(error) ? error.responseCode : undefined,
    })

    return { success: false, output: {}, error: errorMessage }
  }
}

export const smtpHandlers: Record<string, ToolProxyHandler> = {
  'send': handleSend,
}
