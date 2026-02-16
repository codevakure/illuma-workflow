import type { ToolHandler } from '../../sdk/types'

function cleanDomain(domain: string): string {
  return domain
    ?.trim()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\/$/, '')
}

function buildTimeSeriesUrl(
  path: string,
  params: Record<string, unknown>
): string {
  const domain = cleanDomain(params.domain as string)
  const url = new URL(`https://api.similarweb.com/v1/website/${domain}/${path}`)
  url.searchParams.set('api_key', (params.apiKey as string)?.trim())
  url.searchParams.set('country', (params.country as string)?.trim() ?? 'world')
  url.searchParams.set('granularity', (params.granularity as string) ?? 'monthly')
  url.searchParams.set('format', 'json')
  if (params.startDate) url.searchParams.set('start_date', params.startDate as string)
  if (params.endDate) url.searchParams.set('end_date', params.endDate as string)
  if (params.mainDomainOnly !== undefined) {
    url.searchParams.set('main_domain_only', String(params.mainDomainOnly))
  }
  return url.toString()
}

const handler: ToolHandler = {
  operations: {
    similarweb_website_overview: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }

      const cleanedDomain = cleanDomain(domain)
      const url = new URL(
        `https://api.similarweb.com/v1/website/${cleanedDomain}/general-data/all`
      )
      url.searchParams.set('api_key', apiKey.trim())
      url.searchParams.set('format', 'json')

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.message || 'Failed to get website overview',
        }
      }

      const topCountriesRaw = data.TopCountryShares ?? data.top_country_shares ?? []
      const topCountries = topCountriesRaw.map(
        (c: Record<string, unknown>) => ({
          country:
            (c.CountryCode as string) ??
            (c.country_code as string) ??
            String(c.Country ?? c.country ?? ''),
          share: (c.Value as number) ?? (c.value as number) ?? 0,
        })
      )

      const sources = (data.TrafficSources ?? data.traffic_sources ?? {}) as Record<
        string,
        unknown
      >
      const engagements = (data.Engagements ??
        data.engagements ??
        data.engagments ??
        {}) as Record<string, unknown>

      const getGlobalRank = () => {
        if ((data.GlobalRank as Record<string, unknown>)?.Rank !== undefined)
          return (data.GlobalRank as Record<string, unknown>).Rank
        if ((data.global_rank as Record<string, unknown>)?.rank !== undefined)
          return (data.global_rank as Record<string, unknown>).rank
        if (typeof data.GlobalRank === 'number') return data.GlobalRank
        if (typeof data.global_rank === 'number') return data.global_rank
        return null
      }

      const getCountryRank = () => {
        if ((data.CountryRank as Record<string, unknown>)?.Rank !== undefined)
          return (data.CountryRank as Record<string, unknown>).Rank
        if ((data.country_rank as Record<string, unknown>)?.rank !== undefined)
          return (data.country_rank as Record<string, unknown>).rank
        if (typeof data.CountryRank === 'number') return data.CountryRank
        if (typeof data.country_rank === 'number') return data.country_rank
        return null
      }

      const getCategoryRank = () => {
        if ((data.CategoryRank as Record<string, unknown>)?.Rank !== undefined)
          return (data.CategoryRank as Record<string, unknown>).Rank
        if ((data.category_rank as Record<string, unknown>)?.rank !== undefined)
          return (data.category_rank as Record<string, unknown>).rank
        if (typeof data.CategoryRank === 'number') return data.CategoryRank
        if (typeof data.category_rank === 'number') return data.category_rank
        return null
      }

      return {
        success: true,
        output: {
          siteName: data.SiteName ?? data.site_name ?? null,
          description: data.Description ?? data.description ?? null,
          globalRank: getGlobalRank(),
          countryRank: getCountryRank(),
          categoryRank: getCategoryRank(),
          category: data.Category ?? data.category ?? null,
          monthlyVisits: engagements.Visits ?? engagements.visits ?? null,
          engagementVisitDuration: engagements.TimeOnSite ?? engagements.time_on_site ?? null,
          engagementPagesPerVisit: engagements.PagePerVisit ?? engagements.page_per_visit ?? null,
          engagementBounceRate: engagements.BounceRate ?? engagements.bounce_rate ?? null,
          topCountries,
          trafficSources: {
            direct: sources.Direct ?? sources.direct ?? null,
            referrals: sources.Referrals ?? sources.referrals ?? null,
            search: sources.Search ?? sources.search ?? null,
            social: sources.Social ?? sources.social ?? null,
            mail: sources.Mail ?? sources.mail ?? null,
            paidReferrals:
              (sources['Paid Referrals'] as unknown) ?? sources.paid_referrals ?? null,
          },
        },
      }
    },

    similarweb_traffic_visits: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }

      const url = buildTimeSeriesUrl('total-traffic-and-engagement/visits', params)

      const resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.message || 'Failed to get traffic visits',
        }
      }

      const meta = data.meta ?? {}
      const request = meta.request ?? {}

      return {
        success: true,
        output: {
          domain: request.domain ?? null,
          country: request.country ?? null,
          granularity: request.granularity ?? null,
          lastUpdated: meta.last_updated ?? null,
          visits:
            data.visits?.map((v: { date: string; visits: number }) => ({
              date: v.date,
              visits: v.visits,
            })) ?? [],
        },
      }
    },

    similarweb_bounce_rate: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }

      const url = buildTimeSeriesUrl('total-traffic-and-engagement/bounce-rate', params)

      const resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.message || 'Failed to get bounce rate',
        }
      }

      const meta = data.meta ?? {}
      const request = meta.request ?? {}

      return {
        success: true,
        output: {
          domain: request.domain ?? null,
          country: request.country ?? null,
          granularity: request.granularity ?? null,
          lastUpdated: meta.last_updated ?? null,
          bounceRate:
            data.bounce_rate?.map((b: { date: string; bounce_rate: number }) => ({
              date: b.date,
              bounceRate: b.bounce_rate,
            })) ?? [],
        },
      }
    },

    similarweb_pages_per_visit: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }

      const url = buildTimeSeriesUrl('total-traffic-and-engagement/pages-per-visit', params)

      const resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.message || 'Failed to get pages per visit',
        }
      }

      const meta = data.meta ?? {}
      const request = meta.request ?? {}

      return {
        success: true,
        output: {
          domain: request.domain ?? null,
          country: request.country ?? null,
          granularity: request.granularity ?? null,
          lastUpdated: meta.last_updated ?? null,
          pagesPerVisit:
            data.pages_per_visit?.map((p: { date: string; pages_per_visit: number }) => ({
              date: p.date,
              pagesPerVisit: p.pages_per_visit,
            })) ?? [],
        },
      }
    },

    similarweb_visit_duration: async (params) => {
      const apiKey = params.apiKey as string
      const domain = params.domain as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!domain) {
        return { success: false, output: {}, error: 'Missing required parameter: domain' }
      }

      const url = buildTimeSeriesUrl('traffic-and-engagement/average-visit-duration', params)

      const resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const data = await resp.json()

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: data.error?.message || data.message || 'Failed to get visit duration',
        }
      }

      const meta = data.meta ?? {}
      const request = meta.request ?? {}

      return {
        success: true,
        output: {
          domain: request.domain ?? null,
          country: request.country ?? null,
          granularity: request.granularity ?? null,
          lastUpdated: meta.last_updated ?? null,
          averageVisitDuration:
            data.average_visit_duration?.map(
              (d: { date: string; average_visit_duration: number }) => ({
                date: d.date,
                durationSeconds: d.average_visit_duration,
              })
            ) ?? [],
        },
      }
    },
  },
}

export default handler
