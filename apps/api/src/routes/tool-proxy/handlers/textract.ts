import * as crypto from 'node:crypto'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits/types'
import { validateAwsRegion, validateS3BucketName } from '@/lib/core/security/input-validation'
import { getUserId } from '@/middleware/auth'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { isInternalFileUrl, processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  downloadFileFromUrl,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('TextractProxyHandler')

const POLL_INTERVAL_MS = 5000

const QuerySchema = z.object({
  Text: z.string().min(1),
  Alias: z.string().optional(),
  Pages: z.array(z.string()).optional(),
})

const ParseSchema = z
  .object({
    accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
    region: z.string().min(1, 'AWS region is required'),
    processingMode: z.enum(['sync', 'async']).optional().default('sync'),
    filePath: z.string().optional(),
    file: RawFileInputSchema.optional(),
    s3Uri: z.string().optional(),
    featureTypes: z
      .array(z.enum(['TABLES', 'FORMS', 'QUERIES', 'SIGNATURES', 'LAYOUT']))
      .optional(),
    queries: z.array(QuerySchema).optional(),
  })
  .superRefine((data, ctx) => {
    const regionValidation = validateAwsRegion(data.region, 'AWS region')
    if (!regionValidation.isValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: regionValidation.error,
        path: ['region'],
      })
    }
    if (data.processingMode === 'async' && !data.s3Uri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'S3 URI is required for multi-page processing (s3://bucket/key)',
        path: ['s3Uri'],
      })
    }
    if (data.processingMode !== 'async' && !data.file && !data.filePath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'File input is required for single-page processing',
        path: ['filePath'],
      })
    }
  })

/**
 * Derive the AWS SigV4 signing key.
 */
function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Buffer {
  const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest()
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest()
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest()
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest()
  return kSigning
}

/**
 * Sign an AWS API request using Signature Version 4.
 */
function signAwsRequest(
  method: string,
  host: string,
  uri: string,
  body: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  service: string,
  amzTarget: string
): Record<string, string> {
  const date = new Date()
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const payloadHash = crypto.createHash('sha256').update(body).digest('hex')

  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${amzTarget}\n`

  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'

  const canonicalRequest = `${method}\n${uri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const algorithm = 'AWS4-HMAC-SHA256'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service)
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    'Content-Type': 'application/x-amz-json-1.1',
    Host: host,
    'X-Amz-Date': amzDate,
    'X-Amz-Target': amzTarget,
    Authorization: authorizationHeader,
  }
}

/**
 * Parse an S3 URI into bucket and key, with validation.
 */
function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  const match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/)
  if (!match) {
    throw new Error(
      `Invalid S3 URI format: ${s3Uri}. Expected format: s3://bucket-name/path/to/object`
    )
  }

  const bucket = match[1]
  const key = match[2]

  const bucketValidation = validateS3BucketName(bucket, 'S3 bucket name')
  if (!bucketValidation.isValid) {
    throw new Error(bucketValidation.error)
  }

  if (key.includes('..') || key.startsWith('/')) {
    throw new Error('S3 key contains invalid path traversal sequences')
  }

  return { bucket, key }
}

/**
 * Call a Textract API action with signed request.
 */
async function callTextractApi(
  host: string,
  amzTarget: string,
  body: Record<string, unknown>,
  accessKeyId: string,
  secretAccessKey: string,
  region: string
): Promise<Record<string, unknown>> {
  const bodyString = JSON.stringify(body)
  const headers = signAwsRequest(
    'POST',
    host,
    '/',
    bodyString,
    accessKeyId,
    secretAccessKey,
    region,
    'textract',
    amzTarget
  )

  const response = await fetch(`https://${host}/`, {
    method: 'POST',
    headers,
    body: bodyString,
  })

  if (!response.ok) {
    const errorText = await response.text()
    let errorMessage = `Textract API error: ${response.statusText}`
    try {
      const errorJson = JSON.parse(errorText)
      if (errorJson.Message) {
        errorMessage = errorJson.Message
      } else if (errorJson.__type) {
        errorMessage = `${errorJson.__type}: ${errorJson.message || errorText}`
      }
    } catch {
      // Use default error message
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

/**
 * Sleep utility for polling.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll for async Textract job completion, collecting paginated results.
 */
async function pollForJobCompletion(
  host: string,
  jobId: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  useAnalyzeDocument: boolean,
  requestId: string
): Promise<Record<string, unknown>> {
  const maxPollTimeMs = DEFAULT_EXECUTION_TIMEOUT_MS
  const maxAttempts = Math.ceil(maxPollTimeMs / POLL_INTERVAL_MS)

  const getTarget = useAnalyzeDocument
    ? 'Textract.GetDocumentAnalysis'
    : 'Textract.GetDocumentTextDetection'

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await callTextractApi(
      host,
      getTarget,
      { JobId: jobId },
      accessKeyId,
      secretAccessKey,
      region
    )

    const jobStatus = result.JobStatus as string

    if (jobStatus === 'SUCCEEDED' || jobStatus === 'PARTIAL_SUCCESS') {
      if (jobStatus === 'PARTIAL_SUCCESS') {
        logger.warn(`[${requestId}] Job completed with partial success: ${result.StatusMessage}`)
      } else {
        logger.info(`[${requestId}] Async job completed successfully after ${attempt + 1} polls`)
      }

      let allBlocks = (result.Blocks as unknown[]) || []
      let nextToken = result.NextToken as string | undefined

      while (nextToken) {
        const nextResult = await callTextractApi(
          host,
          getTarget,
          { JobId: jobId, NextToken: nextToken },
          accessKeyId,
          secretAccessKey,
          region
        )
        allBlocks = allBlocks.concat((nextResult.Blocks as unknown[]) || [])
        nextToken = nextResult.NextToken as string | undefined
      }

      return {
        ...result,
        Blocks: allBlocks,
      }
    }

    if (jobStatus === 'FAILED') {
      throw new Error(`Textract job failed: ${result.StatusMessage || 'Unknown error'}`)
    }

    logger.info(`[${requestId}] Job status: ${jobStatus}, attempt ${attempt + 1}/${maxAttempts}`)
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(
    `Timeout waiting for Textract job to complete (max ${maxPollTimeMs / 1000} seconds)`
  )
}

/**
 * Parse a document using AWS Textract.
 * Supports sync (single-page) and async (multi-page via S3) processing modes,
 * feature types (TABLES, FORMS, QUERIES, SIGNATURES, LAYOUT), and query configuration.
 */
const handleParse: ToolProxyHandler = async (body, c) => {
  const requestId = generateRequestId()

  try {
    const validated = ParseSchema.parse(body)
    const userId = getUserId(c)

    const processingMode = validated.processingMode || 'sync'
    const featureTypes = validated.featureTypes ?? []
    const useAnalyzeDocument = featureTypes.length > 0
    const host = `textract.${validated.region}.amazonaws.com`

    logger.info(`[${requestId}] Textract parse request`, {
      processingMode,
      hasFile: Boolean(validated.file),
      hasS3Uri: Boolean(validated.s3Uri),
      featureTypes,
      userId,
    })

    if (processingMode === 'async') {
      if (!validated.s3Uri) {
        return {
          success: false,
          output: {},
          error: 'S3 URI is required for multi-page processing (s3://bucket/key)',
        }
      }

      const { bucket: s3Bucket, key: s3Key } = parseS3Uri(validated.s3Uri)

      logger.info(`[${requestId}] Starting async Textract job`, { s3Bucket, s3Key })

      const startTarget = useAnalyzeDocument
        ? 'Textract.StartDocumentAnalysis'
        : 'Textract.StartDocumentTextDetection'

      const startBody: Record<string, unknown> = {
        DocumentLocation: {
          S3Object: {
            Bucket: s3Bucket,
            Name: s3Key,
          },
        },
      }

      if (useAnalyzeDocument) {
        startBody.FeatureTypes = featureTypes

        if (
          validated.queries &&
          validated.queries.length > 0 &&
          featureTypes.includes('QUERIES')
        ) {
          startBody.QueriesConfig = {
            Queries: validated.queries.map((q) => ({
              Text: q.Text,
              Alias: q.Alias,
              Pages: q.Pages,
            })),
          }
        }
      }

      const startResult = await callTextractApi(
        host,
        startTarget,
        startBody,
        validated.accessKeyId,
        validated.secretAccessKey,
        validated.region
      )

      const jobId = startResult.JobId as string
      if (!jobId) {
        throw new Error('Failed to start Textract job: No JobId returned')
      }

      logger.info(`[${requestId}] Async job started`, { jobId })

      const textractData = await pollForJobCompletion(
        host,
        jobId,
        validated.accessKeyId,
        validated.secretAccessKey,
        validated.region,
        useAnalyzeDocument,
        requestId
      )

      logger.info(`[${requestId}] Textract async parse successful`, {
        pageCount: (textractData.DocumentMetadata as { Pages?: number })?.Pages ?? 0,
        blockCount: (textractData.Blocks as unknown[])?.length ?? 0,
      })

      return {
        success: true,
        output: {
          blocks: textractData.Blocks ?? [],
          documentMetadata: {
            pages: (textractData.DocumentMetadata as { Pages?: number })?.Pages ?? 0,
          },
          modelVersion: (textractData.AnalyzeDocumentModelVersion ??
            textractData.DetectDocumentTextModelVersion) as string | undefined,
        },
      }
    }

    let bytes = ''
    let isPdf = false

    if (validated.file) {
      const userFile = processSingleFileToUserFile(validated.file, requestId, logger)
      const buffer = await downloadFileFromStorage(userFile, requestId, logger)
      bytes = buffer.toString('base64')
      const contentType = userFile.type || 'application/octet-stream'
      isPdf = contentType.includes('pdf') || (userFile.name?.toLowerCase().endsWith('.pdf') ?? false)
    } else if (validated.filePath) {
      let fileUrl = validated.filePath

      if (isInternalFileUrl(fileUrl)) {
        const resolution = await resolveInternalFileUrl(fileUrl, userId, requestId, logger)
        if (resolution.error) {
          return {
            success: false,
            output: {},
            error: resolution.error.message,
          }
        }
        fileUrl = resolution.fileUrl || fileUrl
      } else if (fileUrl.startsWith('/')) {
        logger.warn(`[${requestId}] Invalid internal path`, {
          userId,
          path: fileUrl.substring(0, 50),
        })
        return {
          success: false,
          output: {},
          error: 'Invalid file path. Only uploaded files are supported for internal paths.',
        }
      }

      const buffer = await downloadFileFromUrl(fileUrl)
      bytes = buffer.toString('base64')
      isPdf = fileUrl.toLowerCase().endsWith('.pdf')
    } else {
      return {
        success: false,
        output: {},
        error: 'File input is required for single-page processing',
      }
    }

    let textractBody: Record<string, unknown>
    let amzTarget: string

    if (useAnalyzeDocument) {
      amzTarget = 'Textract.AnalyzeDocument'
      textractBody = {
        Document: {
          Bytes: bytes,
        },
        FeatureTypes: featureTypes,
      }

      if (
        validated.queries &&
        validated.queries.length > 0 &&
        featureTypes.includes('QUERIES')
      ) {
        textractBody.QueriesConfig = {
          Queries: validated.queries.map((q) => ({
            Text: q.Text,
            Alias: q.Alias,
            Pages: q.Pages,
          })),
        }
      }
    } else {
      amzTarget = 'Textract.DetectDocumentText'
      textractBody = {
        Document: {
          Bytes: bytes,
        },
      }
    }

    const bodyString = JSON.stringify(textractBody)

    const headers = signAwsRequest(
      'POST',
      host,
      '/',
      bodyString,
      validated.accessKeyId,
      validated.secretAccessKey,
      validated.region,
      'textract',
      amzTarget
    )

    const textractResponse = await fetch(`https://${host}/`, {
      method: 'POST',
      headers,
      body: bodyString,
    })

    if (!textractResponse.ok) {
      const errorText = await textractResponse.text()
      logger.error(`[${requestId}] Textract API error:`, errorText)

      let errorMessage = `Textract API error: ${textractResponse.statusText}`
      let isUnsupportedFormat = false
      try {
        const errorJson = JSON.parse(errorText)
        if (errorJson.Message) {
          errorMessage = errorJson.Message
        } else if (errorJson.__type) {
          errorMessage = `${errorJson.__type}: ${errorJson.message || errorText}`
        }
        isUnsupportedFormat =
          errorJson.__type === 'UnsupportedDocumentException' ||
          errorJson.Message?.toLowerCase().includes('unsupported document') ||
          errorText.toLowerCase().includes('unsupported document')
      } catch {
        isUnsupportedFormat = errorText.toLowerCase().includes('unsupported document')
      }

      if (isUnsupportedFormat && isPdf) {
        errorMessage =
          'This document format is not supported in Single Page mode. If this is a multi-page PDF, please use "Multi-Page (PDF, TIFF via S3)" mode instead, which requires uploading your document to S3 first. Single Page mode only supports JPEG, PNG, and single-page PDF files.'
      }

      return {
        success: false,
        output: {},
        error: errorMessage,
      }
    }

    const textractData = await textractResponse.json()

    logger.info(`[${requestId}] Textract parse successful`, {
      pageCount: textractData.DocumentMetadata?.Pages ?? 0,
      blockCount: textractData.Blocks?.length ?? 0,
    })

    return {
      success: true,
      output: {
        blocks: textractData.Blocks ?? [],
        documentMetadata: {
          pages: textractData.DocumentMetadata?.Pages ?? 0,
        },
        modelVersion:
          textractData.AnalyzeDocumentModelVersion ??
          textractData.DetectDocumentTextModelVersion ??
          undefined,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return {
        success: false,
        output: {},
        error: 'Invalid request data',
      }
    }

    logger.error(`[${requestId}] Error in Textract parse:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to parse document with Textract',
    }
  }
}

export const textractHandlers: Record<string, ToolProxyHandler> = {
  parse: handleParse,
}
