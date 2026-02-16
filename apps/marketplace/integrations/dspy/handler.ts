import type { ToolHandler } from '../../sdk/types'

interface TrajectoryStep {
  thought: string
  toolName: string
  toolArgs: Record<string, unknown>
  observation: string | null
}

/**
 * Parse DSPy ReAct trajectory format into structured steps.
 * DSPy trajectory format: { thought_0, tool_name_0, tool_args_0, observation_0, thought_1, ... }
 */
function parseTrajectory(trajectory: Record<string, unknown>): TrajectoryStep[] {
  const steps: TrajectoryStep[] = []
  let idx = 0

  while (
    trajectory[`thought_${idx}`] !== undefined ||
    trajectory[`tool_name_${idx}`] !== undefined
  ) {
    steps.push({
      thought: (trajectory[`thought_${idx}`] as string) ?? '',
      toolName: (trajectory[`tool_name_${idx}`] as string) ?? '',
      toolArgs: (trajectory[`tool_args_${idx}`] as Record<string, unknown>) ?? {},
      observation:
        trajectory[`observation_${idx}`] !== undefined
          ? String(trajectory[`observation_${idx}`])
          : null,
    })
    idx++
  }

  return steps
}

function buildDspyUrl(params: Record<string, unknown>): string {
  const baseUrl = (params.baseUrl as string).replace(/\/$/, '')
  const endpoint = (params.endpoint as string) || '/predict'
  return `${baseUrl}${endpoint}`
}

function buildDspyHeaders(params: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`
  }
  return headers
}

const handler: ToolHandler = {
  operations: {
    dspy_predict: async (params) => {
      const baseUrl = params.baseUrl as string
      const input = params.input as string
      if (!baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameter: baseUrl' }
      }
      if (!input) {
        return { success: false, output: {}, error: 'Missing required parameter: input' }
      }

      const inputField = (params.inputField as string) || 'text'
      const body: Record<string, unknown> = {
        [inputField]: input,
      }

      if (params.context) {
        body.context = params.context
      }

      if (params.additionalInputs) {
        const additional =
          typeof params.additionalInputs === 'string'
            ? JSON.parse(params.additionalInputs)
            : params.additionalInputs
        Object.assign(body, additional)
      }

      const resp = await fetch(buildDspyUrl(params), {
        method: 'POST',
        headers: buildDspyHeaders(params),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const errorText = await resp.text()
        return {
          success: false,
          output: {},
          error: `DSPy API error: ${errorText}`,
        }
      }

      const data = await resp.json()
      const status = data.status ?? 'success'
      const outputData = data.data ?? data

      return {
        success: true,
        output: {
          answer: outputData.answer ?? outputData.output ?? outputData.response ?? '',
          reasoning: outputData.reasoning ?? outputData.rationale ?? null,
          status,
          rawOutput: outputData,
        },
      }
    },

    dspy_chain_of_thought: async (params) => {
      const baseUrl = params.baseUrl as string
      const question = params.question as string
      if (!baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameter: baseUrl' }
      }
      if (!question) {
        return { success: false, output: {}, error: 'Missing required parameter: question' }
      }

      const body: Record<string, unknown> = {
        text: question,
      }

      if (params.context) {
        body.context = params.context
      }

      const resp = await fetch(buildDspyUrl(params), {
        method: 'POST',
        headers: buildDspyHeaders(params),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const errorText = await resp.text()
        return {
          success: false,
          output: {},
          error: `DSPy API error: ${errorText}`,
        }
      }

      const data = await resp.json()
      const status = data.status ?? 'success'
      const outputData = data.data ?? data

      return {
        success: true,
        output: {
          answer: outputData.answer ?? outputData.output ?? outputData.response ?? '',
          reasoning: outputData.reasoning ?? outputData.rationale ?? outputData.thought ?? '',
          status,
          rawOutput: outputData,
        },
      }
    },

    dspy_react: async (params) => {
      const baseUrl = params.baseUrl as string
      const task = params.task as string
      if (!baseUrl) {
        return { success: false, output: {}, error: 'Missing required parameter: baseUrl' }
      }
      if (!task) {
        return { success: false, output: {}, error: 'Missing required parameter: task' }
      }

      const body: Record<string, unknown> = {
        text: task,
      }

      if (params.context) {
        body.context = params.context
      }

      if (params.maxIterations !== undefined) {
        body.max_iters = params.maxIterations
      }

      const resp = await fetch(buildDspyUrl(params), {
        method: 'POST',
        headers: buildDspyHeaders(params),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const errorText = await resp.text()
        return {
          success: false,
          output: {},
          error: `DSPy API error: ${errorText}`,
        }
      }

      const data = await resp.json()
      const status = data.status ?? 'success'
      const outputData = data.data ?? data

      const rawTrajectory = outputData.trajectory ?? {}
      const trajectory = Array.isArray(rawTrajectory)
        ? rawTrajectory.map((step: Record<string, unknown>) => ({
            thought: (step.thought as string) ?? (step.reasoning as string) ?? '',
            toolName: (step.tool_name as string) ?? (step.selected_fn as string) ?? '',
            toolArgs:
              (step.tool_args as Record<string, unknown>) ??
              (step.args as Record<string, unknown>) ??
              {},
            observation:
              step.observation !== undefined ? String(step.observation) : null,
          }))
        : parseTrajectory(rawTrajectory)

      return {
        success: true,
        output: {
          answer:
            outputData.answer ??
            outputData.process_result ??
            outputData.output ??
            outputData.response ??
            '',
          reasoning: outputData.reasoning ?? null,
          trajectory,
          status,
          rawOutput: outputData,
        },
      }
    },
  },
}

export default handler
