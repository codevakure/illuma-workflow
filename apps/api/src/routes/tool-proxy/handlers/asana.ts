import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('AsanaProxyHandler')

const ASANA_API_BASE = 'https://app.asana.com/api/1.0'

/**
 * Creates a new task in an Asana project.
 */
const handleCreateTask: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    projectId: z.string().min(1, 'Project ID is required'),
    name: z.string().min(1, 'Task name is required'),
    notes: z.string().optional().nullable(),
    due_on: z.string().optional().nullable(),
    assignee: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  const taskData: Record<string, unknown> = {
    projects: [validated.projectId],
    name: validated.name,
  }

  if (validated.notes) {
    taskData.notes = validated.notes
  }
  if (validated.due_on) {
    taskData.due_on = validated.due_on
  }
  if (validated.assignee) {
    taskData.assignee = validated.assignee
  }

  logger.info(`[${requestId}] Creating Asana task in project ${validated.projectId}`)

  const response = await fetch(`${ASANA_API_BASE}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: taskData }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Asana API error creating task`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Asana API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully created Asana task: ${data.data?.gid}`)
  return { success: true, output: data.data }
}

/**
 * Retrieves a single Asana task by ID.
 */
const handleGetTask: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    taskId: z.string().min(1, 'Task ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching Asana task: ${validated.taskId}`)

  const response = await fetch(`${ASANA_API_BASE}/tasks/${validated.taskId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Asana API error fetching task`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Asana API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched Asana task: ${validated.taskId}`)
  return { success: true, output: data.data }
}

/**
 * Updates an existing Asana task.
 */
const handleUpdateTask: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    taskId: z.string().min(1, 'Task ID is required'),
    name: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    due_on: z.string().optional().nullable(),
    assignee: z.string().optional().nullable(),
    completed: z.boolean().optional().nullable(),
  })

  const validated = schema.parse(body)

  const fields: Record<string, unknown> = {}
  if (validated.name !== undefined && validated.name !== null) {
    fields.name = validated.name
  }
  if (validated.notes !== undefined && validated.notes !== null) {
    fields.notes = validated.notes
  }
  if (validated.due_on !== undefined && validated.due_on !== null) {
    fields.due_on = validated.due_on
  }
  if (validated.assignee !== undefined && validated.assignee !== null) {
    fields.assignee = validated.assignee
  }
  if (validated.completed !== undefined && validated.completed !== null) {
    fields.completed = validated.completed
  }

  logger.info(`[${requestId}] Updating Asana task: ${validated.taskId}`)

  const response = await fetch(`${ASANA_API_BASE}/tasks/${validated.taskId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: fields }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Asana API error updating task`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Asana API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully updated Asana task: ${validated.taskId}`)
  return { success: true, output: data.data }
}

/**
 * Lists Asana projects, optionally filtered by workspace.
 */
const handleGetProjects: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    workspaceId: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)

  const url = new URL(`${ASANA_API_BASE}/projects`)
  if (validated.workspaceId) {
    url.searchParams.append('workspace', validated.workspaceId)
  }

  logger.info(`[${requestId}] Fetching Asana projects`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Asana API error fetching projects`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Asana API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched Asana projects`)
  return { success: true, output: { projects: data.data } }
}

/**
 * Searches for tasks in an Asana workspace by text query.
 */
const handleSearchTasks: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    query: z.string().min(1, 'Search query is required'),
  })

  const validated = schema.parse(body)

  const url = `${ASANA_API_BASE}/workspaces/${validated.workspaceId}/tasks/search?text=${encodeURIComponent(validated.query)}`

  logger.info(`[${requestId}] Searching Asana tasks in workspace ${validated.workspaceId}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Asana API error searching tasks`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Asana API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully searched Asana tasks`)
  return { success: true, output: { tasks: data.data } }
}

/**
 * Adds a comment (story) to an Asana task.
 */
const handleAddComment: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    taskId: z.string().min(1, 'Task ID is required'),
    text: z.string().min(1, 'Comment text is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Adding comment to Asana task: ${validated.taskId}`)

  const response = await fetch(`${ASANA_API_BASE}/tasks/${validated.taskId}/stories`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { text: validated.text } }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] Asana API error adding comment`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Asana API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully added comment to Asana task: ${validated.taskId}`)
  return { success: true, output: data.data }
}

export const asanaHandlers: Record<string, ToolProxyHandler> = {
  'create-task': handleCreateTask,
  'get-task': handleGetTask,
  'update-task': handleUpdateTask,
  'get-projects': handleGetProjects,
  'search-tasks': handleSearchTasks,
  'add-comment': handleAddComment,
}
