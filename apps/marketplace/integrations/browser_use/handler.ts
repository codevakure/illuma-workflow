import type { ToolHandler } from '../../sdk/types'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = 300000
const MAX_CONSECUTIVE_ERRORS = 3

async function createSessionWithProfile(
  profileId: string,
  apiKey: string
): Promise<{ sessionId: string } | { error: string }> {
  try {
    const response = await fetch('https://api.browser-use.com/api/v2/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Browser-Use-API-Key': apiKey,
      },
      body: JSON.stringify({ profileId: profileId.trim() }),
    })

    if (!response.ok) {
      return { error: `Failed to create session with profile: ${response.statusText}` }
    }

    const data = (await response.json()) as { id: string }
    return { sessionId: data.id }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { error: `Error creating session: ${message}` }
  }
}

async function stopSession(sessionId: string, apiKey: string): Promise<void> {
  try {
    await fetch(`https://api.browser-use.com/api/v2/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Browser-Use-API-Key': apiKey,
      },
      body: JSON.stringify({ action: 'stop' }),
    })
  } catch {
    // Best-effort session cleanup
  }
}

function buildRequestBody(
  params: Record<string, unknown>,
  sessionId?: string
): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    task: params.task,
  }

  if (sessionId) {
    requestBody.sessionId = sessionId
  }

  if (params.variables) {
    let secrets: Record<string, string> = {}

    if (Array.isArray(params.variables)) {
      ;(params.variables as Record<string, unknown>[]).forEach((row) => {
        const cells = row.cells as Record<string, string> | undefined
        if (cells?.Key && cells.Value !== undefined) {
          secrets[cells.Key] = cells.Value
        } else if (row.Key && (row.Value as string) !== undefined) {
          secrets[row.Key as string] = row.Value as string
        }
      })
    } else if (typeof params.variables === 'object' && params.variables !== null) {
      secrets = params.variables as Record<string, string>
    }

    if (Object.keys(secrets).length > 0) {
      requestBody.secrets = secrets
    }
  }

  if (params.model) {
    requestBody.llm_model = params.model
  }

  if (params.save_browser_data) {
    requestBody.save_browser_data = params.save_browser_data
  }

  requestBody.use_adblock = true
  requestBody.highlight_elements = true

  return requestBody
}

async function fetchTaskStatus(
  taskId: string,
  apiKey: string
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const response = await fetch(`https://api.browser-use.com/api/v2/tasks/${taskId}`, {
      method: 'GET',
      headers: { 'X-Browser-Use-API-Key': apiKey },
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }

    const data = await response.json()
    return { ok: true, data }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Network error'
    return { ok: false, error: message }
  }
}

async function pollForCompletion(
  taskId: string,
  apiKey: string
): Promise<{
  success: boolean
  output: unknown
  steps: unknown[]
  error?: string
}> {
  let consecutiveErrors = 0
  const startTime = Date.now()

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const result = await fetchTaskStatus(taskId, apiKey)

    if (!result.ok) {
      consecutiveErrors++
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return {
          success: false,
          output: null,
          steps: [],
          error: `Failed to poll task status after ${MAX_CONSECUTIVE_ERRORS} attempts: ${result.error}`,
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      continue
    }

    consecutiveErrors = 0
    const taskData = result.data
    const status = taskData.status as string

    if (['finished', 'failed', 'stopped'].includes(status)) {
      return {
        success: status === 'finished',
        output: taskData.output ?? null,
        steps: (taskData.steps as unknown[]) || [],
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  const finalResult = await fetchTaskStatus(taskId, apiKey)
  if (
    finalResult.ok &&
    ['finished', 'failed', 'stopped'].includes(finalResult.data.status as string)
  ) {
    return {
      success: (finalResult.data.status as string) === 'finished',
      output: finalResult.data.output ?? null,
      steps: (finalResult.data.steps as unknown[]) || [],
    }
  }

  return {
    success: false,
    output: null,
    steps: [],
    error: `Task did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
  }
}

const handler: ToolHandler = {
  operations: {
    browser_use_run_task: async (params) => {
      const task = params.task as string
      const apiKey = params.apiKey as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!task) {
        return { success: false, output: {}, error: 'Missing required parameter: task' }
      }

      let sessionId: string | undefined

      if (params.profile_id) {
        const sessionResult = await createSessionWithProfile(
          params.profile_id as string,
          apiKey
        )
        if ('error' in sessionResult) {
          return {
            success: false,
            output: { id: null, success: false, output: null, steps: [] },
            error: sessionResult.error,
          }
        }
        sessionId = sessionResult.sessionId
      }

      const requestBody = buildRequestBody(params, sessionId)

      try {
        const response = await fetch('https://api.browser-use.com/api/v2/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Browser-Use-API-Key': apiKey,
          },
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          if (sessionId) await stopSession(sessionId, apiKey)
          return {
            success: false,
            output: { id: null, success: false, output: null, steps: [] },
            error: `Failed to create task: ${response.statusText}`,
          }
        }

        const data = (await response.json()) as { id: string }
        const taskId = data.id

        const result = await pollForCompletion(taskId, apiKey)

        if (sessionId) await stopSession(sessionId, apiKey)

        return {
          success: result.success && !result.error,
          output: {
            id: taskId,
            success: result.success,
            output: result.output,
            steps: result.steps,
          },
          error: result.error,
        }
      } catch (error: unknown) {
        if (sessionId) await stopSession(sessionId, apiKey)
        const message = error instanceof Error ? error.message : 'Unknown error'
        return {
          success: false,
          output: { id: null, success: false, output: null, steps: [] },
          error: `Error creating task: ${message}`,
        }
      }
    },
  },
}

export default handler
