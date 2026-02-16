import type { ToolHandler } from '../../sdk/types'

const ENRICH_API_BASE = 'https://api.enrich.so/v1/api'

function enrichHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function enrichGet(path: string, apiKey: string, queryParams?: URLSearchParams): Promise<Record<string, unknown>> {
  const url = new URL(`${ENRICH_API_BASE}${path}`)
  if (queryParams) {
    queryParams.forEach((value, key) => url.searchParams.append(key, value))
  }
  const response = await fetch(url.toString(), { method: 'GET', headers: enrichHeaders(apiKey) })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Enrich API error: ${response.status} - ${errorText}`)
  }
  return response.json()
}

async function enrichPost(path: string, apiKey: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${ENRICH_API_BASE}${path}`, {
    method: 'POST',
    headers: enrichHeaders(apiKey),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Enrich API error: ${response.status} - ${errorText}`)
  }
  return response.json()
}

function extractApiKey(params: Record<string, unknown>, ctx: { apiKey?: string }): string | null {
  return (ctx.apiKey || params.apiKey) as string | null
}

const handler: ToolHandler = {
  operations: {
    enrich_check_credits: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const data = await enrichGet('/auth', apiKey)
      return {
        success: true,
        output: {
          totalCredits: data.total_credits ?? 0,
          creditsUsed: data.credits_used ?? 0,
          creditsRemaining: data.credits_remaining ?? 0,
        },
      }
    },

    enrich_email_to_profile: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.email) return { success: false, output: {}, error: 'Missing required parameter: email' }

      const qp = new URLSearchParams({ email: (params.email as string).trim() })
      if (params.inRealtime !== undefined) qp.append('in_realtime', String(params.inRealtime))

      const data = await enrichGet('/person', apiKey, qp)

      const positions = data.positions as Record<string, unknown> | undefined
      const positionHistory = ((positions?.positionHistory as Array<Record<string, unknown>>) || []).map((pos) => {
        const company = pos.company as Record<string, unknown> | undefined
        const dates = pos.startEndDate as Record<string, Record<string, unknown>> | undefined
        return {
          title: pos.title ?? '',
          company: company?.companyName ?? '',
          startDate: dates?.start ? `${dates.start.year}-${dates.start.month ?? 1}` : null,
          endDate: dates?.end ? `${dates.end.year}-${dates.end.month ?? 1}` : null,
          location: company?.companyLocation ?? null,
        }
      })

      const schools = data.schools as Record<string, unknown> | undefined
      const education = ((schools?.educationHistory as Array<Record<string, unknown>>) || []).map((edu) => {
        const school = edu.school as Record<string, unknown> | undefined
        const dates = edu.startEndDate as Record<string, Record<string, unknown>> | undefined
        return {
          school: school?.schoolName ?? '',
          degree: edu.degreeName ?? null,
          fieldOfStudy: edu.fieldOfStudy ?? null,
          startDate: dates?.start?.year ? String(dates.start.year) : null,
          endDate: dates?.end?.year ? String(dates.end.year) : null,
        }
      })

      const certifications = ((data.certifications as Array<Record<string, unknown>>) || []).map((cert) => ({
        name: cert.name ?? '',
        authority: cert.authority ?? null,
        url: cert.url ?? null,
      }))

      return {
        success: true,
        output: {
          displayName: data.displayName ?? null, firstName: data.firstName ?? null,
          lastName: data.lastName ?? null, headline: data.headline ?? null,
          occupation: data.occupation ?? null, summary: data.summary ?? null,
          location: data.location ?? null, country: data.country ?? null,
          linkedInUrl: data.linkedInUrl ?? null, photoUrl: data.photoUrl ?? null,
          connectionCount: data.connectionCount ?? null,
          positionHistory, education, certifications,
          skills: data.skills ?? [], languages: data.languages ?? [],
        },
      }
    },

    enrich_email_to_person_lite: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.email) return { success: false, output: {}, error: 'Missing required parameter: email' }

      const data = await enrichGet('/person-lite', apiKey, new URLSearchParams({ email: (params.email as string).trim() }))
      return { success: true, output: data }
    },

    enrich_linkedin_profile: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.linkedinUrl) return { success: false, output: {}, error: 'Missing required parameter: linkedinUrl' }

      const qp = new URLSearchParams({ linkedin_url: (params.linkedinUrl as string).trim() })
      if (params.inRealtime !== undefined) qp.append('in_realtime', String(params.inRealtime))

      const data = await enrichGet('/person', apiKey, qp)
      return { success: true, output: data }
    },

    enrich_find_email: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.fullName || !params.companyDomain) return { success: false, output: {}, error: 'Missing required parameters: fullName, companyDomain' }

      const data = await enrichGet('/find-email', apiKey, new URLSearchParams({
        fullName: (params.fullName as string).trim(),
        companyDomain: (params.companyDomain as string).trim(),
      }))

      if ((data.status as string) === 'in_progress' || ((data.message as string) || '').includes('queued')) {
        return { success: true, output: { email: null, firstName: null, lastName: null, domain: null, found: false, acceptAll: null } }
      }

      return {
        success: true,
        output: {
          email: data.email ?? null, firstName: data.firstName ?? null,
          lastName: data.lastName ?? null, domain: data.domain ?? null,
          found: data.found ?? false, acceptAll: data.acceptAll ?? null,
        },
      }
    },

    enrich_linkedin_to_work_email: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.linkedinUrl) return { success: false, output: {}, error: 'Missing required parameter: linkedinUrl' }

      const data = await enrichGet('/linkedin-to-work-email', apiKey, new URLSearchParams({ linkedin_url: (params.linkedinUrl as string).trim() }))
      return { success: true, output: data }
    },

    enrich_linkedin_to_personal_email: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.linkedinUrl) return { success: false, output: {}, error: 'Missing required parameter: linkedinUrl' }

      const data = await enrichGet('/linkedin-to-personal-email', apiKey, new URLSearchParams({ linkedin_url: (params.linkedinUrl as string).trim() }))
      return { success: true, output: data }
    },

    enrich_phone_finder: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.linkedinUrl) return { success: false, output: {}, error: 'Missing required parameter: linkedinUrl' }

      const data = await enrichGet('/phone-finder', apiKey, new URLSearchParams({ linkedin_url: (params.linkedinUrl as string).trim() }))
      return { success: true, output: data }
    },

    enrich_email_to_phone: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.email) return { success: false, output: {}, error: 'Missing required parameter: email' }

      const data = await enrichGet('/email-to-phone', apiKey, new URLSearchParams({ email: (params.email as string).trim() }))
      return { success: true, output: data }
    },

    enrich_verify_email: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.email) return { success: false, output: {}, error: 'Missing required parameter: email' }

      const data = await enrichGet('/verify-email', apiKey, new URLSearchParams({ email: (params.email as string).trim() }))
      return { success: true, output: data }
    },

    enrich_disposable_email_check: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.email) return { success: false, output: {}, error: 'Missing required parameter: email' }

      const data = await enrichGet('/disposable-email', apiKey, new URLSearchParams({ email: (params.email as string).trim() }))
      return { success: true, output: data }
    },

    enrich_email_to_ip: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.email) return { success: false, output: {}, error: 'Missing required parameter: email' }

      const data = await enrichGet('/email-to-ip', apiKey, new URLSearchParams({ email: (params.email as string).trim() }))
      return { success: true, output: data }
    },

    enrich_ip_to_company: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.ip) return { success: false, output: {}, error: 'Missing required parameter: ip' }

      const data = await enrichGet('/ip-to-company', apiKey, new URLSearchParams({ ip: (params.ip as string).trim() }))
      return { success: true, output: data }
    },

    enrich_company_lookup: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.name) qp.append('name', (params.name as string).trim())
      if (params.domain) qp.append('domain', (params.domain as string).trim())

      const data = await enrichGet('/company', apiKey, qp)

      const fundingRounds = ((data.fundingData as Array<Record<string, unknown>>) || []).map((round) => {
        const moneyRaised = round.moneyRaised as Record<string, unknown> | undefined
        return {
          roundType: round.fundingRound ?? '',
          amount: moneyRaised?.amount ?? null,
          currency: moneyRaised?.currency ?? null,
          investors: round.investors ?? [],
        }
      })

      return {
        success: true,
        output: {
          name: data.name ?? null, universalName: data.universal_name ?? null,
          companyId: data.company_id ?? null, description: data.description ?? null,
          phone: data.phone ?? null, linkedInUrl: data.url ?? null,
          websiteUrl: data.website ?? null, followers: data.followers ?? null,
          staffCount: data.staffCount ?? null, foundedDate: data.founded ?? null,
          type: data.type ?? null, industries: data.industries ?? [],
          specialties: data.specialities ?? [],
          headquarters: {
            city: (data.headquarter as Record<string, unknown>)?.city ?? null,
            country: (data.headquarter as Record<string, unknown>)?.country ?? null,
            postalCode: (data.headquarter as Record<string, unknown>)?.postalCode ?? null,
            line1: (data.headquarter as Record<string, unknown>)?.line1 ?? null,
          },
          logo: data.logo ?? null, coverImage: data.cover ?? null, fundingRounds,
        },
      }
    },

    enrich_company_funding: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.name) qp.append('name', (params.name as string).trim())
      if (params.domain) qp.append('domain', (params.domain as string).trim())

      const data = await enrichGet('/company-funding', apiKey, qp)
      return { success: true, output: data }
    },

    enrich_company_revenue: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.name) qp.append('name', (params.name as string).trim())
      if (params.domain) qp.append('domain', (params.domain as string).trim())

      const data = await enrichGet('/company-revenue', apiKey, qp)
      return { success: true, output: data }
    },

    enrich_search_people: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.firstName) body.first_name = params.firstName
      if (params.lastName) body.last_name = params.lastName
      if (params.title) body.title = params.title
      if (params.companyName) body.company_name = params.companyName
      if (params.location) body.location = params.location
      if (params.industries) body.industries = params.industries
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-people', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_search_company: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.website) body.website = params.website
      if (params.tagline) body.tagline = params.tagline
      if (params.type) body.type = params.type
      if (params.description) body.description = params.description
      if (params.industries) body.industries = params.industries
      if (params.locationCountry) body.location_country = params.locationCountry
      if (params.locationCity) body.location_city = params.locationCity
      if (params.postalCode) body.postal_code = params.postalCode
      if (params.locationCountryList) body.location_country_list = params.locationCountryList
      if (params.locationCityList) body.location_city_list = params.locationCityList
      if (params.specialities) body.specialities = params.specialities
      if (params.followers !== undefined) body.followers = params.followers
      if (params.staffCount !== undefined) body.staff_count = params.staffCount
      if (params.staffCountMin !== undefined) body.staff_count_min = params.staffCountMin
      if (params.staffCountMax !== undefined) body.staff_count_max = params.staffCountMax
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-company', apiKey, body)
      const resultData = (data.data ?? {}) as Record<string, unknown>
      const companies = ((resultData.companies as Array<Record<string, unknown>>) || []).map((c) => ({
        companyName: c.company_name ?? '', tagline: c.tagline ?? null,
        webAddress: c.web_address ?? null, industries: c.industries ?? [],
        teamSize: c.team_size ?? null, linkedInProfile: c.linkedin_profile ?? null,
      }))
      return {
        success: true,
        output: {
          currentPage: resultData.current_page ?? 1, totalPage: resultData.total_page ?? 1,
          pageSize: resultData.page_size ?? 20, companies,
        },
      }
    },

    enrich_search_company_employees: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.companyName) body.company_name = params.companyName
      if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-company-employees', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_search_similar_companies: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.companyName) body.company_name = params.companyName
      if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl

      const data = await enrichPost('/search-similar-companies', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_sales_pointer_people: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/sales-pointer-people', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_search_posts: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-posts', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_get_post_details: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.postUrl) return { success: false, output: {}, error: 'Missing required parameter: postUrl' }

      const data = await enrichGet('/get-post-details', apiKey, new URLSearchParams({ post_url: (params.postUrl as string).trim() }))
      return { success: true, output: data }
    },

    enrich_search_post_reactions: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.postUrl) body.post_url = params.postUrl
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-post-reactions', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_search_post_comments: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.postUrl) body.post_url = params.postUrl
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-post-comments', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_search_people_activities: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-people-activities', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_search_company_activities: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body: Record<string, unknown> = {}
      if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl
      if (params.currentPage) body.current_page = params.currentPage
      if (params.pageSize) body.page_size = params.pageSize

      const data = await enrichPost('/search-company-activities', apiKey, body)
      return { success: true, output: data.data ?? data }
    },

    enrich_reverse_hash_lookup: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!params.hash) return { success: false, output: {}, error: 'Missing required parameter: hash' }

      const data = await enrichGet('/reverse-hash-lookup', apiKey, new URLSearchParams({ hash: (params.hash as string).trim() }))
      return { success: true, output: data }
    },

    enrich_search_logo: async (params, ctx) => {
      const apiKey = extractApiKey(params, ctx)
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const qp = new URLSearchParams()
      if (params.name) qp.append('name', (params.name as string).trim())
      if (params.domain) qp.append('domain', (params.domain as string).trim())

      const data = await enrichGet('/search-logo', apiKey, qp)
      return { success: true, output: data }
    },
  },
}

export default handler
