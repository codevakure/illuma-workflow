import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('ConfluenceProxyHandler')

/**
 * Builds the Confluence cloud API base URL for a given cloud ID.
 */
const CONFLUENCE_API_BASE = (cloudId: string) =>
  `https://api.atlassian.com/ex/confluence/${cloudId}`

/**
 * Creates a new Confluence page in a space.
 */
const handleCreatePage: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    spaceId: z.string().min(1, 'Space ID is required'),
    title: z.string().min(1, 'Title is required'),
    body: z.string().min(1, 'Body is required'),
    parentId: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  const payload: Record<string, unknown> = {
    spaceId: validated.spaceId,
    title: validated.title,
    body: {
      representation: 'storage',
      value: validated.body,
    },
    status: 'current',
  }

  if (validated.parentId) {
    payload.parentId = validated.parentId
  }

  logger.info(`[${requestId}] Creating Confluence page: ${validated.title}`)

  const response = await fetch(`${base}/wiki/api/v2/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error creating page`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully created Confluence page: ${data.id}`)
  return { success: true, output: data }
}

/**
 * Retrieves a single Confluence page by ID.
 */
const handlePage: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching Confluence page: ${validated.pageId}`)

  const response = await fetch(`${base}/wiki/api/v2/pages/${validated.pageId}?body-format=storage`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching page`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched Confluence page: ${validated.pageId}`)
  return { success: true, output: data }
}

/**
 * Lists Confluence pages, optionally filtered by space.
 */
const handlePages: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    spaceId: z.string().optional().nullable(),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  const url = new URL(`${base}/wiki/api/v2/pages`)
  if (validated.spaceId) {
    url.searchParams.append('space-id', validated.spaceId)
  }
  url.searchParams.append('limit', String(limit))

  logger.info(`[${requestId}] Fetching Confluence pages`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching pages`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched Confluence pages`)
  return { success: true, output: { pages: data.results || data } }
}

/**
 * Searches Confluence content using CQL.
 */
const handleSearch: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    query: z.string().min(1, 'Search query is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  const url = `${base}/wiki/rest/api/search?cql=${encodeURIComponent(validated.query)}&limit=${limit}`

  logger.info(`[${requestId}] Searching Confluence content`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error searching`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully searched Confluence content`)
  return { success: true, output: { results: data.results || data } }
}

/**
 * Lists Confluence spaces.
 */
const handleSpaces: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  logger.info(`[${requestId}] Fetching Confluence spaces`)

  const response = await fetch(`${base}/wiki/api/v2/spaces?limit=${limit}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching spaces`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched Confluence spaces`)
  return { success: true, output: { spaces: data.results || data } }
}

/**
 * Retrieves a single Confluence space by ID.
 */
const handleSpace: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    spaceId: z.string().min(1, 'Space ID is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching Confluence space: ${validated.spaceId}`)

  const response = await fetch(`${base}/wiki/api/v2/spaces/${validated.spaceId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching space`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched Confluence space: ${validated.spaceId}`)
  return { success: true, output: data }
}

/**
 * Adds a footer comment to a Confluence page.
 */
const handleComment: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
    body: z.string().min(1, 'Comment body is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Adding comment to Confluence page: ${validated.pageId}`)

  const response = await fetch(`${base}/wiki/api/v2/pages/${validated.pageId}/footer-comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: {
        representation: 'storage',
        value: validated.body,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error adding comment`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully added comment to Confluence page: ${validated.pageId}`)
  return { success: true, output: data }
}

/**
 * Lists footer comments on a Confluence page.
 */
const handleComments: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  logger.info(`[${requestId}] Fetching comments for Confluence page: ${validated.pageId}`)

  const response = await fetch(
    `${base}/wiki/api/v2/pages/${validated.pageId}/footer-comments?limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching comments`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched comments for Confluence page: ${validated.pageId}`)
  return { success: true, output: { comments: data.results || data } }
}

/**
 * Retrieves labels for a Confluence page.
 */
const handleLabels: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching labels for Confluence page: ${validated.pageId}`)

  const response = await fetch(`${base}/wiki/rest/api/content/${validated.pageId}/label`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching labels`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched labels for Confluence page: ${validated.pageId}`)
  return { success: true, output: { labels: data.results || data } }
}

/**
 * Lists blogposts, optionally filtered by space.
 */
const handleBlogposts: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    spaceId: z.string().optional().nullable(),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  const url = new URL(`${base}/wiki/api/v2/blogposts`)
  if (validated.spaceId) {
    url.searchParams.append('space-id', validated.spaceId)
  }
  url.searchParams.append('limit', String(limit))

  logger.info(`[${requestId}] Fetching Confluence blogposts`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching blogposts`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched Confluence blogposts`)
  return { success: true, output: { blogposts: data.results || data } }
}

/**
 * Lists pages in a specific Confluence space.
 */
const handleSpacePages: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    spaceId: z.string().min(1, 'Space ID is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  logger.info(`[${requestId}] Fetching pages for Confluence space: ${validated.spaceId}`)

  const response = await fetch(
    `${base}/wiki/api/v2/spaces/${validated.spaceId}/pages?limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching space pages`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched pages for Confluence space: ${validated.spaceId}`)
  return { success: true, output: { pages: data.results || data } }
}

/**
 * Lists blogposts in a specific Confluence space.
 */
const handleSpaceBlogposts: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    spaceId: z.string().min(1, 'Space ID is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  logger.info(`[${requestId}] Fetching blogposts for Confluence space: ${validated.spaceId}`)

  const response = await fetch(
    `${base}/wiki/api/v2/spaces/${validated.spaceId}/blogposts?limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching space blogposts`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched blogposts for Confluence space: ${validated.spaceId}`)
  return { success: true, output: { blogposts: data.results || data } }
}

/**
 * Lists child pages of a Confluence page.
 */
const handlePageChildren: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  logger.info(`[${requestId}] Fetching children for Confluence page: ${validated.pageId}`)

  const response = await fetch(
    `${base}/wiki/api/v2/pages/${validated.pageId}/children?limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching page children`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched children for Confluence page: ${validated.pageId}`)
  return { success: true, output: { children: data.results || data } }
}

/**
 * Retrieves ancestors of a Confluence page.
 */
const handlePageAncestors: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching ancestors for Confluence page: ${validated.pageId}`)

  const response = await fetch(`${base}/wiki/api/v2/pages/${validated.pageId}/ancestors`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching page ancestors`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched ancestors for Confluence page: ${validated.pageId}`)
  return { success: true, output: { ancestors: data.results || data } }
}

/**
 * Lists version history for a Confluence page.
 */
const handlePageVersions: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  logger.info(`[${requestId}] Fetching versions for Confluence page: ${validated.pageId}`)

  const response = await fetch(
    `${base}/wiki/api/v2/pages/${validated.pageId}/versions?limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching page versions`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched versions for Confluence page: ${validated.pageId}`)
  return { success: true, output: { versions: data.results || data } }
}

/**
 * Retrieves content properties for a Confluence page.
 */
const handlePageProperties: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching properties for Confluence page: ${validated.pageId}`)

  const response = await fetch(`${base}/wiki/rest/api/content/${validated.pageId}/property`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching page properties`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched properties for Confluence page: ${validated.pageId}`)
  return { success: true, output: { properties: data.results || data } }
}

/**
 * Retrieves a specific attachment from a Confluence page.
 */
const handleAttachment: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
    attachmentId: z.string().min(1, 'Attachment ID is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching attachment ${validated.attachmentId} from Confluence page: ${validated.pageId}`)

  const response = await fetch(
    `${base}/wiki/rest/api/content/${validated.pageId}/child/attachment/${validated.attachmentId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching attachment`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched attachment from Confluence page: ${validated.pageId}`)
  return { success: true, output: data }
}

/**
 * Lists all attachments on a Confluence page.
 */
const handleAttachments: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching attachments for Confluence page: ${validated.pageId}`)

  const response = await fetch(
    `${base}/wiki/rest/api/content/${validated.pageId}/child/attachment`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error fetching attachments`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched attachments for Confluence page: ${validated.pageId}`)
  return { success: true, output: { attachments: data.results || data } }
}

/**
 * Uploads a file attachment to a Confluence page.
 */
const handleUploadAttachment: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    pageId: z.string().min(1, 'Page ID is required'),
    file: z.any(),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)

  const userFiles = processFilesToUserFiles(
    Array.isArray(validated.file) ? validated.file : [validated.file],
    requestId,
    logger
  )

  if (userFiles.length === 0) {
    return { success: false, output: {}, error: 'No valid file provided' }
  }

  const userFile = userFiles[0]
  logger.info(`[${requestId}] Downloading file for Confluence attachment: ${userFile.name}`)

  const buffer = await downloadFileFromStorage(userFile, requestId, logger)

  const formData = new FormData()
  const blob = new Blob([new Uint8Array(buffer)], {
    type: userFile.type || 'application/octet-stream',
  })
  formData.append('file', blob, userFile.name)

  logger.info(`[${requestId}] Uploading attachment to Confluence page: ${validated.pageId}`)

  const response = await fetch(
    `${base}/wiki/rest/api/content/${validated.pageId}/child/attachment`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'X-Atlassian-Token': 'nocheck',
      },
      body: formData,
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error uploading attachment`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Failed to upload attachment: ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully uploaded attachment to Confluence page: ${validated.pageId}`)
  return { success: true, output: data }
}

/**
 * Searches content within a specific Confluence space.
 */
const handleSearchInSpace: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    spaceKey: z.string().min(1, 'Space key is required'),
    query: z.string().min(1, 'Search query is required'),
    limit: z.coerce.number().optional().nullable().default(25),
  })

  const validated = schema.parse(body)
  const base = CONFLUENCE_API_BASE(validated.cloudId)
  const limit = validated.limit ?? 25

  const cql = `space="${validated.spaceKey}" AND ${validated.query}`
  const url = `${base}/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${limit}`

  logger.info(`[${requestId}] Searching in Confluence space: ${validated.spaceKey}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Confluence API error searching in space`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Confluence API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully searched in Confluence space: ${validated.spaceKey}`)
  return { success: true, output: { results: data.results || data } }
}

export const confluenceHandlers: Record<string, ToolProxyHandler> = {
  'create-page': handleCreatePage,
  'page': handlePage,
  'pages': handlePages,
  'search': handleSearch,
  'spaces': handleSpaces,
  'space': handleSpace,
  'comment': handleComment,
  'comments': handleComments,
  'labels': handleLabels,
  'blogposts': handleBlogposts,
  'space-pages': handleSpacePages,
  'space-blogposts': handleSpaceBlogposts,
  'page-children': handlePageChildren,
  'page-ancestors': handlePageAncestors,
  'page-versions': handlePageVersions,
  'page-properties': handlePageProperties,
  'attachment': handleAttachment,
  'attachments': handleAttachments,
  'upload-attachment': handleUploadAttachment,
  'search-in-space': handleSearchInSpace,
}
