import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    pinecone_search_vector: async (params, ctx) => {
      const indexHost = params.indexHost as string
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const namespace = params.namespace as string | undefined

      if (!indexHost || !apiKey) {
        return { success: false, output: {}, error: 'Missing required parameters: indexHost, apiKey' }
      }

      const vector = typeof params.vector === 'string'
        ? JSON.parse(params.vector as string)
        : params.vector

      if (!vector || !Array.isArray(vector)) {
        return { success: false, output: {}, error: 'Missing required parameter: vector (must be an array)' }
      }

      const filter = params.filter
        ? typeof params.filter === 'string'
          ? JSON.parse(params.filter as string)
          : params.filter
        : undefined

      const body: Record<string, unknown> = {
        namespace,
        vector,
        topK: params.topK ? Number(params.topK) : 10,
        filter,
        includeValues: true,
        includeMetadata: true,
      }

      const response = await fetch(`${indexHost}/query`, {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Pinecone error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          matches: (data.matches || []).map((match: Record<string, unknown>) => ({
            id: match.id,
            score: match.score,
            values: match.values,
            metadata: match.metadata,
          })),
          namespace: data.namespace,
        },
      }
    },

    pinecone_search_text: async (params, ctx) => {
      const indexHost = params.indexHost as string
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const namespace = params.namespace as string | undefined
      const searchQuery = params.searchQuery as string

      if (!indexHost || !apiKey || !searchQuery) {
        return { success: false, output: {}, error: 'Missing required parameters: indexHost, apiKey, searchQuery' }
      }

      const query: Record<string, unknown> = {
        inputs: { text: searchQuery },
        top_k: params.topK ? Number(params.topK) : 10,
      }

      const body: Record<string, unknown> = { query }

      if (params.fields) {
        body.fields = typeof params.fields === 'string'
          ? JSON.parse(params.fields as string)
          : params.fields
      }

      if (params.filter) {
        query.filter = typeof params.filter === 'string'
          ? JSON.parse(params.filter as string)
          : params.filter
      }

      if (params.rerank) {
        const rerank = typeof params.rerank === 'string'
          ? JSON.parse(params.rerank as string)
          : params.rerank as Record<string, unknown>
        if (!rerank.query) {
          rerank.query = { text: searchQuery }
        }
        body.rerank = rerank
      }

      const response = await fetch(
        `${indexHost}/records/namespaces/${namespace || ''}/search`,
        {
          method: 'POST',
          headers: {
            'Api-Key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Pinecone-API-Version': '2025-01',
          },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Pinecone error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          matches: (data.result?.hits || []).map((hit: Record<string, unknown>) => ({
            id: hit._id,
            score: hit._score,
            metadata: hit.fields,
          })),
          usage: {
            total_tokens: data.usage?.embed_total_tokens || 0,
            read_units: data.usage?.read_units,
            rerank_units: data.usage?.rerank_units,
          },
        },
      }
    },

    pinecone_upsert_text: async (params, ctx) => {
      const indexHost = params.indexHost as string
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const namespace = params.namespace as string

      if (!indexHost || !apiKey || !namespace) {
        return { success: false, output: {}, error: 'Missing required parameters: indexHost, apiKey, namespace' }
      }

      let records: Array<Record<string, unknown>>
      if (typeof params.records === 'string') {
        records = (params.records as string)
          .split('\n')
          .filter((line: string) => line.trim())
          .map((line: string) => JSON.parse(line.trim()))
      } else {
        records = Array.isArray(params.records)
          ? params.records as Array<Record<string, unknown>>
          : [params.records as Record<string, unknown>]
      }

      const ndjson = records.map((r) => JSON.stringify(r)).join('\n')

      const response = await fetch(
        `${indexHost}/records/namespaces/${namespace}/upsert`,
        {
          method: 'POST',
          headers: {
            'Api-Key': apiKey,
            'Content-Type': 'application/x-ndjson',
            'X-Pinecone-API-Version': '2025-01',
          },
          body: ndjson,
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Pinecone upsert error: ${response.status} - ${errorText}` }
      }

      return {
        success: true,
        output: {
          statusText: response.status === 201 ? 'Created' : response.statusText,
        },
      }
    },

    pinecone_fetch: async (params, ctx) => {
      const indexHost = params.indexHost as string
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const ids = params.ids as string[]
      const namespace = params.namespace as string | undefined

      if (!indexHost || !apiKey || !ids || ids.length === 0) {
        return { success: false, output: {}, error: 'Missing required parameters: indexHost, apiKey, ids' }
      }

      const queryParams = new URLSearchParams()
      queryParams.append('ids', ids.join(','))
      if (namespace) {
        queryParams.append('namespace', namespace)
      }

      const response = await fetch(
        `${indexHost}/vectors/fetch?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: {
            'Api-Key': apiKey,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Pinecone fetch error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()
      const vectors = data.vectors as Record<string, Record<string, unknown>> || {}

      return {
        success: true,
        output: {
          matches: Object.entries(vectors).map(([id, vector]) => ({
            id,
            values: vector.values,
            metadata: vector.metadata,
            score: 1.0,
          })),
          data: Object.values(vectors).map((vector) => ({
            values: vector.values,
            vector_type: 'dense',
          })),
          usage: {
            total_tokens: data.usage?.readUnits || 0,
          },
        },
      }
    },

    pinecone_generate_embeddings: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const model = params.model as string
      const inputs = params.inputs as Array<{ text: string }>

      if (!apiKey || !model || !inputs) {
        return { success: false, output: {}, error: 'Missing required parameters: apiKey, model, inputs' }
      }

      const response = await fetch('https://api.pinecone.io/embed', {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
          'X-Pinecone-API-Version': '2025-01',
        },
        body: JSON.stringify({
          model,
          inputs,
          parameters: (params.parameters as Record<string, unknown>) || {
            input_type: 'passage',
            truncate: 'END',
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Pinecone embeddings error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          data: data.data,
          model: data.model,
          vector_type: data.vector_type,
          usage: data.usage,
        },
      }
    },
  },
}

export default handler
