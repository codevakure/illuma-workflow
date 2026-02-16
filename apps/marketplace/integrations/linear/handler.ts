import type { ToolHandler } from '../../sdk/types'

const GRAPHQL_URL = 'https://api.linear.app/graphql'

async function linearGql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<any> {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Linear API error: ${resp.status} ${text}`)
  }
  const data = await resp.json()
  if (data.errors) {
    throw new Error(data.errors[0]?.message || 'Linear GraphQL error')
  }
  return data.data
}

function mapIssue(issue: any) {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    estimate: issue.estimate,
    url: issue.url,
    dueDate: issue.dueDate,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt,
    canceledAt: issue.canceledAt,
    archivedAt: issue.archivedAt,
    state: issue.state,
    assignee: issue.assignee,
    teamId: issue.team?.id,
    teamName: issue.team?.name,
    projectId: issue.project?.id,
    projectName: issue.project?.name,
    cycleId: issue.cycle?.id,
    cycleNumber: issue.cycle?.number,
    cycleName: issue.cycle?.name,
    parentId: issue.parent?.id,
    parentTitle: issue.parent?.title,
    projectMilestoneId: issue.projectMilestone?.id,
    projectMilestoneName: issue.projectMilestone?.name,
    labels: issue.labels?.nodes || [],
  }
}

const ISSUE_FIELDS = `
  id title description priority estimate url dueDate
  createdAt updatedAt completedAt canceledAt archivedAt
  state { id name type }
  assignee { id name email }
  team { id name }
  project { id name }
  cycle { id number name }
  parent { id title }
  projectMilestone { id name }
  labels { nodes { id name color } }
`

const handler: ToolHandler = {
  operations: {
    linear_read_issues: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const filter: Record<string, any> = {}
      if (params.teamId) filter.team = { id: { eq: params.teamId } }
      if (params.projectId) filter.project = { id: { eq: params.projectId } }
      if (params.assigneeId) filter.assignee = { id: { eq: params.assigneeId } }
      if (params.stateId) filter.state = { id: { eq: params.stateId } }
      if (params.priority != null) filter.priority = { eq: Number(params.priority) }
      if (Array.isArray(params.labelIds) && params.labelIds.length > 0) {
        filter.labels = { some: { id: { in: params.labelIds } } }
      }
      if (params.createdAfter) filter.createdAt = { gte: params.createdAfter }
      if (params.updatedAfter) filter.updatedAt = { gte: params.updatedAfter }

      const variables: Record<string, any> = {}
      if (Object.keys(filter).length > 0) variables.filter = filter
      if (params.first != null) variables.first = Math.min(Number(params.first), 250)
      if (params.after) variables.after = params.after
      if (params.includeArchived != null) variables.includeArchived = params.includeArchived
      if (params.orderBy) variables.orderBy = params.orderBy

      const data = await linearGql(accessToken, `
        query($filter: IssueFilter, $first: Int, $after: String, $includeArchived: Boolean, $orderBy: PaginationOrderBy) {
          issues(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived, orderBy: $orderBy) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, variables)

      return {
        success: true,
        output: {
          issues: (data.issues.nodes || []).map(mapIssue),
          hasNextPage: data.issues.pageInfo.hasNextPage,
          endCursor: data.issues.pageInfo.endCursor,
        },
      }
    },

    linear_get_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const issueId = params.issueId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!issueId) return { success: false, output: {}, error: 'Missing required parameter: issueId' }

      const data = await linearGql(accessToken, `
        query($id: String!) {
          issue(id: $id) { ${ISSUE_FIELDS} }
        }
      `, { id: issueId })

      return { success: true, output: { issue: mapIssue(data.issue) } }
    },

    linear_create_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.title) return { success: false, output: {}, error: 'Missing required parameter: title' }
      if (!params.teamId) return { success: false, output: {}, error: 'Missing required parameter: teamId' }

      const input: Record<string, any> = { teamId: params.teamId, title: params.title }
      for (const key of ['projectId', 'description', 'stateId', 'assigneeId', 'cycleId', 'parentId', 'dueDate', 'projectMilestoneId']) {
        if (params[key] != null && params[key] !== '') input[key] = params[key]
      }
      if (params.priority != null) input.priority = Number(params.priority)
      if (params.estimate != null) input.estimate = Number(params.estimate)
      if (Array.isArray(params.labelIds)) input.labelIds = params.labelIds
      if (Array.isArray(params.subscriberIds)) input.subscriberIds = params.subscriberIds

      const data = await linearGql(accessToken, `
        mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            issue { ${ISSUE_FIELDS} }
          }
        }
      `, { input })

      return { success: true, output: { issue: mapIssue(data.issueCreate.issue) } }
    },

    linear_update_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const issueId = params.issueId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!issueId) return { success: false, output: {}, error: 'Missing required parameter: issueId' }

      const input: Record<string, any> = {}
      for (const key of ['title', 'description', 'stateId', 'assigneeId', 'projectId', 'cycleId', 'parentId', 'dueDate']) {
        if (params[key] != null && params[key] !== '') input[key] = params[key]
      }
      if (params.priority != null) input.priority = Number(params.priority)
      if (params.estimate != null) input.estimate = Number(params.estimate)
      if (Array.isArray(params.labelIds)) input.labelIds = params.labelIds
      if (Array.isArray(params.addedLabelIds)) input.addedLabelIds = params.addedLabelIds
      if (Array.isArray(params.removedLabelIds)) input.removedLabelIds = params.removedLabelIds

      const data = await linearGql(accessToken, `
        mutation($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { ${ISSUE_FIELDS} }
          }
        }
      `, { id: issueId, input })

      if (!data.issueUpdate.success) {
        return { success: false, output: {}, error: 'Issue update was not successful' }
      }
      return { success: true, output: { issue: mapIssue(data.issueUpdate.issue) } }
    },

    linear_archive_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const issueId = params.issueId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const data = await linearGql(accessToken, `
        mutation($id: String!) { issueArchive(id: $id) { success } }
      `, { id: issueId })

      return { success: true, output: { success: data.issueArchive.success, issueId } }
    },

    linear_unarchive_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const data = await linearGql(accessToken, `
        mutation($id: String!) { issueUnarchive(id: $id) { success } }
      `, { id: params.issueId as string })
      return { success: true, output: { success: data.issueUnarchive.success, issueId: params.issueId } }
    },

    linear_delete_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const data = await linearGql(accessToken, `
        mutation($id: String!) { issueDelete(id: $id) { success } }
      `, { id: params.issueId as string })
      return { success: true, output: { success: data.issueDelete.success } }
    },

    linear_search_issues: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const filter: Record<string, any> = {}
      if (params.teamId) filter.team = { id: { eq: params.teamId } }

      const data = await linearGql(accessToken, `
        query($term: String!, $filter: IssueFilter, $first: Int, $after: String, $includeArchived: Boolean) {
          searchIssues(term: $term, filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, {
        term: params.query,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        first: params.first ? Number(params.first) : 50,
        after: params.after,
        includeArchived: params.includeArchived || false,
      })

      return {
        success: true,
        output: {
          issues: data.searchIssues.nodes.map(mapIssue),
          pageInfo: data.searchIssues.pageInfo,
        },
      }
    },

    linear_create_comment: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const data = await linearGql(accessToken, `
        mutation($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            comment { id body createdAt updatedAt user { id name email } issue { id title } }
          }
        }
      `, { input: { issueId: params.issueId, body: params.body } })
      return { success: true, output: { comment: data.commentCreate.comment } }
    },

    linear_list_teams: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const data = await linearGql(accessToken, `
        query($first: Int, $after: String) {
          teams(first: $first, after: $after) {
            nodes { id name key description }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { first: params.first ? Number(params.first) : 50, after: params.after })
      return {
        success: true,
        output: { teams: data.teams.nodes, pageInfo: data.teams.pageInfo },
      }
    },

    linear_list_projects: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const filter: Record<string, any> = {}
      if (params.teamId) filter.accessibleTeams = { some: { id: { eq: params.teamId } } }

      const data = await linearGql(accessToken, `
        query($first: Int, $after: String, $filter: ProjectFilter) {
          projects(first: $first, after: $after, filter: $filter) {
            nodes { id name description state priority startDate targetDate url lead { id name } teams { nodes { id name } } }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, {
        first: params.first ? Number(params.first) : 50,
        after: params.after,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      })
      return {
        success: true,
        output: {
          projects: (data.projects.nodes || []).map((p: any) => ({
            ...p,
            teams: p.teams?.nodes || [],
          })),
          pageInfo: data.projects.pageInfo,
        },
      }
    },

    linear_get_viewer: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const data = await linearGql(accessToken, `
        query { viewer { id name email displayName active admin avatarUrl } }
      `)
      return { success: true, output: { user: data.viewer } }
    },

    linear_list_users: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const data = await linearGql(accessToken, `
        query($first: Int, $after: String) {
          users(first: $first, after: $after) {
            nodes { id name email displayName active admin avatarUrl }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { first: params.first ? Number(params.first) : 50, after: params.after })
      return {
        success: true,
        output: { users: data.users.nodes, pageInfo: data.users.pageInfo },
      }
    },

    linear_list_labels: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const filter: Record<string, any> = {}
      if (params.teamId) filter.team = { id: { eq: params.teamId } }

      const data = await linearGql(accessToken, `
        query($first: Int, $after: String, $filter: IssueLabelFilter) {
          issueLabels(first: $first, after: $after, filter: $filter) {
            nodes { id name color description isGroup createdAt updatedAt archivedAt team { id name } }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, {
        first: params.first ? Number(params.first) : 50,
        after: params.after,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      })
      return {
        success: true,
        output: { labels: data.issueLabels.nodes, pageInfo: data.issueLabels.pageInfo },
      }
    },
  },
}

export default handler
