import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('WebflowHandler')

const WEBFLOW_API_BASE = 'https://api.webflow.com/v2'

const SitesSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  siteId: z.string().optional(),
})

const CollectionsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  siteId: z.string().min(1, 'Site ID is required'),
})

const ItemsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  collectionId: z.string().min(1, 'Collection ID is required'),
  search: z.string().optional(),
})

/**
 * Make an authenticated request to the Webflow API.
 */
async function webflowFetch(
  url: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      (errorData as Record<string, string>).message ||
      (errorData as Record<string, string>).err ||
      `Webflow API error: ${response.status}`
    throw new Error(errorMessage)
  }

  return response.json()
}

/**
 * List all Webflow sites, or get a single site by ID.
 */
const handleSites: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = SitesSchema.parse(body)

    const url = validated.siteId
      ? `${WEBFLOW_API_BASE}/sites/${validated.siteId}`
      : `${WEBFLOW_API_BASE}/sites`

    logger.info(`[${requestId}] Fetching Webflow sites`, {
      siteId: validated.siteId || 'all',
    })

    const data = await webflowFetch(url, validated.accessToken)

    let sites: Array<Record<string, unknown>>
    if (validated.siteId) {
      sites = [data]
    } else {
      sites = (data.sites as Array<Record<string, unknown>>) || []
    }

    const formattedSites = sites.map((site) => ({
      id: site.id,
      name: site.displayName || site.shortName || site.id,
    }))

    logger.info(`[${requestId}] Webflow sites fetched successfully`, {
      count: formattedSites.length,
    })

    return {
      success: true,
      output: { sites: formattedSites },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Webflow sites:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Webflow sites',
    }
  }
}

/**
 * List collections for a Webflow site.
 */
const handleCollections: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = CollectionsSchema.parse(body)

    logger.info(`[${requestId}] Fetching Webflow collections`, {
      siteId: validated.siteId,
    })

    const data = await webflowFetch(
      `${WEBFLOW_API_BASE}/sites/${validated.siteId}/collections`,
      validated.accessToken
    )

    const collections = (data.collections as Array<Record<string, unknown>>) || []
    const formattedCollections = collections.map((collection) => ({
      id: collection.id,
      name: collection.displayName || collection.slug || collection.id,
    }))

    logger.info(`[${requestId}] Webflow collections fetched successfully`, {
      count: formattedCollections.length,
    })

    return {
      success: true,
      output: { collections: formattedCollections },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Webflow collections:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Webflow collections',
    }
  }
}

/**
 * List items in a Webflow collection with optional search filter.
 */
const handleItems: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = ItemsSchema.parse(body)

    logger.info(`[${requestId}] Fetching Webflow collection items`, {
      collectionId: validated.collectionId,
      hasSearch: !!validated.search,
    })

    const data = await webflowFetch(
      `${WEBFLOW_API_BASE}/collections/${validated.collectionId}/items?limit=100`,
      validated.accessToken
    )

    const items = (data.items as Array<Record<string, unknown>>) || []

    let formattedItems = items.map((item) => {
      const fieldData = (item.fieldData as Record<string, unknown>) || {}
      const name =
        (fieldData.name as string) ||
        (fieldData.title as string) ||
        (fieldData.slug as string) ||
        (item.id as string)
      return { id: item.id, name }
    })

    if (validated.search) {
      const searchLower = validated.search.toLowerCase()
      formattedItems = formattedItems.filter((item) =>
        (item.name as string).toLowerCase().includes(searchLower)
      )
    }

    logger.info(`[${requestId}] Webflow collection items fetched successfully`, {
      count: formattedItems.length,
    })

    return {
      success: true,
      output: { items: formattedItems },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Webflow collection items:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Webflow collection items',
    }
  }
}

export const webflowHandlers: Record<string, ToolProxyHandler> = {
  sites: handleSites,
  collections: handleCollections,
  items: handleItems,
}
