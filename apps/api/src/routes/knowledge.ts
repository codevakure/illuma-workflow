/**
 * Knowledge base routes for Hono API.
 * Ports all legacy Next.js knowledge endpoints to Hono router patterns.
 */

import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { getUserId, type AuthContext } from '@/middleware/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  getKnowledgeBases,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import {
  bulkDocumentOperation,
  bulkDocumentOperationByFilter,
  createDocumentRecords,
  createSingleDocument,
  deleteDocument,
  getDocuments,
  markDocumentAsFailedTimeout,
  retryDocumentProcessing,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import {
  batchChunkOperation,
  createChunk,
  deleteChunk,
  queryChunks,
  updateChunk,
} from '@/lib/knowledge/chunks/service'
import {
  cleanupUnusedTagDefinitions,
  createOrUpdateTagDefinitionsBulk,
  createTagDefinition,
  deleteAllTagDefinitions,
  deleteTagDefinition,
  getDocumentTagDefinitions,
  getTagDefinitions,
  getTagUsage,
} from '@/lib/knowledge/tags/service'
import type { BulkTagDefinitionsData } from '@/lib/knowledge/tags/types'
import { SUPPORTED_FIELD_TYPES } from '@/lib/knowledge/constants'
import {
  checkChunkAccess,
  checkDocumentAccess,
  checkDocumentWriteAccess,
  checkKnowledgeBaseAccess,
  checkKnowledgeBaseWriteAccess,
} from '@/lib/knowledge/utils'

const logger = createLogger('KnowledgeRoutes')

const app = new Hono<{ Variables: AuthContext }>()

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const CreateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  embeddingModel: z.literal('text-embedding-3-small').default('text-embedding-3-small'),
  embeddingDimension: z.literal(1536).default(1536),
  chunkingConfig: z
    .object({
      maxSize: z.number().min(100).max(4000).default(1024),
      minSize: z.number().min(1).max(2000).default(100),
      overlap: z.number().min(0).max(500).default(200),
    })
    .default({ maxSize: 1024, minSize: 100, overlap: 200 })
    .refine(
      (data) => {
        const maxSizeInChars = data.maxSize * 4
        return data.minSize < maxSizeInChars
      },
      { message: 'Min chunk size (characters) must be less than max chunk size (tokens x 4)' }
    ),
})

const UpdateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  embeddingModel: z.literal('text-embedding-3-small').optional(),
  embeddingDimension: z.literal(1536).optional(),
  workspaceId: z.string().nullable().optional(),
  chunkingConfig: z
    .object({
      maxSize: z.number().min(100).max(4000),
      minSize: z.number().min(1).max(2000),
      overlap: z.number().min(0).max(500),
    })
    .refine(
      (data) => {
        const maxSizeInChars = data.maxSize * 4
        return data.minSize < maxSizeInChars
      },
      { message: 'Min chunk size (characters) must be less than max chunk size (tokens x 4)' }
    )
    .optional(),
})

const CreateDocumentSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().url('File URL must be valid'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
  documentTagsData: z.string().optional(),
})

const BulkCreateDocumentsSchema = z.object({
  documents: z.array(CreateDocumentSchema),
  processingOptions: z.object({
    chunkSize: z.number().min(100).max(4000),
    minCharactersPerChunk: z.number().min(1).max(2000),
    recipe: z.string(),
    lang: z.string(),
    chunkOverlap: z.number().min(0).max(500),
  }),
  bulk: z.literal(true),
})

const BulkUpdateDocumentsSchema = z
  .object({
    operation: z.enum(['enable', 'disable', 'delete']),
    documentIds: z
      .array(z.string())
      .min(1, 'At least one document ID is required')
      .max(100, 'Cannot operate on more than 100 documents at once')
      .optional(),
    selectAll: z.boolean().optional(),
    enabledFilter: z.enum(['all', 'enabled', 'disabled']).optional(),
  })
  .refine((data) => data.selectAll || (data.documentIds && data.documentIds.length > 0), {
    message: 'Either selectAll must be true or documentIds must be provided',
  })

const UpdateDocumentSchema = z.object({
  filename: z.string().min(1, 'Filename is required').optional(),
  enabled: z.boolean().optional(),
  chunkCount: z.number().min(0).optional(),
  tokenCount: z.number().min(0).optional(),
  characterCount: z.number().min(0).optional(),
  processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  processingError: z.string().optional(),
  markFailedDueToTimeout: z.boolean().optional(),
  retryProcessing: z.boolean().optional(),
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
  number1: z.string().optional(),
  number2: z.string().optional(),
  number3: z.string().optional(),
  number4: z.string().optional(),
  number5: z.string().optional(),
  date1: z.string().optional(),
  date2: z.string().optional(),
  boolean1: z.string().optional(),
  boolean2: z.string().optional(),
  boolean3: z.string().optional(),
})

const GetChunksQuerySchema = z.object({
  search: z.string().optional(),
  enabled: z.enum(['true', 'false', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
})

const CreateChunkSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000, 'Content too long'),
  enabled: z.boolean().optional().default(true),
})

const BatchChunkOperationSchema = z.object({
  operation: z.enum(['enable', 'disable', 'delete']),
  chunkIds: z
    .array(z.string())
    .min(1, 'At least one chunk ID is required')
    .max(100, 'Cannot operate on more than 100 chunks at once'),
})

const UpdateChunkSchema = z.object({
  content: z.string().min(1, 'Content is required').optional(),
  enabled: z.boolean().optional(),
})

const CreateTagDefinitionSchema = z.object({
  tagSlot: z.string().min(1, 'Tag slot is required'),
  displayName: z.string().min(1, 'Display name is required'),
  fieldType: z.enum(SUPPORTED_FIELD_TYPES as [string, ...string[]], {
    errorMap: () => ({ message: 'Invalid field type' }),
  }),
})

const TagDefinitionSchema = z.object({
  tagSlot: z.string(),
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long'),
  fieldType: z.enum(SUPPORTED_FIELD_TYPES as [string, ...string[]]).default('text'),
  _originalDisplayName: z.string().optional(),
})

const BulkTagDefinitionsSchema = z.object({
  definitions: z.array(TagDefinitionSchema),
})

// ---------------------------------------------------------------------------
// Knowledge Base CRUD: GET / POST /
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge
 * List all knowledge bases the user can access.
 */
app.get('/', async (c) => {
  const requestId = generateRequestId()

  try {
    const userId = getUserId(c)
    const workspaceId = c.req.query('workspaceId')

    const knowledgeBasesWithCounts = await getKnowledgeBases(userId, workspaceId)

    return c.json({ success: true, data: knowledgeBasesWithCounts })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge bases`, error)
    return c.json({ error: 'Failed to fetch knowledge bases' }, 500)
  }
})

/**
 * POST /api/knowledge
 * Create a new knowledge base.
 */
app.post('/', async (c) => {
  const requestId = generateRequestId()

  try {
    const userId = getUserId(c)
    const body = await c.req.json()

    try {
      const validatedData = CreateKnowledgeBaseSchema.parse(body)

      const createData = {
        ...validatedData,
        userId,
      }

      const newKnowledgeBase = await createKnowledgeBase(createData, requestId)

      logger.info(
        `[${requestId}] Knowledge base created: ${newKnowledgeBase.id} for user ${userId}`
      )

      return c.json({ success: true, data: newKnowledgeBase })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid knowledge base data`, {
          errors: validationError.errors,
        })
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error creating knowledge base`, error)
    return c.json({ error: 'Failed to create knowledge base' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Knowledge Base by ID: GET / PUT / DELETE /:id
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id
 * Get a single knowledge base by ID.
 */
app.get('/:id', async (c) => {
  const requestId = generateRequestId()
  const id = c.req.param('id')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseAccess(id, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
        return c.json({ error: 'Knowledge base not found' }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to access unauthorized knowledge base ${id}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const knowledgeBaseData = await getKnowledgeBaseById(id)

    if (!knowledgeBaseData) {
      return c.json({ error: 'Knowledge base not found' }, 404)
    }

    logger.info(`[${requestId}] Retrieved knowledge base: ${id} for user ${userId}`)

    return c.json({ success: true, data: knowledgeBaseData })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge base`, error)
    return c.json({ error: 'Failed to fetch knowledge base' }, 500)
  }
})

/**
 * PUT /api/knowledge/:id
 * Update a knowledge base.
 */
app.put('/:id', async (c) => {
  const requestId = generateRequestId()
  const id = c.req.param('id')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseWriteAccess(id, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
        return c.json({ error: 'Knowledge base not found' }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to update unauthorized knowledge base ${id}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()

    try {
      const validatedData = UpdateKnowledgeBaseSchema.parse(body)

      const updatedKnowledgeBase = await updateKnowledgeBase(
        id,
        {
          name: validatedData.name,
          description: validatedData.description,
          workspaceId: validatedData.workspaceId,
          chunkingConfig: validatedData.chunkingConfig,
        },
        requestId
      )

      logger.info(`[${requestId}] Knowledge base updated: ${id} for user ${userId}`)

      return c.json({ success: true, data: updatedKnowledgeBase })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid knowledge base update data`, {
          errors: validationError.errors,
        })
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating knowledge base`, error)
    return c.json({ error: 'Failed to update knowledge base' }, 500)
  }
})

/**
 * DELETE /api/knowledge/:id
 * Delete a knowledge base (soft delete).
 */
app.delete('/:id', async (c) => {
  const requestId = generateRequestId()
  const id = c.req.param('id')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseWriteAccess(id, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
        return c.json({ error: 'Knowledge base not found' }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to delete unauthorized knowledge base ${id}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    await deleteKnowledgeBase(id, requestId)

    logger.info(`[${requestId}] Knowledge base deleted: ${id} for user ${userId}`)

    return c.json({ success: true, data: { message: 'Knowledge base deleted successfully' } })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting knowledge base`, error)
    return c.json({ error: 'Failed to delete knowledge base' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Search: POST /search
// ---------------------------------------------------------------------------

/**
 * POST /api/knowledge/search
 * Perform vector/tag search across knowledge bases.
 * Note: Full vector search requires embedding generation which is not yet
 * available in sim-v2. Tag-only search is fully functional.
 */
app.post('/search', async (c) => {
  const requestId = generateRequestId()

  try {
    const userId = getUserId(c)
    const body = await c.req.json()

    const VectorSearchSchema = z
      .object({
        knowledgeBaseIds: z.union([
          z.string().min(1, 'Knowledge base ID is required'),
          z.array(z.string().min(1)).min(1, 'At least one knowledge base ID is required'),
        ]),
        query: z.string().optional().nullable().transform((val) => val || undefined),
        topK: z.number().min(1).max(100).optional().nullable().default(10).transform((val) => val ?? 10),
        tagFilters: z
          .array(
            z.object({
              tagName: z.string(),
              tagSlot: z.string().optional(),
              fieldType: z.enum(['text', 'number', 'date', 'boolean']).default('text'),
              operator: z.string().default('eq'),
              value: z.union([z.string(), z.number(), z.boolean()]),
              valueTo: z.union([z.string(), z.number()]).optional(),
            })
          )
          .optional()
          .nullable()
          .transform((val) => val || undefined),
      })
      .refine(
        (data) => {
          const hasQuery = data.query && data.query.trim().length > 0
          const hasTagFilters = data.tagFilters && data.tagFilters.length > 0
          return hasQuery || hasTagFilters
        },
        {
          message:
            'Please provide either a search query or tag filters to search your knowledge base',
        }
      )

    try {
      const validatedData = VectorSearchSchema.parse(body)

      const knowledgeBaseIds = Array.isArray(validatedData.knowledgeBaseIds)
        ? validatedData.knowledgeBaseIds
        : [validatedData.knowledgeBaseIds]

      const accessChecks = await Promise.all(
        knowledgeBaseIds.map((kbId) => checkKnowledgeBaseAccess(kbId, userId))
      )
      const accessibleKbIds: string[] = knowledgeBaseIds.filter(
        (_, idx) => accessChecks[idx]?.hasAccess
      )

      if (accessibleKbIds.length === 0) {
        return c.json({ error: 'Knowledge base not found or access denied' }, 404)
      }

      const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))
      if (inaccessibleKbIds.length > 0) {
        return c.json(
          { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
          404
        )
      }

      const hasQuery = validatedData.query && validatedData.query.trim().length > 0

      if (hasQuery) {
        return c.json(
          {
            error:
              'Vector search is not yet available in sim-v2. Use tag filters for tag-only search.',
          },
          501
        )
      }

      if (!validatedData.tagFilters || validatedData.tagFilters.length === 0) {
        return c.json(
          {
            error:
              'Please provide either a search query or tag filters to search your knowledge base',
          },
          400
        )
      }

      // Validate tag filters against definitions
      const kbId = accessibleKbIds[0]
      const tagDefs = await getDocumentTagDefinitions(kbId)

      const displayNameToTagDef: Record<string, { tagSlot: string; fieldType: string }> = {}
      tagDefs.forEach((def) => {
        displayNameToTagDef[def.displayName] = {
          tagSlot: def.tagSlot,
          fieldType: def.fieldType,
        }
      })

      const { validateTagValue, buildUndefinedTagsError } = await import('@/lib/knowledge/utils')

      const undefinedTags: string[] = []
      const typeErrors: string[] = []

      for (const filter of validatedData.tagFilters) {
        const tagDef = displayNameToTagDef[filter.tagName]
        if (!tagDef) {
          undefinedTags.push(filter.tagName)
          continue
        }
        const validationError = validateTagValue(
          filter.tagName,
          String(filter.value),
          tagDef.fieldType
        )
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
        return c.json({ error: errorParts.join('\n') }, 400)
      }

      // Build structured filters
      const structuredFilters = validatedData.tagFilters.map((filter) => {
        const tagDef = displayNameToTagDef[filter.tagName]!
        return {
          tagSlot: filter.tagSlot || tagDef.tagSlot,
          fieldType: filter.fieldType || tagDef.fieldType,
          operator: filter.operator,
          value: filter.value,
          valueTo: filter.valueTo,
        }
      })

      // Import search utils for tag-only search
      // Tag-only search is done via direct DB queries since we don't need vectors
      const { db } = await import('@sim/db')
      const { embedding, document } = await import('@sim/db/schema')
      const { and: andOp, eq: eqOp, inArray: inArrayOp, isNull: isNullOp, sql: sqlOp } = await import('drizzle-orm')
      const { ALL_TAG_SLOTS } = await import('@/lib/knowledge/constants')

      // Build tag filter SQL conditions
      const tagFilterConditions = structuredFilters.map((filter) => {
        const column = (embedding as unknown as Record<string, unknown>)[filter.tagSlot]
        if (!column) return null

        if (filter.fieldType === 'text') {
          const stringValue = String(filter.value)
          switch (filter.operator) {
            case 'eq': return sqlOp`LOWER(${column}) = LOWER(${stringValue})`
            case 'neq': return sqlOp`LOWER(${column}) != LOWER(${stringValue})`
            case 'contains': return sqlOp`LOWER(${column}) LIKE LOWER(${`%${stringValue}%`})`
            case 'not_contains': return sqlOp`LOWER(${column}) NOT LIKE LOWER(${`%${stringValue}%`})`
            case 'starts_with': return sqlOp`LOWER(${column}) LIKE LOWER(${`${stringValue}%`})`
            case 'ends_with': return sqlOp`LOWER(${column}) LIKE LOWER(${`%${stringValue}`})`
            default: return sqlOp`LOWER(${column}) = LOWER(${stringValue})`
          }
        }
        if (filter.fieldType === 'number') {
          const numValue = typeof filter.value === 'number' ? filter.value : Number.parseFloat(String(filter.value))
          if (Number.isNaN(numValue)) return null
          switch (filter.operator) {
            case 'eq': return sqlOp`${column} = ${numValue}`
            case 'neq': return sqlOp`${column} != ${numValue}`
            case 'gt': return sqlOp`${column} > ${numValue}`
            case 'gte': return sqlOp`${column} >= ${numValue}`
            case 'lt': return sqlOp`${column} < ${numValue}`
            case 'lte': return sqlOp`${column} <= ${numValue}`
            default: return sqlOp`${column} = ${numValue}`
          }
        }
        if (filter.fieldType === 'date') {
          const dateStr = String(filter.value)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
          switch (filter.operator) {
            case 'eq': return sqlOp`${column}::date = ${dateStr}::date`
            case 'neq': return sqlOp`${column}::date != ${dateStr}::date`
            case 'gt': return sqlOp`${column}::date > ${dateStr}::date`
            case 'gte': return sqlOp`${column}::date >= ${dateStr}::date`
            case 'lt': return sqlOp`${column}::date < ${dateStr}::date`
            case 'lte': return sqlOp`${column}::date <= ${dateStr}::date`
            default: return sqlOp`${column}::date = ${dateStr}::date`
          }
        }
        if (filter.fieldType === 'boolean') {
          const boolValue = filter.value === true || filter.value === 'true'
          switch (filter.operator) {
            case 'eq': return sqlOp`${column} = ${boolValue}`
            case 'neq': return sqlOp`${column} != ${boolValue}`
            default: return sqlOp`${column} = ${boolValue}`
          }
        }
        return sqlOp`${column} = ${filter.value}`
      }).filter((c): c is NonNullable<typeof c> => c !== null)

      const results = await db
        .select({
          id: embedding.id,
          content: embedding.content,
          documentId: embedding.documentId,
          chunkIndex: embedding.chunkIndex,
          tag1: embedding.tag1,
          tag2: embedding.tag2,
          tag3: embedding.tag3,
          tag4: embedding.tag4,
          tag5: embedding.tag5,
          tag6: embedding.tag6,
          tag7: embedding.tag7,
          number1: embedding.number1,
          number2: embedding.number2,
          number3: embedding.number3,
          number4: embedding.number4,
          number5: embedding.number5,
          date1: embedding.date1,
          date2: embedding.date2,
          boolean1: embedding.boolean1,
          boolean2: embedding.boolean2,
          boolean3: embedding.boolean3,
          knowledgeBaseId: embedding.knowledgeBaseId,
        })
        .from(embedding)
        .innerJoin(document, eqOp(embedding.documentId, document.id))
        .where(
          andOp(
            inArrayOp(embedding.knowledgeBaseId, accessibleKbIds),
            eqOp(embedding.enabled, true),
            isNullOp(document.deletedAt),
            ...tagFilterConditions
          )
        )
        .limit(validatedData.topK)

      // Fetch tag definitions for display name mapping
      const tagDefsResults = await Promise.all(
        accessibleKbIds.map(async (kbId) => {
          try {
            const tagDefs2 = await getDocumentTagDefinitions(kbId)
            const map: Record<string, string> = {}
            tagDefs2.forEach((def) => { map[def.tagSlot] = def.displayName })
            return { kbId, map }
          } catch {
            return { kbId, map: {} as Record<string, string> }
          }
        })
      )
      const tagDefinitionsMap: Record<string, Record<string, string>> = {}
      tagDefsResults.forEach(({ kbId, map }) => { tagDefinitionsMap[kbId] = map })

      // Fetch document names
      const documentIds = results.map((result) => result.documentId)
      let documentNameMap: Record<string, string> = {}
      if (documentIds.length > 0) {
        const uniqueIds = [...new Set(documentIds)]
        const docs = await db
          .select({ id: document.id, filename: document.filename })
          .from(document)
          .where(andOp(inArrayOp(document.id, uniqueIds), isNullOp(document.deletedAt)))
        docs.forEach((doc) => { documentNameMap[doc.id] = doc.filename })
      }

      return c.json({
        success: true,
        data: {
          results: results.map((result) => {
            const kbTagMap = tagDefinitionsMap[result.knowledgeBaseId] || {}
            const tags: Record<string, unknown> = {}

            ALL_TAG_SLOTS.forEach((slot) => {
              const tagValue = (result as Record<string, unknown>)[slot]
              if (tagValue !== null && tagValue !== undefined) {
                const displayName = kbTagMap[slot] || slot
                tags[displayName] = tagValue
              }
            })

            return {
              documentId: result.documentId,
              documentName: documentNameMap[result.documentId] || undefined,
              content: result.content,
              chunkIndex: result.chunkIndex,
              metadata: tags,
              similarity: 1,
            }
          }),
          query: '',
          knowledgeBaseIds: accessibleKbIds,
          knowledgeBaseId: accessibleKbIds[0],
          topK: validatedData.topK,
          totalResults: results.length,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    return c.json(
      {
        error: 'Failed to perform vector search',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// Documents: GET / POST / PATCH /:id/documents
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id/documents
 * List documents for a knowledge base.
 */
app.get('/:id/documents', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return c.json({ error: 'Knowledge base not found' }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to access unauthorized knowledge base documents ${knowledgeBaseId}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const enabledFilter = c.req.query('enabledFilter') as 'all' | 'enabled' | 'disabled' | undefined
    const search = c.req.query('search') || undefined
    const limit = Number.parseInt(c.req.query('limit') || '50')
    const offset = Number.parseInt(c.req.query('offset') || '0')
    const sortByParam = c.req.query('sortBy')
    const sortOrderParam = c.req.query('sortOrder')

    const validSortFields: DocumentSortField[] = [
      'filename', 'fileSize', 'tokenCount', 'chunkCount', 'uploadedAt', 'processingStatus', 'enabled',
    ]
    const validSortOrders: SortOrder[] = ['asc', 'desc']

    const sortBy =
      sortByParam && validSortFields.includes(sortByParam as DocumentSortField)
        ? (sortByParam as DocumentSortField)
        : undefined
    const sortOrder =
      sortOrderParam && validSortOrders.includes(sortOrderParam as SortOrder)
        ? (sortOrderParam as SortOrder)
        : undefined

    const result = await getDocuments(
      knowledgeBaseId,
      {
        enabledFilter: enabledFilter || undefined,
        search,
        limit,
        offset,
        ...(sortBy && { sortBy }),
        ...(sortOrder && { sortOrder }),
      },
      requestId
    )

    return c.json({
      success: true,
      data: { documents: result.documents, pagination: result.pagination },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching documents`, error)
    return c.json({ error: 'Failed to fetch documents' }, 500)
  }
})

/**
 * POST /api/knowledge/:id/documents
 * Create a single document or bulk-create documents.
 */
app.post('/:id/documents', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')

  try {
    const userId = getUserId(c)
    const body = await c.req.json()

    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return c.json({ error: 'Knowledge base not found' }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to create document in unauthorized knowledge base ${knowledgeBaseId}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (body.bulk === true) {
      try {
        const validatedData = BulkCreateDocumentsSchema.parse(body)

        const createdDocuments = await createDocumentRecords(
          validatedData.documents,
          knowledgeBaseId,
          requestId
        )

        logger.info(
          `[${requestId}] Created ${createdDocuments.length} documents (processing not yet available in sim-v2)`
        )

        return c.json({
          success: true,
          data: {
            total: createdDocuments.length,
            documentsCreated: createdDocuments.map((doc) => ({
              documentId: doc.documentId,
              filename: doc.filename,
              status: 'pending',
            })),
            processingMethod: 'pending',
          },
        })
      } catch (validationError) {
        if (validationError instanceof z.ZodError) {
          logger.warn(`[${requestId}] Invalid bulk processing request data`, {
            errors: validationError.errors,
          })
          return c.json(
            { error: 'Invalid request data', details: validationError.errors },
            400
          )
        }
        throw validationError
      }
    } else {
      try {
        const validatedData = CreateDocumentSchema.parse(body)

        const newDocument = await createSingleDocument(validatedData, knowledgeBaseId, requestId)

        return c.json({ success: true, data: newDocument })
      } catch (validationError) {
        if (validationError instanceof z.ZodError) {
          logger.warn(`[${requestId}] Invalid document data`, {
            errors: validationError.errors,
          })
          return c.json(
            { error: 'Invalid request data', details: validationError.errors },
            400
          )
        }
        throw validationError
      }
    }
  } catch (error) {
    logger.error(`[${requestId}] Error creating document`, error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create document'
    const isStorageLimitError =
      errorMessage.includes('Storage limit exceeded') || errorMessage.includes('storage limit')
    return c.json({ error: errorMessage }, isStorageLimitError ? 413 : 500)
  }
})

/**
 * PATCH /api/knowledge/:id/documents
 * Bulk document operations (enable/disable/delete).
 */
app.patch('/:id/documents', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return c.json({ error: 'Knowledge base not found' }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to perform bulk operation on unauthorized knowledge base ${knowledgeBaseId}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()

    try {
      const validatedData = BulkUpdateDocumentsSchema.parse(body)
      const { operation, documentIds, selectAll, enabledFilter } = validatedData

      try {
        let result
        if (selectAll) {
          result = await bulkDocumentOperationByFilter(
            knowledgeBaseId,
            operation,
            enabledFilter,
            requestId
          )
        } else if (documentIds && documentIds.length > 0) {
          result = await bulkDocumentOperation(knowledgeBaseId, operation, documentIds, requestId)
        } else {
          return c.json({ error: 'No documents specified' }, 400)
        }

        return c.json({
          success: true,
          data: {
            operation,
            successCount: result.successCount,
            updatedDocuments: result.updatedDocuments,
          },
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'No valid documents found to update') {
          return c.json({ error: 'No valid documents found to update' }, 404)
        }
        throw error
      }
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid bulk operation data`, {
          errors: validationError.errors,
        })
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error in bulk document operation`, error)
    return c.json({ error: 'Failed to perform bulk operation' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Document by ID: GET / PUT / DELETE /:id/documents/:documentId
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id/documents/:documentId
 */
app.get('/:id/documents/:documentId', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized document access: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    logger.info(
      `[${requestId}] Retrieved document: ${documentId} from knowledge base ${knowledgeBaseId}`
    )

    return c.json({ success: true, data: accessCheck.document })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching document`, error)
    return c.json({ error: 'Failed to fetch document' }, 500)
  }
})

/**
 * PUT /api/knowledge/:id/documents/:documentId
 */
app.put('/:id/documents/:documentId', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized document update: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()

    try {
      const validatedData = UpdateDocumentSchema.parse(body)

      if (validatedData.markFailedDueToTimeout) {
        const doc = accessCheck.document

        if (doc.processingStatus !== 'processing') {
          return c.json(
            { error: `Document is not in processing state (current: ${doc.processingStatus})` },
            400
          )
        }

        if (!doc.processingStartedAt) {
          return c.json({ error: 'Document has no processing start time' }, 400)
        }

        try {
          await markDocumentAsFailedTimeout(documentId, doc.processingStartedAt, requestId)

          return c.json({
            success: true,
            data: {
              documentId,
              status: 'failed',
              message: 'Document marked as failed due to timeout',
            },
          })
        } catch (error) {
          if (error instanceof Error) {
            return c.json({ error: error.message }, 400)
          }
          throw error
        }
      } else if (validatedData.retryProcessing) {
        const doc = accessCheck.document

        if (doc.processingStatus !== 'failed') {
          return c.json({ error: 'Document is not in failed state' }, 400)
        }

        const docData = {
          filename: doc.filename,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
        }

        const result = await retryDocumentProcessing(
          knowledgeBaseId,
          documentId,
          docData,
          requestId
        )

        return c.json({
          success: true,
          data: {
            documentId,
            status: result.status,
            message: result.message,
          },
        })
      } else {
        const updatedDocument = await updateDocument(documentId, validatedData, requestId)

        logger.info(
          `[${requestId}] Document updated: ${documentId} in knowledge base ${knowledgeBaseId}`
        )

        return c.json({ success: true, data: updatedDocument })
      }
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid document update data`, {
          errors: validationError.errors,
          documentId,
        })
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating document ${documentId}`, error)
    return c.json({ error: 'Failed to update document' }, 500)
  }
})

/**
 * DELETE /api/knowledge/:id/documents/:documentId
 */
app.delete('/:id/documents/:documentId', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized document deletion: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const result = await deleteDocument(documentId, requestId)

    logger.info(
      `[${requestId}] Document deleted: ${documentId} from knowledge base ${knowledgeBaseId}`
    )

    return c.json({ success: true, data: result })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting document`, error)
    return c.json({ error: 'Failed to delete document' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Chunks: GET / POST / PATCH /:id/documents/:documentId/chunks
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id/documents/:documentId/chunks
 */
app.get('/:id/documents/:documentId/chunks', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized chunks access: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const doc = accessCheck.document
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    if (doc.processingStatus !== 'completed') {
      logger.warn(
        `[${requestId}] Document ${documentId} is not ready for chunk access (status: ${doc.processingStatus})`
      )
      return c.json(
        {
          error: 'Document is not ready for access',
          details: `Document status: ${doc.processingStatus}`,
          retryAfter: doc.processingStatus === 'processing' ? 5 : null,
        },
        400
      )
    }

    const queryParams = GetChunksQuerySchema.parse({
      search: c.req.query('search') || undefined,
      enabled: c.req.query('enabled') || undefined,
      limit: c.req.query('limit') || undefined,
      offset: c.req.query('offset') || undefined,
    })

    const result = await queryChunks(documentId, queryParams, requestId)

    return c.json({ success: true, data: result.chunks, pagination: result.pagination })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching chunks`, error)
    return c.json({ error: 'Failed to fetch chunks' }, 500)
  }
})

/**
 * POST /api/knowledge/:id/documents/:documentId/chunks
 * Create a new chunk for a document.
 */
app.post('/:id/documents/:documentId/chunks', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    const userId = getUserId(c)
    const body = await c.req.json()

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized chunk creation: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const doc = accessCheck.document
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    if (doc.processingStatus === 'failed') {
      logger.warn(`[${requestId}] Document ${documentId} is in failed state, cannot add chunks`)
      return c.json({ error: 'Cannot add chunks to failed document' }, 400)
    }

    try {
      const validatedData = CreateChunkSchema.parse(body)

      const docTags = {
        tag1: doc.tag1 ?? null,
        tag2: doc.tag2 ?? null,
        tag3: doc.tag3 ?? null,
        tag4: doc.tag4 ?? null,
        tag5: doc.tag5 ?? null,
        tag6: doc.tag6 ?? null,
        tag7: doc.tag7 ?? null,
        number1: doc.number1 ?? null,
        number2: doc.number2 ?? null,
        number3: doc.number3 ?? null,
        number4: doc.number4 ?? null,
        number5: doc.number5 ?? null,
        date1: doc.date1 ?? null,
        date2: doc.date2 ?? null,
        boolean1: doc.boolean1 ?? null,
        boolean2: doc.boolean2 ?? null,
        boolean3: doc.boolean3 ?? null,
      }

      const newChunk = await createChunk(
        knowledgeBaseId,
        documentId,
        docTags,
        validatedData,
        requestId,
        accessCheck.knowledgeBase?.workspaceId
      )

      return c.json({
        success: true,
        data: {
          ...newChunk,
          documentId,
          documentName: doc.filename,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid chunk creation data`, {
          errors: validationError.errors,
        })
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error creating chunk`, error)
    return c.json({ error: 'Failed to create chunk' }, 500)
  }
})

/**
 * PATCH /api/knowledge/:id/documents/:documentId/chunks
 * Batch chunk operations (enable/disable/delete).
 */
app.patch('/:id/documents/:documentId/chunks', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized batch chunk operation: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()

    try {
      const validatedData = BatchChunkOperationSchema.parse(body)
      const { operation, chunkIds } = validatedData

      const result = await batchChunkOperation(documentId, operation, chunkIds, requestId)

      return c.json({
        success: true,
        data: {
          operation,
          successCount: result.processed,
          errorCount: result.errors.length,
          processed: result.processed,
          errors: result.errors,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid batch operation data`, {
          errors: validationError.errors,
        })
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error in batch chunk operation`, error)
    return c.json({ error: 'Failed to perform batch operation' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Chunk by ID: GET / PUT / DELETE /:id/documents/:documentId/chunks/:chunkId
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id/documents/:documentId/chunks/:chunkId
 */
app.get('/:id/documents/:documentId/chunks/:chunkId', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')
  const chunkId = c.req.param('chunkId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkChunkAccess(knowledgeBaseId, documentId, chunkId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
        )
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized chunk access: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    logger.info(
      `[${requestId}] Retrieved chunk: ${chunkId} from document ${documentId} in knowledge base ${knowledgeBaseId}`
    )

    return c.json({ success: true, data: accessCheck.chunk })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching chunk`, error)
    return c.json({ error: 'Failed to fetch chunk' }, 500)
  }
})

/**
 * PUT /api/knowledge/:id/documents/:documentId/chunks/:chunkId
 */
app.put('/:id/documents/:documentId/chunks/:chunkId', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')
  const chunkId = c.req.param('chunkId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkChunkAccess(knowledgeBaseId, documentId, chunkId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
        )
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized chunk update: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()

    try {
      const validatedData = UpdateChunkSchema.parse(body)

      const updatedChunk = await updateChunk(
        chunkId,
        validatedData,
        requestId,
        accessCheck.knowledgeBase?.workspaceId
      )

      logger.info(
        `[${requestId}] Chunk updated: ${chunkId} in document ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return c.json({ success: true, data: updatedChunk })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid chunk update data`, {
          errors: validationError.errors,
        })
        return c.json(
          { error: 'Invalid request data', details: validationError.errors },
          400
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating chunk`, error)
    return c.json({ error: 'Failed to update chunk' }, 500)
  }
})

/**
 * DELETE /api/knowledge/:id/documents/:documentId/chunks/:chunkId
 */
app.delete('/:id/documents/:documentId/chunks/:chunkId', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')
  const chunkId = c.req.param('chunkId')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkChunkAccess(knowledgeBaseId, documentId, chunkId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
        )
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized chunk deletion: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    await deleteChunk(chunkId, documentId, requestId)

    logger.info(
      `[${requestId}] Chunk deleted: ${chunkId} from document ${documentId} in knowledge base ${knowledgeBaseId}`
    )

    return c.json({ success: true, data: { message: 'Chunk deleted successfully' } })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting chunk`, error)
    return c.json({ error: 'Failed to delete chunk' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Tag Definitions: GET / POST /:id/tag-definitions
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id/tag-definitions
 * Get all tag definitions for a knowledge base.
 */
app.get('/:id/tag-definitions', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')

  try {
    logger.info(`[${requestId}] Getting tag definitions for knowledge base ${knowledgeBaseId}`)

    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)
    if (!accessCheck.hasAccess) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const tagDefinitions = await getTagDefinitions(knowledgeBaseId)

    logger.info(`[${requestId}] Retrieved ${tagDefinitions.length} tag definitions`)

    return c.json({ success: true, data: tagDefinitions })
  } catch (error) {
    logger.error(`[${requestId}] Error getting tag definitions`, error)
    return c.json({ error: 'Failed to get tag definitions' }, 500)
  }
})

/**
 * POST /api/knowledge/:id/tag-definitions
 * Create a new tag definition.
 */
app.post('/:id/tag-definitions', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')

  try {
    logger.info(`[${requestId}] Creating tag definition for knowledge base ${knowledgeBaseId}`)

    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)
    if (!accessCheck.hasAccess) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const body = await c.req.json()

    let validatedData
    try {
      validatedData = CreateTagDefinitionSchema.parse(body)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: 'Invalid request data', details: error.errors },
          400
        )
      }
      throw error
    }

    const newTagDefinition = await createTagDefinition(
      {
        knowledgeBaseId,
        tagSlot: validatedData.tagSlot,
        displayName: validatedData.displayName,
        fieldType: validatedData.fieldType,
      },
      requestId
    )

    return c.json({ success: true, data: newTagDefinition })
  } catch (error) {
    logger.error(`[${requestId}] Error creating tag definition`, error)
    return c.json({ error: 'Failed to create tag definition' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Tag Definition by ID: DELETE /:id/tag-definitions/:tagId
// ---------------------------------------------------------------------------

/**
 * DELETE /api/knowledge/:id/tag-definitions/:tagId
 * Delete a tag definition.
 */
app.delete('/:id/tag-definitions/:tagId', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const tagId = c.req.param('tagId')

  try {
    logger.info(
      `[${requestId}] Deleting tag definition ${tagId} from knowledge base ${knowledgeBaseId}`
    )

    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)
    if (!accessCheck.hasAccess) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const deletedTag = await deleteTagDefinition(tagId, requestId)

    return c.json({
      success: true,
      message: `Tag definition "${deletedTag.displayName}" deleted successfully`,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting tag definition`, error)
    return c.json({ error: 'Failed to delete tag definition' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Document Tag Definitions: GET / POST / DELETE /:id/documents/:documentId/tag-definitions
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id/documents/:documentId/tag-definitions
 * Get tag definitions for a specific document.
 */
app.get('/:id/documents/:documentId/tag-definitions', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    logger.info(`[${requestId}] Getting tag definitions for document ${documentId}`)

    const userId = getUserId(c)

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, userId)
    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized document access: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const tagDefinitions = await getDocumentTagDefinitions(knowledgeBaseId)

    logger.info(`[${requestId}] Retrieved ${tagDefinitions.length} tag definitions`)

    return c.json({ success: true, data: tagDefinitions })
  } catch (error) {
    logger.error(`[${requestId}] Error getting tag definitions`, error)
    return c.json({ error: 'Failed to get tag definitions' }, 500)
  }
})

/**
 * POST /api/knowledge/:id/documents/:documentId/tag-definitions
 * Create/update tag definitions for a document.
 */
app.post('/:id/documents/:documentId/tag-definitions', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')

  try {
    logger.info(`[${requestId}] Creating/updating tag definitions for document ${documentId}`)

    const userId = getUserId(c)

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)
    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized document write access: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    let body
    try {
      body = await c.req.json()
    } catch {
      logger.error(`[${requestId}] Failed to parse JSON body`)
      return c.json({ error: 'Invalid JSON in request body' }, 400)
    }

    if (!body || typeof body !== 'object') {
      logger.error(`[${requestId}] Invalid request body:`, body)
      return c.json({ error: 'Request body must be a valid JSON object' }, 400)
    }

    try {
      const validatedData = BulkTagDefinitionsSchema.parse(body)

      const bulkData: BulkTagDefinitionsData = {
        definitions: validatedData.definitions.map((def) => ({
          tagSlot: def.tagSlot,
          displayName: def.displayName,
          fieldType: def.fieldType,
          originalDisplayName: def._originalDisplayName,
        })),
      }

      const result = await createOrUpdateTagDefinitionsBulk(knowledgeBaseId, bulkData, requestId)

      return c.json({
        success: true,
        data: {
          created: result.created,
          updated: result.updated,
          errors: result.errors,
        },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          { error: 'Invalid request data', details: error.errors },
          400
        )
      }
      throw error
    }
  } catch (error) {
    logger.error(`[${requestId}] Error creating/updating tag definitions`, error)
    return c.json({ error: 'Failed to create/update tag definitions' }, 500)
  }
})

/**
 * DELETE /api/knowledge/:id/documents/:documentId/tag-definitions
 * Delete tag definitions for a document (cleanup or delete all).
 */
app.delete('/:id/documents/:documentId/tag-definitions', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')
  const documentId = c.req.param('documentId')
  const action = c.req.query('action')

  try {
    const userId = getUserId(c)

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)
    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
        return c.json({ error: accessCheck.reason }, 404)
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized document write access: ${accessCheck.reason}`
      )
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (action === 'cleanup') {
      logger.info(`[${requestId}] Running cleanup for KB ${knowledgeBaseId}`)
      const cleanedUpCount = await cleanupUnusedTagDefinitions(knowledgeBaseId, requestId)

      return c.json({ success: true, data: { cleanedUp: cleanedUpCount } })
    }

    logger.info(`[${requestId}] Deleting all tag definitions for KB ${knowledgeBaseId}`)
    const deletedCount = await deleteAllTagDefinitions(knowledgeBaseId, requestId)

    return c.json({
      success: true,
      message: 'Tag definitions deleted successfully',
      data: { deleted: deletedCount },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error with tag definitions operation`, error)
    return c.json({ error: 'Failed to process tag definitions' }, 500)
  }
})

// ---------------------------------------------------------------------------
// Tag Usage: GET /:id/tag-usage
// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge/:id/tag-usage
 * Get usage statistics for all tag definitions.
 */
app.get('/:id/tag-usage', async (c) => {
  const requestId = generateRequestId()
  const knowledgeBaseId = c.req.param('id')

  try {
    logger.info(`[${requestId}] Getting tag usage statistics for knowledge base ${knowledgeBaseId}`)

    const userId = getUserId(c)

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)
    if (!accessCheck.hasAccess) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const usageStats = await getTagUsage(knowledgeBaseId, requestId)

    logger.info(
      `[${requestId}] Retrieved usage statistics for ${usageStats.length} tag definitions`
    )

    return c.json({ success: true, data: usageStats })
  } catch (error) {
    logger.error(`[${requestId}] Error getting tag usage statistics`, error)
    return c.json({ error: 'Failed to get tag usage statistics' }, 500)
  }
})

export { app as knowledgeRoutes }
