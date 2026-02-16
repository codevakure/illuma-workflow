import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    resend_send: async (params) => {
      const apiKey = params.resendApiKey as string
      const fromAddress = params.fromAddress as string
      const to = params.to as string
      const subject = params.subject as string
      const body = params.body as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: resendApiKey' }
      }
      if (!fromAddress) {
        return { success: false, output: {}, error: 'Missing required parameter: fromAddress' }
      }
      if (!to) {
        return { success: false, output: {}, error: 'Missing required parameter: to' }
      }
      if (!subject) {
        return { success: false, output: {}, error: 'Missing required parameter: subject' }
      }
      if (!body) {
        return { success: false, output: {}, error: 'Missing required parameter: body' }
      }

      const contentType = (params.contentType as string) || 'text'
      const emailBody: Record<string, unknown> = {
        from: fromAddress,
        to: [to],
        subject,
      }

      if (contentType === 'html') {
        emailBody.html = body
      } else {
        emailBody.text = body
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(emailBody),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage =
          (errorData as Record<string, unknown>).message ||
          (errorData as Record<string, unknown>).error ||
          `Resend API error: ${response.status}`
        return { success: false, output: {}, error: errorMessage as string }
      }

      return {
        success: true,
        output: {
          success: true,
          to,
          subject,
          body,
        },
      }
    },
  },
}

export default handler
