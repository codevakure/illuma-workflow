/**
 * Variable type definitions for the panel store.
 */

/**
 * Variable types supported in the application.
 * Note: 'string' is deprecated - use 'plain' for text values instead.
 */
export type VariableType = 'plain' | 'number' | 'boolean' | 'object' | 'array' | 'string'

/**
 * Represents a workflow variable with workflow-specific naming.
 * Variable names must be unique within each workflow.
 */
export interface Variable {
  id: string
  workflowId: string
  name: string
  type: VariableType
  value: unknown
  validationError?: string
}
