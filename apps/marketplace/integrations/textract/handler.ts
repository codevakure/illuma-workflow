import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    textract_parser: async (params, ctx) => {
      const accessKeyId = (params.accessKeyId as string || '').trim()
      const secretAccessKey = (params.secretAccessKey as string || '').trim()
      const region = (params.region as string || '').trim()

      if (!accessKeyId || !secretAccessKey || !region) {
        return { success: false, output: {}, error: 'Missing required AWS credentials: accessKeyId, secretAccessKey, region' }
      }

      const processingMode = (params.processingMode as string) || 'sync'
      const featureTypes = params.featureTypes as string[] | undefined
      const queries = params.queries as Array<{ Text: string; Alias?: string }> | undefined

      const service = 'textract'
      const host = `textract.${region}.amazonaws.com`
      const endpoint = `https://${host}`

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

      async function sha256(data: string | Uint8Array): Promise<string> {
        const hash = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data)
        return Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }

      const useAnalyze = featureTypes && featureTypes.length > 0
      const target = useAnalyze ? 'Textract.AnalyzeDocument' : 'Textract.DetectDocumentText'

      let documentParam: Record<string, unknown> = {}

      if (processingMode === 'async') {
        const s3Uri = (params.s3Uri as string || '').trim()
        if (!s3Uri) {
          return { success: false, output: {}, error: 'S3 URI is required for async processing' }
        }
        const s3Match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/)
        if (!s3Match) {
          return { success: false, output: {}, error: 'Invalid S3 URI format. Expected: s3://bucket/key' }
        }
        documentParam = { S3Object: { Bucket: s3Match[1], Name: s3Match[2] } }
      } else {
        const filePath = params.filePath as string | undefined
        if (filePath && filePath.trim()) {
          const fileResponse = await fetch(filePath.trim())
          if (!fileResponse.ok) {
            return { success: false, output: {}, error: `Failed to fetch document from URL: ${filePath}` }
          }
          const buffer = await fileResponse.arrayBuffer()
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
          documentParam = { Bytes: base64 }
        } else if (params.file && typeof params.file === 'object') {
          const fileObj = params.file as Record<string, unknown>
          if (ctx.downloadFile) {
            const buffer = await ctx.downloadFile(params.file)
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
            documentParam = { Bytes: base64 }
          } else if (fileObj.url) {
            const fileResponse = await fetch(fileObj.url as string)
            const buffer = await fileResponse.arrayBuffer()
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
            documentParam = { Bytes: base64 }
          } else {
            return { success: false, output: {}, error: 'Cannot process file object without download helper' }
          }
        } else {
          return { success: false, output: {}, error: 'Document is required: provide filePath URL or file object' }
        }
      }

      const requestBody: Record<string, unknown> = {
        Document: documentParam,
      }

      if (useAnalyze) {
        requestBody.FeatureTypes = featureTypes
        if (queries && queries.length > 0) {
          requestBody.QueriesConfig = { Queries: queries }
        }
      }

      const body = JSON.stringify(requestBody)
      const now = new Date()
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
      const dateStamp = amzDate.slice(0, 8)
      const payloadHash = await sha256(body)

      const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`
      const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'
      const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
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
          'Content-Type': 'application/x-amz-json-1.1',
          Host: host,
          'X-Amz-Date': amzDate,
          'X-Amz-Target': target,
          Authorization: authorization,
        },
        body,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Textract API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          blocks: data.Blocks ?? [],
          documentMetadata: {
            pages: data.DocumentMetadata?.Pages ?? 0,
          },
          modelVersion:
            data.AnalyzeDocumentModelVersion ??
            data.DetectDocumentTextModelVersion ??
            undefined,
        },
      }
    },
  },
}

export default handler
