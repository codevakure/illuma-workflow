import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('A2AHandler')

const SendMessageSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  message: z.object({
    role: z.string(),
    parts: z.array(z.record(z.unknown())),
  }),
})

const TaskIdSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  taskId: z.string().min(1, 'Task ID is required'),
})

const AgentUrlSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
})

const SetPushNotificationSchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  taskId: z.string().min(1, 'Task ID is required'),
  pushNotificationConfig: z.record(z.unknown()),
})

/**
 * Send a JSON-RPC request to the A2A agent endpoint.
 */
async function sendJsonRpc(
  agentUrl: string,
  method: string,
  params: Record<string, unknown>,
  requestId: string
): Promise<Record<string, unknown>> {
  const response = await fetch(agentUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`A2A agent returned ${response.status}: ${errorText}`)
  }

  const data = await response.json()

  if (data.error) {
    throw new Error(
      `A2A JSON-RPC error: ${data.error.message || JSON.stringify(data.error)}`
    )
  }

  return data.result ?? data
}

/**
 * Send a message to an A2A agent via JSON-RPC tasks/send.
 */
const handleSendMessage: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = SendMessageSchema.parse(body)

    logger.info(`[${requestId}] Sending A2A message`, {
      agentUrl: validated.agentUrl,
    })

    const result = await sendJsonRpc(
      validated.agentUrl,
      'tasks/send',
      { message: validated.message },
      requestId
    )

    logger.info(`[${requestId}] A2A message sent successfully`)

    return {
      success: true,
      output: { result },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error sending A2A message:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to send A2A message',
    }
  }
}

/**
 * Get an A2A task by ID via JSON-RPC tasks/get.
 */
const handleGetTask: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = TaskIdSchema.parse(body)

    logger.info(`[${requestId}] Getting A2A task`, {
      agentUrl: validated.agentUrl,
      taskId: validated.taskId,
    })

    const result = await sendJsonRpc(
      validated.agentUrl,
      'tasks/get',
      { id: validated.taskId },
      requestId
    )

    logger.info(`[${requestId}] A2A task retrieved successfully`)

    return {
      success: true,
      output: { task: result },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error getting A2A task:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to get A2A task',
    }
  }
}

/**
 * Cancel an A2A task via JSON-RPC tasks/cancel.
 */
const handleCancelTask: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = TaskIdSchema.parse(body)

    logger.info(`[${requestId}] Canceling A2A task`, {
      agentUrl: validated.agentUrl,
      taskId: validated.taskId,
    })

    const result = await sendJsonRpc(
      validated.agentUrl,
      'tasks/cancel',
      { id: validated.taskId },
      requestId
    )

    logger.info(`[${requestId}] A2A task canceled successfully`)

    return {
      success: true,
      output: { result },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error canceling A2A task:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to cancel A2A task',
    }
  }
}

/**
 * Fetch the agent card from the .well-known endpoint.
 */
const handleGetAgentCard: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = AgentUrlSchema.parse(body)

    const agentCardUrl = validated.agentUrl.replace(/\/$/, '') + '/.well-known/agent.json'

    logger.info(`[${requestId}] Fetching A2A agent card`, {
      url: agentCardUrl,
    })

    const response = await fetch(agentCardUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Failed to fetch agent card: ${response.status} ${errorText}`)
    }

    const agentCard = await response.json()

    logger.info(`[${requestId}] Agent card fetched successfully`, {
      name: agentCard.name,
    })

    return {
      success: true,
      output: { agentCard },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching agent card:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch agent card',
    }
  }
}

/**
 * Get push notification config for an A2A task.
 */
const handleGetPushNotification: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = TaskIdSchema.parse(body)

    logger.info(`[${requestId}] Getting A2A push notification config`, {
      agentUrl: validated.agentUrl,
      taskId: validated.taskId,
    })

    const result = await sendJsonRpc(
      validated.agentUrl,
      'tasks/pushNotification/get',
      { id: validated.taskId },
      requestId
    )

    logger.info(`[${requestId}] Push notification config retrieved successfully`)

    return {
      success: true,
      output: { config: result },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error getting push notification config:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to get push notification config',
    }
  }
}

/**
 * Set push notification config for an A2A task.
 */
const handleSetPushNotification: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = SetPushNotificationSchema.parse(body)

    logger.info(`[${requestId}] Setting A2A push notification config`, {
      agentUrl: validated.agentUrl,
      taskId: validated.taskId,
    })

    const result = await sendJsonRpc(
      validated.agentUrl,
      'tasks/pushNotification/set',
      {
        id: validated.taskId,
        pushNotificationConfig: validated.pushNotificationConfig,
      },
      requestId
    )

    logger.info(`[${requestId}] Push notification config set successfully`)

    return {
      success: true,
      output: { result },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error setting push notification config:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to set push notification config',
    }
  }
}

/**
 * Delete push notification config for an A2A task.
 */
const handleDeletePushNotification: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = TaskIdSchema.parse(body)

    logger.info(`[${requestId}] Deleting A2A push notification config`, {
      agentUrl: validated.agentUrl,
      taskId: validated.taskId,
    })

    const result = await sendJsonRpc(
      validated.agentUrl,
      'tasks/pushNotification/delete',
      { id: validated.taskId },
      requestId
    )

    logger.info(`[${requestId}] Push notification config deleted successfully`)

    return {
      success: true,
      output: { result },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error deleting push notification config:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to delete push notification config',
    }
  }
}

/**
 * Resubscribe to an A2A task stream.
 */
const handleResubscribe: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = TaskIdSchema.parse(body)

    logger.info(`[${requestId}] Resubscribing to A2A task`, {
      agentUrl: validated.agentUrl,
      taskId: validated.taskId,
    })

    const result = await sendJsonRpc(
      validated.agentUrl,
      'tasks/resubscribe',
      { id: validated.taskId },
      requestId
    )

    logger.info(`[${requestId}] A2A task resubscription successful`)

    return {
      success: true,
      output: { result },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error resubscribing to A2A task:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to resubscribe to A2A task',
    }
  }
}

export const a2aHandlers: Record<string, ToolProxyHandler> = {
  'send-message': handleSendMessage,
  'get-task': handleGetTask,
  'cancel-task': handleCancelTask,
  'get-agent-card': handleGetAgentCard,
  'get-push-notification': handleGetPushNotification,
  'set-push-notification': handleSetPushNotification,
  'delete-push-notification': handleDeletePushNotification,
  'resubscribe': handleResubscribe,
}
