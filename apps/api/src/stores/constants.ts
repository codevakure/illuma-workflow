/**
 * Store-level constants including API endpoint paths.
 */

export const API_ENDPOINTS = {
  ENVIRONMENT: '/api/environment',
  WORKSPACE_ENVIRONMENT: (workspaceId: string) => `/api/workspaces/${workspaceId}/environment`,
} as const
