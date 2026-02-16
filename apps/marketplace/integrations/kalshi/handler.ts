import type { ToolHandler } from '../../sdk/types'

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

function buildUrl(path: string, queryParams?: Record<string, string | undefined>): string {
  const url = new URL(`${KALSHI_BASE_URL}${path}`)
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function handleError(data: Record<string, unknown>, operation: string): string {
  return (data.error as Record<string, unknown>)?.message?.toString()
    ?? (data.error as string)
    ?? (data.message as string)
    ?? (data.detail as string)
    ?? `Kalshi ${operation} failed`
}

const handler: ToolHandler = {
  operations: {
    kalshi_get_events: async (params) => {
      const url = buildUrl('/events', {
        status: params.status as string,
        series_ticker: params.seriesTicker as string,
        with_nested_markets: params.withNestedMarkets as string,
        limit: params.limit as string,
        cursor: params.cursor as string,
      })

      const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_events') }

      return { success: true, output: { events: data.events ?? [], paging: { cursor: data.cursor ?? null } } }
    },

    kalshi_get_event: async (params) => {
      const eventTicker = params.eventTicker as string
      if (!eventTicker) return { success: false, output: {}, error: 'Missing required parameter: eventTicker' }

      const url = buildUrl(`/events/${encodeURIComponent(eventTicker)}`, {
        with_nested_markets: params.withNestedMarkets as string,
      })

      const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_event') }

      return { success: true, output: { event: data.event ?? data } }
    },

    kalshi_get_markets: async (params) => {
      const url = buildUrl('/markets', {
        event_ticker: params.eventTicker as string,
        series_ticker: params.seriesTicker as string,
        status: params.status as string,
        limit: params.limit as string,
        cursor: params.cursor as string,
      })

      const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_markets') }

      return { success: true, output: { markets: data.markets ?? [], paging: { cursor: data.cursor ?? null } } }
    },

    kalshi_get_market: async (params) => {
      const ticker = params.ticker as string
      if (!ticker) return { success: false, output: {}, error: 'Missing required parameter: ticker' }

      const response = await fetch(buildUrl(`/markets/${encodeURIComponent(ticker)}`), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_market') }

      return { success: true, output: { market: data.market ?? data } }
    },

    kalshi_get_orderbook: async (params) => {
      const ticker = params.ticker as string
      if (!ticker) return { success: false, output: {}, error: 'Missing required parameter: ticker' }

      const url = buildUrl(`/markets/${encodeURIComponent(ticker)}/orderbook`, {
        depth: params.depth as string,
      })

      const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_orderbook') }

      return { success: true, output: { orderbook: data.orderbook ?? data } }
    },

    kalshi_get_trades: async (params) => {
      const url = buildUrl('/markets/trades', {
        ticker: params.ticker as string,
        limit: params.limit as string,
        cursor: params.cursor as string,
        min_ts: params.minTs as string,
        max_ts: params.maxTs as string,
      })

      const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_trades') }

      return { success: true, output: { trades: data.trades ?? [], paging: { cursor: data.cursor ?? null } } }
    },

    kalshi_get_candlesticks: async (params) => {
      const ticker = params.ticker as string
      if (!ticker) return { success: false, output: {}, error: 'Missing required parameter: ticker' }

      const url = buildUrl(`/markets/${encodeURIComponent(ticker)}/candlesticks`, {
        series_ticker: params.seriesTicker as string,
        start_ts: params.startTs as string,
        end_ts: params.endTs as string,
        period_interval: params.periodInterval as string,
      })

      const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_candlesticks') }

      return { success: true, output: { candlesticks: data.candlesticks ?? [] } }
    },

    kalshi_get_series_by_ticker: async (params) => {
      const seriesTicker = params.seriesTicker as string
      if (!seriesTicker) return { success: false, output: {}, error: 'Missing required parameter: seriesTicker' }

      const response = await fetch(buildUrl(`/series/${encodeURIComponent(seriesTicker)}`), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_series_by_ticker') }

      return { success: true, output: { series: data.series ?? data } }
    },

    kalshi_get_exchange_status: async () => {
      const response = await fetch(buildUrl('/exchange/status'), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json()
      if (!response.ok) return { success: false, output: {}, error: handleError(data, 'get_exchange_status') }

      return {
        success: true,
        output: { trading_active: data.trading_active ?? false, exchange_active: data.exchange_active ?? false },
      }
    },

    kalshi_get_balance: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },

    kalshi_get_positions: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },

    kalshi_get_orders: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },

    kalshi_get_order: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },

    kalshi_get_fills: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },

    kalshi_create_order: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },

    kalshi_cancel_order: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },

    kalshi_amend_order: async (params) => {
      const keyId = params.keyId as string
      const privateKey = params.privateKey as string
      if (!keyId || !privateKey) {
        return { success: false, output: {}, error: 'Missing required parameters: keyId, privateKey (authentication required)' }
      }

      return { success: false, output: {}, error: 'Authenticated Kalshi operations require RSA-PSS signing which needs Node.js crypto module. Use the API proxy for authenticated requests.' }
    },
  },
}

export default handler
