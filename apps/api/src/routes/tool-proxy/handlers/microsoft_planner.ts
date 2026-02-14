import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MicrosoftPlannerHandler')

const TasksSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  planId: z.string().min(1, 'Plan ID is required'),
})

/**
 * Fetch tasks from a Microsoft Planner plan via the Graph API.
 * Returns tasks with detailed field mapping including assignments.
 */
const handleTasks: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = TasksSchema.parse(body)

    const url = `https://graph.microsoft.com/v1.0/planner/plans/${validated.planId}/tasks`

    logger.info(`[${requestId}] Fetching Microsoft Planner tasks`, {
      planId: validated.planId,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        (errorData as Record<string, Record<string, string>>).error?.message ||
        `Microsoft Graph API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const rawTasks: Array<Record<string, unknown>> = data.value || []

    const tasks = rawTasks.map((task) => ({
      id: task.id,
      title: task.title,
      planId: task.planId,
      bucketId: task.bucketId,
      percentComplete: task.percentComplete,
      priority: task.priority,
      dueDateTime: task.dueDateTime,
      createdDateTime: task.createdDateTime,
      completedDateTime: task.completedDateTime,
      hasDescription: task.hasDescription,
      assignments: task.assignments
        ? Object.keys(task.assignments as Record<string, unknown>)
        : [],
    }))

    logger.info(`[${requestId}] Successfully fetched ${tasks.length} Planner tasks`)

    return {
      success: true,
      output: {
        tasks,
        metadata: {
          planId: validated.planId,
          planUrl: `https://graph.microsoft.com/v1.0/planner/plans/${validated.planId}`,
        },
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Planner tasks:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch Planner tasks',
    }
  }
}

export const microsoftPlannerHandlers: Record<string, ToolProxyHandler> = {
  tasks: handleTasks,
}
