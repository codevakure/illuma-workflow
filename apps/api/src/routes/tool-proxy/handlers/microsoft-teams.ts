import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MicrosoftTeamsListProxyHandler')

const MS_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

/**
 * Lists teams the authenticated user has joined.
 */
const handleTeams: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching Microsoft Teams teams`)

  const response = await fetch(`${MS_GRAPH_BASE}/me/joinedTeams`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to retrieve teams',
    }
  }

  const data = await response.json()
  const teams = data.value || []

  logger.info(`[${requestId}] Successfully fetched ${teams.length} teams`)
  return { success: true, output: { teams } }
}

/**
 * Lists channels for a specific team.
 */
const handleChannels: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    teamId: z.string().min(1, 'Team ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching Teams channels for team: ${validated.teamId}`)

  const response = await fetch(
    `${MS_GRAPH_BASE}/teams/${encodeURIComponent(validated.teamId)}/channels`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to retrieve channels',
    }
  }

  const data = await response.json()
  const channels = data.value || []

  logger.info(`[${requestId}] Successfully fetched ${channels.length} channels`)
  return { success: true, output: { channels } }
}

/**
 * Lists chats the authenticated user participates in.
 */
const handleChats: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching Microsoft Teams chats`)

  const response = await fetch(`${MS_GRAPH_BASE}/me/chats`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    logger.error(`[${requestId}] Microsoft Graph API error:`, errorData)
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to retrieve chats',
    }
  }

  const data = await response.json()
  const chats = data.value || []

  logger.info(`[${requestId}] Successfully fetched ${chats.length} chats`)
  return { success: true, output: { chats } }
}

export const microsoftTeamsListHandlers: Record<string, ToolProxyHandler> = {
  'teams': handleTeams,
  'channels': handleChannels,
  'chats': handleChats,
}
