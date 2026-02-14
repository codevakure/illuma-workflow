/**
 * Knowledge base utility functions for tag validation and parsing.
 */

import { db } from '@sim/db'
import { document, embedding, knowledgeBase } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * Validate a tag value against its expected field type.
 * Returns an error message if invalid, or null if valid.
 */
export function validateTagValue(tagName: string, value: string, fieldType: string): string | null {
  const stringValue = String(value).trim()

  switch (fieldType) {
    case 'boolean': {
      const lowerValue = stringValue.toLowerCase()
      if (lowerValue !== 'true' && lowerValue !== 'false') {
        return `Tag "${tagName}" expects a boolean value (true/false), but received "${value}"`
      }
      return null
    }
    case 'number': {
      const numValue = Number(stringValue)
      if (Number.isNaN(numValue)) {
        return `Tag "${tagName}" expects a number value, but received "${value}"`
      }
      return null
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
        return `Tag "${tagName}" expects a date in YYYY-MM-DD format, but received "${value}"`
      }
      const [year, month, day] = stringValue.split('-').map(Number)
      const date = new Date(year, month - 1, day)
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return `Tag "${tagName}" has an invalid date: "${value}"`
      }
      return null
    }
    default:
      return null
  }
}

/**
 * Build error message for undefined tags
 */
export function buildUndefinedTagsError(undefinedTags: string[]): string {
  const tagList = undefinedTags.map((t) => `"${t}"`).join(', ')
  return `The following tags are not defined in this knowledge base: ${tagList}. Please define them at the knowledge base level first.`
}

/**
 * Parse a string to number with strict validation.
 * Returns null if invalid.
 */
export function parseNumberValue(value: string): number | null {
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

/**
 * Parse a string to Date with strict YYYY-MM-DD validation.
 * Returns null if invalid format or invalid date.
 */
export function parseDateValue(value: string): Date | null {
  const stringValue = String(value).trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return null
  }

  const [year, month, day] = stringValue.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return date
}

/**
 * Parse a string to boolean with strict validation.
 * Returns null if not 'true' or 'false'.
 */
export function parseBooleanValue(value: string): boolean | null {
  const lowerValue = String(value).trim().toLowerCase()
  if (lowerValue === 'true') return true
  if (lowerValue === 'false') return false
  return null
}

/** Knowledge base data from access checks */
export interface KnowledgeBaseData {
  id: string
  userId: string
  workspaceId?: string | null
  name: string
  description?: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: unknown
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Document data from access checks */
export interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: string
  processingStartedAt?: Date | null
  processingCompletedAt?: Date | null
  processingError?: string | null
  enabled: boolean
  deletedAt?: Date | null
  uploadedAt: Date
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
  number1?: number | null
  number2?: number | null
  number3?: number | null
  number4?: number | null
  number5?: number | null
  date1?: Date | null
  date2?: Date | null
  boolean1?: boolean | null
  boolean2?: boolean | null
  boolean3?: boolean | null
}

/** Embedding data from access checks */
export interface EmbeddingData {
  id: string
  knowledgeBaseId: string
  documentId: string
  chunkIndex: number
  chunkHash: string
  content: string
  contentLength: number
  tokenCount: number
  embedding?: number[] | null
  embeddingModel: string
  startOffset: number
  endOffset: number
  tag1?: string | null
  tag2?: string | null
  tag3?: string | null
  tag4?: string | null
  tag5?: string | null
  tag6?: string | null
  tag7?: string | null
  number1?: number | null
  number2?: number | null
  number3?: number | null
  number4?: number | null
  number5?: number | null
  date1?: Date | null
  date2?: Date | null
  boolean1?: boolean | null
  boolean2?: boolean | null
  boolean3?: boolean | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeBaseAccessResult {
  hasAccess: true
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId' | 'workspaceId'>
}

export interface KnowledgeBaseAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export type KnowledgeBaseAccessCheck = KnowledgeBaseAccessResult | KnowledgeBaseAccessDenied

export interface DocumentAccessResult {
  hasAccess: true
  document: DocumentData
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId' | 'workspaceId'>
}

export interface DocumentAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type DocumentAccessCheck = DocumentAccessResult | DocumentAccessDenied

export interface ChunkAccessResult {
  hasAccess: true
  chunk: EmbeddingData
  document: DocumentData
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId' | 'workspaceId'>
}

export interface ChunkAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type ChunkAccessCheck = ChunkAccessResult | ChunkAccessDenied

/**
 * Check if a user has access to a knowledge base
 */
export async function checkKnowledgeBaseAccess(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const kbData = kb[0]

  if (kbData.userId === userId) {
    return { hasAccess: true, knowledgeBase: kbData }
  }

  if (kbData.workspaceId) {
    const userPermission = await getUserEntityPermissions(userId, 'workspace', kbData.workspaceId)
    if (userPermission !== null) {
      return { hasAccess: true, knowledgeBase: kbData }
    }
  }

  return { hasAccess: false }
}

/**
 * Check if a user has write access to a knowledge base
 */
export async function checkKnowledgeBaseWriteAccess(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const kbData = kb[0]

  if (kbData.userId === userId) {
    return { hasAccess: true, knowledgeBase: kbData }
  }

  if (kbData.workspaceId) {
    const userPermission = await getUserEntityPermissions(userId, 'workspace', kbData.workspaceId)
    if (userPermission === 'write' || userPermission === 'admin') {
      return { hasAccess: true, knowledgeBase: kbData }
    }
  }

  return { hasAccess: false }
}

/**
 * Check if a user has write access to a specific document
 */
export async function checkDocumentWriteAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string
): Promise<DocumentAccessCheck> {
  const kbAccess = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, userId)

  if (!kbAccess.hasAccess) {
    return {
      hasAccess: false,
      notFound: 'notFound' in kbAccess ? kbAccess.notFound : undefined,
      reason:
        'notFound' in kbAccess && kbAccess.notFound
          ? 'Knowledge base not found'
          : 'Unauthorized knowledge base access',
    }
  }

  const doc = await db
    .select({
      id: document.id,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      enabled: document.enabled,
      processingStatus: document.processingStatus,
      processingError: document.processingError,
      uploadedAt: document.uploadedAt,
      processingStartedAt: document.processingStartedAt,
      processingCompletedAt: document.processingCompletedAt,
      knowledgeBaseId: document.knowledgeBaseId,
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
      number1: document.number1,
      number2: document.number2,
      number3: document.number3,
      number4: document.number4,
      number5: document.number5,
      date1: document.date1,
      date2: document.date2,
      boolean1: document.boolean1,
      boolean2: document.boolean2,
      boolean3: document.boolean3,
    })
    .from(document)
    .where(and(eq(document.id, documentId), isNull(document.deletedAt)))
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  return {
    hasAccess: true,
    document: doc[0] as DocumentData,
    knowledgeBase: kbAccess.knowledgeBase!,
  }
}

/**
 * Check if a user has access to a document within a knowledge base
 */
export async function checkDocumentAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string
): Promise<DocumentAccessCheck> {
  const kbAccess = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)

  if (!kbAccess.hasAccess) {
    return {
      hasAccess: false,
      notFound: 'notFound' in kbAccess ? kbAccess.notFound : undefined,
      reason:
        'notFound' in kbAccess && kbAccess.notFound
          ? 'Knowledge base not found'
          : 'Unauthorized knowledge base access',
    }
  }

  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  return {
    hasAccess: true,
    document: doc[0] as DocumentData,
    knowledgeBase: kbAccess.knowledgeBase!,
  }
}

/**
 * Check if a user has access to a chunk within a document and knowledge base
 */
export async function checkChunkAccess(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  userId: string
): Promise<ChunkAccessCheck> {
  const kbAccess = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)

  if (!kbAccess.hasAccess) {
    return {
      hasAccess: false,
      notFound: 'notFound' in kbAccess ? kbAccess.notFound : undefined,
      reason:
        'notFound' in kbAccess && kbAccess.notFound
          ? 'Knowledge base not found'
          : 'Unauthorized knowledge base access',
    }
  }

  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  const docData = doc[0] as DocumentData

  if (docData.processingStatus !== 'completed') {
    return {
      hasAccess: false,
      reason: `Document is not ready for access (status: ${docData.processingStatus})`,
    }
  }

  const chunk = await db
    .select()
    .from(embedding)
    .where(and(eq(embedding.id, chunkId), eq(embedding.documentId, documentId)))
    .limit(1)

  if (chunk.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Chunk not found' }
  }

  return {
    hasAccess: true,
    chunk: chunk[0] as EmbeddingData,
    document: docData,
    knowledgeBase: kbAccess.knowledgeBase!,
  }
}
