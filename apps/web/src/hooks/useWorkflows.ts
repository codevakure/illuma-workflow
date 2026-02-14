import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'

export interface Workflow {
  id: string
  name: string
  description: string
  color: string
  workspaceId: string | null
  folderId: string | null
  sortOrder: number
  isDeployed: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkflowWithState extends Workflow {
  state: {
    blocks: Record<string, unknown>
    edges: unknown[]
    loops: Record<string, unknown>
    parallels: Record<string, unknown>
    isDeployed: boolean
  }
  variables: Record<string, unknown>
}

interface WorkflowsResponse {
  data: Workflow[]
}

interface WorkflowResponse {
  data: WorkflowWithState
}

interface CreateWorkflowInput {
  name: string
  description?: string
  color?: string
  workspaceId?: string
  folderId?: string | null
}

interface UpdateWorkflowInput {
  name?: string
  description?: string
  color?: string
  folderId?: string | null
  sortOrder?: number
}

// Query keys
export const workflowKeys = {
  all: ['workflows'] as const,
  list: (workspaceId?: string) => [...workflowKeys.all, 'list', workspaceId ?? ''] as const,
  detail: (id: string) => [...workflowKeys.all, 'detail', id] as const,
}

// Hooks
export function useWorkflows(workspaceId?: string) {
  return useQuery({
    queryKey: workflowKeys.list(workspaceId),
    queryFn: async () => {
      const params = workspaceId ? { workspaceId } : undefined
      const response = await apiClient.get<WorkflowsResponse>('/api/workflows', { params })
      return response.data
    },
  })
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: async () => {
      const response = await apiClient.get<WorkflowResponse>(`/api/workflows/${id}`)
      return response.data
    },
    enabled: !!id,
  })
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateWorkflowInput) => {
      return apiClient.post<Workflow>('/api/workflows', input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all })
    },
  })
}

export function useUpdateWorkflow(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateWorkflowInput) => {
      return apiClient.put<{ workflow: Workflow }>(`/api/workflows/${id}`, input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: workflowKeys.all })
    },
  })
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete<{ success: boolean }>(`/api/workflows/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all })
    },
  })
}
