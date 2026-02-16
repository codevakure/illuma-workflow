import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    twilio_send_sms: async (params) => {
      const accountSid = params.accountSid as string
      const authToken = params.authToken as string
      const phoneNumbers = params.phoneNumbers as string
      const message = params.message as string
      const fromNumber = params.fromNumber as string

      if (!accountSid) {
        return { success: false, output: {}, error: 'Missing required parameter: accountSid' }
      }
      if (!authToken) {
        return { success: false, output: {}, error: 'Missing required parameter: authToken' }
      }
      if (!phoneNumbers) {
        return { success: false, output: {}, error: 'Missing required parameter: phoneNumbers' }
      }
      if (!message) {
        return { success: false, output: {}, error: 'Missing required parameter: message' }
      }
      if (!fromNumber) {
        return { success: false, output: {}, error: 'Missing required parameter: fromNumber' }
      }

      const toNumber = phoneNumbers.split('\n')[0].trim()

      const formData = new URLSearchParams()
      formData.append('To', toNumber)
      formData.append('From', fromNumber)
      formData.append('Body', message)

      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage =
          (errorData as Record<string, unknown>).message ||
          `Twilio API error: ${response.status}`
        return { success: false, output: {}, error: errorMessage as string }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          success: true,
          messageId: data.sid,
          status: data.status,
        },
      }
    },
  },
}

export default handler
