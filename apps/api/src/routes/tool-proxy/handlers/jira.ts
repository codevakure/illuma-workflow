import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('JiraProxyHandler')

/**
 * Builds the JIRA REST API v3 base URL for a given cloud ID.
 */
const JIRA_API_BASE = (cloudId: string) =>
  `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`

/**
 * Creates a new JIRA issue with optional assignee, labels, components, and custom fields.
 */
const handleWrite: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    projectKey: z.string().min(1, 'Project key is required'),
    summary: z.string().min(1, 'Summary is required'),
    description: z.string().optional().nullable(),
    issueType: z.string().optional().nullable().default('Task'),
    priority: z.string().optional().nullable(),
    assignee: z.string().optional().nullable(),
    labels: z.array(z.string()).optional().nullable(),
    components: z.array(z.string()).optional().nullable(),
    customFields: z.record(z.string(), z.any()).optional().nullable(),
  })

  const validated = schema.parse(body)
  const base = JIRA_API_BASE(validated.cloudId)

  const fields: Record<string, unknown> = {
    project: { key: validated.projectKey },
    issuetype: { name: validated.issueType || 'Task' },
    summary: validated.summary,
  }

  if (validated.description) {
    fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: validated.description }],
        },
      ],
    }
  }

  if (validated.priority) {
    fields.priority = { name: validated.priority }
  }

  if (validated.labels && validated.labels.length > 0) {
    fields.labels = validated.labels
  }

  if (validated.components && validated.components.length > 0) {
    fields.components = validated.components.map((name) => ({ name }))
  }

  if (validated.customFields) {
    for (const [key, value] of Object.entries(validated.customFields)) {
      fields[key] = value
    }
  }

  logger.info(`[${requestId}] Creating JIRA issue in project ${validated.projectKey}`)

  const response = await fetch(`${base}/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JIRA API error creating issue`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JIRA API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()
  const issueKey = data.key

  if (validated.assignee) {
    logger.info(`[${requestId}] Assigning issue ${issueKey} to ${validated.assignee}`)

    const assignResponse = await fetch(`${base}/issue/${issueKey}/assignee`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: validated.assignee }),
    })

    if (!assignResponse.ok) {
      const assignError = await assignResponse.text()
      logger.warn(`[${requestId}] Failed to assign issue (issue was created)`, {
        status: assignResponse.status,
        error: assignError,
      })
    }
  }

  logger.info(`[${requestId}] Successfully created JIRA issue: ${issueKey}`)
  return {
    success: true,
    output: {
      key: data.key,
      id: data.id,
      self: data.self,
    },
  }
}

/**
 * Retrieves a single JIRA issue by key.
 */
const handleIssue: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueKey: z.string().min(1, 'Issue key is required'),
  })

  const validated = schema.parse(body)
  const base = JIRA_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching JIRA issue: ${validated.issueKey}`)

  const response = await fetch(`${base}/issue/${validated.issueKey}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JIRA API error fetching issue`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JIRA API error: ${response.status} ${response.statusText}`,
    }
  }

  const issue = await response.json()

  logger.info(`[${requestId}] Successfully fetched JIRA issue: ${validated.issueKey}`)
  return { success: true, output: issue }
}

/**
 * Searches JIRA issues using JQL.
 */
const handleIssues: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    jql: z.string().min(1, 'JQL query is required'),
    maxResults: z.coerce.number().optional().nullable().default(50),
  })

  const validated = schema.parse(body)
  const base = JIRA_API_BASE(validated.cloudId)
  const maxResults = validated.maxResults ?? 50

  logger.info(`[${requestId}] Searching JIRA issues with JQL`)

  const url = `${base}/search?jql=${encodeURIComponent(validated.jql)}&maxResults=${maxResults}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JIRA API error searching issues`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JIRA API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched ${data.issues?.length ?? 0} JIRA issues`)
  return {
    success: true,
    output: {
      issues: data.issues,
      total: data.total,
    },
  }
}

/**
 * Updates fields on an existing JIRA issue.
 */
const handleUpdate: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueKey: z.string().min(1, 'Issue key is required'),
    fields: z.record(z.string(), z.any()),
  })

  const validated = schema.parse(body)
  const base = JIRA_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Updating JIRA issue: ${validated.issueKey}`)

  const response = await fetch(`${base}/issue/${validated.issueKey}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: validated.fields }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JIRA API error updating issue`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JIRA API error: ${response.status} ${response.statusText}`,
    }
  }

  logger.info(`[${requestId}] Successfully updated JIRA issue: ${validated.issueKey}`)
  return {
    success: true,
    output: {
      issueKey: validated.issueKey,
      updated: true,
    },
  }
}

/**
 * Lists all projects accessible to the authenticated user.
 */
const handleProjects: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
  })

  const validated = schema.parse(body)
  const base = JIRA_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching JIRA projects`)

  const response = await fetch(`${base}/project/search`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JIRA API error fetching projects`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JIRA API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched JIRA projects`)
  return { success: true, output: { projects: data.values || data } }
}

/**
 * Adds a file attachment to a JIRA issue.
 */
const handleAddAttachment: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueKey: z.string().min(1, 'Issue key is required'),
    file: z.any(),
  })

  const validated = schema.parse(body)
  const base = JIRA_API_BASE(validated.cloudId)

  const userFiles = processFilesToUserFiles(
    Array.isArray(validated.file) ? validated.file : [validated.file],
    requestId,
    logger
  )

  if (userFiles.length === 0) {
    return { success: false, output: {}, error: 'No valid file provided' }
  }

  const userFile = userFiles[0]
  logger.info(`[${requestId}] Downloading file for JIRA attachment: ${userFile.name}`)

  const buffer = await downloadFileFromStorage(userFile, requestId, logger)

  const formData = new FormData()
  const blob = new Blob([new Uint8Array(buffer)], {
    type: userFile.type || 'application/octet-stream',
  })
  formData.append('file', blob, userFile.name)

  logger.info(`[${requestId}] Uploading attachment to JIRA issue: ${validated.issueKey}`)

  const response = await fetch(`${base}/issue/${validated.issueKey}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'X-Atlassian-Token': 'no-check',
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JIRA API error uploading attachment`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `Failed to upload attachment: ${response.statusText}`,
    }
  }

  const attachments = await response.json()

  logger.info(`[${requestId}] Successfully uploaded attachment to JIRA issue: ${validated.issueKey}`)
  return {
    success: true,
    output: {
      issueKey: validated.issueKey,
      attachments: Array.isArray(attachments) ? attachments : [attachments],
    },
  }
}

export const jiraHandlers: Record<string, ToolProxyHandler> = {
  'write': handleWrite,
  'issue': handleIssue,
  'issues': handleIssues,
  'update': handleUpdate,
  'projects': handleProjects,
  'add-attachment': handleAddAttachment,
}
