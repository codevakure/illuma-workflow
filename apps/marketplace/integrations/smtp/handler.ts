import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    smtp_send_mail: async (params) => {
      const host = params.host as string
      const port = Number(params.port) || 587
      const username = params.username as string
      const password = params.password as string
      const from = params.from as string
      const to = params.to as string
      const subject = params.subject as string
      const body = params.body as string

      if (!host || !username || !password || !from || !to || !subject || !body) {
        return {
          success: false,
          output: {},
          error: 'Missing required parameters: host, username, password, from, to, subject, body',
        }
      }

      try {
        const nodemailer = await import('nodemailer')

        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: {
            user: username,
            pass: password,
          },
        })

        const mailOptions: Record<string, unknown> = {
          from,
          to,
          subject,
        }

        const contentType = params.contentType as string
        if (contentType === 'html') {
          mailOptions.html = body
        } else {
          mailOptions.text = body
        }

        if (params.cc) mailOptions.cc = params.cc
        if (params.bcc) mailOptions.bcc = params.bcc
        if (params.replyTo) mailOptions.replyTo = params.replyTo

        const info = await transporter.sendMail(mailOptions)

        return {
          success: true,
          output: {
            message: 'Email sent successfully',
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
            response: info.response,
          },
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to send email via SMTP'
        return { success: false, output: {}, error: errorMessage }
      }
    },
  },
}

export default handler
