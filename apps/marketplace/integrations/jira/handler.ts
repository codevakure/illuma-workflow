import type { ToolHandler } from '../../sdk/types'

async function getJiraCloudId(domain: string, accessToken: string): Promise<string> {
  const resp = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const resources = await resp.json()
  if (Array.isArray(resources) && resources.length > 0) {
    const normalizedInput = `https://${domain}`.toLowerCase()
    const matched = resources.find((r: any) => r.url.toLowerCase() === normalizedInput)
    if (matched) return matched.id
    return resources[0].id
  }
  throw new Error('No Jira resources found')
}

async function resolveCloudId(params: Record<string, unknown>): Promise<string> {
  if (params.cloudId) return params.cloudId as string
  return getJiraCloudId(params.domain as string, params.accessToken as string)
}

function jiraHeaders(accessToken: string) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
}

function adfFromText(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
    ],
  }
}

const handler: ToolHandler = {
  operations: {
    jira_retrieve: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const issueKey = params.issueKey as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!issueKey) return { success: false, output: {}, error: 'Missing required parameter: issueKey' }

      const cloudId = await resolveCloudId(params)
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations`
      const resp = await fetch(url, { headers: jiraHeaders(accessToken) })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Jira API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: data.key,
          summary: data.fields?.summary,
          description: data.fields?.description,
          created: data.fields?.created,
          updated: data.fields?.updated,
          issue: data,
        },
      }
    },

    jira_write: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const cloudId = await resolveCloudId(params)
      const fields: Record<string, any> = {
        project: { key: params.projectId },
        summary: params.summary,
        issuetype: { name: params.issueType || 'Task' },
      }
      if (params.description) fields.description = adfFromText(params.description as string)
      if (params.priority) fields.priority = { name: params.priority }
      if (params.assignee) fields.assignee = { accountId: params.assignee }
      if (params.labels) fields.labels = params.labels
      if (params.duedate) fields.duedate = params.duedate
      if (params.reporter) fields.reporter = { accountId: params.reporter }
      if (params.environment) fields.environment = adfFromText(params.environment as string)
      if (params.parent) fields.parent = params.parent
      if (params.customFieldId && params.customFieldValue) {
        fields[params.customFieldId as string] = params.customFieldValue
      }

      const resp = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`, {
        method: 'POST',
        headers: jiraHeaders(accessToken),
        body: JSON.stringify({ fields }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Jira API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: data.key,
          summary: params.summary as string,
          success: true,
          url: `https://${params.domain}/browse/${data.key}`,
        },
      }
    },

    jira_update: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const issueKey = params.issueKey as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!issueKey) return { success: false, output: {}, error: 'Missing required parameter: issueKey' }

      const cloudId = await resolveCloudId(params)
      const fields: Record<string, any> = {}
      if (params.summary || params.title) fields.summary = params.summary || params.title
      if (params.description) fields.description = adfFromText(params.description as string)
      if (params.priority) fields.priority = { name: params.priority }
      if (params.assignee) fields.assignee = { accountId: params.assignee }

      const resp = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`, {
        method: 'PUT',
        headers: jiraHeaders(accessToken),
        body: JSON.stringify({ fields }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Jira API error: ${resp.status} ${err}` }
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey,
          summary: (params.summary || params.title || '') as string,
          success: true,
        },
      }
    },

    jira_search_issues: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const jql = params.jql as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!jql) return { success: false, output: {}, error: 'Missing required parameter: jql' }

      const cloudId = await resolveCloudId(params)
      const query = new URLSearchParams()
      query.set('jql', jql)
      if (typeof params.startAt === 'number') query.set('startAt', String(params.startAt))
      if (typeof params.maxResults === 'number') query.set('maxResults', String(params.maxResults))
      if (Array.isArray(params.fields) && params.fields.length > 0) {
        query.set('fields', (params.fields as string[]).join(','))
      }

      const resp = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${query.toString()}`,
        { headers: jiraHeaders(accessToken) }
      )
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Jira API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          total: data.total || 0,
          startAt: data.startAt || 0,
          maxResults: data.maxResults || 0,
          issues: (data.issues || []).map((issue: any) => ({
            key: issue.key,
            summary: issue.fields?.summary,
            status: issue.fields?.status?.name,
            assignee: issue.fields?.assignee?.displayName || issue.fields?.assignee?.accountId,
            priority: issue.fields?.priority?.name,
            created: issue.fields?.created,
            updated: issue.fields?.updated,
          })),
        },
      }
    },

    jira_add_comment: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const issueKey = params.issueKey as string
      const body = params.body as string
      if (!accessToken || !issueKey || !body) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const cloudId = await resolveCloudId(params)
      const resp = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/comment`,
        {
          method: 'POST',
          headers: jiraHeaders(accessToken),
          body: JSON.stringify({ body: adfFromText(body) }),
        }
      )
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Jira API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey,
          commentId: data.id,
          body,
          success: true,
        },
      }
    },

    jira_delete_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const issueKey = params.issueKey as string
      const cloudId = await resolveCloudId(params)
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}${params.deleteSubtasks ? '?deleteSubtasks=true' : ''}`
      const resp = await fetch(url, { method: 'DELETE', headers: jiraHeaders(accessToken) })
      return {
        success: resp.ok,
        output: { ts: new Date().toISOString(), issueKey, success: resp.ok },
      }
    },

    jira_assign_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const cloudId = await resolveCloudId(params)
      const resp = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}/assignee`,
        {
          method: 'PUT',
          headers: jiraHeaders(accessToken),
          body: JSON.stringify({ accountId: params.accountId }),
        }
      )
      return {
        success: resp.ok,
        output: {
          ts: new Date().toISOString(),
          issueKey: params.issueKey as string,
          assigneeId: params.accountId as string,
          success: resp.ok,
        },
      }
    },

    jira_transition_issue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const cloudId = await resolveCloudId(params)
      const body: Record<string, any> = { transition: { id: params.transitionId } }
      if (params.comment) {
        body.update = {
          comment: [{ add: { body: adfFromText(params.comment as string) } }],
        }
      }
      const resp = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}/transitions`,
        { method: 'POST', headers: jiraHeaders(accessToken), body: JSON.stringify(body) }
      )
      return {
        success: resp.ok,
        output: {
          ts: new Date().toISOString(),
          issueKey: params.issueKey as string,
          transitionId: params.transitionId as string,
          success: resp.ok,
        },
      }
    },

    jira_get_comments: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const cloudId = await resolveCloudId(params)
      const query = new URLSearchParams()
      if (params.startAt) query.set('startAt', String(params.startAt))
      if (params.maxResults) query.set('maxResults', String(params.maxResults))
      const resp = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}/comment?${query}`,
        { headers: jiraHeaders(accessToken) }
      )
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Jira API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params.issueKey as string,
          total: data.total || 0,
          comments: (data.comments || []).map((c: any) => ({
            id: c.id,
            author: c.author?.displayName || c.author?.accountId,
            body: c.body,
            created: c.created,
            updated: c.updated,
          })),
        },
      }
    },

    jira_get_users: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const cloudId = await resolveCloudId(params)
      const resp = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/users/search?maxResults=100`,
        { headers: jiraHeaders(accessToken) }
      )
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Jira API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          users: (data || []).map((u: any) => ({
            accountId: u.accountId,
            displayName: u.displayName,
            emailAddress: u.emailAddress,
            active: u.active,
            accountType: u.accountType,
          })),
        },
      }
    },
  },
}

export default handler
