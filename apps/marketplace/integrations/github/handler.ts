import type { ToolHandler } from '../../sdk/types'

const API_BASE = 'https://api.github.com'

function githubHeaders(token: string) {
  return {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function parseCommaSeparated(value: unknown): string[] {
  if (!value) return []
  return String(value).split(',').map((s) => s.trim()).filter(Boolean)
}

const handler: ToolHandler = {
  operations: {
    /** Issues */
    github_create_issue: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.owner || !params.repo) return { success: false, output: {}, error: 'Missing owner/repo' }
      if (!params.title) return { success: false, output: {}, error: 'Missing required parameter: title' }

      const body: Record<string, unknown> = { title: params.title }
      if (params.body) body.body = params.body
      const assignees = parseCommaSeparated(params.assignees)
      if (assignees.length > 0) body.assignees = assignees
      const labels = parseCommaSeparated(params.labels)
      if (labels.length > 0) body.labels = labels
      if (params.milestone) body.milestone = params.milestone

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const issue = await resp.json()
      return { success: true, output: issue }
    },

    github_get_issue: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_update_issue: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.body !== undefined) body.body = params.body
      if (params.state !== undefined) body.state = params.state
      if (params.labels !== undefined) body.labels = params.labels
      if (params.assignees !== undefined) body.assignees = params.assignees

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_close_issue: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = { state: 'closed' }
      if (params.state_reason) body.state_reason = params.state_reason

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_list_issues: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/issues`)
      if (params.state) url.searchParams.set('state', params.state as string)
      if (params.assignee) url.searchParams.set('assignee', params.assignee as string)
      if (params.creator) url.searchParams.set('creator', params.creator as string)
      if (params.labels) url.searchParams.set('labels', params.labels as string)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.direction) url.searchParams.set('direction', params.direction as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const issues = await resp.json()
      return { success: true, output: { items: issues, count: issues.length } }
    },

    github_search_issues: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.q) return { success: false, output: {}, error: 'Missing required parameter: q' }

      const url = new URL(`${API_BASE}/search/issues`)
      url.searchParams.set('q', params.q as string)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.order) url.searchParams.set('order', params.order as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return {
        success: true,
        output: {
          total_count: data.total_count,
          incomplete_results: data.incomplete_results,
          items: data.items || [],
        },
      }
    },

    /** Issue Comments */
    github_issue_comment: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ body: params.body }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_list_issue_comments: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`)
      if (params.since) url.searchParams.set('since', params.since as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const comments = await resp.json()
      return { success: true, output: { comments, count: comments.length } }
    },

    github_update_comment: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify({ body: params.body }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_comment: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { deleted: resp.ok, comment_id: params.comment_id } }
    },

    /** Labels & Assignees */
    github_add_labels: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const labels = parseCommaSeparated(params.labels)
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/labels`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ labels }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_remove_label: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/labels/${encodeURIComponent(params.name as string)}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_add_assignees: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const assignees = parseCommaSeparated(params.assignees)
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/assignees`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ assignees }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    /** Pull Requests */
    github_pr: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_create_pr: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = { title: params.title, head: params.head, base: params.base }
      if (params.body) body.body = params.body
      if (params.draft !== undefined) body.draft = params.draft

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_update_pr: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.body !== undefined) body.body = params.body
      if (params.state !== undefined) body.state = params.state
      if (params.base !== undefined) body.base = params.base

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_close_pr: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify({ state: 'closed' }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_merge_pr: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      if (params.commit_title) body.commit_title = params.commit_title
      if (params.commit_message) body.commit_message = params.commit_message
      if (params.merge_method) body.merge_method = params.merge_method

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/merge`, {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_list_prs: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls`)
      if (params.state) url.searchParams.set('state', params.state as string)
      if (params.head) url.searchParams.set('head', params.head as string)
      if (params.base) url.searchParams.set('base', params.base as string)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.direction) url.searchParams.set('direction', params.direction as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const prs = await resp.json()
      return { success: true, output: { items: prs, count: prs.length } }
    },

    github_get_pr_files: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/files`)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const files = await resp.json()
      return { success: true, output: { files, count: files.length } }
    },

    github_list_pr_comments: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/comments`)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.direction) url.searchParams.set('direction', params.direction as string)
      if (params.since) url.searchParams.set('since', params.since as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const comments = await resp.json()
      return { success: true, output: { comments, count: comments.length } }
    },

    github_comment: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = { body: params.body }
      if (params.path) body.path = params.path
      if (params.position) body.position = params.position
      if (params.line) body.line = params.line
      if (params.side) body.side = params.side
      if (params.commitId) body.commit_id = params.commitId

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/comments`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_request_reviewers: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      const reviewers = parseCommaSeparated(params.reviewers)
      if (reviewers.length > 0) body.reviewers = reviewers
      const teamReviewers = parseCommaSeparated(params.team_reviewers)
      if (teamReviewers.length > 0) body.team_reviewers = teamReviewers

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/requested_reviewers`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    /** Repository */
    github_repo_info: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_fork_repo: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/forks`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({}),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_list_forks: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/forks`)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const forks = await resp.json()
      return { success: true, output: { items: forks, count: forks.length } }
    },

    /** Branches */
    github_list_branches: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/branches`)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const branches = await resp.json()
      return { success: true, output: { items: branches, count: branches.length } }
    },

    github_get_branch: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/branches/${encodeURIComponent(params.branch as string)}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_create_branch: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/git/refs`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ ref: `refs/heads/${params.branch}`, sha: params.sha }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_branch: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/git/refs/heads/${encodeURIComponent(params.branch as string)}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { deleted: resp.ok, branch: params.branch } }
    },

    github_get_branch_protection: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/branches/${encodeURIComponent(params.branch as string)}/protection`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_update_branch_protection: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/branches/${encodeURIComponent(params.branch as string)}/protection`, {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify({
          required_status_checks: params.required_status_checks ?? null,
          enforce_admins: params.enforce_admins ?? false,
          required_pull_request_reviews: params.required_pull_request_reviews ?? null,
          restrictions: params.restrictions ?? null,
        }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    /** Commits */
    github_latest_commit: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/commits`)
      if (params.branch) url.searchParams.set('sha', params.branch as string)
      url.searchParams.set('per_page', '1')

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const commits = await resp.json()
      return { success: true, output: commits[0] || {} }
    },

    github_list_commits: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/commits`)
      if (params.sha) url.searchParams.set('sha', params.sha as string)
      if (params.path) url.searchParams.set('path', params.path as string)
      if (params.author) url.searchParams.set('author', params.author as string)
      if (params.since) url.searchParams.set('since', params.since as string)
      if (params.until) url.searchParams.set('until', params.until as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const commits = await resp.json()
      return { success: true, output: { items: commits, count: commits.length } }
    },

    github_get_commit: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/commits/${params.ref}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_compare_commits: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/compare/${params.base}...${params.head}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    /** Files & Tree */
    github_get_file_content: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`)
      if (params.ref) url.searchParams.set('ref', params.ref as string)

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_create_file: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {
        message: params.message,
        content: btoa(params.content as string),
      }
      if (params.branch) body.branch = params.branch

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`, {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_update_file: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {
        message: params.message,
        content: btoa(params.content as string),
        sha: params.sha,
      }
      if (params.branch) body.branch = params.branch

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`, {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_file: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = { message: params.message, sha: params.sha }
      if (params.branch) body.branch = params.branch

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/contents/${params.path}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_get_tree: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const ref = (params.ref || 'HEAD') as string
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/git/trees/${ref}?recursive=1`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    /** Search */
    github_search_repos: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/search/repositories`)
      url.searchParams.set('q', params.q as string)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.order) url.searchParams.set('order', params.order as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_search_code: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/search/code`)
      url.searchParams.set('q', params.q as string)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.order) url.searchParams.set('order', params.order as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_search_commits: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/search/commits`)
      url.searchParams.set('q', params.q as string)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.order) url.searchParams.set('order', params.order as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), {
        headers: { ...githubHeaders(token), Accept: 'application/vnd.github.cloak-preview+json' },
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_search_users: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/search/users`)
      url.searchParams.set('q', params.q as string)
      if (params.sort) url.searchParams.set('sort', params.sort as string)
      if (params.order) url.searchParams.set('order', params.order as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    /** Gists */
    github_create_gist: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/gists`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ files: params.files, description: params.description, public: params.public ?? false }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_get_gist: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/gists/${params.gist_id}`, { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_list_gists: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/gists`)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const gists = await resp.json()
      return { success: true, output: { items: gists, count: gists.length } }
    },

    github_update_gist: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      if (params.files) body.files = params.files
      if (params.description !== undefined) body.description = params.description

      const resp = await fetch(`${API_BASE}/gists/${params.gist_id}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_gist: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/gists/${params.gist_id}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { deleted: resp.ok, gist_id: params.gist_id } }
    },

    github_fork_gist: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/gists/${params.gist_id}/forks`, {
        method: 'POST',
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_star_gist: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/gists/${params.gist_id}/star`, {
        method: 'PUT',
        headers: { ...githubHeaders(token), 'Content-Length': '0' },
      })
      return { success: resp.ok, output: { starred: resp.ok, gist_id: params.gist_id } }
    },

    github_unstar_gist: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/gists/${params.gist_id}/star`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { unstarred: resp.ok, gist_id: params.gist_id } }
    },

    /** Stars */
    github_star_repo: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/user/starred/${params.owner}/${params.repo}`, {
        method: 'PUT',
        headers: { ...githubHeaders(token), 'Content-Length': '0' },
      })
      return { success: resp.ok, output: { starred: resp.ok } }
    },

    github_unstar_repo: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/user/starred/${params.owner}/${params.repo}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { unstarred: resp.ok } }
    },

    github_check_star: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/user/starred/${params.owner}/${params.repo}`, {
        headers: githubHeaders(token),
      })
      return { success: true, output: { starred: resp.status === 204 } }
    },

    github_list_stargazers: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/stargazers`)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const stargazers = await resp.json()
      return { success: true, output: { items: stargazers, count: stargazers.length } }
    },

    /** Milestones */
    github_create_milestone: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = { title: params.title }
      if (params.state) body.state = params.state
      if (params.description) body.description = params.description
      if (params.due_on) body.due_on = params.due_on

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/milestones`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_get_milestone: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/milestones/${params.milestone_number}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_list_milestones: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/milestones`)
      if (params.state) url.searchParams.set('state', params.state as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const milestones = await resp.json()
      return { success: true, output: { items: milestones, count: milestones.length } }
    },

    github_update_milestone: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.state !== undefined) body.state = params.state
      if (params.description !== undefined) body.description = params.description
      if (params.due_on !== undefined) body.due_on = params.due_on

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/milestones/${params.milestone_number}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_milestone: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/milestones/${params.milestone_number}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { deleted: resp.ok, milestone_number: params.milestone_number } }
    },

    /** Reactions */
    github_create_issue_reaction: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/reactions`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ content: params.content }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_issue_reaction: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/reactions/${params.reaction_id}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { deleted: resp.ok, reaction_id: params.reaction_id } }
    },

    github_create_comment_reaction: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}/reactions`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify({ content: params.content }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_comment_reaction: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/issues/comments/${params.comment_id}/reactions/${params.reaction_id}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { deleted: resp.ok, reaction_id: params.reaction_id } }
    },

    /** Releases */
    github_create_release: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = { tag_name: params.tag_name }
      if (params.target_commitish) body.target_commitish = params.target_commitish
      if (params.name) body.name = params.name
      if (params.body) body.body = params.body
      if (params.draft !== undefined) body.draft = params.draft
      if (params.prerelease !== undefined) body.prerelease = params.prerelease

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/releases`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_get_release: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/releases/${params.release_id}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_list_releases: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/releases`)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const releases = await resp.json()
      return { success: true, output: { items: releases, count: releases.length } }
    },

    github_update_release: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      if (params.tag_name !== undefined) body.tag_name = params.tag_name
      if (params.target_commitish !== undefined) body.target_commitish = params.target_commitish
      if (params.name !== undefined) body.name = params.name
      if (params.body !== undefined) body.body = params.body
      if (params.draft !== undefined) body.draft = params.draft
      if (params.prerelease !== undefined) body.prerelease = params.prerelease

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/releases/${params.release_id}`, {
        method: 'PATCH',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_delete_release: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/releases/${params.release_id}`, {
        method: 'DELETE',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { deleted: resp.ok, release_id: params.release_id } }
    },

    /** Workflows */
    github_list_workflows: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/actions/workflows`)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_get_workflow: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow_id}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_trigger_workflow: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = { ref: params.ref }
      if (params.inputs) body.inputs = params.inputs

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow_id}/dispatches`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      return { success: resp.ok, output: { triggered: resp.ok } }
    },

    github_list_workflow_runs: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const url = new URL(`${API_BASE}/repos/${params.owner}/${params.repo}/actions/runs`)
      if (params.actor) url.searchParams.set('actor', params.actor as string)
      if (params.branch) url.searchParams.set('branch', params.branch as string)
      if (params.event) url.searchParams.set('event', params.event as string)
      if (params.status) url.searchParams.set('status', params.status as string)
      if (params.per_page) url.searchParams.set('per_page', String(params.per_page))
      if (params.page) url.searchParams.set('page', String(params.page))

      const resp = await fetch(url.toString(), { headers: githubHeaders(token) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_get_workflow_run: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}`, {
        headers: githubHeaders(token),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      return { success: true, output: await resp.json() }
    },

    github_cancel_workflow_run: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}/cancel`, {
        method: 'POST',
        headers: githubHeaders(token),
      })
      return { success: resp.ok, output: { cancelled: resp.ok, run_id: params.run_id } }
    },

    github_rerun_workflow: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const body: Record<string, unknown> = {}
      if (params.enable_debug_logging) body.enable_debug_logging = true

      const resp = await fetch(`${API_BASE}/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}/rerun`, {
        method: 'POST',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
      })
      return { success: resp.ok, output: { rerun: resp.ok, run_id: params.run_id } }
    },

    /** Projects (GraphQL) */
    github_list_projects: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const ownerType = (params.owner_type as string) === 'org' ? 'organization' : 'user'
      const query = `query { ${ownerType}(login: "${params.owner_login}") { projectsV2(first: 20) { nodes { id title number url closed public shortDescription } totalCount } } }`

      const resp = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      const projects = data.data?.[ownerType]?.projectsV2
      return {
        success: true,
        output: {
          projects: projects?.nodes || [],
          totalCount: projects?.totalCount || 0,
        },
      }
    },

    github_get_project: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const ownerType = (params.owner_type as string) === 'org' ? 'organization' : 'user'
      const query = `query { ${ownerType}(login: "${params.owner_login}") { projectV2(number: ${params.project_number}) { id title number url closed public shortDescription readme createdAt updatedAt } } }`

      const resp = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return { success: true, output: data.data?.[ownerType]?.projectV2 || {} }
    },

    github_create_project: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const query = `mutation { createProjectV2(input: { ownerId: "${params.owner_id}", title: "${params.title}" }) { projectV2 { id title number url } } }`

      const resp = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return { success: true, output: data.data?.createProjectV2?.projectV2 || {} }
    },

    github_update_project: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const inputs: string[] = [`projectId: "${params.project_id}"`]
      if (params.title !== undefined) inputs.push(`title: "${params.title}"`)
      if (params.shortDescription !== undefined) inputs.push(`shortDescription: "${params.shortDescription}"`)
      if (params.project_public !== undefined) inputs.push(`public: ${params.project_public}`)
      if (params.closed !== undefined) inputs.push(`closed: ${params.closed}`)

      const query = `mutation { updateProjectV2(input: { ${inputs.join(', ')} }) { projectV2 { id title number url closed public shortDescription } } }`
      const resp = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return { success: true, output: data.data?.updateProjectV2?.projectV2 || {} }
    },

    github_delete_project: async (params, ctx) => {
      const token = (ctx.accessToken || params.accessToken || params.apiKey) as string
      if (!token) return { success: false, output: {}, error: 'Missing access token' }
      const query = `mutation { deleteProjectV2(input: { projectId: "${params.project_id}" }) { projectV2 { id } } }`
      const resp = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `GitHub API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return { success: true, output: { deleted: true, project_id: params.project_id } }
    },
  },
}

export default handler
