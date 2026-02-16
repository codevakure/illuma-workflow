import type { ToolHandler } from '../../sdk/types'

const BASE_URL = 'https://gitlab.com/api/v4'

function gitlabHeaders(accessToken: string) {
  return {
    'Content-Type': 'application/json',
    'PRIVATE-TOKEN': accessToken,
  }
}

function encodeProjectId(projectId: unknown): string {
  return encodeURIComponent(String(projectId))
}

const handler: ToolHandler = {
  operations: {
    /** Projects */
    gitlab_list_projects: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const query = new URLSearchParams()
      if (params.owned) query.set('owned', 'true')
      if (params.membership) query.set('membership', 'true')
      if (params.search) query.set('search', params.search as string)
      if (params.visibility) query.set('visibility', params.visibility as string)
      if (params.orderBy) query.set('order_by', params.orderBy as string)
      if (params.sort) query.set('sort', params.sort as string)
      if (params.perPage) query.set('per_page', String(params.perPage))
      if (params.page) query.set('page', String(params.page))

      const qs = query.toString()
      const resp = await fetch(`${BASE_URL}/projects${qs ? `?${qs}` : ''}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }

      const projects = await resp.json()
      const total = resp.headers.get('x-total')
      return {
        success: true,
        output: { projects, total: total ? parseInt(total, 10) : projects.length },
      }
    },

    gitlab_get_project: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.projectId) return { success: false, output: {}, error: 'Missing required parameter: projectId' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { project: await resp.json() } }
    },

    /** Issues */
    gitlab_list_issues: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.projectId) return { success: false, output: {}, error: 'Missing required parameter: projectId' }

      const query = new URLSearchParams()
      if (params.state) query.set('state', params.state as string)
      if (params.labels) query.set('labels', params.labels as string)
      if (params.assignee_id) query.set('assignee_id', String(params.assignee_id))
      if (params.search) query.set('search', params.search as string)
      if (params.order_by) query.set('order_by', params.order_by as string)
      if (params.sort) query.set('sort', params.sort as string)
      if (params.per_page) query.set('per_page', String(params.per_page))
      if (params.page) query.set('page', String(params.page))

      const qs = query.toString()
      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/issues${qs ? `?${qs}` : ''}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }

      const issues = await resp.json()
      const total = resp.headers.get('x-total')
      return {
        success: true,
        output: { issues, total: total ? parseInt(total, 10) : issues.length },
      }
    },

    gitlab_get_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.projectId || !params.issueIid) {
        return { success: false, output: {}, error: 'Missing required parameters: projectId, issueIid' }
      }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/issues/${params.issueIid}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { issue: await resp.json() } }
    },

    gitlab_create_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.projectId) return { success: false, output: {}, error: 'Missing required parameter: projectId' }
      if (!params.title) return { success: false, output: {}, error: 'Missing required parameter: title' }

      const body: Record<string, unknown> = { title: params.title }
      if (params.description) body.description = params.description
      if (params.labels) body.labels = params.labels
      if (params.assigneeIds) body.assignee_ids = params.assigneeIds
      if (params.milestoneId) body.milestone_id = params.milestoneId
      if (params.dueDate) body.due_date = params.dueDate
      if (params.confidential !== undefined) body.confidential = params.confidential

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/issues`, {
        method: 'POST',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { issue: await resp.json() } }
    },

    gitlab_update_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.projectId || !params.issueIid) {
        return { success: false, output: {}, error: 'Missing required parameters: projectId, issueIid' }
      }

      const body: Record<string, unknown> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.description !== undefined) body.description = params.description
      if (params.labels !== undefined) body.labels = params.labels
      if (params.assigneeIds !== undefined) body.assignee_ids = params.assigneeIds
      if (params.milestoneId !== undefined) body.milestone_id = params.milestoneId
      if (params.dueDate !== undefined) body.due_date = params.dueDate
      if (params.stateEvent !== undefined) body.state_event = params.stateEvent
      if (params.confidential !== undefined) body.confidential = params.confidential

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/issues/${params.issueIid}`, {
        method: 'PUT',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { issue: await resp.json() } }
    },

    gitlab_delete_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/issues/${params.issueIid}`, {
        method: 'DELETE',
        headers: gitlabHeaders(accessToken),
      })
      return {
        success: resp.ok,
        output: { deleted: resp.ok, issueIid: params.issueIid },
      }
    },

    gitlab_create_issue_note: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.body) return { success: false, output: {}, error: 'Missing required parameter: body' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/issues/${params.issueIid}/notes`, {
        method: 'POST',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify({ body: params.body }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { note: await resp.json() } }
    },

    /** Merge Requests */
    gitlab_list_merge_requests: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.projectId) return { success: false, output: {}, error: 'Missing required parameter: projectId' }

      const query = new URLSearchParams()
      if (params.state) query.set('state', params.state as string)
      if (params.order_by) query.set('order_by', params.order_by as string)
      if (params.sort) query.set('sort', params.sort as string)
      if (params.per_page) query.set('per_page', String(params.per_page))
      if (params.page) query.set('page', String(params.page))

      const qs = query.toString()
      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/merge_requests${qs ? `?${qs}` : ''}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }

      const mergeRequests = await resp.json()
      const total = resp.headers.get('x-total')
      return {
        success: true,
        output: { mergeRequests, total: total ? parseInt(total, 10) : mergeRequests.length },
      }
    },

    gitlab_get_merge_request: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/merge_requests/${params.mergeRequestIid}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { mergeRequest: await resp.json() } }
    },

    gitlab_create_merge_request: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const body: Record<string, unknown> = {
        source_branch: params.sourceBranch,
        target_branch: params.targetBranch,
        title: params.title,
      }
      if (params.description) body.description = params.description
      if (params.assigneeId) body.assignee_id = params.assigneeId
      if (params.labels) body.labels = params.labels
      if (params.milestoneId) body.milestone_id = params.milestoneId
      if (params.removeSourceBranch !== undefined) body.remove_source_branch = params.removeSourceBranch
      if (params.squash !== undefined) body.squash = params.squash

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/merge_requests`, {
        method: 'POST',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { mergeRequest: await resp.json() } }
    },

    gitlab_update_merge_request: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const body: Record<string, unknown> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.description !== undefined) body.description = params.description
      if (params.targetBranch !== undefined) body.target_branch = params.targetBranch
      if (params.assigneeId !== undefined) body.assignee_id = params.assigneeId
      if (params.labels !== undefined) body.labels = params.labels
      if (params.milestoneId !== undefined) body.milestone_id = params.milestoneId
      if (params.stateEvent !== undefined) body.state_event = params.stateEvent
      if (params.removeSourceBranch !== undefined) body.remove_source_branch = params.removeSourceBranch
      if (params.squash !== undefined) body.squash = params.squash

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/merge_requests/${params.mergeRequestIid}`, {
        method: 'PUT',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { mergeRequest: await resp.json() } }
    },

    gitlab_merge_merge_request: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const body: Record<string, unknown> = {}
      if (params.mergeCommitMessage) body.merge_commit_message = params.mergeCommitMessage
      if (params.squashCommitMessage) body.squash_commit_message = params.squashCommitMessage
      if (params.squash !== undefined) body.squash = params.squash
      if (params.shouldRemoveSourceBranch !== undefined) body.should_remove_source_branch = params.shouldRemoveSourceBranch

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/merge_requests/${params.mergeRequestIid}/merge`, {
        method: 'PUT',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { mergeRequest: await resp.json() } }
    },

    gitlab_create_merge_request_note: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/merge_requests/${params.mergeRequestIid}/notes`, {
        method: 'POST',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify({ body: params.body }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { note: await resp.json() } }
    },

    /** Pipelines */
    gitlab_list_pipelines: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const query = new URLSearchParams()
      if (params.status) query.set('status', params.status as string)
      if (params.ref) query.set('ref', params.ref as string)
      if (params.per_page) query.set('per_page', String(params.per_page))
      if (params.page) query.set('page', String(params.page))

      const qs = query.toString()
      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/pipelines${qs ? `?${qs}` : ''}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }

      const pipelines = await resp.json()
      const total = resp.headers.get('x-total')
      return {
        success: true,
        output: { pipelines, total: total ? parseInt(total, 10) : pipelines.length },
      }
    },

    gitlab_get_pipeline: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/pipelines/${params.pipelineId}`, {
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { pipeline: await resp.json() } }
    },

    gitlab_create_pipeline: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.ref) return { success: false, output: {}, error: 'Missing required parameter: ref' }

      const body: Record<string, unknown> = { ref: params.ref }
      if (params.variables) body.variables = params.variables

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/pipeline`, {
        method: 'POST',
        headers: gitlabHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { pipeline: await resp.json() } }
    },

    gitlab_retry_pipeline: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/pipelines/${params.pipelineId}/retry`, {
        method: 'POST',
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { pipeline: await resp.json() } }
    },

    gitlab_cancel_pipeline: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const resp = await fetch(`${BASE_URL}/projects/${encodeProjectId(params.projectId)}/pipelines/${params.pipelineId}/cancel`, {
        method: 'POST',
        headers: gitlabHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitLab API error: ${resp.status} ${err}` }
      }
      return { success: true, output: { pipeline: await resp.json() } }
    },
  },
}

export default handler
