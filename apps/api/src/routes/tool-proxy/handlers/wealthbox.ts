import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('WealthboxHandler')

const WEALTHBOX_API_BASE = 'https://api.crmworkspace.com/v1'

const ALLOWED_ITEM_TYPES = ['note', 'contact', 'task'] as const

const TYPE_TO_ENDPOINT: Record<string, string> = {
  note: 'notes',
  contact: 'contacts',
  task: 'tasks',
} as const

const ItemSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  itemId: z.string().min(1, 'Item ID is required'),
  type: z.enum(ALLOWED_ITEM_TYPES).optional().default('note'),
})

const ItemsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  type: z.enum(['contact']).optional().default('contact'),
  query: z.string().optional(),
})

/**
 * Get a single Wealthbox item (note, contact, or task) by ID and type.
 */
const handleItem: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = ItemSchema.parse(body)
    const endpoint = TYPE_TO_ENDPOINT[validated.type]

    const url = `${WEALTHBOX_API_BASE}/${endpoint}/${validated.itemId}`

    logger.info(`[${requestId}] Fetching ${validated.type} ${validated.itemId} from Wealthbox`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `[${requestId}] Wealthbox API error: ${response.status} ${response.statusText}`,
        { error: errorText, endpoint, itemId: validated.itemId }
      )

      if (response.status === 404) {
        throw new Error('Item not found')
      }
      throw new Error(`Failed to fetch ${validated.type} from Wealthbox`)
    }

    const data = await response.json()

    const item = {
      id: data.id?.toString() || validated.itemId,
      name:
        data.content ||
        data.name ||
        `${data.first_name || ''} ${data.last_name || ''}`.trim() ||
        `${validated.type} ${data.id}`,
      type: validated.type,
      content: data.content || '',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }

    logger.info(
      `[${requestId}] Successfully fetched ${validated.type} ${validated.itemId} from Wealthbox`
    )

    return {
      success: true,
      output: { item },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Wealthbox item:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Wealthbox item',
    }
  }
}

/**
 * List Wealthbox contacts with optional search query.
 */
const handleItems: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = ItemsSchema.parse(body)
    const endpoint = TYPE_TO_ENDPOINT[validated.type]

    const url = `${WEALTHBOX_API_BASE}/${endpoint}`

    logger.info(`[${requestId}] Fetching ${validated.type}s from Wealthbox`, {
      endpoint,
      hasQuery: !!validated.query?.trim(),
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `[${requestId}] Wealthbox API error: ${response.status} ${response.statusText}`,
        { error: errorText, endpoint }
      )
      throw new Error(`Failed to fetch ${validated.type}s from Wealthbox`)
    }

    const data = await response.json()

    let items: Array<{
      id: string
      name: string
      type: string
      content: string
      createdAt: string
      updatedAt: string
    }> = []

    if (validated.type === 'contact') {
      const contacts = data.contacts || []
      if (!Array.isArray(contacts)) {
        logger.warn(`[${requestId}] Contacts is not an array`, {
          dataType: typeof contacts,
        })
        return {
          success: true,
          output: { contacts: [] },
        }
      }

      items = contacts.map((item: Record<string, unknown>) => ({
        id: item.id?.toString() || '',
        name:
          `${(item.first_name as string) || ''} ${(item.last_name as string) || ''}`.trim() ||
          `Contact ${item.id}`,
        type: 'contact',
        content: (item.background_information as string) || '',
        createdAt: item.created_at as string,
        updatedAt: item.updated_at as string,
      }))
    }

    if (validated.query?.trim()) {
      const searchTerm = validated.query.trim().toLowerCase()
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(searchTerm) ||
          item.content.toLowerCase().includes(searchTerm)
      )
    }

    logger.info(
      `[${requestId}] Successfully fetched ${items.length} ${validated.type}s from Wealthbox`,
      { totalItems: items.length, hasSearchQuery: !!validated.query?.trim() }
    )

    return {
      success: true,
      output: { contacts: items },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error listing Wealthbox items:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to list Wealthbox contacts',
    }
  }
}

export const wealthboxHandlers: Record<string, ToolProxyHandler> = {
  item: handleItem,
  items: handleItems,
}
