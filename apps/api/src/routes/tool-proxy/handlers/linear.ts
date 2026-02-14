import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('LinearHandler')

const LINEAR_API = 'https://api.linear.app/graphql'

const TeamsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
})

const ProjectsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  teamId: z.string().optional(),
})

/**
 * Execute a GraphQL query against the Linear API.
 */
async function linearGraphQL(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Linear API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()

  if (data.errors && data.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${data.errors[0].message}`)
  }

  return data.data
}

/**
 * Fetch all teams from Linear.
 */
const handleTeams: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = TeamsSchema.parse(body)

    logger.info(`[${requestId}] Fetching Linear teams`)

    const data = await linearGraphQL(
      validated.accessToken,
      `{ teams { nodes { id name key } } }`
    )

    const teams = (data as { teams: { nodes: Array<{ id: string; name: string; key: string }> } }).teams.nodes

    logger.info(`[${requestId}] Successfully fetched ${teams.length} Linear teams`)

    return {
      success: true,
      output: { teams },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Linear teams:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Linear teams',
    }
  }
}

/**
 * Fetch projects from Linear, optionally filtered by team.
 */
const handleProjects: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = ProjectsSchema.parse(body)

    logger.info(`[${requestId}] Fetching Linear projects`, {
      hasTeamId: !!validated.teamId,
    })

    const query = validated.teamId
      ? `query($teamId: String!) {
          team(id: $teamId) {
            projects {
              nodes { id name }
            }
          }
        }`
      : `{ projects { nodes { id name } } }`

    const variables = validated.teamId ? { teamId: validated.teamId } : undefined

    const data = await linearGraphQL(validated.accessToken, query, variables)

    let projects: Array<{ id: string; name: string }>
    if (validated.teamId) {
      const teamData = data as { team: { projects: { nodes: Array<{ id: string; name: string }> } } }
      projects = teamData.team.projects.nodes
    } else {
      const projectData = data as { projects: { nodes: Array<{ id: string; name: string }> } }
      projects = projectData.projects.nodes
    }

    logger.info(`[${requestId}] Successfully fetched ${projects.length} Linear projects`)

    return {
      success: true,
      output: { projects },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Linear projects:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Linear projects',
    }
  }
}

export const linearHandlers: Record<string, ToolProxyHandler> = {
  teams: handleTeams,
  projects: handleProjects,
}
