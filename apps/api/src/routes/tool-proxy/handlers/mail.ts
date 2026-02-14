import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MailProxyHandler')

/**
 * Sends an email via the Mailgun API.
 */
const handleSend: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    apiKey: z.string().min(1, 'API key is required'),
    domain: z.string().min(1, 'Domain is required'),
    from: z.string().min(1, 'From address is required'),
    to: z.string().min(1, 'To email is required'),
    subject: z.string().min(1, 'Subject is required'),
    text: z.string().optional().nullable(),
    html: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Sending email via Mailgun`, {
    to: validated.to,
    subject: validated.subject,
    domain: validated.domain,
  })

  const formData = new FormData()
  formData.append('from', validated.from)
  formData.append('to', validated.to)
  formData.append('subject', validated.subject)

  if (validated.html) {
    formData.append('html', validated.html)
  }
  if (validated.text) {
    formData.append('text', validated.text)
  }

  const credentials = Buffer.from(`api:${validated.apiKey}`).toString('base64')

  const response = await fetch(
    `https://api.mailgun.net/v3/${validated.domain}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      body: formData,
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Mailgun API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.message || 'Failed to send email via Mailgun',
    }
  }

  const data = await response.json()
  logger.info(`[${requestId}] Email sent successfully via Mailgun`, { id: data.id })

  return {
    success: true,
    output: {
      id: data.id,
      message: data.message,
    },
  }
}

export const mailHandlers: Record<string, ToolProxyHandler> = {
  'send': handleSend,
}
