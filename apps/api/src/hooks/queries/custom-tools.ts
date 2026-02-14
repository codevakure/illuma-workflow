/**
 * Custom tools query stub for the API server.
 * In the web app these use React Query; here we provide a minimal synchronous accessor.
 */

import { createLogger } from '@sim/logger'

const logger = createLogger('CustomToolsQueries')

export interface CustomToolSchema {
  type: string
  function: {
    name: string
    description?: string
    parameters: {
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export interface CustomToolDefinition {
  id: string
  workspaceId: string | null
  userId: string | null
  title: string
  schema: CustomToolSchema
  code: string
  createdAt: string
  updatedAt?: string
}

/**
 * Synchronous accessor for a custom tool from cache.
 * On the server side this always returns undefined -- custom tools are
 * fetched asynchronously via the API instead.
 */
export function getCustomTool(_identifier: string, _workspaceId?: string): CustomToolDefinition | undefined {
  return undefined
}
