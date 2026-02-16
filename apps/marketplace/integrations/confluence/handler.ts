import type { ToolHandler } from '../../sdk/types'

async function getCloudId(domain: string, accessToken: string): Promise<string> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const resources = await response.json()
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('No Confluence resources found')
  }
  const normalizedInput = `https://${domain}`.toLowerCase()
  const matched = resources.find((r: Record<string, string>) => r.url.toLowerCase() === normalizedInput)
  return matched ? matched.id : resources[0].id
}

async function resolveCloudId(params: Record<string, unknown>): Promise<string> {
  if (params.cloudId) return params.cloudId as string
  return getCloudId(params.domain as string, params.accessToken as string)
}

function cfHeaders(accessToken: string, includeContentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
  if (includeContentType) headers['Content-Type'] = 'application/json'
  return headers
}

function cfUrl(cloudId: string, path: string): string {
  return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2${path}`
}

function cfV1Url(cloudId: string, path: string): string {
  return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api${path}`
}

function stripHtml(html: string): string {
  let text = html.replace(/<[^>]*>/g, '')
  text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  return text.replace(/\s+/g, ' ').trim()
}

const handler: ToolHandler = {
  operations: {
    confluence_retrieve: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}?body-format=storage`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const rawContent = data.body?.storage?.value || ''
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          pageId: data.id ?? '',
          title: data.title ?? '',
          content: stripHtml(rawContent),
          status: data.status ?? null,
          spaceId: data.spaceId ?? null,
          parentId: data.parentId ?? null,
          authorId: data.authorId ?? null,
          createdAt: data.createdAt ?? null,
          url: data._links?.webui ?? null,
          body: data.body ?? null,
          version: data.version ?? null,
        },
      }
    },

    confluence_update: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)

      const body: Record<string, unknown> = {
        id: pageId,
        status: 'current',
        version: { number: params.version || 1, message: 'Updated via Sim' },
      }
      if (params.title) body.title = params.title
      if (params.content) {
        body.body = { representation: 'storage', value: params.content }
      }

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}`), {
        method: 'PUT',
        headers: cfHeaders(accessToken, true),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          pageId: data.id ?? '',
          title: data.title ?? '',
          status: data.status ?? null,
          spaceId: data.spaceId ?? null,
          body: data.body ?? null,
          version: data.version ?? null,
          url: data._links?.webui ?? null,
          success: true,
        },
      }
    },

    confluence_create_page: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const spaceId = params.spaceId as string
      const title = params.title as string
      const content = params.content as string
      if (!accessToken || !domain || !spaceId || !title || !content) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)

      const body: Record<string, unknown> = {
        spaceId,
        status: 'current',
        title,
        body: { representation: 'storage', value: content },
      }
      if (params.parentId) body.parentId = params.parentId

      const response = await fetch(cfUrl(cloudId, '/pages'), {
        method: 'POST',
        headers: cfHeaders(accessToken, true),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          pageId: data.id ?? '',
          title: data.title ?? '',
          status: data.status ?? null,
          spaceId: data.spaceId ?? null,
          parentId: data.parentId ?? null,
          body: data.body ?? null,
          version: data.version ?? null,
          url: data._links?.webui ?? '',
        },
      }
    },

    confluence_delete_page: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const purge = params.purge ? '?purge=true' : ''

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}${purge}`), {
        method: 'DELETE',
        headers: cfHeaders(accessToken),
      })

      if (!response.ok && response.status !== 204) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      return { success: true, output: { ts: new Date().toISOString(), pageId, deleted: true } }
    },

    confluence_list_pages_in_space: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const spaceId = params.spaceId as string
      if (!accessToken || !domain || !spaceId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      qp.set('limit', String(params.limit || 50))
      if (params.status) qp.set('status', params.status as string)
      if (params.bodyFormat) qp.set('body-format', params.bodyFormat as string)
      if (params.cursor) qp.set('cursor', params.cursor as string)

      const response = await fetch(cfUrl(cloudId, `/spaces/${spaceId}/pages?${qp.toString()}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          pages: data.results || [],
          nextCursor: data._links?.next ? data._links.cursor : null,
        },
      }
    },

    confluence_get_page_children: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.cursor) qp.set('cursor', params.cursor as string)
      const qs = qp.toString()

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/children${qs ? `?${qs}` : ''}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), pages: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },

    confluence_get_page_ancestors: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/ancestors`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), ancestors: data.results || [] } }
    },

    confluence_list_page_versions: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.cursor) qp.set('cursor', params.cursor as string)
      const qs = qp.toString()

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/versions${qs ? `?${qs}` : ''}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), versions: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },

    confluence_get_page_version: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      const versionNumber = params.versionNumber as string
      if (!accessToken || !domain || !pageId || !versionNumber) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/versions/${versionNumber}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), version: data } }
    },

    confluence_list_page_properties: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/properties`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), properties: data.results || [] } }
    },

    confluence_create_page_property: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      const key = params.key as string
      if (!accessToken || !domain || !pageId || !key) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)

      let value: unknown
      try {
        value = typeof params.value === 'string' ? JSON.parse(params.value as string) : params.value
      } catch {
        value = params.value
      }

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/properties`), {
        method: 'POST',
        headers: cfHeaders(accessToken, true),
        body: JSON.stringify({ key, value }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), property: data } }
    },

    confluence_list_blogposts: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      if (!accessToken || !domain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.cursor) qp.set('cursor', params.cursor as string)
      const qs = qp.toString()

      const response = await fetch(cfUrl(cloudId, `/blogposts${qs ? `?${qs}` : ''}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), blogposts: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },

    confluence_get_blogpost: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const blogPostId = params.blogPostId as string
      if (!accessToken || !domain || !blogPostId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const bodyFormat = params.bodyFormat || 'storage'
      const response = await fetch(cfUrl(cloudId, `/blogposts/${blogPostId}?body-format=${bodyFormat}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          id: data.id ?? '',
          title: data.title ?? '',
          status: data.status ?? null,
          spaceId: data.spaceId ?? null,
          authorId: data.authorId ?? null,
          createdAt: data.createdAt ?? null,
          version: data.version ?? null,
          body: data.body ?? null,
          webUrl: data._links?.webui ?? null,
        },
      }
    },

    confluence_create_blogpost: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const spaceId = params.spaceId as string
      const title = params.title as string
      const content = params.content as string
      if (!accessToken || !domain || !spaceId || !title || !content) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, '/blogposts'), {
        method: 'POST',
        headers: cfHeaders(accessToken, true),
        body: JSON.stringify({
          spaceId,
          status: params.status || 'current',
          title,
          body: { representation: 'storage', value: content },
        }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          id: data.id ?? '',
          title: data.title ?? '',
          status: data.status ?? null,
          spaceId: data.spaceId ?? '',
          authorId: data.authorId ?? null,
          body: data.body ?? null,
          version: data.version ?? null,
          webUrl: data._links?.webui ?? null,
        },
      }
    },

    confluence_list_blogposts_in_space: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const spaceId = params.spaceId as string
      if (!accessToken || !domain || !spaceId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.cursor) qp.set('cursor', params.cursor as string)
      const qs = qp.toString()

      const response = await fetch(cfUrl(cloudId, `/spaces/${spaceId}/blogposts${qs ? `?${qs}` : ''}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), blogposts: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },

    confluence_search: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const query = params.query as string
      if (!accessToken || !domain || !query) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const limit = params.limit ? Number(params.limit) : 25
      const qp = new URLSearchParams({ cql: query, limit: String(limit) })

      const response = await fetch(cfV1Url(cloudId, `/search?${qp.toString()}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const results = (data.results || []).map((r: Record<string, unknown>) => ({
        id: (r.content as Record<string, unknown>)?.id ?? r.id ?? '',
        title: (r.content as Record<string, unknown>)?.title ?? r.title ?? '',
        type: (r.content as Record<string, unknown>)?.type ?? '',
        url: r.url || '',
        excerpt: r.excerpt || '',
      }))

      return { success: true, output: { ts: new Date().toISOString(), results } }
    },

    confluence_search_in_space: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const spaceKey = params.spaceKey as string
      const query = params.query as string
      if (!accessToken || !domain || !spaceKey || !query) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const limit = params.limit ? Number(params.limit) : 25
      const cql = `space = "${spaceKey}" AND ${query}`
      const qp = new URLSearchParams({ cql, limit: String(limit) })

      const response = await fetch(cfV1Url(cloudId, `/search?${qp.toString()}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const results = (data.results || []).map((r: Record<string, unknown>) => ({
        id: (r.content as Record<string, unknown>)?.id ?? r.id ?? '',
        title: (r.content as Record<string, unknown>)?.title ?? r.title ?? '',
        type: (r.content as Record<string, unknown>)?.type ?? '',
        url: r.url || '',
        excerpt: r.excerpt || '',
      }))

      return { success: true, output: { ts: new Date().toISOString(), results } }
    },

    confluence_create_comment: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      const comment = params.comment as string
      if (!accessToken || !domain || !pageId || !comment) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, '/footer-comments'), {
        method: 'POST',
        headers: cfHeaders(accessToken, true),
        body: JSON.stringify({
          pageId,
          body: { representation: 'storage', value: comment },
        }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), commentId: data.id, pageId } }
    },

    confluence_list_comments: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      qp.set('limit', String(params.limit || 25))
      if (params.bodyFormat) qp.set('body-format', params.bodyFormat as string)
      if (params.cursor) qp.set('cursor', params.cursor as string)

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/footer-comments?${qp.toString()}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), comments: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },

    confluence_update_comment: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const commentId = params.commentId as string
      const comment = params.comment as string
      const version = params.version as number
      if (!accessToken || !domain || !commentId || !comment) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/footer-comments/${commentId}`), {
        method: 'PUT',
        headers: cfHeaders(accessToken, true),
        body: JSON.stringify({
          version: { number: version || 1 },
          body: { representation: 'storage', value: comment },
        }),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), commentId: data.id, success: true } }
    },

    confluence_delete_comment: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const commentId = params.commentId as string
      if (!accessToken || !domain || !commentId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/footer-comments/${commentId}`), {
        method: 'DELETE',
        headers: cfHeaders(accessToken),
      })

      if (!response.ok && response.status !== 204) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      return { success: true, output: { ts: new Date().toISOString(), commentId, deleted: true } }
    },

    confluence_list_attachments: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      qp.set('limit', String(params.limit || 50))
      if (params.cursor) qp.set('cursor', params.cursor as string)

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/attachments?${qp.toString()}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), attachments: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },

    confluence_delete_attachment: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const attachmentId = params.attachmentId as string
      if (!accessToken || !domain || !attachmentId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/attachments/${attachmentId}`), {
        method: 'DELETE',
        headers: cfHeaders(accessToken),
      })

      if (!response.ok && response.status !== 204) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      return { success: true, output: { ts: new Date().toISOString(), attachmentId, deleted: true } }
    },

    confluence_list_labels: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      if (!accessToken || !domain || !pageId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      qp.set('limit', String(params.limit || 25))
      if (params.cursor) qp.set('cursor', params.cursor as string)

      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/labels?${qp.toString()}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), labels: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },

    confluence_add_label: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const pageId = params.pageId as string
      const labelName = params.labelName as string
      if (!accessToken || !domain || !pageId || !labelName) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/pages/${pageId}/labels`), {
        method: 'POST',
        headers: cfHeaders(accessToken, true),
        body: JSON.stringify([{ prefix: params.prefix || 'global', name: labelName.trim() }]),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const label = Array.isArray(data.results) && data.results.length > 0 ? data.results[0] : data
      return { success: true, output: { ts: new Date().toISOString(), pageId, labelName: label.name ?? labelName, labelId: label.id ?? '' } }
    },

    confluence_get_space: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      const spaceId = params.spaceId as string
      if (!accessToken || !domain || !spaceId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const response = await fetch(cfUrl(cloudId, `/spaces/${spaceId}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          spaceId: data.id,
          name: data.name,
          key: data.key,
          type: data.type,
          status: data.status,
          url: data._links?.webui || '',
          authorId: data.authorId ?? null,
          createdAt: data.createdAt ?? null,
          homepageId: data.homepageId ?? null,
          description: data.description ?? null,
        },
      }
    },

    confluence_list_spaces: async (params) => {
      const accessToken = params.accessToken as string
      const domain = params.domain as string
      if (!accessToken || !domain) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const qp = new URLSearchParams()
      qp.set('limit', String(params.limit || 25))
      if (params.cursor) qp.set('cursor', params.cursor as string)

      const response = await fetch(cfUrl(cloudId, `/spaces?${qp.toString()}`), {
        headers: cfHeaders(accessToken),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Confluence API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      return { success: true, output: { ts: new Date().toISOString(), spaces: data.results || [], nextCursor: data._links?.next ? data._links.cursor : null } }
    },
  },
}

export default handler
