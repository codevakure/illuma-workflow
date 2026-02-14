import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SmsProxyHandler')

/**
 * Sends an SMS via the Twilio API.
 */
const handleSend: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accountSid: z.string().min(1, 'Account SID is required'),
    authToken: z.string().min(1, 'Auth token is required'),
    from: z.string().min(1, 'From phone number is required'),
    to: z.string().min(1, 'To phone number is required'),
    body: z.string().min(1, 'SMS body is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Sending SMS via Twilio`, {
    to: validated.to,
    from: validated.from,
    bodyLength: validated.body.length,
  })

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${validated.accountSid}/Messages.json`

  const formBody = new URLSearchParams({
    From: validated.from,
    To: validated.to,
    Body: validated.body,
  })

  const credentials = Buffer.from(
    `${validated.accountSid}:${validated.authToken}`
  ).toString('base64')

  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: formBody.toString(),
  })

  const data = await response.json()

  if (!response.ok) {
    logger.error(`[${requestId}] Twilio API error:`, data)
    return {
      success: false,
      output: {},
      error: data.message || 'Failed to send SMS',
    }
  }

  logger.info(`[${requestId}] SMS sent successfully`, {
    sid: data.sid,
    status: data.status,
  })

  return {
    success: true,
    output: {
      sid: data.sid,
      status: data.status,
      to: data.to,
      from: data.from,
    },
  }
}

export const smsHandlers: Record<string, ToolProxyHandler> = {
  'send': handleSend,
}
