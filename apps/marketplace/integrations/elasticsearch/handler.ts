import type { ToolHandler } from '../../sdk/types'

/**
 * Builds the base URL for Elasticsearch from connection params.
 * Supports both self-hosted and Elastic Cloud deployments.
 */
function buildBaseUrl(params: Record<string, unknown>): string {
  const deploymentType = params.deploymentType as string
  const cloudId = params.cloudId as string | undefined
  const host = params.host as string | undefined

  if (deploymentType === 'cloud' && cloudId) {
    const parts = cloudId.split(':')
    if (parts.length >= 2) {
      try {
        const decoded = Buffer.from(parts[1], 'base64').toString('utf-8')
        const [esHost] = decoded.split('$')
        if (esHost) {
          return `https://${parts[0]}.${esHost}`
        }
      } catch {
        // Fall through to error
      }
    }
    throw new Error('Invalid Cloud ID format')
  }

  if (!host) {
    throw new Error('Host is required for self-hosted deployments')
  }

  return host.replace(/\/$/, '')
}

/**
 * Builds authentication headers for Elasticsearch requests.
 */
function buildAuthHeaders(params: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const authMethod = params.authMethod as string
  const apiKey = params.apiKey as string | undefined
  const username = params.username as string | undefined
  const password = params.password as string | undefined

  if (authMethod === 'api_key' && apiKey) {
    headers.Authorization = `ApiKey ${apiKey}`
  } else if (authMethod === 'basic_auth' && username && password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64')
    headers.Authorization = `Basic ${credentials}`
  } else {
    throw new Error('Invalid authentication configuration')
  }

  return headers
}

/**
 * Parses an Elasticsearch error response into a readable message.
 */
async function parseErrorResponse(response: Response): Promise<string> {
  const errorText = await response.text()
  let errorMessage = `Elasticsearch error: ${response.status}`
  try {
    const errorJson = JSON.parse(errorText)
    errorMessage = errorJson.error?.reason || errorJson.error?.type || errorMessage
  } catch {
    errorMessage = errorText || errorMessage
  }
  return errorMessage
}

const handler: ToolHandler = {
  operations: {
    elasticsearch_search: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string

      if (!index) {
        return { success: false, output: {}, error: 'Missing required parameter: index' }
      }

      const body: Record<string, unknown> = {}

      if (params.query) {
        try {
          body.query = JSON.parse(params.query as string)
        } catch {
          body.query = { match_all: {} }
        }
      }

      if (params.from !== undefined) body.from = params.from
      if (params.size !== undefined) body.size = params.size

      if (params.sort) {
        try {
          body.sort = JSON.parse(params.sort as string)
        } catch {
          // Ignore invalid sort
        }
      }

      if (params.sourceIncludes || params.sourceExcludes) {
        const source: Record<string, unknown> = {}
        if (params.sourceIncludes) {
          source.includes = (params.sourceIncludes as string).split(',').map((s) => s.trim())
        }
        if (params.sourceExcludes) {
          source.excludes = (params.sourceExcludes as string).split(',').map((s) => s.trim())
        }
        body._source = source
      }

      if (params.trackTotalHits !== undefined) {
        body.track_total_hits = params.trackTotalHits
      }

      const response = await fetch(`${baseUrl}/${encodeURIComponent(index)}/_search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return {
          success: false,
          output: { took: 0, timed_out: false, hits: { total: { value: 0, relation: 'eq' }, max_score: null, hits: [] } },
          error: errorMessage,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          took: data.took,
          timed_out: data.timed_out,
          hits: {
            total: data.hits.total,
            max_score: data.hits.max_score,
            hits: data.hits.hits.map((hit: Record<string, unknown>) => ({
              _index: hit._index,
              _id: hit._id,
              _score: hit._score,
              _source: hit._source,
            })),
          },
          aggregations: data.aggregations,
        },
      }
    },

    elasticsearch_index_document: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string
      const documentId = params.documentId as string | undefined
      const document = params.document as string

      if (!index) {
        return { success: false, output: {}, error: 'Missing required parameter: index' }
      }
      if (!document) {
        return { success: false, output: {}, error: 'Missing required parameter: document' }
      }

      let parsedDoc: Record<string, unknown>
      try {
        parsedDoc = JSON.parse(document)
      } catch {
        return { success: false, output: {}, error: 'Invalid JSON document' }
      }

      let url = `${baseUrl}/${encodeURIComponent(index)}/_doc`
      if (documentId) {
        url += `/${encodeURIComponent(documentId)}`
      }
      if (params.refresh) {
        url += `?refresh=${params.refresh}`
      }

      const response = await fetch(url, {
        method: documentId ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(parsedDoc),
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { _index: '', _id: '' }, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          _index: data._index,
          _id: data._id,
          _version: data._version,
          result: data.result,
        },
      }
    },

    elasticsearch_get_document: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string
      const documentId = params.documentId as string

      if (!index || !documentId) {
        return { success: false, output: {}, error: 'Missing required parameters: index, documentId' }
      }

      let url = `${baseUrl}/${encodeURIComponent(index)}/_doc/${encodeURIComponent(documentId)}`

      const queryParams: string[] = []
      if (params.sourceIncludes) {
        queryParams.push(`_source_includes=${encodeURIComponent(params.sourceIncludes as string)}`)
      }
      if (params.sourceExcludes) {
        queryParams.push(`_source_excludes=${encodeURIComponent(params.sourceExcludes as string)}`)
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`
      }

      const response = await fetch(url, { method: 'GET', headers })

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, output: { _index: '', _id: '', found: false } }
        }
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { _index: '', _id: '' }, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          _index: data._index,
          _id: data._id,
          _version: data._version,
          found: data.found,
          _source: data._source,
        },
      }
    },

    elasticsearch_update_document: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string
      const documentId = params.documentId as string
      const document = params.document as string

      if (!index || !documentId || !document) {
        return { success: false, output: {}, error: 'Missing required parameters: index, documentId, document' }
      }

      let parsedDoc: Record<string, unknown>
      try {
        parsedDoc = JSON.parse(document)
      } catch {
        return { success: false, output: {}, error: 'Invalid JSON document' }
      }

      let url = `${baseUrl}/${encodeURIComponent(index)}/_update/${encodeURIComponent(documentId)}`
      if (params.retryOnConflict !== undefined) {
        url += `?retry_on_conflict=${params.retryOnConflict}`
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ doc: parsedDoc }),
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { _index: '', _id: '' }, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          _index: data._index,
          _id: data._id,
          _version: data._version,
          result: data.result,
        },
      }
    },

    elasticsearch_delete_document: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string
      const documentId = params.documentId as string

      if (!index || !documentId) {
        return { success: false, output: {}, error: 'Missing required parameters: index, documentId' }
      }

      let url = `${baseUrl}/${encodeURIComponent(index)}/_doc/${encodeURIComponent(documentId)}`
      if (params.refresh) {
        url += `?refresh=${params.refresh}`
      }

      const response = await fetch(url, { method: 'DELETE', headers })

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, output: { _index: '', _id: '', result: 'not_found' } }
        }
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { _index: '', _id: '' }, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          _index: data._index,
          _id: data._id,
          _version: data._version,
          result: data.result,
        },
      }
    },

    elasticsearch_bulk: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const authHeaders = buildAuthHeaders(params)
      const index = params.index as string | undefined
      const operations = params.operations as string

      if (!operations) {
        return { success: false, output: {}, error: 'Missing required parameter: operations' }
      }

      let ndjson = operations.trim()
      if (!ndjson.endsWith('\n')) {
        ndjson += '\n'
      }

      let url = index
        ? `${baseUrl}/${encodeURIComponent(index)}/_bulk`
        : `${baseUrl}/_bulk`

      if (params.refresh) {
        url += `?refresh=${params.refresh}`
      }

      const headers = { ...authHeaders, 'Content-Type': 'application/x-ndjson' }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: ndjson,
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { took: 0, errors: true, items: [] }, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          took: data.took,
          errors: data.errors,
          items: data.items,
        },
      }
    },

    elasticsearch_count: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string

      if (!index) {
        return { success: false, output: {}, error: 'Missing required parameter: index' }
      }

      const body: Record<string, unknown> = {}
      if (params.query) {
        try {
          body.query = JSON.parse(params.query as string)
        } catch {
          // Ignore invalid query
        }
      }

      const response = await fetch(`${baseUrl}/${encodeURIComponent(index)}/_count`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return {
          success: false,
          output: { count: 0, _shards: { total: 0, successful: 0, skipped: 0, failed: 0 } },
          error: errorMessage,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          count: data.count,
          _shards: data._shards,
        },
      }
    },

    elasticsearch_create_index: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string

      if (!index) {
        return { success: false, output: {}, error: 'Missing required parameter: index' }
      }

      const body: Record<string, unknown> = {}
      if (params.settings) {
        try { body.settings = JSON.parse(params.settings as string) } catch { /* ignore */ }
      }
      if (params.mappings) {
        try { body.mappings = JSON.parse(params.mappings as string) } catch { /* ignore */ }
      }

      const response = await fetch(`${baseUrl}/${encodeURIComponent(index)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { acknowledged: false }, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          acknowledged: data.acknowledged,
          shards_acknowledged: data.shards_acknowledged,
          index: data.index,
        },
      }
    },

    elasticsearch_delete_index: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string

      if (!index) {
        return { success: false, output: {}, error: 'Missing required parameter: index' }
      }

      const response = await fetch(`${baseUrl}/${encodeURIComponent(index)}`, {
        method: 'DELETE',
        headers,
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { acknowledged: false }, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          acknowledged: data.acknowledged,
        },
      }
    },

    elasticsearch_get_index: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)
      const index = params.index as string

      if (!index) {
        return { success: false, output: {}, error: 'Missing required parameter: index' }
      }

      const response = await fetch(`${baseUrl}/${encodeURIComponent(index)}`, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: {}, error: errorMessage }
      }

      const data = await response.json()

      return {
        success: true,
        output: data,
      }
    },

    elasticsearch_list_indices: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)

      const response = await fetch(`${baseUrl}/_cat/indices?format=json`, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return { success: false, output: { message: errorMessage, indices: [] }, error: errorMessage }
      }

      const data = await response.json()

      const indices = data
        .filter((item: Record<string, unknown>) => {
          const indexName = item.index as string
          return !indexName.startsWith('.')
        })
        .map((item: Record<string, unknown>) => ({
          index: item.index as string,
          health: item.health as string,
          status: item.status as string,
          docsCount: Number.parseInt(item['docs.count'] as string, 10) || 0,
          storeSize: (item['store.size'] as string) || '0b',
          primaryShards: Number.parseInt(item.pri as string, 10) || 0,
          replicaShards: Number.parseInt(item.rep as string, 10) || 0,
        }))

      return {
        success: true,
        output: {
          message: `Found ${indices.length} indices`,
          indices,
        },
      }
    },

    elasticsearch_cluster_health: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)

      let url = `${baseUrl}/_cluster/health`
      const queryParams: string[] = []
      if (params.waitForStatus) {
        queryParams.push(`wait_for_status=${params.waitForStatus}`)
      }
      if (params.timeout) {
        queryParams.push(`timeout=${encodeURIComponent(params.timeout as string)}`)
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`
      }

      const response = await fetch(url, { method: 'GET', headers })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return {
          success: false,
          output: {
            cluster_name: '',
            status: 'red',
            timed_out: true,
            number_of_nodes: 0,
            number_of_data_nodes: 0,
            active_primary_shards: 0,
            active_shards: 0,
            relocating_shards: 0,
            initializing_shards: 0,
            unassigned_shards: 0,
            delayed_unassigned_shards: 0,
            number_of_pending_tasks: 0,
            number_of_in_flight_fetch: 0,
            task_max_waiting_in_queue_millis: 0,
            active_shards_percent_as_number: 0,
          },
          error: errorMessage,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          cluster_name: data.cluster_name,
          status: data.status,
          timed_out: data.timed_out,
          number_of_nodes: data.number_of_nodes,
          number_of_data_nodes: data.number_of_data_nodes,
          active_primary_shards: data.active_primary_shards,
          active_shards: data.active_shards,
          relocating_shards: data.relocating_shards,
          initializing_shards: data.initializing_shards,
          unassigned_shards: data.unassigned_shards,
          delayed_unassigned_shards: data.delayed_unassigned_shards,
          number_of_pending_tasks: data.number_of_pending_tasks,
          number_of_in_flight_fetch: data.number_of_in_flight_fetch,
          task_max_waiting_in_queue_millis: data.task_max_waiting_in_queue_millis,
          active_shards_percent_as_number: data.active_shards_percent_as_number,
        },
      }
    },

    elasticsearch_cluster_stats: async (params) => {
      const baseUrl = buildBaseUrl(params)
      const headers = buildAuthHeaders(params)

      const response = await fetch(`${baseUrl}/_cluster/stats`, { method: 'GET', headers })

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response)
        return {
          success: false,
          output: {
            cluster_name: '',
            cluster_uuid: '',
            status: 'red',
            nodes: { count: { total: 0, data: 0, master: 0 }, versions: [] },
            indices: { count: 0, docs: { count: 0, deleted: 0 }, store: { size_in_bytes: 0 }, shards: { total: 0, primaries: 0 } },
          },
          error: errorMessage,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          cluster_name: data.cluster_name,
          cluster_uuid: data.cluster_uuid,
          status: data.status,
          nodes: {
            count: data.nodes?.count || { total: 0, data: 0, master: 0 },
            versions: data.nodes?.versions || [],
          },
          indices: {
            count: data.indices?.count || 0,
            docs: data.indices?.docs || { count: 0, deleted: 0 },
            store: data.indices?.store || { size_in_bytes: 0 },
            shards: data.indices?.shards || { total: 0, primaries: 0 },
          },
        },
      }
    },
  },
}

export default handler
