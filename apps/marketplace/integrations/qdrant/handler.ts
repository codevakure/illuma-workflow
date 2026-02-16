import type { ToolHandler } from '../../sdk/types'

/**
 * Builds headers for Qdrant requests, including optional API key.
 */
function buildHeaders(params: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (params.apiKey) {
    headers['api-key'] = params.apiKey as string
  }
  return headers
}

/**
 * Normalizes the Qdrant URL, removing trailing slashes.
 */
function normalizeUrl(params: Record<string, unknown>): string {
  return (params.url as string).replace(/\/$/, '')
}

/**
 * Resolves with_payload and with_vector from a return_data convenience param.
 */
function resolveReturnData(
  returnData: string | undefined,
  withPayload: boolean | undefined,
  withVector: boolean | undefined
): { withPayload: boolean; withVector: boolean } {
  let resolvedPayload = withPayload ?? false
  let resolvedVector = withVector ?? false

  if (returnData) {
    switch (returnData) {
      case 'payload_only':
        resolvedPayload = true
        resolvedVector = false
        break
      case 'vector_only':
        resolvedPayload = false
        resolvedVector = true
        break
      case 'both':
        resolvedPayload = true
        resolvedVector = true
        break
      case 'none':
        resolvedPayload = false
        resolvedVector = false
        break
    }
  }

  return { withPayload: resolvedPayload, withVector: resolvedVector }
}

const handler: ToolHandler = {
  operations: {
    qdrant_search_vector: async (params) => {
      const baseUrl = normalizeUrl(params)
      const headers = buildHeaders(params)
      const collection = params.collection as string
      const vector = params.vector as number[]

      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }
      if (!vector || !Array.isArray(vector)) {
        return { success: false, output: {}, error: 'Missing required parameter: vector (must be an array)' }
      }

      const { withPayload, withVector } = resolveReturnData(
        params.search_return_data as string | undefined,
        params.with_payload as boolean | undefined,
        params.with_vector as boolean | undefined
      )

      const body = {
        query: vector,
        limit: params.limit ? Number(params.limit) : 10,
        filter: params.filter || undefined,
        with_payload: withPayload,
        with_vector: withVector,
      }

      const response = await fetch(
        `${baseUrl}/collections/${encodeURIComponent(collection)}/points/query`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Qdrant error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          data: data.result,
          status: data.status,
        },
      }
    },

    qdrant_upsert_points: async (params) => {
      const baseUrl = normalizeUrl(params)
      const headers = buildHeaders(params)
      const collection = params.collection as string
      const points = params.points as Array<Record<string, unknown>>

      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }
      if (!points || !Array.isArray(points)) {
        return { success: false, output: {}, error: 'Missing required parameter: points (must be an array)' }
      }

      const response = await fetch(
        `${baseUrl}/collections/${encodeURIComponent(collection)}/points`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ points }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Qdrant error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: data.status === 'ok',
        output: {
          status: data.status,
          data: data.result,
        },
      }
    },

    qdrant_fetch_points: async (params) => {
      const baseUrl = normalizeUrl(params)
      const headers = buildHeaders(params)
      const collection = params.collection as string
      const ids = params.ids as Array<string | number>

      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }
      if (!ids || !Array.isArray(ids)) {
        return { success: false, output: {}, error: 'Missing required parameter: ids (must be an array)' }
      }

      const { withPayload, withVector } = resolveReturnData(
        params.fetch_return_data as string | undefined,
        params.with_payload as boolean | undefined,
        params.with_vector as boolean | undefined
      )

      const body = {
        ids,
        with_payload: withPayload,
        with_vector: withVector,
      }

      const response = await fetch(
        `${baseUrl}/collections/${encodeURIComponent(collection)}/points`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Qdrant error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          data: data.result,
          status: data.status,
        },
      }
    },
  },
}

export default handler
