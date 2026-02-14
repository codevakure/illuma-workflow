/**
 * Types for the workspace logs view.
 */

export interface Suggestion {
  id: string
  value: string
  label: string
  description?: string
  category: string
  color?: string
}

export interface SuggestionGroup {
  type: 'filter-keys' | 'filter-values' | 'multi-section'
  filterKey?: string
  suggestions: Suggestion[]
  sections?: Array<{
    title: string
    suggestions: Suggestion[]
  }>
}
