import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    sqs_send: async (params) => {
      const region = params.region as string
      const accessKeyId = params.accessKeyId as string
      const secretAccessKey = params.secretAccessKey as string
      const queueUrl = params.queueUrl as string
      const data = params.data as Record<string, unknown>

      if (!region || !accessKeyId || !secretAccessKey || !queueUrl || !data) {
        return { success: false, output: {}, error: 'Missing required AWS SQS parameters' }
      }

      const messageBody = typeof data === 'string' ? data : JSON.stringify(data)
      const service = 'sqs'
      const host = `sqs.${region}.amazonaws.com`
      const endpoint = queueUrl

      const actionParams: Record<string, string> = {
        Action: 'SendMessage',
        MessageBody: messageBody,
        Version: '2012-11-05',
      }

      if (params.messageGroupId) {
        actionParams.MessageGroupId = params.messageGroupId as string
      }
      if (params.messageDeduplicationId) {
        actionParams.MessageDeduplicationId = params.messageDeduplicationId as string
      }

      const body = new URLSearchParams(actionParams).toString()
      const now = new Date()
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
      const dateStamp = amzDate.slice(0, 8)

      const encoder = new TextEncoder()

      async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          key instanceof ArrayBuffer ? new Uint8Array(key) : key,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        )
        return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
      }

      async function sha256(data: string): Promise<string> {
        const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data))
        return Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }

      const payloadHash = await sha256(body)
      const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzDate}\n`
      const signedHeaders = 'content-type;host;x-amz-date'
      const parsedUrl = new URL(endpoint)
      const canonicalRequest = `POST\n${parsedUrl.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`

      const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp)
      const kRegion = await hmac(kDate, region)
      const kService = await hmac(kRegion, service)
      const kSigning = await hmac(kService, 'aws4_request')
      const signatureBuffer = await hmac(kSigning, stringToSign)
      const signature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Host: host,
          'X-Amz-Date': amzDate,
          Authorization: authorization,
        },
        body,
      })

      const responseText = await response.text()

      if (!response.ok) {
        return { success: false, output: {}, error: `SQS send failed: ${response.status} ${responseText}` }
      }

      const messageIdMatch = responseText.match(/<MessageId>(.*?)<\/MessageId>/)
      const messageId = messageIdMatch ? messageIdMatch[1] : ''

      return {
        success: true,
        output: {
          message: 'SQS send message executed successfully',
          id: messageId,
        },
      }
    },
  },
}

export default handler
