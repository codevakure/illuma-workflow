import type { ToolHandler } from '../../sdk/types'

const API_BASE = 'https://public-api.wordpress.com/wp/v2/sites'

function wpHeaders(accessToken: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
}

function parsePost(data: Record<string, unknown>) {
  return {
    id: data.id,
    date: data.date,
    modified: data.modified,
    slug: data.slug,
    status: data.status,
    type: data.type,
    link: data.link,
    title: data.title,
    content: data.content,
    excerpt: data.excerpt,
    author: data.author,
    featured_media: data.featured_media,
    categories: data.categories || [],
    tags: data.tags || [],
  }
}

function parsePage(data: Record<string, unknown>) {
  return {
    id: data.id,
    date: data.date,
    modified: data.modified,
    slug: data.slug,
    status: data.status,
    type: data.type,
    link: data.link,
    title: data.title,
    content: data.content,
    excerpt: data.excerpt,
    author: data.author,
    featured_media: data.featured_media,
    parent: data.parent,
    menu_order: data.menu_order,
  }
}

function parseCsvIds(csv: string | undefined): number[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id))
}

const handler: ToolHandler = {
  operations: {
    wordpress_create_post: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!params.title) return { success: false, output: {}, error: 'Missing required parameter: title' }

      const body: Record<string, unknown> = { title: params.title }
      if (params.content) body.content = params.content
      if (params.status) body.status = params.status
      if (params.excerpt) body.excerpt = params.excerpt
      if (params.slug) body.slug = params.slug
      if (params.featuredMedia) body.featured_media = params.featuredMedia
      const cats = parseCsvIds(params.categories as string)
      if (cats.length > 0) body.categories = cats
      const tags = parseCsvIds(params.tags as string)
      if (tags.length > 0) body.tags = tags

      const resp = await fetch(`${API_BASE}/${siteId}/posts`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { post: parsePost(data) } }
    },

    wordpress_update_post: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const postId = params.postId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!postId) return { success: false, output: {}, error: 'Missing required parameter: postId' }

      const body: Record<string, unknown> = {}
      if (params.title) body.title = params.title
      if (params.content) body.content = params.content
      if (params.status) body.status = params.status
      if (params.excerpt) body.excerpt = params.excerpt
      if (params.slug) body.slug = params.slug
      if (params.featuredMedia) body.featured_media = params.featuredMedia
      const cats = parseCsvIds(params.categories as string)
      if (cats.length > 0) body.categories = cats
      const tags = parseCsvIds(params.tags as string)
      if (tags.length > 0) body.tags = tags

      const resp = await fetch(`${API_BASE}/${siteId}/posts/${postId}`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { post: parsePost(data) } }
    },

    wordpress_delete_post: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const postId = params.postId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!postId) return { success: false, output: {}, error: 'Missing required parameter: postId' }

      const url = params.force
        ? `${API_BASE}/${siteId}/posts/${postId}?force=true`
        : `${API_BASE}/${siteId}/posts/${postId}`

      const resp = await fetch(url, { method: 'DELETE', headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { deleted: true, post: parsePost(data) } }
    },

    wordpress_get_post: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const postId = params.postId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!postId) return { success: false, output: {}, error: 'Missing required parameter: postId' }

      const resp = await fetch(`${API_BASE}/${siteId}/posts/${postId}`, {
        headers: wpHeaders(accessToken),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { post: parsePost(data) } }
    },

    wordpress_list_posts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const url = new URL(`${API_BASE}/${siteId}/posts`)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.status) url.searchParams.set('status', params.status as string)
      if (params.author) url.searchParams.set('author', String(params.author))
      if (params.search) url.searchParams.set('search', params.search as string)
      if (params.orderBy) url.searchParams.set('orderby', params.orderBy as string)
      if (params.order) url.searchParams.set('order', params.order as string)
      const cats = parseCsvIds(params.categories as string)
      if (cats.length > 0) url.searchParams.set('categories', cats.join(','))
      const tags = parseCsvIds(params.tags as string)
      if (tags.length > 0) url.searchParams.set('tags', tags.join(','))

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          posts: (data as Record<string, unknown>[]).map(parsePost),
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },

    wordpress_create_page: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!params.title) return { success: false, output: {}, error: 'Missing required parameter: title' }

      const body: Record<string, unknown> = { title: params.title }
      if (params.content) body.content = params.content
      if (params.status) body.status = params.status
      if (params.excerpt) body.excerpt = params.excerpt
      if (params.slug) body.slug = params.slug
      if (params.parent) body.parent = params.parent
      if (params.menuOrder) body.menu_order = params.menuOrder
      if (params.featuredMedia) body.featured_media = params.featuredMedia

      const resp = await fetch(`${API_BASE}/${siteId}/pages`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { page: parsePage(data) } }
    },

    wordpress_update_page: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const pageId = params.pageId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const body: Record<string, unknown> = {}
      if (params.title) body.title = params.title
      if (params.content) body.content = params.content
      if (params.status) body.status = params.status
      if (params.excerpt) body.excerpt = params.excerpt
      if (params.slug) body.slug = params.slug
      if (params.parent) body.parent = params.parent
      if (params.menuOrder) body.menu_order = params.menuOrder
      if (params.featuredMedia) body.featured_media = params.featuredMedia

      const resp = await fetch(`${API_BASE}/${siteId}/pages/${pageId}`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { page: parsePage(data) } }
    },

    wordpress_delete_page: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const pageId = params.pageId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const url = params.force
        ? `${API_BASE}/${siteId}/pages/${pageId}?force=true`
        : `${API_BASE}/${siteId}/pages/${pageId}`

      const resp = await fetch(url, { method: 'DELETE', headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { deleted: true, page: parsePage(data) } }
    },

    wordpress_get_page: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const pageId = params.pageId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const resp = await fetch(`${API_BASE}/${siteId}/pages/${pageId}`, {
        headers: wpHeaders(accessToken),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { page: parsePage(data) } }
    },

    wordpress_list_pages: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const url = new URL(`${API_BASE}/${siteId}/pages`)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.status) url.searchParams.set('status', params.status as string)
      if (params.parent) url.searchParams.set('parent', String(params.parent))
      if (params.search) url.searchParams.set('search', params.search as string)
      if (params.orderBy) url.searchParams.set('orderby', params.orderBy as string)
      if (params.order) url.searchParams.set('order', params.order as string)

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          pages: (data as Record<string, unknown>[]).map(parsePage),
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },

    wordpress_upload_media: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!params.file) return { success: false, output: {}, error: 'Missing required parameter: file' }

      if (!ctx.downloadFile) {
        return { success: false, output: {}, error: 'File download helper is not available in this context' }
      }

      const fileBuffer = await ctx.downloadFile(params.file)
      const fileObj = params.file as Record<string, unknown>
      const filename = (params.filename || fileObj.name || 'upload') as string
      const mimeType = (fileObj.mimeType || fileObj.type || 'application/octet-stream') as string

      const resp = await fetch(`${API_BASE}/${siteId}/media`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
        body: new Uint8Array(fileBuffer),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()

      if (params.title || params.caption || params.altText || params.description) {
        const updateBody: Record<string, unknown> = {}
        if (params.title) updateBody.title = params.title
        if (params.caption) updateBody.caption = params.caption
        if (params.altText) updateBody.alt_text = params.altText
        if (params.description) updateBody.description = params.description

        await fetch(`${API_BASE}/${siteId}/media/${data.id}`, {
          method: 'POST',
          headers: wpHeaders(accessToken),
          body: JSON.stringify(updateBody),
        })
      }

      return { success: true, output: { media: data } }
    },

    wordpress_get_media: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const mediaId = params.mediaId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!mediaId) return { success: false, output: {}, error: 'Missing required parameter: mediaId' }

      const resp = await fetch(`${API_BASE}/${siteId}/media/${mediaId}`, {
        headers: wpHeaders(accessToken),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { media: data } }
    },

    wordpress_list_media: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const url = new URL(`${API_BASE}/${siteId}/media`)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.search) url.searchParams.set('search', params.search as string)
      if (params.mediaType) url.searchParams.set('media_type', params.mediaType as string)
      if (params.mimeType) url.searchParams.set('mime_type', params.mimeType as string)
      if (params.orderBy) url.searchParams.set('orderby', params.orderBy as string)
      if (params.order) url.searchParams.set('order', params.order as string)

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          media: data,
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },

    wordpress_delete_media: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const mediaId = params.mediaId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!mediaId) return { success: false, output: {}, error: 'Missing required parameter: mediaId' }

      const url = params.force
        ? `${API_BASE}/${siteId}/media/${mediaId}?force=true`
        : `${API_BASE}/${siteId}/media/${mediaId}`

      const resp = await fetch(url, { method: 'DELETE', headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { deleted: true, media: data } }
    },

    wordpress_create_comment: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!params.postId) return { success: false, output: {}, error: 'Missing required parameter: postId' }
      if (!params.content) return { success: false, output: {}, error: 'Missing required parameter: content' }

      const body: Record<string, unknown> = { post: params.postId, content: params.content }
      if (params.parent) body.parent = params.parent
      if (params.authorName) body.author_name = params.authorName
      if (params.authorEmail) body.author_email = params.authorEmail
      if (params.authorUrl) body.author_url = params.authorUrl

      const resp = await fetch(`${API_BASE}/${siteId}/comments`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { comment: data } }
    },

    wordpress_list_comments: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const url = new URL(`${API_BASE}/${siteId}/comments`)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.postId) url.searchParams.set('post', String(params.postId))
      if (params.status) url.searchParams.set('status', params.status as string)
      if (params.search) url.searchParams.set('search', params.search as string)
      if (params.orderBy) url.searchParams.set('orderby', params.orderBy as string)
      if (params.order) url.searchParams.set('order', params.order as string)

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          comments: data,
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },

    wordpress_update_comment: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const commentId = params.commentId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!commentId) return { success: false, output: {}, error: 'Missing required parameter: commentId' }

      const body: Record<string, unknown> = {}
      if (params.content) body.content = params.content
      if (params.status) body.status = params.status

      const resp = await fetch(`${API_BASE}/${siteId}/comments/${commentId}`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { comment: data } }
    },

    wordpress_delete_comment: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const commentId = params.commentId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!commentId) return { success: false, output: {}, error: 'Missing required parameter: commentId' }

      const url = params.force
        ? `${API_BASE}/${siteId}/comments/${commentId}?force=true`
        : `${API_BASE}/${siteId}/comments/${commentId}`

      const resp = await fetch(url, { method: 'DELETE', headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { deleted: true, comment: data } }
    },

    wordpress_create_category: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!params.name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const body: Record<string, unknown> = { name: params.name }
      if (params.description) body.description = params.description
      if (params.parent) body.parent = params.parent
      if (params.slug) body.slug = params.slug

      const resp = await fetch(`${API_BASE}/${siteId}/categories`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { category: data } }
    },

    wordpress_list_categories: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const url = new URL(`${API_BASE}/${siteId}/categories`)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.search) url.searchParams.set('search', params.search as string)
      if (params.order) url.searchParams.set('order', params.order as string)

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          categories: data,
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },

    wordpress_create_tag: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!params.name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const body: Record<string, unknown> = { name: params.name }
      if (params.description) body.description = params.description
      if (params.slug) body.slug = params.slug

      const resp = await fetch(`${API_BASE}/${siteId}/tags`, {
        method: 'POST',
        headers: wpHeaders(accessToken),
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { tag: data } }
    },

    wordpress_list_tags: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const url = new URL(`${API_BASE}/${siteId}/tags`)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.search) url.searchParams.set('search', params.search as string)
      if (params.order) url.searchParams.set('order', params.order as string)

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          tags: data,
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },

    wordpress_get_current_user: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const resp = await fetch(`${API_BASE}/${siteId}/users/me?context=edit`, {
        headers: wpHeaders(accessToken),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { user: data } }
    },

    wordpress_list_users: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }

      const url = new URL(`${API_BASE}/${siteId}/users`)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.search) url.searchParams.set('search', params.search as string)
      if (params.roles) url.searchParams.set('roles', params.roles as string)
      if (params.order) url.searchParams.set('order', params.order as string)

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          users: data,
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },

    wordpress_get_user: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      const userId = params.userId as number
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!userId) return { success: false, output: {}, error: 'Missing required parameter: userId' }

      const resp = await fetch(`${API_BASE}/${siteId}/users/${userId}`, {
        headers: wpHeaders(accessToken),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return { success: true, output: { user: data } }
    },

    wordpress_search_content: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const siteId = params.siteId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!siteId) return { success: false, output: {}, error: 'Missing required parameter: siteId' }
      if (!params.query) return { success: false, output: {}, error: 'Missing required parameter: query' }

      const url = new URL(`${API_BASE}/${siteId}/search`)
      url.searchParams.set('search', params.query as string)
      if (params.perPage) url.searchParams.set('per_page', String(params.perPage))
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.type) url.searchParams.set('type', params.type as string)
      if (params.subtype) url.searchParams.set('subtype', params.subtype as string)

      const resp = await fetch(url.toString(), { headers: wpHeaders(accessToken) })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, string>).message || `WordPress API error: ${resp.status}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          results: data,
          total: parseInt(resp.headers.get('x-wp-total') || '0', 10),
          totalPages: parseInt(resp.headers.get('x-wp-totalpages') || '0', 10),
        },
      }
    },
  },
}

export default handler
