import { MongoClient } from 'mongodb'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MongoDBProxyHandler')

/**
 * Creates a MongoClient from a connection string and connects.
 */
async function createConnection(connectionString: string): Promise<MongoClient> {
  const client = new MongoClient(connectionString, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    maxPoolSize: 1,
  })

  await client.connect()
  return client
}

/**
 * Parses a filter that may be a JSON string or an object.
 */
function parseFilter(filter: unknown): Record<string, unknown> {
  if (typeof filter === 'string') {
    return JSON.parse(filter)
  }
  if (typeof filter === 'object' && filter !== null) {
    return filter as Record<string, unknown>
  }
  return {}
}

/**
 * Sanitizes a collection name to prevent injection.
 */
function sanitizeCollectionName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
    throw new Error(
      'Invalid collection name. Must start with letter or underscore and contain only letters, numbers, underscores, and dots.'
    )
  }
  return name
}

/**
 * Queries documents from a MongoDB collection with optional filter, sort, and limit.
 */
const handleQuery: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    connectionString: z.string().min(1, 'Connection string is required'),
    database: z.string().min(1, 'Database name is required'),
    collection: z.string().min(1, 'Collection name is required'),
    filter: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
    sort: z.union([z.string(), z.record(z.unknown())]).optional(),
    limit: z.coerce.number().int().positive().optional().default(100),
  })

  const validated = schema.parse(body)
  const client = await createConnection(validated.connectionString)

  try {
    const sanitizedCollection = sanitizeCollectionName(validated.collection)
    const filter = parseFilter(validated.filter)

    logger.info(
      `[${requestId}] Querying MongoDB ${validated.database}.${sanitizedCollection}`
    )

    const db = client.db(validated.database)
    const coll = db.collection(sanitizedCollection)

    let cursor = coll.find(filter)

    if (validated.sort) {
      const sortCriteria = typeof validated.sort === 'string'
        ? JSON.parse(validated.sort)
        : validated.sort
      if (Object.keys(sortCriteria).length > 0) {
        cursor = cursor.sort(sortCriteria)
      }
    }

    cursor = cursor.limit(validated.limit)
    const documents = await cursor.toArray()

    logger.info(
      `[${requestId}] Query executed successfully, returned ${documents.length} documents`
    )

    return {
      success: true,
      output: {
        documents,
        count: documents.length,
      },
    }
  } finally {
    await client.close()
  }
}

/**
 * Inserts one or many documents into a MongoDB collection.
 */
const handleInsert: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    connectionString: z.string().min(1, 'Connection string is required'),
    database: z.string().min(1, 'Database name is required'),
    collection: z.string().min(1, 'Collection name is required'),
    documents: z.union([
      z.array(z.record(z.unknown())),
      z.record(z.unknown()),
      z.string().min(1).transform((str) => {
        const parsed = JSON.parse(str)
        return Array.isArray(parsed) ? parsed : [parsed]
      }),
    ]).transform((val) => {
      if (Array.isArray(val)) return val
      return [val]
    }),
  })

  const validated = schema.parse(body)
  const client = await createConnection(validated.connectionString)

  try {
    const sanitizedCollection = sanitizeCollectionName(validated.collection)

    logger.info(
      `[${requestId}] Inserting ${validated.documents.length} document(s) into ${validated.database}.${sanitizedCollection}`
    )

    const db = client.db(validated.database)
    const coll = db.collection(sanitizedCollection)

    if (validated.documents.length === 1) {
      const result = await coll.insertOne(validated.documents[0] as Record<string, unknown>)

      logger.info(`[${requestId}] Single document inserted successfully`)

      return {
        success: true,
        output: {
          insertedId: result.insertedId.toString(),
          count: 1,
        },
      }
    }

    const result = await coll.insertMany(validated.documents as Record<string, unknown>[])
    const insertedCount = Object.keys(result.insertedIds).length

    logger.info(`[${requestId}] ${insertedCount} documents inserted successfully`)

    return {
      success: true,
      output: {
        insertedIds: Object.values(result.insertedIds).map((id) => id.toString()),
        count: insertedCount,
      },
    }
  } finally {
    await client.close()
  }
}

/**
 * Updates documents in a MongoDB collection matching a filter.
 */
const handleUpdate: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    connectionString: z.string().min(1, 'Connection string is required'),
    database: z.string().min(1, 'Database name is required'),
    collection: z.string().min(1, 'Collection name is required'),
    filter: z.union([z.string(), z.record(z.unknown())]),
    update: z.union([z.string(), z.record(z.unknown())]),
  })

  const validated = schema.parse(body)
  const client = await createConnection(validated.connectionString)

  try {
    const sanitizedCollection = sanitizeCollectionName(validated.collection)
    const filterDoc = parseFilter(validated.filter)
    const updateDoc = typeof validated.update === 'string'
      ? JSON.parse(validated.update)
      : validated.update

    logger.info(
      `[${requestId}] Updating documents in ${validated.database}.${sanitizedCollection}`
    )

    const db = client.db(validated.database)
    const coll = db.collection(sanitizedCollection)

    const result = await coll.updateMany(filterDoc, updateDoc)

    logger.info(
      `[${requestId}] Update completed: ${result.modifiedCount} modified, ${result.matchedCount} matched`
    )

    return {
      success: true,
      output: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      },
    }
  } finally {
    await client.close()
  }
}

/**
 * Deletes documents from a MongoDB collection matching a filter.
 */
const handleDelete: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    connectionString: z.string().min(1, 'Connection string is required'),
    database: z.string().min(1, 'Database name is required'),
    collection: z.string().min(1, 'Collection name is required'),
    filter: z.union([z.string(), z.record(z.unknown())]),
  })

  const validated = schema.parse(body)
  const client = await createConnection(validated.connectionString)

  try {
    const sanitizedCollection = sanitizeCollectionName(validated.collection)
    const filterDoc = parseFilter(validated.filter)

    logger.info(
      `[${requestId}] Deleting documents from ${validated.database}.${sanitizedCollection}`
    )

    const db = client.db(validated.database)
    const coll = db.collection(sanitizedCollection)

    const result = await coll.deleteMany(filterDoc)

    logger.info(`[${requestId}] Delete completed: ${result.deletedCount} documents deleted`)

    return {
      success: true,
      output: {
        deletedCount: result.deletedCount,
      },
    }
  } finally {
    await client.close()
  }
}

/**
 * Executes an aggregation pipeline on a MongoDB collection.
 */
const handleExecute: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    connectionString: z.string().min(1, 'Connection string is required'),
    database: z.string().min(1, 'Database name is required'),
    collection: z.string().min(1, 'Collection name is required'),
    pipeline: z.union([
      z.array(z.record(z.unknown())),
      z.string().min(1).transform((str) => {
        const parsed = JSON.parse(str)
        if (!Array.isArray(parsed)) {
          throw new Error('Pipeline must be an array')
        }
        return parsed
      }),
    ]),
  })

  const validated = schema.parse(body)
  const client = await createConnection(validated.connectionString)

  try {
    const sanitizedCollection = sanitizeCollectionName(validated.collection)

    logger.info(
      `[${requestId}] Executing aggregation pipeline on ${validated.database}.${sanitizedCollection}`
    )

    const db = client.db(validated.database)
    const coll = db.collection(sanitizedCollection)

    const cursor = coll.aggregate(validated.pipeline as Record<string, unknown>[])
    const documents = await cursor.toArray()

    logger.info(
      `[${requestId}] Aggregation completed successfully, returned ${documents.length} documents`
    )

    return {
      success: true,
      output: {
        documents,
        count: documents.length,
      },
    }
  } finally {
    await client.close()
  }
}

/**
 * Introspects a MongoDB database, listing collections with sample field info.
 */
const handleIntrospect: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    connectionString: z.string().min(1, 'Connection string is required'),
    database: z.string().min(1, 'Database name is required'),
  })

  const validated = schema.parse(body)
  const client = await createConnection(validated.connectionString)

  try {
    logger.info(
      `[${requestId}] Introspecting MongoDB database ${validated.database}`
    )

    const db = client.db(validated.database)
    const collectionList = await db.listCollections().toArray()

    const collections: Array<{
      name: string
      type: string
      fields: Array<{ name: string; type: string }>
    }> = []

    for (const collInfo of collectionList) {
      const coll = db.collection(collInfo.name)
      const sampleDoc = await coll.findOne()

      const fields: Array<{ name: string; type: string }> = []
      if (sampleDoc) {
        for (const [key, value] of Object.entries(sampleDoc)) {
          fields.push({
            name: key,
            type: Array.isArray(value) ? 'array' : typeof value,
          })
        }
      }

      collections.push({
        name: collInfo.name,
        type: collInfo.type || 'collection',
        fields,
      })
    }

    logger.info(
      `[${requestId}] Introspection completed, found ${collections.length} collections`
    )

    return {
      success: true,
      output: {
        collections,
      },
    }
  } finally {
    await client.close()
  }
}

export const mongodbHandlers: Record<string, ToolProxyHandler> = {
  'query': handleQuery,
  'insert': handleInsert,
  'update': handleUpdate,
  'delete': handleDelete,
  'execute': handleExecute,
  'introspect': handleIntrospect,
}
