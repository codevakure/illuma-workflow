import type { ToolHandler } from '../../sdk/types'

function ahrefsHeaders(apiKey: string) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

function defaultDate(): string {
  return new Date().toISOString().split('T')[0]
}

const handler: ToolHandler = {
  operations: {
    ahrefs_domain_rating: async (params) => {
      const apiKey = params.apiKey as string
      const target = params.target as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!target) {
        return { success: false, output: {}, error: 'Missing required parameter: target' }
      }

      const url = new URL('https://api.ahrefs.com/v3/site-explorer/domain-rating')
      url.searchParams.set('target', target)
      url.searchParams.set('date', (params.date as string) || defaultDate())

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get domain rating',
        }
      }

      return {
        success: true,
        output: {
          domainRating: data.domain_rating ?? 0,
          ahrefsRank: data.ahrefs_rank ?? 0,
        },
      }
    },

    ahrefs_backlinks: async (params) => {
      const apiKey = params.apiKey as string
      const target = params.target as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!target) {
        return { success: false, output: {}, error: 'Missing required parameter: target' }
      }

      const url = new URL('https://api.ahrefs.com/v3/site-explorer/backlinks')
      url.searchParams.set('target', target)
      url.searchParams.set('date', (params.date as string) || defaultDate())
      if (params.mode) url.searchParams.set('mode', params.mode as string)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get backlinks',
        }
      }

      const backlinks = (data.backlinks || []).map((link: Record<string, unknown>) => ({
        urlFrom: link.url_from || '',
        urlTo: link.url_to || '',
        anchor: link.anchor || '',
        domainRatingSource: link.domain_rating_source ?? link.domain_rating ?? 0,
        isDofollow: link.is_dofollow ?? link.dofollow ?? false,
        firstSeen: link.first_seen || '',
        lastVisited: link.last_visited || '',
      }))

      return {
        success: true,
        output: { backlinks },
      }
    },

    ahrefs_backlinks_stats: async (params) => {
      const apiKey = params.apiKey as string
      const target = params.target as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!target) {
        return { success: false, output: {}, error: 'Missing required parameter: target' }
      }

      const url = new URL('https://api.ahrefs.com/v3/site-explorer/backlinks-stats')
      url.searchParams.set('target', target)
      url.searchParams.set('date', (params.date as string) || defaultDate())
      if (params.mode) url.searchParams.set('mode', params.mode as string)

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get backlinks stats',
        }
      }

      return {
        success: true,
        output: {
          stats: {
            total: data.live ?? data.total ?? 0,
            dofollow: data.live_dofollow ?? data.dofollow ?? 0,
            nofollow: data.live_nofollow ?? data.nofollow ?? 0,
            text: data.text ?? 0,
            image: data.image ?? 0,
            redirect: data.redirect ?? 0,
          },
        },
      }
    },

    ahrefs_broken_backlinks: async (params) => {
      const apiKey = params.apiKey as string
      const target = params.target as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!target) {
        return { success: false, output: {}, error: 'Missing required parameter: target' }
      }

      const url = new URL('https://api.ahrefs.com/v3/site-explorer/broken-backlinks')
      url.searchParams.set('target', target)
      url.searchParams.set('date', (params.date as string) || defaultDate())
      if (params.mode) url.searchParams.set('mode', params.mode as string)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get broken backlinks',
        }
      }

      const brokenBacklinks = (data.backlinks || data.broken_backlinks || []).map(
        (link: Record<string, unknown>) => ({
          urlFrom: link.url_from || '',
          urlTo: link.url_to || '',
          httpCode: link.http_code ?? link.status_code ?? 404,
          anchor: link.anchor || '',
          domainRatingSource: link.domain_rating_source ?? link.domain_rating ?? 0,
        })
      )

      return {
        success: true,
        output: { brokenBacklinks },
      }
    },

    ahrefs_referring_domains: async (params) => {
      const apiKey = params.apiKey as string
      const target = params.target as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!target) {
        return { success: false, output: {}, error: 'Missing required parameter: target' }
      }

      const url = new URL('https://api.ahrefs.com/v3/site-explorer/refdomains')
      url.searchParams.set('target', target)
      url.searchParams.set('date', (params.date as string) || defaultDate())
      if (params.mode) url.searchParams.set('mode', params.mode as string)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get referring domains',
        }
      }

      const referringDomains = (data.refdomains || data.referring_domains || []).map(
        (domain: Record<string, unknown>) => ({
          domain: domain.domain || domain.refdomain || '',
          domainRating: domain.domain_rating ?? 0,
          backlinks: domain.backlinks ?? 0,
          dofollowBacklinks: domain.dofollow_backlinks ?? domain.dofollow ?? 0,
          firstSeen: domain.first_seen || '',
          lastVisited: domain.last_visited || '',
        })
      )

      return {
        success: true,
        output: { referringDomains },
      }
    },

    ahrefs_organic_keywords: async (params) => {
      const apiKey = params.apiKey as string
      const target = params.target as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!target) {
        return { success: false, output: {}, error: 'Missing required parameter: target' }
      }

      const url = new URL('https://api.ahrefs.com/v3/site-explorer/organic-keywords')
      url.searchParams.set('target', target)
      url.searchParams.set('country', (params.country as string) || 'us')
      url.searchParams.set('date', (params.date as string) || defaultDate())
      if (params.mode) url.searchParams.set('mode', params.mode as string)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get organic keywords',
        }
      }

      const keywords = (data.keywords || data.organic_keywords || []).map(
        (kw: Record<string, unknown>) => ({
          keyword: kw.keyword || '',
          volume: kw.volume ?? 0,
          position: kw.position ?? 0,
          url: kw.url || '',
          traffic: kw.traffic ?? 0,
          keywordDifficulty: kw.keyword_difficulty ?? kw.difficulty ?? 0,
        })
      )

      return {
        success: true,
        output: { keywords },
      }
    },

    ahrefs_top_pages: async (params) => {
      const apiKey = params.apiKey as string
      const target = params.target as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!target) {
        return { success: false, output: {}, error: 'Missing required parameter: target' }
      }

      const url = new URL('https://api.ahrefs.com/v3/site-explorer/top-pages')
      url.searchParams.set('target', target)
      url.searchParams.set('country', (params.country as string) || 'us')
      url.searchParams.set('date', (params.date as string) || defaultDate())
      url.searchParams.set(
        'select',
        (params.select as string) || 'url,traffic,keywords,top_keyword,value'
      )
      if (params.mode) url.searchParams.set('mode', params.mode as string)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get top pages',
        }
      }

      const pages = (data.pages || data.top_pages || []).map(
        (page: Record<string, unknown>) => ({
          url: page.url || '',
          traffic: page.traffic ?? 0,
          keywords: page.keywords ?? page.keyword_count ?? 0,
          topKeyword: page.top_keyword || '',
          value: page.value ?? page.traffic_value ?? 0,
        })
      )

      return {
        success: true,
        output: { pages },
      }
    },

    ahrefs_keyword_overview: async (params) => {
      const apiKey = params.apiKey as string
      const keyword = params.keyword as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!keyword) {
        return { success: false, output: {}, error: 'Missing required parameter: keyword' }
      }

      const url = new URL('https://api.ahrefs.com/v3/keywords-explorer/overview')
      url.searchParams.set('keyword', keyword)
      url.searchParams.set('country', (params.country as string) || 'us')

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: ahrefsHeaders(apiKey),
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.error || 'Failed to get keyword overview',
        }
      }

      return {
        success: true,
        output: {
          overview: {
            keyword: data.keyword || '',
            searchVolume: data.volume ?? 0,
            keywordDifficulty: data.keyword_difficulty ?? data.difficulty ?? 0,
            cpc: data.cpc ?? 0,
            clicks: data.clicks ?? 0,
            clicksPercentage: data.clicks_percentage ?? 0,
            parentTopic: data.parent_topic || '',
            trafficPotential: data.traffic_potential ?? 0,
          },
        },
      }
    },
  },
}

export default handler
