import type { ToolHandler } from '../../sdk/types'

const GAMMA_URL = 'https://gamma-api.polymarket.com'
const CLOB_URL = 'https://clob.polymarket.com'
const DATA_URL = 'https://data-api.polymarket.com'

function buildQuery(params: Record<string, unknown>, mapping: Record<string, string>): string {
  const sp = new URLSearchParams()
  for (const [paramKey, queryKey] of Object.entries(mapping)) {
    const val = params[paramKey]
    if (val !== undefined && val !== null && val !== '') sp.set(queryKey, String(val))
  }
  return sp.toString()
}

async function fetchJson(url: string, operation: string): Promise<{ ok: boolean; data: unknown }> {
  const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
  const data = await response.json()
  if (!response.ok) {
    const msg = typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>).error?.toString() ?? (data as Record<string, unknown>).message?.toString() ?? `Polymarket ${operation} failed`
      : `Polymarket ${operation} failed: ${response.status}`
    throw new Error(msg)
  }
  return { ok: true, data }
}

const handler: ToolHandler = {
  operations: {
    polymarket_get_events: async (params) => {
      try {
        const qs = buildQuery(params, { closed: 'closed', order: 'order', ascending: 'ascending', tagId: 'tag_id', limit: 'limit', offset: 'offset' })
        if (!qs.includes('limit=')) {
          const sp = new URLSearchParams(qs)
          sp.set('limit', '50')
        }
        const { data } = await fetchJson(`${GAMMA_URL}/events?${qs}`, 'get_events')
        return { success: true, output: { events: Array.isArray(data) ? data : [] } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get events' } }
    },

    polymarket_get_event: async (params) => {
      const id = params.id as string
      if (!id) return { success: false, output: {}, error: 'Missing required parameter: id' }
      try {
        const { data } = await fetchJson(`${GAMMA_URL}/events/${encodeURIComponent(id)}`, 'get_event')
        return { success: true, output: { event: data } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get event' } }
    },

    polymarket_get_markets: async (params) => {
      try {
        const qs = buildQuery(params, { closed: 'closed', order: 'order', ascending: 'ascending', limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${GAMMA_URL}/markets?${qs}`, 'get_markets')
        return { success: true, output: { markets: Array.isArray(data) ? data : [] } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get markets' } }
    },

    polymarket_get_market: async (params) => {
      const conditionId = params.conditionId as string
      if (!conditionId) return { success: false, output: {}, error: 'Missing required parameter: conditionId' }
      try {
        const { data } = await fetchJson(`${GAMMA_URL}/markets/${encodeURIComponent(conditionId)}`, 'get_market')
        return { success: true, output: { market: data } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get market' } }
    },

    polymarket_get_orderbook: async (params) => {
      const tokenId = params.tokenId as string
      if (!tokenId) return { success: false, output: {}, error: 'Missing required parameter: tokenId' }
      try {
        const { data } = await fetchJson(`${CLOB_URL}/book?token_id=${encodeURIComponent(tokenId)}`, 'get_orderbook')
        return { success: true, output: { orderbook: data } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get orderbook' } }
    },

    polymarket_get_trades: async (params) => {
      try {
        const qs = buildQuery(params, { tokenId: 'asset_id', maker: 'maker', limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${DATA_URL}/trades?${qs}`, 'get_trades')
        return { success: true, output: Array.isArray(data) ? { trades: data } : (data as Record<string, unknown>) }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get trades' } }
    },

    polymarket_get_price: async (params) => {
      const tokenId = params.tokenId as string
      if (!tokenId) return { success: false, output: {}, error: 'Missing required parameter: tokenId' }
      try {
        const side = (params.side as string) || 'buy'
        const { data } = await fetchJson(`${CLOB_URL}/price?token_id=${encodeURIComponent(tokenId)}&side=${side}`, 'get_price')
        return { success: true, output: data as Record<string, unknown> }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get price' } }
    },

    polymarket_get_midpoint: async (params) => {
      const tokenId = params.tokenId as string
      if (!tokenId) return { success: false, output: {}, error: 'Missing required parameter: tokenId' }
      try {
        const { data } = await fetchJson(`${CLOB_URL}/midpoint?token_id=${encodeURIComponent(tokenId)}`, 'get_midpoint')
        return { success: true, output: data as Record<string, unknown> }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get midpoint' } }
    },

    polymarket_get_spread: async (params) => {
      const tokenId = params.tokenId as string
      if (!tokenId) return { success: false, output: {}, error: 'Missing required parameter: tokenId' }
      try {
        const { data } = await fetchJson(`${CLOB_URL}/spread?token_id=${encodeURIComponent(tokenId)}`, 'get_spread')
        return { success: true, output: data as Record<string, unknown> }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get spread' } }
    },

    polymarket_get_last_trade_price: async (params) => {
      const tokenId = params.tokenId as string
      if (!tokenId) return { success: false, output: {}, error: 'Missing required parameter: tokenId' }
      try {
        const { data } = await fetchJson(`${CLOB_URL}/last-trade-price?token_id=${encodeURIComponent(tokenId)}`, 'get_last_trade_price')
        return { success: true, output: data as Record<string, unknown> }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get last trade price' } }
    },

    polymarket_get_tick_size: async (params) => {
      const tokenId = params.tokenId as string
      if (!tokenId) return { success: false, output: {}, error: 'Missing required parameter: tokenId' }
      try {
        const { data } = await fetchJson(`${CLOB_URL}/tick-size?token_id=${encodeURIComponent(tokenId)}`, 'get_tick_size')
        return { success: true, output: data as Record<string, unknown> }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get tick size' } }
    },

    polymarket_get_price_history: async (params) => {
      const tokenId = params.tokenId as string
      if (!tokenId) return { success: false, output: {}, error: 'Missing required parameter: tokenId' }
      try {
        const qs = buildQuery(params, { tokenId: 'market', interval: 'interval', fidelity: 'fidelity', startTs: 'startTs', endTs: 'endTs' })
        const { data } = await fetchJson(`${CLOB_URL}/prices-history?${qs}`, 'get_price_history')
        return { success: true, output: data as Record<string, unknown> }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get price history' } }
    },

    polymarket_get_series: async (params) => {
      try {
        const qs = buildQuery(params, { limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${GAMMA_URL}/series?${qs}`, 'get_series')
        return { success: true, output: { series: Array.isArray(data) ? data : [] } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get series' } }
    },

    polymarket_get_series_by_id: async (params) => {
      const id = params.id as string
      if (!id) return { success: false, output: {}, error: 'Missing required parameter: id' }
      try {
        const { data } = await fetchJson(`${GAMMA_URL}/series/${encodeURIComponent(id)}`, 'get_series_by_id')
        return { success: true, output: { series: data } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get series' } }
    },

    polymarket_get_positions: async (params) => {
      const address = params.address as string
      if (!address) return { success: false, output: {}, error: 'Missing required parameter: address' }
      try {
        const qs = buildQuery(params, { address: 'user', limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${DATA_URL}/positions?${qs}`, 'get_positions')
        return { success: true, output: Array.isArray(data) ? { positions: data } : (data as Record<string, unknown>) }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get positions' } }
    },

    polymarket_get_holders: async (params) => {
      const conditionId = params.conditionId as string
      if (!conditionId) return { success: false, output: {}, error: 'Missing required parameter: conditionId' }
      try {
        const qs = buildQuery(params, { conditionId: 'conditionId', limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${DATA_URL}/holders?${qs}`, 'get_holders')
        return { success: true, output: Array.isArray(data) ? { holders: data } : (data as Record<string, unknown>) }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get holders' } }
    },

    polymarket_get_activity: async (params) => {
      const address = params.address as string
      if (!address) return { success: false, output: {}, error: 'Missing required parameter: address' }
      try {
        const qs = buildQuery(params, { address: 'user', limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${DATA_URL}/activity?${qs}`, 'get_activity')
        return { success: true, output: Array.isArray(data) ? { activity: data } : (data as Record<string, unknown>) }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get activity' } }
    },

    polymarket_get_leaderboard: async (params) => {
      try {
        const qs = buildQuery(params, { limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${DATA_URL}/leaderboard?${qs}`, 'get_leaderboard')
        return { success: true, output: Array.isArray(data) ? { leaderboard: data } : (data as Record<string, unknown>) }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get leaderboard' } }
    },

    polymarket_get_tags: async () => {
      try {
        const { data } = await fetchJson(`${GAMMA_URL}/tags`, 'get_tags')
        return { success: true, output: { tags: Array.isArray(data) ? data : [] } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to get tags' } }
    },

    polymarket_search: async (params) => {
      const query = params.query as string
      if (!query) return { success: false, output: {}, error: 'Missing required parameter: query' }
      try {
        const qs = buildQuery(params, { query: 'query', limit: 'limit', offset: 'offset' })
        const { data } = await fetchJson(`${GAMMA_URL}/events?${qs}`, 'search')
        return { success: true, output: { results: Array.isArray(data) ? data : [] } }
      } catch (error) { return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to search' } }
    },
  },
}

export default handler
