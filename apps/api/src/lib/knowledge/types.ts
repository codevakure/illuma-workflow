/**
 * Knowledge base type definitions.
 */

/**
 * Configuration for document chunking in knowledge bases
 *
 * Units:
 * - maxSize: Maximum chunk size in TOKENS (1 token ~ 4 characters)
 * - minSize: Minimum chunk size in CHARACTERS (floor to avoid tiny fragments)
 * - overlap: Overlap between chunks in TOKENS (1 token ~ 4 characters)
 */
export interface ChunkingConfig {
  /** Maximum chunk size in tokens (default: 1024, range: 100-4000) */
  maxSize: number
  /** Minimum chunk size in characters (default: 100, range: 1-2000) */
  minSize: number
  /** Overlap between chunks in tokens (default: 200, range: 0-500) */
  overlap: number
}

export interface KnowledgeBaseWithCounts {
  id: string
  name: string
  description: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: ChunkingConfig
  createdAt: Date
  updatedAt: Date
  workspaceId: string | null
  docCount: number
}

export interface CreateKnowledgeBaseData {
  name: string
  description?: string
  workspaceId: string
  embeddingModel: 'text-embedding-3-small'
  embeddingDimension: 1536
  chunkingConfig: ChunkingConfig
  userId: string
}

export interface TagDefinition {
  id: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateTagDefinitionData {
  knowledgeBaseId: string
  tagSlot: string
  displayName: string
  fieldType: string
}

export interface UpdateTagDefinitionData {
  displayName?: string
  fieldType?: string
}

/** Tag filter for knowledge base search */
export interface StructuredFilter {
  tagName?: string
  tagSlot: string
  fieldType: string
  operator: string
  value: string | number | boolean
  valueTo?: string | number
}

/** Processed document tags ready for database storage */
export interface ProcessedDocumentTags {
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  date1: Date | null
  date2: Date | null
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  [key: string]: string | number | Date | boolean | null
}
