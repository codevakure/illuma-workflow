import type { ToolHandler } from '../../sdk/types'

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v22.0'

const handler: ToolHandler = {
  operations: {
    whatsapp_send_message: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const phoneNumberId = params.phoneNumberId as string
      const to = params.to as string
      const messageType = (params.messageType as string) || 'text'
      if (!phoneNumberId || !to) {
        return { success: false, output: {}, error: 'Missing required parameters: phoneNumberId, to' }
      }

      let body: Record<string, unknown>

      if (messageType === 'template') {
        const templateName = params.templateName as string
        const languageCode = (params.languageCode as string) || 'en_US'
        if (!templateName) {
          return { success: false, output: {}, error: 'Missing required parameter: templateName for template messages' }
        }

        const template: Record<string, unknown> = {
          name: templateName,
          language: { code: languageCode },
        }

        if (params.templateComponents) {
          try {
            template.components = JSON.parse(params.templateComponents as string)
          } catch {
            // ignore parse error
          }
        }

        body = {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template,
        }
      } else {
        const textBody = params.body as string
        if (!textBody) {
          return { success: false, output: {}, error: 'Missing required parameter: body for text messages' }
        }

        body = {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: {
            preview_url: params.previewUrl === true || params.previewUrl === 'true',
            body: textBody,
          },
        }
      }

      const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const error = errorData as Record<string, Record<string, string>>
        return {
          success: false,
          output: {},
          error: error.error?.message || `WhatsApp API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          message: 'Message sent successfully',
          messaging_product: data.messaging_product,
          contacts: data.contacts,
          messages: data.messages,
        },
      }
    },
  },
}

export default handler
