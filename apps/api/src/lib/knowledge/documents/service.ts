/**
 * Document service for knowledge base document CRUD and processing operations.
 */

import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import type { ProcessedDocumentTags } from '@/lib/knowledge/types'
import {
  buildUndefinedTagsError,
  parseBooleanValue,
  parseDateValue,
  parseNumberValue,
  validateTagValue,
} from '@/lib/knowledge/utils'

const logger = createLogger('DocumentService')

export interface DocumentData {
  documentId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
}

export interface ProcessingOptions {
  chunkSize: number
  minCharactersPerChunk: number
  recipe: string
  lang: string
  chunkOverlap: number
}

export interface DocumentTagData {
  tagName: string
  fieldType: string
  value: string
}

/**
 * Process structured document tags and validate them against existing definitions.
 * Throws an error if a tag does not exist or if the value does not match the expected type.
 */
export async function processDocumentTags(
  knowledgeBaseId: string,
  tagData: DocumentTagData[],
  requestId: string
): Promise<ProcessedDocumentTags> {
  const setTagValue = (
    tags: ProcessedDocumentTags,
    slot: string,
    value: string | number | Date | boolean | null
  ): void => {
    switch (slot) {
      case 'tag1': tags.tag1 = value as string | null; break
      case 'tag2': tags.tag2 = value as string | null; break
      case 'tag3': tags.tag3 = value as string | null; break
      case 'tag4': tags.tag4 = value as string | null; break
      case 'tag5': tags.tag5 = value as string | null; break
      case 'tag6': tags.tag6 = value as string | null; break
      case 'tag7': tags.tag7 = value as string | null; break
      case 'number1': tags.number1 = value as number | null; break
      case 'number2': tags.number2 = value as number | null; break
      case 'number3': tags.number3 = value as number | null; break
      case 'number4': tags.number4 = value as number | null; break
      case 'number5': tags.number5 = value as number | null; break
      case 'date1': tags.date1 = value as Date | null; break
      case 'date2': tags.date2 = value as Date | null; break
      case 'boolean1': tags.boolean1 = value as boolean | null; break
      case 'boolean2': tags.boolean2 = value as boolean | null; break
      case 'boolean3': tags.boolean3 = value as boolean | null; break
    }
  }

  const result: ProcessedDocumentTags = {
    tag1: null, tag2: null, tag3: null, tag4: null,
    tag5: null, tag6: null, tag7: null,
    number1: null, number2: null, number3: null,
    number4: null, number5: null,
    date1: null, date2: null,
    boolean1: null, boolean2: null, boolean3: null,
  }

  if (!Array.isArray(tagData) || tagData.length === 0) {
    return result
  }

  const existingDefinitions = await db
    .select()
    .from(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

  const existingByName = new Map(existingDefinitions.map((def) => [def.displayName, def]))

  const undefinedTags: string[] = []
  const typeErrors: string[] = []

  for (const tag of tagData) {
    if (!tag.tagName?.trim()) continue

    const tagName = tag.tagName.trim()
    const fieldType = tag.fieldType || 'text'

    const hasValue =
      fieldType === 'boolean'
        ? tag.value !== undefined && tag.value !== null && tag.value !== ''
        : tag.value?.trim && tag.value.trim().length > 0

    if (!hasValue) continue

    const existingDef = existingByName.get(tagName)
    if (!existingDef) {
      undefinedTags.push(tagName)
      continue
    }

    const rawValue = typeof tag.value === 'string' ? tag.value.trim() : tag.value
    const actualFieldType = existingDef.fieldType || fieldType
    const validationError = validateTagValue(tagName, String(rawValue), actualFieldType)
    if (validationError) {
      typeErrors.push(validationError)
    }
  }

  if (undefinedTags.length > 0 || typeErrors.length > 0) {
    const errorParts: string[] = []
    if (undefinedTags.length > 0) {
      errorParts.push(buildUndefinedTagsError(undefinedTags))
    }
    if (typeErrors.length > 0) {
      errorParts.push(...typeErrors)
    }
    throw new Error(errorParts.join('\n'))
  }

  for (const tag of tagData) {
    if (!tag.tagName?.trim()) continue

    const tagName = tag.tagName.trim()
    const fieldType = tag.fieldType || 'text'

    const hasValue =
      fieldType === 'boolean'
        ? tag.value !== undefined && tag.value !== null && tag.value !== ''
        : tag.value?.trim && tag.value.trim().length > 0

    if (!hasValue) continue

    const existingDef = existingByName.get(tagName)
    if (!existingDef) continue

    const targetSlot = existingDef.tagSlot
    const actualFieldType = existingDef.fieldType || fieldType
    const rawValue = typeof tag.value === 'string' ? tag.value.trim() : tag.value
    const stringValue = String(rawValue).trim()

    if (actualFieldType === 'boolean') {
      setTagValue(result, targetSlot, parseBooleanValue(stringValue) ?? false)
    } else if (actualFieldType === 'number') {
      setTagValue(result, targetSlot, parseNumberValue(stringValue))
    } else if (actualFieldType === 'date') {
      setTagValue(result, targetSlot, parseDateValue(stringValue))
    } else {
      setTagValue(result, targetSlot, stringValue)
    }

    logger.info(`[${requestId}] Set tag ${tagName} (${targetSlot}) = ${stringValue}`)
  }

  return result
}

/**
 * Create document records in database with tags
 */
export async function createDocumentRecords(
  documents: Array<{
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    documentTagsData?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  }>,
  knowledgeBaseId: string,
  requestId: string
): Promise<DocumentData[]> {
  const kb = await db
    .select({ userId: knowledgeBase.userId })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  if (kb.length === 0) {
    throw new Error('Knowledge base not found')
  }

  return await db.transaction(async (tx) => {
    const now = new Date()
    const documentRecords: Array<Record<string, unknown>> = []
    const returnData: DocumentData[] = []

    for (const docData of documents) {
      const documentId = randomUUID()

      let processedTags: Partial<ProcessedDocumentTags> = {}

      if (docData.documentTagsData) {
        try {
          const tagData = JSON.parse(docData.documentTagsData)
          if (Array.isArray(tagData)) {
            processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            logger.warn(`[${requestId}] Failed to parse documentTagsData for bulk document:`, error)
          } else {
            throw error
          }
        }
      }

      const newDocument = {
        id: documentId,
        knowledgeBaseId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        processingStatus: 'pending' as const,
        enabled: true,
        uploadedAt: now,
        tag1: processedTags.tag1 ?? docData.tag1 ?? null,
        tag2: processedTags.tag2 ?? docData.tag2 ?? null,
        tag3: processedTags.tag3 ?? docData.tag3 ?? null,
        tag4: processedTags.tag4 ?? docData.tag4 ?? null,
        tag5: processedTags.tag5 ?? docData.tag5 ?? null,
        tag6: processedTags.tag6 ?? docData.tag6 ?? null,
        tag7: processedTags.tag7 ?? docData.tag7 ?? null,
        number1: processedTags.number1 ?? null,
        number2: processedTags.number2 ?? null,
        number3: processedTags.number3 ?? null,
        number4: processedTags.number4 ?? null,
        number5: processedTags.number5 ?? null,
        date1: processedTags.date1 ?? null,
        date2: processedTags.date2 ?? null,
        boolean1: processedTags.boolean1 ?? null,
        boolean2: processedTags.boolean2 ?? null,
        boolean3: processedTags.boolean3 ?? null,
      }

      documentRecords.push(newDocument)
      returnData.push({
        documentId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
      })
    }

    if (documentRecords.length > 0) {
      await tx.insert(document).values(documentRecords as any)
      logger.info(
        `[${requestId}] Bulk created ${documentRecords.length} document records in knowledge base ${knowledgeBaseId}`
      )

      await tx
        .update(knowledgeBase)
        .set({ updatedAt: now })
        .where(eq(knowledgeBase.id, knowledgeBaseId))
    }

    return returnData
  })
}

/**
 * Get documents for a knowledge base with filtering and pagination
 */
export async function getDocuments(
  knowledgeBaseId: string,
  options: {
    enabledFilter?: 'all' | 'enabled' | 'disabled'
    search?: string
    limit?: number
    offset?: number
    sortBy?: DocumentSortField
    sortOrder?: SortOrder
  },
  requestId: string
): Promise<{
  documents: Array<Record<string, unknown>>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}> {
  const {
    enabledFilter = 'all',
    search,
    limit = 50,
    offset = 0,
    sortBy = 'filename',
    sortOrder = 'asc',
  } = options

  const whereConditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    isNull(document.deletedAt),
  ]

  if (enabledFilter === 'enabled') {
    whereConditions.push(eq(document.enabled, true))
  } else if (enabledFilter === 'disabled') {
    whereConditions.push(eq(document.enabled, false))
  }

  if (search) {
    whereConditions.push(sql`LOWER(${document.filename}) LIKE LOWER(${`%${search}%`})`)
  }

  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(document)
    .where(and(...whereConditions))

  const total = totalResult[0]?.count || 0
  const hasMore = offset + limit < total

  const getOrderByColumn = () => {
    switch (sortBy) {
      case 'filename': return document.filename
      case 'fileSize': return document.fileSize
      case 'tokenCount': return document.tokenCount
      case 'chunkCount': return document.chunkCount
      case 'uploadedAt': return document.uploadedAt
      case 'processingStatus': return document.processingStatus
      case 'enabled': return document.enabled
      default: return document.uploadedAt
    }
  }

  const primaryOrderBy = sortOrder === 'asc' ? asc(getOrderByColumn()) : desc(getOrderByColumn())
  const secondaryOrderBy =
    sortBy === 'filename' ? desc(document.uploadedAt) : asc(document.filename)

  const documents = await db
    .select({
      id: document.id,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      processingStatus: document.processingStatus,
      processingStartedAt: document.processingStartedAt,
      processingCompletedAt: document.processingCompletedAt,
      processingError: document.processingError,
      enabled: document.enabled,
      uploadedAt: document.uploadedAt,
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
    .where(and(...whereConditions))
    .orderBy(primaryOrderBy, secondaryOrderBy)
    .limit(limit)
    .offset(offset)

  logger.info(
    `[${requestId}] Retrieved ${documents.length} documents (${offset}-${offset + documents.length} of ${total}) for knowledge base ${knowledgeBaseId}`
  )

  return {
    documents,
    pagination: { total, limit, offset, hasMore },
  }
}

/**
 * Create a single document record
 */
export async function createSingleDocument(
  documentData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    documentTagsData?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  },
  knowledgeBaseId: string,
  requestId: string
): Promise<Record<string, unknown>> {
  const kb = await db
    .select({ userId: knowledgeBase.userId })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  if (kb.length === 0) {
    throw new Error('Knowledge base not found')
  }

  const documentId = randomUUID()
  const now = new Date()

  let processedTags: ProcessedDocumentTags = {
    tag1: documentData.tag1 ?? null,
    tag2: documentData.tag2 ?? null,
    tag3: documentData.tag3 ?? null,
    tag4: documentData.tag4 ?? null,
    tag5: documentData.tag5 ?? null,
    tag6: documentData.tag6 ?? null,
    tag7: documentData.tag7 ?? null,
    number1: null, number2: null, number3: null, number4: null, number5: null,
    date1: null, date2: null,
    boolean1: null, boolean2: null, boolean3: null,
  }

  if (documentData.documentTagsData) {
    try {
      const tagData = JSON.parse(documentData.documentTagsData)
      if (Array.isArray(tagData)) {
        processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.warn(`[${requestId}] Failed to parse documentTagsData:`, error)
      } else {
        throw error
      }
    }
  }

  const newDocument = {
    id: documentId,
    knowledgeBaseId,
    filename: documentData.filename,
    fileUrl: documentData.fileUrl,
    fileSize: documentData.fileSize,
    mimeType: documentData.mimeType,
    chunkCount: 0,
    tokenCount: 0,
    characterCount: 0,
    enabled: true,
    uploadedAt: now,
    ...processedTags,
  }

  await db.insert(document).values(newDocument)

  await db
    .update(knowledgeBase)
    .set({ updatedAt: now })
    .where(eq(knowledgeBase.id, knowledgeBaseId))

  logger.info(`[${requestId}] Document created: ${documentId} in knowledge base ${knowledgeBaseId}`)

  return newDocument
}

/**
 * Perform bulk operations on documents
 */
export async function bulkDocumentOperation(
  knowledgeBaseId: string,
  operation: 'enable' | 'disable' | 'delete',
  documentIds: string[],
  requestId: string
): Promise<{
  success: boolean
  successCount: number
  updatedDocuments: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
    processingStatus?: string
  }>
}> {
  logger.info(
    `[${requestId}] Starting bulk ${operation} operation on ${documentIds.length} documents in knowledge base ${knowledgeBaseId}`
  )

  const documentsToUpdate = await db
    .select({
      id: document.id,
      enabled: document.enabled,
    })
    .from(document)
    .where(
      and(
        eq(document.knowledgeBaseId, knowledgeBaseId),
        inArray(document.id, documentIds),
        isNull(document.deletedAt)
      )
    )

  if (documentsToUpdate.length === 0) {
    throw new Error('No valid documents found to update')
  }

  if (documentsToUpdate.length !== documentIds.length) {
    logger.warn(
      `[${requestId}] Some documents not found or don't belong to knowledge base. Requested: ${documentIds.length}, Found: ${documentsToUpdate.length}`
    )
  }

  let updateResult: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
    processingStatus?: string
  }>

  if (operation === 'delete') {
    updateResult = await db
      .update(document)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          inArray(document.id, documentIds),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id, deletedAt: document.deletedAt })
  } else {
    const enabled = operation === 'enable'
    updateResult = await db
      .update(document)
      .set({ enabled })
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          inArray(document.id, documentIds),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id, enabled: document.enabled })
  }

  const successCount = updateResult.length

  logger.info(
    `[${requestId}] Bulk ${operation} operation completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
  )

  return { success: true, successCount, updatedDocuments: updateResult }
}

/**
 * Perform bulk operations on all documents matching a filter
 */
export async function bulkDocumentOperationByFilter(
  knowledgeBaseId: string,
  operation: 'enable' | 'disable' | 'delete',
  enabledFilter: 'all' | 'enabled' | 'disabled' | undefined,
  requestId: string
): Promise<{
  success: boolean
  successCount: number
  updatedDocuments: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>
}> {
  logger.info(
    `[${requestId}] Starting bulk ${operation} operation on all documents (filter: ${enabledFilter || 'all'}) in knowledge base ${knowledgeBaseId}`
  )

  const whereConditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    isNull(document.deletedAt),
  ]

  if (enabledFilter === 'enabled') {
    whereConditions.push(eq(document.enabled, true))
  } else if (enabledFilter === 'disabled') {
    whereConditions.push(eq(document.enabled, false))
  }

  let updateResult: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>

  if (operation === 'delete') {
    updateResult = await db
      .update(document)
      .set({ deletedAt: new Date() })
      .where(and(...whereConditions))
      .returning({ id: document.id, deletedAt: document.deletedAt })
  } else {
    const enabled = operation === 'enable'
    updateResult = await db
      .update(document)
      .set({ enabled })
      .where(and(...whereConditions))
      .returning({ id: document.id, enabled: document.enabled })
  }

  const successCount = updateResult.length

  logger.info(
    `[${requestId}] Bulk ${operation} by filter completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
  )

  return { success: true, successCount, updatedDocuments: updateResult }
}

/**
 * Mark a document as failed due to timeout
 */
export async function markDocumentAsFailedTimeout(
  documentId: string,
  processingStartedAt: Date,
  requestId: string
): Promise<{ success: boolean; processingDuration: number }> {
  const now = new Date()
  const processingDuration = now.getTime() - processingStartedAt.getTime()
  const DEAD_PROCESS_THRESHOLD_MS = 600 * 1000

  if (processingDuration <= DEAD_PROCESS_THRESHOLD_MS) {
    throw new Error('Document has not been processing long enough to be considered dead')
  }

  await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingError: 'Processing timed out - background process may have been terminated',
      processingCompletedAt: now,
    })
    .where(eq(document.id, documentId))

  logger.info(
    `[${requestId}] Marked document ${documentId} as failed due to dead process (processing time: ${Math.round(processingDuration / 1000)}s)`
  )

  return { success: true, processingDuration }
}

/**
 * Retry processing a failed document
 */
export async function retryDocumentProcessing(
  knowledgeBaseId: string,
  documentId: string,
  _docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  requestId: string
): Promise<{ success: boolean; status: string; message: string }> {
  await db.transaction(async (tx) => {
    await tx.delete(embedding).where(eq(embedding.documentId, documentId))

    await tx
      .update(document)
      .set({
        processingStatus: 'pending',
        processingStartedAt: null,
        processingCompletedAt: null,
        processingError: null,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
      })
      .where(eq(document.id, documentId))
  })

  logger.info(`[${requestId}] Document retry initiated: ${documentId}`)

  return {
    success: true,
    status: 'pending',
    message: 'Document retry processing started',
  }
}

/**
 * Update a document with specified fields
 */
export async function updateDocument(
  documentId: string,
  updateData: {
    filename?: string
    enabled?: boolean
    chunkCount?: number
    tokenCount?: number
    characterCount?: number
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    processingError?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
    number1?: string
    number2?: string
    number3?: string
    number4?: string
    number5?: string
    date1?: string
    date2?: string
    boolean1?: string
    boolean2?: string
    boolean3?: string
  },
  requestId: string
): Promise<Record<string, unknown>> {
  const dbUpdateData: Record<string, unknown> = {}

  const ALL_TAG_SLOTS = [
    'tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7',
    'number1', 'number2', 'number3', 'number4', 'number5',
    'date1', 'date2',
    'boolean1', 'boolean2', 'boolean3',
  ] as const
  type TagSlot = (typeof ALL_TAG_SLOTS)[number]

  if (updateData.filename !== undefined) dbUpdateData.filename = updateData.filename
  if (updateData.enabled !== undefined) dbUpdateData.enabled = updateData.enabled
  if (updateData.chunkCount !== undefined) dbUpdateData.chunkCount = updateData.chunkCount
  if (updateData.tokenCount !== undefined) dbUpdateData.tokenCount = updateData.tokenCount
  if (updateData.characterCount !== undefined) dbUpdateData.characterCount = updateData.characterCount
  if (updateData.processingStatus !== undefined) dbUpdateData.processingStatus = updateData.processingStatus
  if (updateData.processingError !== undefined) dbUpdateData.processingError = updateData.processingError

  const convertTagValue = (
    slot: string,
    value: string | undefined
  ): string | number | Date | boolean | null => {
    if (value === undefined || value === '') return null
    if (slot.startsWith('number')) return parseNumberValue(value)
    if (slot.startsWith('date')) return parseDateValue(value)
    if (slot.startsWith('boolean')) return parseBooleanValue(value) ?? false
    return value || null
  }

  type UpdateDataWithTags = typeof updateData & Record<TagSlot, string | undefined>
  const typedUpdateData = updateData as UpdateDataWithTags

  ALL_TAG_SLOTS.forEach((slot: TagSlot) => {
    const updateValue = typedUpdateData[slot]
    if (updateValue !== undefined) {
      dbUpdateData[slot] = convertTagValue(slot, updateValue)
    }
  })

  await db.transaction(async (tx) => {
    await tx.update(document).set(dbUpdateData).where(eq(document.id, documentId))

    const hasTagUpdates = ALL_TAG_SLOTS.some((field) => typedUpdateData[field] !== undefined)

    if (hasTagUpdates) {
      const embeddingUpdateData: Record<string, unknown> = {}
      ALL_TAG_SLOTS.forEach((field) => {
        if (typedUpdateData[field] !== undefined) {
          embeddingUpdateData[field] = convertTagValue(field, typedUpdateData[field])
        }
      })

      await tx
        .update(embedding)
        .set(embeddingUpdateData)
        .where(eq(embedding.documentId, documentId))
    }
  })

  const updatedDocument = await db
    .select()
    .from(document)
    .where(eq(document.id, documentId))
    .limit(1)

  if (updatedDocument.length === 0) {
    throw new Error(`Document ${documentId} not found`)
  }

  logger.info(`[${requestId}] Document updated: ${documentId}`)

  return updatedDocument[0]
}

/**
 * Soft delete a document
 */
export async function deleteDocument(
  documentId: string,
  requestId: string
): Promise<{ success: boolean; message: string }> {
  await db
    .update(document)
    .set({ deletedAt: new Date() })
    .where(eq(document.id, documentId))

  logger.info(`[${requestId}] Document deleted: ${documentId}`)

  return { success: true, message: 'Document deleted successfully' }
}
