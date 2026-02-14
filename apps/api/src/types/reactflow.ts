/** Minimal Edge type from reactflow, used server-side without the reactflow dependency */
export interface Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
  animated?: boolean
  hidden?: boolean
  data?: Record<string, unknown>
  label?: string
  [key: string]: unknown
}
