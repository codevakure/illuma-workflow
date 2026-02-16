import type { ToolHandler } from '../../sdk/types'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = 300000

const handler: ToolHandler = {
  operations: {
    apify_run_actor_sync: async (params) => {
      const apiKey = params.apiKey as string
      const actorId = params.actorId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!actorId) {
        return { success: false, output: {}, error: 'Missing required parameter: actorId' }
      }

      let inputData = {}
      if (params.input) {
        try {
          inputData = JSON.parse(params.input as string)
        } catch {
          return { success: false, output: {}, error: 'Invalid JSON in input parameter' }
        }
      }

      const encodedActorId = encodeURIComponent(actorId)
      const queryParams = new URLSearchParams()
      queryParams.set('token', apiKey)
      if (params.memory) queryParams.set('memory', String(params.memory))
      if (params.timeout) queryParams.set('timeout', String(params.timeout))
      if (params.build) queryParams.set('build', params.build as string)

      const url = `https://api.apify.com/v2/acts/${encodedActorId}/run-sync-get-dataset-items?${queryParams.toString()}`

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inputData),
      })

      if (!resp.ok) {
        const errorText = await resp.text()
        return {
          success: false,
          output: { success: false, runId: '', status: 'ERROR', items: [] },
          error: `APIFY API error: ${errorText}`,
        }
      }

      const items = await resp.json()

      return {
        success: true,
        output: {
          success: true,
          runId: 'sync-execution',
          status: 'SUCCEEDED',
          items,
        },
      }
    },

    apify_run_actor_async: async (params) => {
      const apiKey = params.apiKey as string
      const actorId = params.actorId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!actorId) {
        return { success: false, output: {}, error: 'Missing required parameter: actorId' }
      }

      let inputData = {}
      if (params.input) {
        try {
          inputData = JSON.parse(params.input as string)
        } catch {
          return { success: false, output: {}, error: 'Invalid JSON in input parameter' }
        }
      }

      const encodedActorId = encodeURIComponent(actorId)
      const queryParams = new URLSearchParams()
      queryParams.set('token', apiKey)

      if (params.waitForFinish !== undefined) {
        const waitTime = Math.max(0, Math.min(Number(params.waitForFinish), 60))
        queryParams.set('waitForFinish', waitTime.toString())
      }
      if (params.memory) queryParams.set('memory', String(params.memory))
      if (params.timeout) queryParams.set('timeout', String(params.timeout))
      if (params.build) queryParams.set('build', params.build as string)

      const startUrl = `https://api.apify.com/v2/acts/${encodedActorId}/runs?${queryParams.toString()}`

      const startResp = await fetch(startUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inputData),
      })

      if (!startResp.ok) {
        const errorText = await startResp.text()
        return {
          success: false,
          output: { success: false, runId: '', status: 'ERROR' },
          error: `APIFY API error: ${errorText}`,
        }
      }

      const startData = await startResp.json()
      const runId = startData.data?.id
      if (!runId) {
        return {
          success: false,
          output: { success: false, runId: '', status: 'ERROR' },
          error: 'Failed to get run ID from APIFY response',
        }
      }

      let elapsedTime = 0

      while (elapsedTime < MAX_POLL_TIME_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS

        const statusResp = await fetch(
          `https://api.apify.com/v2/acts/${encodedActorId}/runs/${runId}?token=${apiKey}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          }
        )

        if (!statusResp.ok) {
          return {
            success: false,
            output: { success: false, runId, status: 'UNKNOWN' },
            error: 'Failed to fetch run status',
          }
        }

        const statusData = await statusResp.json()
        const run = statusData.data

        if (
          run.status === 'SUCCEEDED' ||
          run.status === 'FAILED' ||
          run.status === 'ABORTED' ||
          run.status === 'TIMED-OUT'
        ) {
          if (run.status === 'SUCCEEDED') {
            const limit = Math.max(1, Math.min(Number(params.itemLimit) || 100, 250000))
            const itemsResp = await fetch(
              `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${apiKey}&limit=${limit}`,
              {
                headers: { Authorization: `Bearer ${apiKey}` },
              }
            )

            if (itemsResp.ok) {
              const items = await itemsResp.json()
              return {
                success: true,
                output: {
                  success: true,
                  runId,
                  status: run.status,
                  datasetId: run.defaultDatasetId,
                  items,
                },
              }
            }
          }

          return {
            success: run.status === 'SUCCEEDED',
            output: {
              success: run.status === 'SUCCEEDED',
              runId,
              status: run.status,
              datasetId: run.defaultDatasetId,
            },
            error: run.status !== 'SUCCEEDED' ? `Actor run ${run.status}` : undefined,
          }
        }
      }

      return {
        success: false,
        output: { success: false, runId, status: 'TIMEOUT' },
        error: 'Actor run timed out after 5 minutes of polling',
      }
    },
  },
}

export default handler
