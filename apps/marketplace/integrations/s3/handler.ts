import type { ToolHandler } from '../../sdk/types'

/**
 * Creates an S3 client from params using the AWS SDK.
 */
async function createS3Client(params: Record<string, unknown>) {
  const { S3Client } = await import('@aws-sdk/client-s3')

  const region = params.region as string
  const accessKeyId = params.accessKeyId as string
  const secretAccessKey = params.secretAccessKey as string
  const endpoint = params.endpoint as string | undefined

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint && { endpoint }),
  })
}

const handler: ToolHandler = {
  operations: {
    s3_list_objects: async (params) => {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')

      const region = params.region as string
      const accessKeyId = params.accessKeyId as string
      const secretAccessKey = params.secretAccessKey as string
      const bucket = (params.bucket || params.bucketName) as string

      if (!region || !accessKeyId || !secretAccessKey || !bucket) {
        return { success: false, output: {}, error: 'Missing required parameters: region, accessKeyId, secretAccessKey, bucket' }
      }

      const client = await createS3Client(params)

      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: (params.prefix as string) || undefined,
        MaxKeys: params.maxKeys ? Number(params.maxKeys) : 1000,
        ContinuationToken: (params.continuationToken as string) || undefined,
      })

      const result = await client.send(command)

      const objects = (result.Contents || []).map((obj) => ({
        key: obj.Key || '',
        size: obj.Size || 0,
        lastModified: obj.LastModified?.toISOString() || '',
        etag: obj.ETag || '',
      }))

      return {
        success: true,
        output: {
          objects,
          count: objects.length,
          isTruncated: result.IsTruncated || false,
          nextContinuationToken: result.NextContinuationToken,
        },
      }
    },

    s3_get_object: async (params) => {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3')

      const bucket = (params.bucket || params.bucketName) as string
      const key = params.key as string

      if (!bucket || !key) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, key' }
      }

      const client = await createS3Client(params)

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })

      const result = await client.send(command)

      if (!result.Body) {
        return { success: false, output: {}, error: 'No body returned from S3' }
      }

      const bodyBytes = await result.Body.transformToByteArray()
      const contentType = result.ContentType || 'application/octet-stream'

      // Check if it's text content
      const isText = contentType.startsWith('text/') ||
        contentType === 'application/json' ||
        contentType === 'application/xml' ||
        contentType === 'application/javascript'

      let bodyContent: string
      if (isText) {
        bodyContent = new TextDecoder().decode(bodyBytes)
      } else {
        bodyContent = Buffer.from(bodyBytes).toString('base64')
      }

      return {
        success: true,
        output: {
          body: bodyContent,
          contentType,
          contentLength: result.ContentLength || 0,
          lastModified: result.LastModified?.toISOString() || '',
          etag: result.ETag || '',
          metadata: result.Metadata || {},
        },
      }
    },

    s3_put_object: async (params) => {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3')

      const bucket = (params.bucket || params.bucketName) as string
      const key = params.key as string
      const body = params.body as string

      if (!bucket || !key || !body) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, key, body' }
      }

      const client = await createS3Client(params)

      const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(body) && body.length > 100
      const uploadBody = isBase64 ? Buffer.from(body, 'base64') : body

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: uploadBody,
        ...(params.contentType && { ContentType: params.contentType as string }),
      })

      const result = await client.send(command)

      return {
        success: true,
        output: {
          key,
          etag: result.ETag,
        },
      }
    },

    s3_delete_object: async (params) => {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')

      const bucket = (params.bucket || params.bucketName) as string
      const key = params.key as string

      if (!bucket || !key) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, key' }
      }

      const client = await createS3Client(params)

      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })

      await client.send(command)

      return {
        success: true,
        output: {},
      }
    },

    s3_copy_object: async (params) => {
      const { CopyObjectCommand } = await import('@aws-sdk/client-s3')

      const sourceBucket = params.sourceBucket as string
      const sourceKey = params.sourceKey as string
      const destBucket = params.destBucket as string
      const destKey = params.destKey as string

      if (!sourceBucket || !sourceKey || !destBucket || !destKey) {
        return { success: false, output: {}, error: 'Missing required parameters: sourceBucket, sourceKey, destBucket, destKey' }
      }

      const client = await createS3Client(params)

      const encodedSourceKey = sourceKey.split('/').map(encodeURIComponent).join('/')
      const copySource = `${sourceBucket}/${encodedSourceKey}`

      const command = new CopyObjectCommand({
        Bucket: destBucket,
        Key: destKey,
        CopySource: copySource,
      })

      await client.send(command)

      return {
        success: true,
        output: {},
      }
    },
  },
}

export default handler
