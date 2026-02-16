import type { ToolHandler } from '../../sdk/types'

const SENTRY_BASE = 'https://sentry.io/api/0'

function sentryHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function parseLinkHeader(linkHeader: string | null): { nextCursor?: string; hasMore: boolean } {
  if (!linkHeader) return { hasMore: false }
  const nextMatch = linkHeader.match(
    /<[^>]*cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/
  )
  if (nextMatch) {
    return { nextCursor: decodeURIComponent(nextMatch[1]), hasMore: true }
  }
  return { hasMore: false }
}

function mapIssue(issue: any) {
  return {
    id: issue.id,
    shortId: issue.shortId,
    title: issue.title,
    culprit: issue.culprit ?? null,
    permalink: issue.permalink,
    logger: issue.logger ?? null,
    level: issue.level,
    status: issue.status,
    statusDetails: issue.statusDetails || {},
    isPublic: issue.isPublic,
    platform: issue.platform ?? null,
    project: {
      id: issue.project?.id || '',
      name: issue.project?.name || '',
      slug: issue.project?.slug || '',
      platform: issue.project?.platform || '',
    },
    type: issue.type ?? null,
    metadata: {
      type: issue.metadata?.type || null,
      value: issue.metadata?.value || null,
      function: issue.metadata?.function || null,
    },
    numComments: issue.numComments || 0,
    assignedTo: issue.assignedTo
      ? { id: issue.assignedTo.id, name: issue.assignedTo.name, email: issue.assignedTo.email }
      : null,
    isBookmarked: issue.isBookmarked,
    isSubscribed: issue.isSubscribed,
    subscriptionDetails: issue.subscriptionDetails ?? null,
    hasSeen: issue.hasSeen,
    annotations: issue.annotations || [],
    isUnhandled: issue.isUnhandled,
    count: issue.count,
    userCount: issue.userCount || 0,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    stats: issue.stats || {},
  }
}

function mapProject(project: any) {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    platform: project.platform ?? null,
    dateCreated: project.dateCreated,
    isBookmarked: project.isBookmarked,
    isMember: project.isMember,
    features: project.features || [],
    firstEvent: project.firstEvent ?? null,
    firstTransactionEvent: project.firstTransactionEvent ?? null,
    access: project.access || [],
    hasAccess: project.hasAccess,
    hasMinifiedStackTrace: project.hasMinifiedStackTrace,
    hasMonitors: project.hasMonitors,
    hasProfiles: project.hasProfiles,
    hasReplays: project.hasReplays,
    hasSessions: project.hasSessions,
    isInternal: project.isInternal,
    organization: {
      id: project.organization?.id || '',
      slug: project.organization?.slug || '',
      name: project.organization?.name || '',
    },
    team: {
      id: project.team?.id || '',
      name: project.team?.name || '',
      slug: project.team?.slug || '',
    },
    teams:
      project.teams?.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug })) || [],
    status: project.status ?? null,
    color: project.color ?? null,
    isPublic: project.isPublic,
  }
}

function mapEvent(event: any) {
  return {
    id: event.id,
    eventID: event.eventID,
    projectID: event.projectID,
    groupID: event.groupID,
    message: event.message || '',
    title: event.title,
    location: event.location ?? null,
    culprit: event.culprit ?? null,
    dateCreated: event.dateCreated,
    dateReceived: event.dateReceived,
    user: event.user
      ? {
          id: event.user.id,
          email: event.user.email,
          username: event.user.username,
          ipAddress: event.user.ip_address,
          name: event.user.name,
        }
      : null,
    tags: event.tags?.map((tag: any) => ({ key: tag.key, value: tag.value })) || [],
    contexts: event.contexts || {},
    platform: event.platform ?? null,
    type: event.type ?? null,
    metadata: {
      type: event.metadata?.type || null,
      value: event.metadata?.value || null,
      function: event.metadata?.function || null,
    },
    entries: event.entries || [],
    errors: event.errors || [],
    dist: event.dist ?? null,
    fingerprints: event.fingerprints || [],
    sdk: event.sdk ? { name: event.sdk.name, version: event.sdk.version } : null,
  }
}

function mapRelease(release: any) {
  return {
    id: release.id,
    version: release.version,
    shortVersion: release.shortVersion,
    ref: release.ref ?? null,
    url: release.url ?? null,
    dateReleased: release.dateReleased ?? null,
    dateCreated: release.dateCreated,
    dateStarted: release.dateStarted ?? null,
    data: release.data || {},
    newGroups: release.newGroups || 0,
    owner: release.owner
      ? { id: release.owner.id, name: release.owner.name, email: release.owner.email }
      : null,
    commitCount: release.commitCount || 0,
    lastCommit: release.lastCommit
      ? {
          id: release.lastCommit.id,
          message: release.lastCommit.message,
          dateCreated: release.lastCommit.dateCreated,
        }
      : null,
    deployCount: release.deployCount || 0,
    lastDeploy: release.lastDeploy
      ? {
          id: release.lastDeploy.id,
          environment: release.lastDeploy.environment,
          dateStarted: release.lastDeploy.dateStarted,
          dateFinished: release.lastDeploy.dateFinished,
        }
      : null,
    authors:
      release.authors?.map((a: any) => ({ id: a.id, name: a.name, email: a.email })) || [],
    projects:
      release.projects?.map((p: any) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        platform: p.platform,
      })) || [],
    firstEvent: release.firstEvent ?? null,
    lastEvent: release.lastEvent ?? null,
    versionInfo: {
      buildHash: release.versionInfo?.buildHash || null,
      version: { raw: release.versionInfo?.version?.raw || release.version },
      package: release.versionInfo?.package || null,
    },
  }
}

const handler: ToolHandler = {
  operations: {
    sentry_issues_list: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      if (!apiKey || !orgSlug) {
        return { success: false, output: {}, error: 'Missing required parameters: apiKey, organizationSlug' }
      }

      const qp = new URLSearchParams()
      if (params.projectSlug) qp.set('project', params.projectSlug as string)
      if (params.query) qp.set('query', params.query as string)
      if (params.statsPeriod) qp.set('statsPeriod', params.statsPeriod as string)
      if (params.cursor) qp.set('cursor', params.cursor as string)
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.status) qp.set('query', `is:${params.status}`)
      if (params.sort) qp.set('sort', params.sort as string)

      const qs = qp.toString()
      const url = `${SENTRY_BASE}/organizations/${orgSlug}/issues/${qs ? `?${qs}` : ''}`
      const response = await fetch(url, { headers: sentryHeaders(apiKey) })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const pagination = parseLinkHeader(response.headers.get('Link'))

      return {
        success: true,
        output: { issues: data.map(mapIssue), metadata: pagination },
      }
    },

    sentry_issues_get: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const issueId = params.issueId as string
      if (!apiKey || !orgSlug || !issueId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${SENTRY_BASE}/organizations/${orgSlug}/issues/${issueId}/`
      const response = await fetch(url, { headers: sentryHeaders(apiKey) })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const issue = await response.json()
      return { success: true, output: { issue: mapIssue(issue) } }
    },

    sentry_issues_update: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const issueId = params.issueId as string
      if (!apiKey || !orgSlug || !issueId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {}
      if (params.status !== undefined) body.status = params.status
      if (params.assignedTo !== undefined) body.assignedTo = params.assignedTo === '' ? null : params.assignedTo
      if (params.isBookmarked !== undefined) body.isBookmarked = params.isBookmarked
      if (params.isSubscribed !== undefined) body.isSubscribed = params.isSubscribed
      if (params.isPublic !== undefined) body.isPublic = params.isPublic

      const url = `${SENTRY_BASE}/organizations/${orgSlug}/issues/${issueId}/`
      const response = await fetch(url, {
        method: 'PUT',
        headers: sentryHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const issue = await response.json()
      return { success: true, output: { issue: mapIssue(issue) } }
    },

    sentry_projects_list: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      if (!apiKey || !orgSlug) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.cursor) qp.set('cursor', params.cursor as string)
      if (params.limit) qp.set('limit', String(params.limit))

      const qs = qp.toString()
      const url = `${SENTRY_BASE}/organizations/${orgSlug}/projects/${qs ? `?${qs}` : ''}`
      const response = await fetch(url, { headers: sentryHeaders(apiKey) })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const pagination = parseLinkHeader(response.headers.get('Link'))

      return {
        success: true,
        output: { projects: data.map(mapProject), metadata: pagination },
      }
    },

    sentry_projects_get: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const projectSlug = params.projectSlug as string
      if (!apiKey || !orgSlug || !projectSlug) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${SENTRY_BASE}/projects/${orgSlug}/${projectSlug}/`
      const response = await fetch(url, { headers: sentryHeaders(apiKey) })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const project = await response.json()
      return { success: true, output: { project: mapProject(project) } }
    },

    sentry_projects_create: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const name = params.name as string
      const teamSlug = params.teamSlug as string
      if (!apiKey || !orgSlug || !name || !teamSlug) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = { name }
      if (params.slug) body.slug = params.slug
      if (params.platform) body.platform = params.platform
      if (params.defaultRules !== undefined) body.default_rules = params.defaultRules

      const url = `${SENTRY_BASE}/teams/${orgSlug}/${teamSlug}/projects/`
      const response = await fetch(url, {
        method: 'POST',
        headers: sentryHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const project = await response.json()
      return { success: true, output: { project: mapProject(project) } }
    },

    sentry_projects_update: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const projectSlug = params.projectSlug as string
      if (!apiKey || !orgSlug || !projectSlug) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {}
      if (params.name) body.name = params.name
      if (params.slug) body.slug = params.slug
      if (params.platform) body.platform = params.platform
      if (params.isBookmarked !== undefined) body.isBookmarked = params.isBookmarked
      if (params.digestsMinDelay !== undefined) body.digestsMinDelay = Number(params.digestsMinDelay)
      if (params.digestsMaxDelay !== undefined) body.digestsMaxDelay = Number(params.digestsMaxDelay)

      const url = `${SENTRY_BASE}/projects/${orgSlug}/${projectSlug}/`
      const response = await fetch(url, {
        method: 'PUT',
        headers: sentryHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const project = await response.json()
      return { success: true, output: { project: mapProject(project) } }
    },

    sentry_events_list: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const projectSlug = params.projectSlug as string
      if (!apiKey || !orgSlug) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      let baseUrl: string
      if (params.issueId) {
        baseUrl = `${SENTRY_BASE}/organizations/${orgSlug}/issues/${params.issueId}/events/`
      } else {
        if (!projectSlug) {
          return { success: false, output: {}, error: 'Missing required parameter: projectSlug' }
        }
        baseUrl = `${SENTRY_BASE}/projects/${orgSlug}/${projectSlug}/events/`
      }

      const qp = new URLSearchParams()
      if (params.query) qp.set('query', params.query as string)
      if (params.cursor) qp.set('cursor', params.cursor as string)
      if (params.limit) qp.set('limit', String(params.limit))
      if (params.statsPeriod) qp.set('statsPeriod', params.statsPeriod as string)

      const qs = qp.toString()
      const url = `${baseUrl}${qs ? `?${qs}` : ''}`
      const response = await fetch(url, { headers: sentryHeaders(apiKey) })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const pagination = parseLinkHeader(response.headers.get('Link'))

      return {
        success: true,
        output: { events: data.map(mapEvent), metadata: pagination },
      }
    },

    sentry_events_get: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const projectSlug = params.projectSlug as string
      const eventId = params.eventId as string
      if (!apiKey || !orgSlug || !projectSlug || !eventId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const url = `${SENTRY_BASE}/projects/${orgSlug}/${projectSlug}/events/${eventId}/`
      const response = await fetch(url, { headers: sentryHeaders(apiKey) })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const event = await response.json()
      return { success: true, output: { event: mapEvent(event) } }
    },

    sentry_releases_list: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      if (!apiKey || !orgSlug) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const qp = new URLSearchParams()
      if (params.projectSlug) qp.set('project', params.projectSlug as string)
      if (params.query) qp.set('query', params.query as string)
      if (params.cursor) qp.set('cursor', params.cursor as string)
      if (params.limit) qp.set('limit', String(params.limit))

      const qs = qp.toString()
      const url = `${SENTRY_BASE}/organizations/${orgSlug}/releases/${qs ? `?${qs}` : ''}`
      const response = await fetch(url, { headers: sentryHeaders(apiKey) })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const pagination = parseLinkHeader(response.headers.get('Link'))

      return {
        success: true,
        output: { releases: data.map(mapRelease), metadata: pagination },
      }
    },

    sentry_releases_create: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const version = params.version as string
      const projects = params.projects as string
      if (!apiKey || !orgSlug || !version || !projects) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = {
        version,
        projects: projects.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0),
      }
      if (params.ref) body.ref = params.ref
      if (params.url) body.url = params.url
      if (params.dateReleased) body.dateReleased = params.dateReleased
      if (params.commits) {
        try { body.commits = JSON.parse(params.commits as string) } catch { /* skip */ }
      }

      const url = `${SENTRY_BASE}/organizations/${orgSlug}/releases/`
      const response = await fetch(url, {
        method: 'POST',
        headers: sentryHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const release = await response.json()
      return { success: true, output: { release: mapRelease(release) } }
    },

    sentry_releases_deploy: async (params) => {
      const apiKey = params.apiKey as string
      const orgSlug = params.organizationSlug as string
      const version = params.version as string
      const environment = params.environment as string
      if (!apiKey || !orgSlug || !version || !environment) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, any> = { environment }
      if (params.name) body.name = params.name
      if (params.url) body.url = params.url
      if (params.dateStarted) body.dateStarted = params.dateStarted
      if (params.dateFinished) body.dateFinished = params.dateFinished

      const url = `${SENTRY_BASE}/organizations/${orgSlug}/releases/${encodeURIComponent(version)}/deploys/`
      const response = await fetch(url, {
        method: 'POST',
        headers: sentryHeaders(apiKey),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Sentry API error: ${response.status} ${err}` }
      }

      const deploy = await response.json()
      return {
        success: true,
        output: {
          deploy: {
            id: deploy.id,
            environment: deploy.environment,
            name: deploy.name ?? null,
            url: deploy.url ?? null,
            dateStarted: deploy.dateStarted,
            dateFinished: deploy.dateFinished ?? null,
          },
        },
      }
    },
  },
}

export default handler
