import type { ToolHandler } from '../../sdk/types'

function toCompactTimestamp(startTime?: string): string {
  const parsed = startTime ? new Date(startTime) : new Date()
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const pad = (value: number, length: number) => value.toString().padStart(length, '0')
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1, 2)
  const day = pad(date.getUTCDate(), 2)
  const hours = pad(date.getUTCHours(), 2)
  const minutes = pad(date.getUTCMinutes(), 2)
  const seconds = pad(date.getUTCSeconds(), 2)
  const micros = pad(date.getUTCMilliseconds() * 1000, 6)
  return `${year}${month}${day}T${hours}${minutes}${seconds}${micros}`
}

function normalizeRunPayload(run: Record<string, unknown>): { payload: Record<string, unknown>; runId: string } {
  const runId = (run.id as string) ?? crypto.randomUUID()
  const traceId = (run.trace_id as string) ?? runId
  const startTime = (run.start_time as string) ?? new Date().toISOString()
  const dottedOrder = (run.dotted_order as string) ?? `${toCompactTimestamp(startTime)}Z${runId}`

  return {
    runId,
    payload: {
      ...run,
      id: runId,
      trace_id: traceId,
      start_time: startTime,
      dotted_order: dottedOrder,
    },
  }
}

const handler: ToolHandler = {
  operations: {
    langsmith_create_run: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.name || !params.run_type) {
        return { success: false, output: {}, error: 'Missing required parameters: name, run_type' }
      }

      const { payload, runId } = normalizeRunPayload(params as Record<string, unknown>)

      const normalizedPayload: Record<string, unknown> = {
        ...payload,
        name: (payload.name as string)?.trim(),
        inputs: params.inputs,
        outputs: params.run_outputs,
        extra: params.extra,
        tags: params.tags,
        status: params.status,
        error: params.error,
        events: params.events,
      }

      const body = Object.fromEntries(
        Object.entries(normalizedPayload).filter(([key, value]) => value !== undefined && key !== 'apiKey')
      )

      const response = await fetch('https://api.smith.langchain.com/runs', {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `LangSmith API error: ${response.status} ${errorText}` }
      }

      const data = await response.json().catch(() => ({}))
      const directMessage =
        typeof (data as Record<string, unknown>).message === 'string'
          ? (data as Record<string, string>).message
          : null
      const nestedPayload =
        typeof data[runId] === 'object' && data[runId] !== null
          ? (data[runId] as Record<string, unknown>)
          : null
      const nestedMessage =
        nestedPayload && typeof nestedPayload.message === 'string' ? nestedPayload.message : null

      return {
        success: true,
        output: {
          accepted: true,
          runId,
          message: directMessage ?? nestedMessage ?? null,
        },
      }
    },

    langsmith_create_runs_batch: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const postRuns = params.post as Record<string, unknown>[] | undefined
      const patchRuns = params.patch as Record<string, unknown>[] | undefined

      const payload: Record<string, unknown> = {}
      const allRunIds: string[] = []

      if (postRuns) {
        payload.post = postRuns.map((run) => {
          const { payload: normalized, runId } = normalizeRunPayload(run)
          allRunIds.push(runId)
          return normalized
        })
      }

      if (patchRuns) {
        payload.patch = patchRuns.map((run) => {
          const { payload: normalized, runId } = normalizeRunPayload(run)
          allRunIds.push(runId)
          return normalized
        })
      }

      const body = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))

      const response = await fetch('https://api.smith.langchain.com/runs/batch', {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `LangSmith API error: ${response.status} ${errorText}` }
      }

      const data = await response.json().catch(() => ({}))
      const directMessage =
        typeof (data as Record<string, unknown>).message === 'string'
          ? (data as Record<string, string>).message
          : null

      const messages = Object.values(data)
        .map((value) => {
          if (typeof value !== 'object' || value === null) return null
          const messageValue = (value as Record<string, unknown>).message
          return typeof messageValue === 'string' ? messageValue : null
        })
        .filter((v): v is string => Boolean(v))

      return {
        success: true,
        output: {
          accepted: true,
          runIds: allRunIds,
          message: directMessage ?? null,
          messages: messages.length ? messages : undefined,
        },
      }
    },
  },
}

export default handler
