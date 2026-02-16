import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    airweave_search: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const collectionId = params.collectionId as string
      const query = params.query as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!collectionId) return { success: false, output: {}, error: 'Missing required parameter: collectionId' }
      if (!query) return { success: false, output: {}, error: 'Missing required parameter: query' }

      const body: Record<string, any> = { query }

      if (params.limit !== undefined) body.limit = Number(params.limit)
      if (params.retrievalStrategy) body.retrieval_strategy = params.retrievalStrategy
      if (params.expandQuery !== undefined) body.expand_query = params.expandQuery
      if (params.rerank !== undefined) body.rerank = params.rerank
      if (params.generateAnswer !== undefined) body.generate_answer = params.generateAnswer

      const resp = await fetch(`https://api.airweave.ai/collections/${collectionId}/search`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          output: { results: [] },
          error: (data as any).detail ?? (data as any).message ?? `Airweave API error: ${resp.status}`,
        }
      }

      const data = await resp.json()
      const output: Record<string, unknown> = {
        results: (data.results ?? []).map((result: any) => ({
          entity_id: result.entity_id ?? result.id ?? '',
          source_name: result.source_name ?? '',
          md_content: result.md_content ?? null,
          score: result.score ?? 0,
          metadata: result.metadata ?? null,
          breadcrumbs: result.breadcrumbs ?? null,
          url: result.url ?? null,
        })),
      }

      if (data.completion) {
        output.completion = data.completion
      }

      return { success: true, output }
    },
  },
}

export default handler
