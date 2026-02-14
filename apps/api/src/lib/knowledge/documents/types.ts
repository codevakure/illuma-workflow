/**
 * Document type definitions for knowledge base documents.
 */

export type DocumentSortField =
  | 'filename'
  | 'fileSize'
  | 'tokenCount'
  | 'chunkCount'
  | 'uploadedAt'
  | 'processingStatus'
  | 'enabled'

export type SortOrder = 'asc' | 'desc'

export interface DocumentSortOptions {
  sortBy?: DocumentSortField
  sortOrder?: SortOrder
}
