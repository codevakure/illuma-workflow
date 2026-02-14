/**
 * Chunks service for knowledge base chunk CRUD operations.
 */

import { createHash, randomUUID } from 'crypto'
import { db } from '@sim/db'
import { document, embedding } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm'
import type {
  BatchOperationResult,
  ChunkData,
  ChunkFilters,
  ChunkQueryResult,
  CreateChunkData,
} from '@/lib/knowledge/chunks/types'

const logger = createLogger('ChunksService')

/**
 * Query chunks for a document with filtering and pagination
 */
export async function queryChunks(
  documentId: string,
  filters: ChunkFilters,
  requestId: string
): Promise<ChunkQueryResult> {
  const { search, enabled = 'all', limit = 50, offset = 0 } = filters

  const conditions = [eq(embedding.documentId, documentId)]

  if (enabled === 'true') {
    conditions.push(eq(embedding.enabled, true))
  } else if (enabled === 'false') {
    conditions.push(eq(embedding.enabled, false))
  }

  if (search) {
    conditions.push(ilike(embedding.content, `%${search}%`))
  }

  const chunks = await db
    .select({
      id: embedding.id,
      chunkIndex: embedding.chunkIndex,
      content: embedding.content,
      contentLength: embedding.contentLength,
      tokenCount: embedding.tokenCount,
      enabled: embedding.enabled,
      startOffset: embedding.startOffset,
      endOffset: embedding.endOffset,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      createdAt: embedding.createdAt,
      updatedAt: embedding.updatedAt,
    })
    .from(embedding)
    .where(and(...conditions))
    .orderBy(asc(embedding.chunkIndex))
    .limit(limit)
    .offset(offset)

  const totalCount = await db
    .select({ count: sql`count(*)` })
    .from(embedding)
    .where(and(...conditions))

  logger.info(`[${requestId}] Retrieved ${chunks.length} chunks for document ${documentId}`)

  return {
    chunks: chunks as ChunkData[],
    pagination: {
      total: Number(totalCount[0]?.count || 0),
      limit,
      offset,
      hasMore: chunks.length === limit,
    },
  }
}

/**
 * Create a new chunk for a document.
 * Note: Embedding generation is not yet available in sim-v2; chunk is created without vector.
 */
export async function createChunk(
  knowledgeBaseId: string,
  documentId: string,
  docTags: Record<string, string | number | boolean | Date | null>,
  chunkData: CreateChunkData,
  requestId: string,
  _workspaceId?: string | null
): Promise<ChunkData> {
  logger.info(`[${requestId}] Creating manual chunk (embedding generation pending)`)

  const tokenCount = Math.ceil(chunkData.content.length / 4)
  const chunkId = randomUUID()
  const now = new Date()

  const newChunk = await db.transaction(async (tx) => {
    const lastChunk = await tx
      .select({ chunkIndex: embedding.chunkIndex })
      .from(embedding)
      .where(eq(embedding.documentId, documentId))
      .orderBy(sql`${embedding.chunkIndex} DESC`)
      .limit(1)

    const nextChunkIndex = lastChunk.length > 0 ? lastChunk[0].chunkIndex + 1 : 0

    const chunkDBData = {
      id: chunkId,
      knowledgeBaseId,
      documentId,
      chunkIndex: nextChunkIndex,
      chunkHash: createHash('sha256').update(chunkData.content).digest('hex'),
      content: chunkData.content,
      contentLength: chunkData.content.length,
      tokenCount,
      embedding: null as number[] | null,
      embeddingModel: 'text-embedding-3-small',
      startOffset: 0,
      endOffset: chunkData.content.length,
      tag1: docTags.tag1 as string | null,
      tag2: docTags.tag2 as string | null,
      tag3: docTags.tag3 as string | null,
      tag4: docTags.tag4 as string | null,
      tag5: docTags.tag5 as string | null,
      tag6: docTags.tag6 as string | null,
      tag7: docTags.tag7 as string | null,
      number1: docTags.number1 as number | null,
      number2: docTags.number2 as number | null,
      number3: docTags.number3 as number | null,
      number4: docTags.number4 as number | null,
      number5: docTags.number5 as number | null,
      date1: docTags.date1 as Date | null,
      date2: docTags.date2 as Date | null,
      boolean1: docTags.boolean1 as boolean | null,
      boolean2: docTags.boolean2 as boolean | null,
      boolean3: docTags.boolean3 as boolean | null,
      enabled: chunkData.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }

    await tx.insert(embedding).values(chunkDBData)

    await tx
      .update(document)
      .set({
        chunkCount: sql`${document.chunkCount} + 1`,
        tokenCount: sql`${document.tokenCount} + ${tokenCount}`,
        characterCount: sql`${document.characterCount} + ${chunkData.content.length}`,
      })
      .where(eq(document.id, documentId))

    return {
      id: chunkId,
      chunkIndex: nextChunkIndex,
      content: chunkData.content,
      contentLength: chunkData.content.length,
      tokenCount,
      enabled: chunkData.enabled ?? true,
      startOffset: 0,
      endOffset: chunkData.content.length,
      tag1: docTags.tag1,
      tag2: docTags.tag2,
      tag3: docTags.tag3,
      tag4: docTags.tag4,
      tag5: docTags.tag5,
      tag6: docTags.tag6,
      tag7: docTags.tag7,
      createdAt: now,
      updatedAt: now,
    } as ChunkData
  })

  logger.info(`[${requestId}] Created chunk ${chunkId} in document ${documentId}`)

  return newChunk
}

/**
 * Perform batch operations on chunks
 */
export async function batchChunkOperation(
  documentId: string,
  operation: 'enable' | 'disable' | 'delete',
  chunkIds: string[],
  requestId: string
): Promise<BatchOperationResult> {
  logger.info(
    `[${requestId}] Starting batch ${operation} operation on ${chunkIds.length} chunks for document ${documentId}`
  )

  const errors: string[] = []
  let successCount = 0

  if (operation === 'delete') {
    await db.transaction(async (tx) => {
      const chunksToDelete = await tx
        .select({
          id: embedding.id,
          tokenCount: embedding.tokenCount,
          contentLength: embedding.contentLength,
        })
        .from(embedding)
        .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))

      if (chunksToDelete.length === 0) {
        errors.push('No matching chunks found to delete')
        return
      }

      const totalTokensToRemove = chunksToDelete.reduce((sum, chunk) => sum + chunk.tokenCount, 0)
      const totalCharsToRemove = chunksToDelete.reduce(
        (sum, chunk) => sum + chunk.contentLength,
        0
      )

      await tx
        .delete(embedding)
        .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))

      await tx
        .update(document)
        .set({
          chunkCount: sql`${document.chunkCount} - ${chunksToDelete.length}`,
          tokenCount: sql`${document.tokenCount} - ${totalTokensToRemove}`,
          characterCount: sql`${document.characterCount} - ${totalCharsToRemove}`,
        })
        .where(eq(document.id, documentId))

      successCount = chunksToDelete.length
    })
  } else {
    const enabled = operation === 'enable'

    await db
      .update(embedding)
      .set({
        enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))

    successCount = chunkIds.length
  }

  logger.info(
    `[${requestId}] Batch ${operation} completed: ${successCount} chunks processed, ${errors.length} errors`
  )

  return { success: errors.length === 0, processed: successCount, errors }
}

/**
 * Update a single chunk.
 * Note: Embedding regeneration is not yet available in sim-v2; content updates do not regenerate vectors.
 */
export async function updateChunk(
  chunkId: string,
  updateData: {
    content?: string
    enabled?: boolean
  },
  requestId: string,
  _workspaceId?: string | null
): Promise<ChunkData> {
  const dbUpdateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (updateData.content !== undefined && typeof updateData.content === 'string') {
    return await db.transaction(async (tx) => {
      const currentChunk = await tx
        .select({
          documentId: embedding.documentId,
          content: embedding.content,
          contentLength: embedding.contentLength,
          tokenCount: embedding.tokenCount,
        })
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)

      if (currentChunk.length === 0) {
        throw new Error(`Chunk ${chunkId} not found`)
      }

      const oldContentLength = currentChunk[0].contentLength
      const oldTokenCount = currentChunk[0].tokenCount
      const content = updateData.content!
      const newContentLength = content.length
      const newTokenCount = Math.ceil(content.length / 4)

      dbUpdateData.content = content
      dbUpdateData.contentLength = newContentLength
      dbUpdateData.tokenCount = newTokenCount
      dbUpdateData.chunkHash = createHash('sha256').update(content).digest('hex')

      if (updateData.enabled !== undefined) {
        dbUpdateData.enabled = updateData.enabled
      }

      await tx.update(embedding).set(dbUpdateData).where(eq(embedding.id, chunkId))

      const charDiff = newContentLength - oldContentLength
      const tokenDiff = newTokenCount - oldTokenCount

      await tx
        .update(document)
        .set({
          characterCount: sql`${document.characterCount} + ${charDiff}`,
          tokenCount: sql`${document.tokenCount} + ${tokenDiff}`,
        })
        .where(eq(document.id, currentChunk[0].documentId))

      const updatedChunk = await tx
        .select({
          id: embedding.id,
          chunkIndex: embedding.chunkIndex,
          content: embedding.content,
          contentLength: embedding.contentLength,
          tokenCount: embedding.tokenCount,
          enabled: embedding.enabled,
          startOffset: embedding.startOffset,
          endOffset: embedding.endOffset,
          tag1: embedding.tag1,
          tag2: embedding.tag2,
          tag3: embedding.tag3,
          tag4: embedding.tag4,
          tag5: embedding.tag5,
          tag6: embedding.tag6,
          tag7: embedding.tag7,
          createdAt: embedding.createdAt,
          updatedAt: embedding.updatedAt,
        })
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)

      logger.info(`[${requestId}] Updated chunk: ${chunkId}`)

      return updatedChunk[0] as ChunkData
    })
  }

  if (updateData.enabled !== undefined) {
    dbUpdateData.enabled = updateData.enabled
  }

  await db.update(embedding).set(dbUpdateData).where(eq(embedding.id, chunkId))

  const updatedChunk = await db
    .select({
      id: embedding.id,
      chunkIndex: embedding.chunkIndex,
      content: embedding.content,
      contentLength: embedding.contentLength,
      tokenCount: embedding.tokenCount,
      enabled: embedding.enabled,
      startOffset: embedding.startOffset,
      endOffset: embedding.endOffset,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      createdAt: embedding.createdAt,
      updatedAt: embedding.updatedAt,
    })
    .from(embedding)
    .where(eq(embedding.id, chunkId))
    .limit(1)

  if (updatedChunk.length === 0) {
    throw new Error(`Chunk ${chunkId} not found`)
  }

  logger.info(`[${requestId}] Updated chunk: ${chunkId}`)

  return updatedChunk[0] as ChunkData
}

/**
 * Delete a single chunk with document statistics updates
 */
export async function deleteChunk(
  chunkId: string,
  documentId: string,
  requestId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const chunkToDelete = await tx
      .select({
        tokenCount: embedding.tokenCount,
        contentLength: embedding.contentLength,
      })
      .from(embedding)
      .where(eq(embedding.id, chunkId))
      .limit(1)

    if (chunkToDelete.length === 0) {
      throw new Error('Chunk not found')
    }

    const chunk = chunkToDelete[0]

    await tx.delete(embedding).where(eq(embedding.id, chunkId))

    await tx
      .update(document)
      .set({
        chunkCount: sql`${document.chunkCount} - 1`,
        tokenCount: sql`${document.tokenCount} - ${chunk.tokenCount}`,
        characterCount: sql`${document.characterCount} - ${chunk.contentLength}`,
      })
      .where(eq(document.id, documentId))
  })

  logger.info(`[${requestId}] Deleted chunk: ${chunkId}`)
}
