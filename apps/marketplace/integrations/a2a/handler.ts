import type { ToolHandler } from '../../sdk/types'

const A2A_TERMINAL_STATES = ['completed', 'failed', 'canceled', 'rejected']

function isTerminalState(state: string): boolean {
  return A2A_TERMINAL_STATES.includes(state)
}

function extractTextFromParts(parts: Array<Record<string, unknown>>): string {
  return parts
    .filter((part) => part.kind === 'text')
    .map((part) => part.text as string)
    .join('\n')
}

async function sendJsonRpc(agentUrl: string, method: string, params: Record<string, unknown>, apiKey?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey

  const body = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method,
    params,
  }

  const response = await fetch(agentUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`A2A request failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error))
  }

  return data.result ?? data
}

async function fetchAgentCard(agentUrl: string, apiKey?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey

  const baseUrl = agentUrl.replace(/\/$/, '')

  let response = await fetch(`${baseUrl}/.well-known/agent.json`, { headers }).catch(() => null)
  if (!response || !response.ok) {
    response = await fetch(baseUrl, { method: 'GET', headers })
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch agent card: ${response.status}`)
  }

  return response.json()
}

const handler: ToolHandler = {
  operations: {
    a2a_send_message: async (params) => {
      const agentUrl = params.agentUrl as string
      const message = params.message as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl || !message) {
        return { success: false, output: {}, error: 'Missing required parameters: agentUrl, message' }
      }

      const parts: Array<Record<string, unknown>> = [{ kind: 'text', text: message }]

      if (params.data) {
        try {
          const parsedData = JSON.parse(params.data as string)
          parts.push({ kind: 'data', data: parsedData })
        } catch { /* skip invalid JSON data */ }
      }

      if (params.files && Array.isArray(params.files)) {
        for (const file of params.files as Array<Record<string, unknown>>) {
          if (file.type === 'url') {
            parts.push({ kind: 'file', file: { name: file.name, mimeType: file.mime, uri: file.data } })
          } else if (file.type === 'file') {
            let bytes = file.data as string
            let mimeType = file.mime as string | undefined
            if (typeof bytes === 'string' && bytes.startsWith('data:')) {
              const match = bytes.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                mimeType = mimeType || match[1]
                bytes = match[2]
              }
            }
            parts.push({ kind: 'file', file: { name: file.name, mimeType: mimeType || 'application/octet-stream', bytes } })
          }
        }
      }

      const messagePayload: Record<string, unknown> = {
        kind: 'message',
        messageId: crypto.randomUUID(),
        role: 'user',
        parts,
      }
      if (params.taskId) messagePayload.taskId = params.taskId
      if (params.contextId) messagePayload.contextId = params.contextId

      try {
        const result = await sendJsonRpc(agentUrl, 'message/send', { message: messagePayload }, apiKey)

        if (result.kind === 'message') {
          const msg = result as Record<string, unknown>
          const msgParts = (msg.parts as Array<Record<string, unknown>>) || []
          return {
            success: true,
            output: {
              content: extractTextFromParts(msgParts),
              taskId: (msg.taskId as string) || '',
              contextId: msg.contextId,
              state: 'completed',
            },
          }
        }

        const task = result as Record<string, unknown>
        const status = task.status as Record<string, unknown> | undefined
        const history = (task.history as Array<Record<string, unknown>>) || []
        const lastAgentMsg = history.filter((m) => m.role === 'agent').pop()
        const content = lastAgentMsg ? extractTextFromParts((lastAgentMsg.parts as Array<Record<string, unknown>>) || []) : ''

        const state = status?.state as string || 'working'

        return {
          success: isTerminalState(state) && state !== 'failed',
          output: {
            content,
            taskId: task.id as string,
            contextId: task.contextId,
            state,
            artifacts: task.artifacts,
            history: task.history,
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to send A2A message' }
      }
    },

    a2a_get_task: async (params) => {
      const agentUrl = params.agentUrl as string
      const taskId = params.taskId as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: agentUrl, taskId' }
      }

      try {
        const rpcParams: Record<string, unknown> = { id: taskId }
        if (params.historyLength) rpcParams.historyLength = params.historyLength

        const task = await sendJsonRpc(agentUrl, 'tasks/get', rpcParams, apiKey)
        const status = task.status as Record<string, unknown> | undefined

        return {
          success: true,
          output: {
            taskId: task.id as string,
            contextId: task.contextId,
            state: status?.state as string,
            artifacts: task.artifacts,
            history: task.history,
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get task' }
      }
    },

    a2a_cancel_task: async (params) => {
      const agentUrl = params.agentUrl as string
      const taskId = params.taskId as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: agentUrl, taskId' }
      }

      try {
        const task = await sendJsonRpc(agentUrl, 'tasks/cancel', { id: taskId }, apiKey)
        const status = task.status as Record<string, unknown> | undefined

        return {
          success: true,
          output: {
            cancelled: true,
            state: status?.state as string || 'canceled',
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to cancel task' }
      }
    },

    a2a_get_agent_card: async (params) => {
      const agentUrl = params.agentUrl as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl) {
        return { success: false, output: {}, error: 'Missing required parameter: agentUrl' }
      }

      try {
        const card = await fetchAgentCard(agentUrl, apiKey)

        return {
          success: true,
          output: {
            name: card.name,
            description: card.description,
            url: card.url,
            version: card.protocolVersion,
            capabilities: card.capabilities,
            skills: card.skills,
            defaultInputModes: card.defaultInputModes,
            defaultOutputModes: card.defaultOutputModes,
            provider: card.provider,
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to fetch agent card' }
      }
    },

    a2a_get_push_notification: async (params) => {
      const agentUrl = params.agentUrl as string
      const taskId = params.taskId as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: agentUrl, taskId' }
      }

      try {
        const result = await sendJsonRpc(agentUrl, 'tasks/pushNotificationConfig/get', { id: taskId }, apiKey)

        if (!result || !result.pushNotificationConfig) {
          return { success: true, output: { exists: false } }
        }

        const config = result.pushNotificationConfig as Record<string, unknown>
        return {
          success: true,
          output: {
            url: config.url,
            token: config.token,
            exists: true,
          },
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return { success: true, output: { exists: false } }
        }
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get push notification' }
      }
    },

    a2a_set_push_notification: async (params) => {
      const agentUrl = params.agentUrl as string
      const taskId = params.taskId as string
      const webhookUrl = params.webhookUrl as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl || !taskId || !webhookUrl) {
        return { success: false, output: {}, error: 'Missing required parameters: agentUrl, taskId, webhookUrl' }
      }

      try {
        const config: Record<string, unknown> = { url: webhookUrl }
        if (params.token) config.token = params.token

        const result = await sendJsonRpc(agentUrl, 'tasks/pushNotificationConfig/set', {
          taskId,
          pushNotificationConfig: config,
        }, apiKey)

        const resultConfig = result.pushNotificationConfig as Record<string, unknown> | undefined

        return {
          success: true,
          output: {
            url: resultConfig?.url ?? webhookUrl,
            token: resultConfig?.token,
            success: true,
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to set push notification' }
      }
    },

    a2a_delete_push_notification: async (params) => {
      const agentUrl = params.agentUrl as string
      const taskId = params.taskId as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: agentUrl, taskId' }
      }

      try {
        await sendJsonRpc(agentUrl, 'tasks/pushNotificationConfig/delete', {
          id: taskId,
          pushNotificationConfigId: (params.pushNotificationConfigId as string) || taskId,
        }, apiKey)

        return { success: true, output: { success: true } }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to delete push notification' }
      }
    },

    a2a_resubscribe: async (params) => {
      const agentUrl = params.agentUrl as string
      const taskId = params.taskId as string
      const apiKey = params.apiKey as string | undefined

      if (!agentUrl || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: agentUrl, taskId' }
      }

      try {
        const task = await sendJsonRpc(agentUrl, 'tasks/resubscribe', { id: taskId }, apiKey)
        const status = task.status as Record<string, unknown> | undefined
        const state = (status?.state as string) || 'working'

        return {
          success: true,
          output: {
            taskId: (task.id as string) || taskId,
            contextId: task.contextId,
            state,
            isRunning: !isTerminalState(state),
            artifacts: task.artifacts,
            history: task.history,
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to resubscribe' }
      }
    },
  },
}

export default handler
