import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('S3ProxyHandler')

interface S3ClientConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
}

/**
 * Creates an S3 client from the provided configuration.
 */
function createS3Client(config: S3ClientConfig): S3Client {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint && { endpoint: config.endpoint }),
  })
}

const baseSchema = z.object({
  region: z.string().min(1, 'Region is required'),
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  endpoint: z.string().optional(),
})

/**
 * Lists objects in an S3 bucket with optional prefix filtering.
 */
const handleListObjects: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    bucket: z.string().min(1, 'Bucket name is required'),
    prefix: z.string().optional().nullable(),
    maxKeys: z.number().optional().nullable().default(1000),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Listing S3 objects`, {
    bucket: params.bucket,
    prefix: params.prefix || '(none)',
    maxKeys: params.maxKeys || 1000,
  })

  const client = createS3Client(params)

  const command = new ListObjectsV2Command({
    Bucket: params.bucket,
    Prefix: params.prefix || undefined,
    MaxKeys: params.maxKeys || 1000,
  })

  const result = await client.send(command)

  const objects = (result.Contents || []).map((obj) => ({
    key: obj.Key || '',
    size: obj.Size || 0,
    lastModified: obj.LastModified?.toISOString() || '',
    etag: obj.ETag || '',
  }))

  logger.info(`[${requestId}] Listed ${objects.length} objects from bucket ${params.bucket}`)

  return {
    success: true,
    output: { objects, count: objects.length },
  }
}

/**
 * Uploads an object to an S3 bucket.
 */
const handlePutObject: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    bucket: z.string().min(1, 'Bucket name is required'),
    key: z.string().min(1, 'Object key is required'),
    body: z.string().min(1, 'Body is required'),
    contentType: z.string().optional().nullable(),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Uploading object to S3`, {
    bucket: params.bucket,
    key: params.key,
  })

  const client = createS3Client(params)

  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(params.body) && params.body.length > 100
  const uploadBody = isBase64 ? Buffer.from(params.body, 'base64') : params.body

  const command = new PutObjectCommand({
    Bucket: params.bucket,
    Key: params.key,
    Body: uploadBody,
    ...(params.contentType && { ContentType: params.contentType }),
  })

  const result = await client.send(command)

  logger.info(`[${requestId}] Object uploaded successfully`, {
    bucket: params.bucket,
    key: params.key,
    etag: result.ETag,
  })

  return {
    success: true,
    output: {
      key: params.key,
      etag: result.ETag,
    },
  }
}

/**
 * Deletes an object from an S3 bucket.
 */
const handleDeleteObject: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    bucket: z.string().min(1, 'Bucket name is required'),
    key: z.string().min(1, 'Object key is required'),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Deleting S3 object`, {
    bucket: params.bucket,
    key: params.key,
  })

  const client = createS3Client(params)

  const command = new DeleteObjectCommand({
    Bucket: params.bucket,
    Key: params.key,
  })

  await client.send(command)

  logger.info(`[${requestId}] Object deleted successfully`, {
    bucket: params.bucket,
    key: params.key,
  })

  return {
    success: true,
    output: {},
  }
}

/**
 * Copies an object between S3 buckets or within the same bucket.
 */
const handleCopyObject: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    sourceBucket: z.string().min(1, 'Source bucket name is required'),
    sourceKey: z.string().min(1, 'Source object key is required'),
    destBucket: z.string().min(1, 'Destination bucket name is required'),
    destKey: z.string().min(1, 'Destination object key is required'),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Copying S3 object`, {
    source: `${params.sourceBucket}/${params.sourceKey}`,
    destination: `${params.destBucket}/${params.destKey}`,
  })

  const client = createS3Client(params)

  const encodedSourceKey = params.sourceKey.split('/').map(encodeURIComponent).join('/')
  const copySource = `${params.sourceBucket}/${encodedSourceKey}`

  const command = new CopyObjectCommand({
    Bucket: params.destBucket,
    Key: params.destKey,
    CopySource: copySource,
  })

  await client.send(command)

  logger.info(`[${requestId}] Object copied successfully`, {
    source: `${params.sourceBucket}/${params.sourceKey}`,
    destination: `${params.destBucket}/${params.destKey}`,
  })

  return {
    success: true,
    output: {},
  }
}

export const s3Handlers: Record<string, ToolProxyHandler> = {
  'list-objects': handleListObjects,
  'put-object': handlePutObject,
  'delete-object': handleDeleteObject,
  'copy-object': handleCopyObject,
}
