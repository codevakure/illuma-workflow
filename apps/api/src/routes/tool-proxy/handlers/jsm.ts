import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('JSMProxyHandler')

/**
 * Builds the JSM (Jira Service Management) REST API base URL for a given cloud ID.
 */
const JSM_API_BASE = (cloudId: string) =>
  `https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi`

/**
 * Lists all service desks accessible to the authenticated user.
 */
const handleServicedesks: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching JSM service desks`)

  const response = await fetch(`${base}/servicedesk`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching service desks`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched JSM service desks`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Lists request types for a specific service desk.
 */
const handleRequesttypes: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    serviceDeskId: z.string().min(1, 'Service desk ID is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching request types for service desk: ${validated.serviceDeskId}`)

  const response = await fetch(
    `${base}/servicedesk/${validated.serviceDeskId}/requesttype`,
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
    logger.error(`[${requestId}] JSM API error fetching request types`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched request types`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Creates a new customer request in JSM.
 */
const handleRequest: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    serviceDeskId: z.string().min(1, 'Service desk ID is required'),
    requestTypeId: z.string().min(1, 'Request type ID is required'),
    summary: z.string().min(1, 'Summary is required'),
    description: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  const requestFieldValues: Record<string, unknown> = {
    summary: validated.summary,
  }

  if (validated.description) {
    requestFieldValues.description = validated.description
  }

  logger.info(`[${requestId}] Creating JSM request in service desk: ${validated.serviceDeskId}`)

  const response = await fetch(`${base}/request`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      serviceDeskId: validated.serviceDeskId,
      requestTypeId: validated.requestTypeId,
      requestFieldValues,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error creating request`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully created JSM request`)
  return { success: true, output: data }
}

/**
 * Lists customer requests, optionally filtered by search term and status.
 */
const handleRequests: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    searchTerm: z.string().optional().nullable(),
    requestStatus: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  const url = new URL(`${base}/request`)
  if (validated.searchTerm) {
    url.searchParams.append('searchTerm', validated.searchTerm)
  }
  if (validated.requestStatus) {
    url.searchParams.append('requestStatus', validated.requestStatus)
  }

  logger.info(`[${requestId}] Fetching JSM requests`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching requests`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched JSM requests`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Adds a comment to a JSM request.
 */
const handleComment: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
    body: z.string().min(1, 'Comment body is required'),
    public: z.boolean().optional().nullable().default(true),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Adding comment to JSM request: ${validated.issueIdOrKey}`)

  const response = await fetch(`${base}/request/${validated.issueIdOrKey}/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: validated.body,
      public: validated.public ?? true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error adding comment`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully added comment to JSM request: ${validated.issueIdOrKey}`)
  return { success: true, output: data }
}

/**
 * Lists comments on a JSM request.
 */
const handleComments: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching comments for JSM request: ${validated.issueIdOrKey}`)

  const response = await fetch(`${base}/request/${validated.issueIdOrKey}/comment`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching comments`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched comments for JSM request: ${validated.issueIdOrKey}`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Performs a transition on a JSM request.
 */
const handleTransition: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
    transitionId: z.string().min(1, 'Transition ID is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Transitioning JSM request: ${validated.issueIdOrKey}`)

  const response = await fetch(`${base}/request/${validated.issueIdOrKey}/transition`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: validated.transitionId }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error performing transition`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  logger.info(`[${requestId}] Successfully transitioned JSM request: ${validated.issueIdOrKey}`)
  return {
    success: true,
    output: {
      issueIdOrKey: validated.issueIdOrKey,
      transitionId: validated.transitionId,
      transitioned: true,
    },
  }
}

/**
 * Lists available transitions for a JSM request.
 */
const handleTransitions: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching transitions for JSM request: ${validated.issueIdOrKey}`)

  const response = await fetch(`${base}/request/${validated.issueIdOrKey}/transition`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching transitions`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched transitions for JSM request: ${validated.issueIdOrKey}`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Lists customers for a specific service desk.
 */
const handleCustomers: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    serviceDeskId: z.string().min(1, 'Service desk ID is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching customers for service desk: ${validated.serviceDeskId}`)

  const response = await fetch(
    `${base}/servicedesk/${validated.serviceDeskId}/customer`,
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
    logger.error(`[${requestId}] JSM API error fetching customers`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched customers`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Retrieves a single organization by ID.
 */
const handleOrganization: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching JSM organization: ${validated.organizationId}`)

  const response = await fetch(`${base}/organization/${validated.organizationId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching organization`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched JSM organization: ${validated.organizationId}`)
  return { success: true, output: data }
}

/**
 * Lists all organizations.
 */
const handleOrganizations: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching JSM organizations`)

  const response = await fetch(`${base}/organization`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching organizations`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched JSM organizations`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Lists participants on a JSM request.
 */
const handleParticipants: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching participants for JSM request: ${validated.issueIdOrKey}`)

  const response = await fetch(`${base}/request/${validated.issueIdOrKey}/participant`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching participants`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched participants for JSM request: ${validated.issueIdOrKey}`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Lists queues for a specific service desk.
 */
const handleQueues: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    serviceDeskId: z.string().min(1, 'Service desk ID is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching queues for service desk: ${validated.serviceDeskId}`)

  const response = await fetch(
    `${base}/servicedesk/${validated.serviceDeskId}/queue`,
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
    logger.error(`[${requestId}] JSM API error fetching queues`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched queues`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Retrieves SLA information for a JSM request.
 */
const handleSla: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching SLA for JSM request: ${validated.issueIdOrKey}`)

  const response = await fetch(`${base}/request/${validated.issueIdOrKey}/sla`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching SLA`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched SLA for JSM request: ${validated.issueIdOrKey}`)
  return { success: true, output: { values: data.values || data } }
}

/**
 * Retrieves approval information for a JSM request.
 */
const handleApprovals: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    cloudId: z.string().min(1, 'Cloud ID is required'),
    issueIdOrKey: z.string().min(1, 'Issue ID or key is required'),
  })

  const validated = schema.parse(body)
  const base = JSM_API_BASE(validated.cloudId)

  logger.info(`[${requestId}] Fetching approvals for JSM request: ${validated.issueIdOrKey}`)

  const response = await fetch(`${base}/request/${validated.issueIdOrKey}/approval`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[${requestId}] JSM API error fetching approvals`, {
      status: response.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `JSM API error: ${response.status} ${response.statusText}`,
    }
  }

  const data = await response.json()

  logger.info(`[${requestId}] Successfully fetched approvals for JSM request: ${validated.issueIdOrKey}`)
  return { success: true, output: { values: data.values || data } }
}

export const jsmHandlers: Record<string, ToolProxyHandler> = {
  'servicedesks': handleServicedesks,
  'requesttypes': handleRequesttypes,
  'request': handleRequest,
  'requests': handleRequests,
  'comment': handleComment,
  'comments': handleComments,
  'transition': handleTransition,
  'transitions': handleTransitions,
  'customers': handleCustomers,
  'organization': handleOrganization,
  'organizations': handleOrganizations,
  'participants': handleParticipants,
  'queues': handleQueues,
  'sla': handleSla,
  'approvals': handleApprovals,
}
