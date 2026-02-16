import type { ToolHandler } from '../../sdk/types'

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

const handler: ToolHandler = {
  operations: {
    microsoft_planner_create_task: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const planId = params.planId as string
      const title = params.title as string
      if (!accessToken || !planId || !title) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, planId, title' }
      }

      const body: Record<string, unknown> = { planId, title }
      if (params.bucketId) body.bucketId = params.bucketId
      if (params.dueDateTime) body.dueDateTime = params.dueDateTime
      if (params.assigneeUserId) {
        body.assignments = {
          [params.assigneeUserId as string]: {
            '@odata.type': 'microsoft.graph.plannerAssignment',
            orderHint: ' !',
          },
        }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const task = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: task.error?.message ?? 'Failed to create task' }
      }

      return {
        success: true,
        output: {
          task,
          metadata: { planId: task.planId, taskId: task.id, taskUrl: `${GRAPH_API_BASE}/planner/tasks/${task.id}` },
        },
      }
    },

    microsoft_planner_read_task: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const taskId = params.taskId as string
      if (!accessToken || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, taskId' }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const task = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: task.error?.message ?? 'Failed to read task' }
      }

      return {
        success: true,
        output: {
          task,
          metadata: { planId: task.planId, taskId: task.id, taskUrl: `${GRAPH_API_BASE}/planner/tasks/${task.id}` },
        },
      }
    },

    microsoft_planner_update_task: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const taskId = params.taskId as string
      if (!accessToken || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, taskId' }
      }

      const getResponse = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const existingTask = await getResponse.json()
      if (!getResponse.ok) {
        return { success: false, output: {}, error: existingTask.error?.message ?? 'Failed to get task for update' }
      }

      const etag = (params.etag as string) || existingTask['@odata.etag']
      if (!etag) {
        return { success: false, output: {}, error: 'Missing etag for task update' }
      }

      const body: Record<string, unknown> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.bucketId !== undefined) body.bucketId = params.bucketId
      if (params.dueDateTime !== undefined) body.dueDateTime = params.dueDateTime
      if (params.startDateTime !== undefined) body.startDateTime = params.startDateTime
      if (params.percentComplete !== undefined) body.percentComplete = params.percentComplete
      if (params.priority !== undefined) body.priority = params.priority
      if (params.assigneeUserId) {
        body.assignments = {
          [params.assigneeUserId as string]: {
            '@odata.type': 'microsoft.graph.plannerAssignment',
            orderHint: ' !',
          },
        }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'If-Match': etag,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to update task' }
      }

      const updatedTask = await response.json().catch(() => existingTask)

      return {
        success: true,
        output: {
          message: 'Task updated successfully',
          task: updatedTask,
          taskId,
          etag: updatedTask['@odata.etag'] ?? etag,
          metadata: { taskId, taskUrl: `${GRAPH_API_BASE}/planner/tasks/${taskId}` },
        },
      }
    },

    microsoft_planner_delete_task: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const taskId = params.taskId as string
      if (!accessToken || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, taskId' }
      }

      const getResponse = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const existingTask = await getResponse.json()
      if (!getResponse.ok) {
        return { success: false, output: {}, error: existingTask.error?.message ?? 'Failed to get task for deletion' }
      }

      const etag = (params.etag as string) || existingTask['@odata.etag']

      const response = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'If-Match': etag },
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to delete task' }
      }

      return { success: true, output: { deleted: true, metadata: { taskId } } }
    },

    microsoft_planner_list_plans: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupId = params.groupId as string
      if (!accessToken || !groupId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupId' }
      }

      const response = await fetch(`${GRAPH_API_BASE}/groups/${groupId}/planner/plans`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list plans' }
      }

      return { success: true, output: { plans: data.value ?? [], metadata: { groupId } } }
    },

    microsoft_planner_read_plan: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const planId = params.planId as string
      if (!accessToken || !planId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, planId' }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/plans/${planId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const plan = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: plan.error?.message ?? 'Failed to read plan' }
      }

      return { success: true, output: { plan, metadata: { planId } } }
    },

    microsoft_planner_list_buckets: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const planId = params.planId as string
      if (!accessToken || !planId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, planId' }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/plans/${planId}/buckets`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list buckets' }
      }

      return { success: true, output: { buckets: data.value ?? [], metadata: { planId } } }
    },

    microsoft_planner_read_bucket: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const bucketId = params.bucketId as string
      if (!accessToken || !bucketId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, bucketId' }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/buckets/${bucketId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const bucket = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: bucket.error?.message ?? 'Failed to read bucket' }
      }

      return { success: true, output: { bucket, metadata: { bucketId } } }
    },

    microsoft_planner_create_bucket: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const planId = params.planId as string
      const name = params.name as string
      if (!accessToken || !planId || !name) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, planId, name' }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/buckets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, name }),
      })

      const bucket = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: bucket.error?.message ?? 'Failed to create bucket' }
      }

      return { success: true, output: { bucket, metadata: { planId, bucketId: bucket.id } } }
    },

    microsoft_planner_update_bucket: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const bucketId = params.bucketId as string
      const name = params.name as string
      if (!accessToken || !bucketId || !name) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, bucketId, name' }
      }

      const getResponse = await fetch(`${GRAPH_API_BASE}/planner/buckets/${bucketId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const existing = await getResponse.json()
      if (!getResponse.ok) {
        return { success: false, output: {}, error: existing.error?.message ?? 'Failed to get bucket for update' }
      }

      const etag = (params.etag as string) || existing['@odata.etag']
      const response = await fetch(`${GRAPH_API_BASE}/planner/buckets/${bucketId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to update bucket' }
      }

      const bucket = await response.json().catch(() => ({ ...existing, name }))
      return { success: true, output: { bucket, metadata: { bucketId } } }
    },

    microsoft_planner_delete_bucket: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const bucketId = params.bucketId as string
      if (!accessToken || !bucketId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, bucketId' }
      }

      const getResponse = await fetch(`${GRAPH_API_BASE}/planner/buckets/${bucketId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const existing = await getResponse.json()
      if (!getResponse.ok) {
        return { success: false, output: {}, error: existing.error?.message ?? 'Failed to get bucket for deletion' }
      }

      const etag = (params.etag as string) || existing['@odata.etag']
      const response = await fetch(`${GRAPH_API_BASE}/planner/buckets/${bucketId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'If-Match': etag },
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to delete bucket' }
      }

      return { success: true, output: { deleted: true, metadata: { bucketId } } }
    },

    microsoft_planner_get_task_details: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const taskId = params.taskId as string
      if (!accessToken || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, taskId' }
      }

      const response = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}/details`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const details = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: details.error?.message ?? 'Failed to get task details' }
      }

      return {
        success: true,
        output: { taskDetails: details, etag: details['@odata.etag'] ?? '', metadata: { taskId } },
      }
    },

    microsoft_planner_update_task_details: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const taskId = params.taskId as string
      if (!accessToken || !taskId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, taskId' }
      }

      const getResponse = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}/details`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const existing = await getResponse.json()
      if (!getResponse.ok) {
        return { success: false, output: {}, error: existing.error?.message ?? 'Failed to get task details for update' }
      }

      const etag = (params.etag as string) || existing['@odata.etag']
      const body: Record<string, unknown> = {}
      if (params.description !== undefined) body.description = params.description
      if (params.previewType !== undefined) body.previewType = params.previewType
      if (params.checklist !== undefined) body.checklist = params.checklist
      if (params.references !== undefined) body.references = params.references

      const response = await fetch(`${GRAPH_API_BASE}/planner/tasks/${taskId}/details`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to update task details' }
      }

      const details = await response.json().catch(() => ({ ...existing, ...body }))
      return { success: true, output: { taskDetails: details, metadata: { taskId } } }
    },
  },
}

export default handler
