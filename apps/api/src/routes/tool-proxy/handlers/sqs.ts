import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SQSProxyHandler')

/**
 * Creates an SQS client from the provided configuration.
 */
function createSqsClient(config: {
  region: string
  accessKeyId: string
  secretAccessKey: string
}): SQSClient {
  return new SQSClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/**
 * Sends a message to an SQS queue, with optional FIFO queue parameters.
 */
const handleSend: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    region: z.string().min(1, 'AWS region is required'),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    queueUrl: z.string().min(1, 'Queue URL is required'),
    messageBody: z.union([z.string(), z.record(z.unknown())]),
    delaySeconds: z.number().optional(),
    messageGroupId: z.string().optional().nullable(),
    messageDeduplicationId: z.string().optional().nullable(),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Sending message to SQS queue`, { queueUrl: params.queueUrl })

  const client = createSqsClient(params)

  try {
    const messageBody =
      typeof params.messageBody === 'string'
        ? params.messageBody
        : JSON.stringify(params.messageBody)

    const command = new SendMessageCommand({
      QueueUrl: params.queueUrl,
      MessageBody: messageBody,
      ...(params.delaySeconds !== undefined && { DelaySeconds: params.delaySeconds }),
      ...(params.messageGroupId && { MessageGroupId: params.messageGroupId }),
      ...(params.messageDeduplicationId && {
        MessageDeduplicationId: params.messageDeduplicationId,
      }),
    })

    const response = await client.send(command)

    logger.info(`[${requestId}] Message sent successfully`, {
      messageId: response.MessageId,
    })

    return {
      success: true,
      output: {
        messageId: response.MessageId,
        sequenceNumber: response.SequenceNumber,
      },
    }
  } finally {
    client.destroy()
  }
}

export const sqsHandlers: Record<string, ToolProxyHandler> = {
  'send': handleSend,
}
