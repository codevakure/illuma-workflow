/**
 * Tag definition types for knowledge base tag management.
 */

export interface DocumentTagDefinition {
  id: string
  knowledgeBaseId: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: Date
  updatedAt: Date
}

export interface DocumentTag {
  slot: string
  displayName: string
  fieldType: string
  value: string
}

export interface CreateTagDefinitionData {
  tagSlot: string
  displayName: string
  fieldType: string
  originalDisplayName?: string
}

export interface BulkTagDefinitionsData {
  definitions: CreateTagDefinitionData[]
}
