import type { ToolHandler } from '../../sdk/types'

const BASE_URL = 'https://app.asana.com/api/1.0'

function asanaHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

const handler: ToolHandler = {
  operations: {
    asana_get_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const taskGid = params.taskGid as string | undefined
      if (taskGid) {
        const resp = await fetch(`${BASE_URL}/tasks/${taskGid}?opt_fields=gid,resource_type,resource_subtype,name,notes,completed,assignee,assignee.name,created_by,created_by.name,due_on,created_at,modified_at,permalink_url`, {
          headers: asanaHeaders(accessToken),
        })
        if (!resp.ok) {
          const err = await resp.text().catch(() => '')
          return { success: false, output: {}, error: `Asana API error: ${resp.status} ${err}` }
        }
        const data = await resp.json()
        return { success: true, output: { ts: new Date().toISOString(), ...data.data } }
      }

      const query = new URLSearchParams()
      if (params.workspace) query.set('workspace', params.workspace as string)
      if (params.project) query.set('project', params.project as string)
      query.set('limit', String(params.limit || 50))
      query.set('opt_fields', 'gid,name,completed')

      const resp = await fetch(`${BASE_URL}/tasks?${query}`, {
        headers: asanaHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Asana API error: ${resp.status} ${err}` }
      }
      const data = await resp.json()
      return {
        success: true,
        output: { ts: new Date().toISOString(), tasks: data.data || [] },
      }
    },

    asana_create_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!params.workspace) return { success: false, output: {}, error: 'Missing required parameter: workspace' }
      if (!params.name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const body: Record<string, any> = {
        workspace: params.workspace,
        name: params.name,
      }
      if (params.notes) body.notes = params.notes
      if (params.assignee) body.assignee = params.assignee
      if (params.due_on) body.due_on = params.due_on

      const resp = await fetch(`${BASE_URL}/tasks`, {
        method: 'POST',
        headers: asanaHeaders(accessToken),
        body: JSON.stringify({ data: body }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Asana API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      const task = data.data
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          gid: task.gid,
          name: task.name,
          notes: task.notes || '',
          completed: task.completed || false,
          created_at: task.created_at,
          permalink_url: task.permalink_url || '',
        },
      }
    },

    asana_update_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const taskGid = params.taskGid as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!taskGid) return { success: false, output: {}, error: 'Missing required parameter: taskGid' }

      const body: Record<string, any> = {}
      if (params.name !== undefined) body.name = params.name
      if (params.notes !== undefined) body.notes = params.notes
      if (params.assignee !== undefined) body.assignee = params.assignee
      if (params.completed !== undefined) body.completed = params.completed
      if (params.due_on !== undefined) body.due_on = params.due_on

      const resp = await fetch(`${BASE_URL}/tasks/${taskGid}`, {
        method: 'PUT',
        headers: asanaHeaders(accessToken),
        body: JSON.stringify({ data: body }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Asana API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      const task = data.data
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          gid: task.gid,
          name: task.name,
          notes: task.notes || '',
          completed: task.completed || false,
          modified_at: task.modified_at,
        },
      }
    },

    asana_search_tasks: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const workspace = params.workspace as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!workspace) return { success: false, output: {}, error: 'Missing required parameter: workspace' }

      const query = new URLSearchParams()
      if (params.text) query.set('text', params.text as string)
      if (params.assignee) query.set('assignee.any', params.assignee as string)
      if (Array.isArray(params.projects) && params.projects.length > 0) {
        query.set('projects.any', (params.projects as string[]).join(','))
      }
      if (params.completed !== undefined) query.set('completed', String(params.completed))
      query.set('opt_fields', 'gid,resource_type,resource_subtype,name,notes,completed,assignee,assignee.name,due_on,created_at,modified_at')

      const resp = await fetch(`${BASE_URL}/workspaces/${workspace}/tasks/search?${query}`, {
        headers: asanaHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Asana API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          tasks: data.data || [],
          next_page: data.next_page || null,
        },
      }
    },

    asana_get_projects: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const workspace = params.workspace as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!workspace) return { success: false, output: {}, error: 'Missing required parameter: workspace' }

      const resp = await fetch(`${BASE_URL}/projects?workspace=${workspace}&opt_fields=gid,name,resource_type`, {
        headers: asanaHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Asana API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: { ts: new Date().toISOString(), projects: data.data || [] },
      }
    },

    asana_add_comment: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const taskGid = params.taskGid as string
      const text = params.text as string
      if (!accessToken || !taskGid || !text) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const resp = await fetch(`${BASE_URL}/tasks/${taskGid}/stories`, {
        method: 'POST',
        headers: asanaHeaders(accessToken),
        body: JSON.stringify({ data: { text } }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Asana API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      const story = data.data
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          gid: story.gid,
          text: story.text,
          created_at: story.created_at,
          created_by: story.created_by,
        },
      }
    },
  },
}

export default handler
