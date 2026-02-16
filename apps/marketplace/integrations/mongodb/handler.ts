import type { ToolHandler } from '../../sdk/types'

/**
 * Builds a MongoDB connection string from individual params.
 */
function buildConnectionString(params: Record<string, unknown>): string {
  const connectionString = params.connectionString as string | undefined
  if (connectionString) {
    return connectionString
  }

  const host = params.host as string
  const port = params.port ? Number(params.port) : 27017
  const database = params.database as string
  const username = params.username as string | undefined
  const password = params.password as string | undefined
  const authSource = params.authSource as string | undefined
  const ssl = (params.ssl as string) || 'preferred'

  let uri: string
  if (username && password) {
    uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
  } else {
    uri = `mongodb://${host}:${port}/${database}`
  }

  const queryParams: string[] = []
  if (authSource) {
    queryParams.push(`authSource=${encodeURIComponent(authSource)}`)
  }
  if (ssl === 'required') {
    queryParams.push('tls=true')
  } else if (ssl === 'preferred') {
    queryParams.push('tls=true&tlsAllowInvalidCertificates=true')
  }
  if (queryParams.length > 0) {
    uri += `?${queryParams.join('&')}`
  }

  return uri
}

/**
 * Parses a value that may be a JSON string or already an object/array.
 */
function parseJsonParam(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value)
  }
  return value
}

/**
 * Validates collection name to prevent injection.
 */
function validateCollectionName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
    throw new Error(
      'Invalid collection name. Must start with letter or underscore and contain only letters, numbers, underscores, and dots.'
    )
  }
}

const handler: ToolHandler = {
  operations: {
    mongodb_query: async (params) => {
      const { MongoClient } = await import('mongodb')

      const connectionString = buildConnectionString(params)
      const database = params.database as string
      const collection = params.collection as string

      if (!database) {
        return { success: false, output: {}, error: 'Missing required parameter: database' }
      }
      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }

      validateCollectionName(collection)

      const client = new MongoClient(connectionString, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        maxPoolSize: 1,
      })

      try {
        await client.connect()
        const db = client.db(database)
        const coll = db.collection(collection)

        const filter = params.query ? parseJsonParam(params.query) as Record<string, unknown> : {}
        let cursor = coll.find(filter)

        if (params.sort) {
          const sortCriteria = parseJsonParam(params.sort) as Record<string, number>
          if (Object.keys(sortCriteria).length > 0) {
            cursor = cursor.sort(sortCriteria)
          }
        }

        const limit = params.limit ? Number(params.limit) : 100
        cursor = cursor.limit(limit)

        const documents = await cursor.toArray()

        return {
          success: true,
          output: {
            message: 'Query executed successfully',
            documents,
            documentCount: documents.length,
          },
        }
      } finally {
        await client.close()
      }
    },

    mongodb_insert: async (params) => {
      const { MongoClient } = await import('mongodb')

      const connectionString = buildConnectionString(params)
      const database = params.database as string
      const collection = params.collection as string

      if (!database) {
        return { success: false, output: {}, error: 'Missing required parameter: database' }
      }
      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }

      validateCollectionName(collection)

      let documents: Record<string, unknown>[]
      if (typeof params.documents === 'string') {
        const parsed = JSON.parse(params.documents as string)
        documents = Array.isArray(parsed) ? parsed : [parsed]
      } else if (Array.isArray(params.documents)) {
        documents = params.documents as Record<string, unknown>[]
      } else {
        return { success: false, output: {}, error: 'Missing required parameter: documents' }
      }

      const client = new MongoClient(connectionString, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        maxPoolSize: 1,
      })

      try {
        await client.connect()
        const db = client.db(database)
        const coll = db.collection(collection)

        if (documents.length === 1) {
          const result = await coll.insertOne(documents[0])
          return {
            success: true,
            output: {
              message: 'Document inserted successfully',
              documentCount: 1,
              insertedId: result.insertedId.toString(),
            },
          }
        }

        const result = await coll.insertMany(documents)
        const insertedCount = Object.keys(result.insertedIds).length

        return {
          success: true,
          output: {
            message: `${insertedCount} documents inserted successfully`,
            documentCount: insertedCount,
            insertedIds: Object.values(result.insertedIds).map((id) => id.toString()),
          },
        }
      } finally {
        await client.close()
      }
    },

    mongodb_update: async (params) => {
      const { MongoClient } = await import('mongodb')

      const connectionString = buildConnectionString(params)
      const database = params.database as string
      const collection = params.collection as string
      const filterRaw = params.filter
      const updateRaw = params.update

      if (!database) {
        return { success: false, output: {}, error: 'Missing required parameter: database' }
      }
      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }
      if (!filterRaw) {
        return { success: false, output: {}, error: 'Missing required parameter: filter' }
      }
      if (!updateRaw) {
        return { success: false, output: {}, error: 'Missing required parameter: update' }
      }

      validateCollectionName(collection)

      const filterDoc = parseJsonParam(filterRaw) as Record<string, unknown>
      const updateDoc = parseJsonParam(updateRaw) as Record<string, unknown>

      const client = new MongoClient(connectionString, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        maxPoolSize: 1,
      })

      try {
        await client.connect()
        const db = client.db(database)
        const coll = db.collection(collection)

        const result = await coll.updateMany(filterDoc, updateDoc)

        return {
          success: true,
          output: {
            message: 'Documents updated successfully',
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            documentCount: result.modifiedCount,
          },
        }
      } finally {
        await client.close()
      }
    },

    mongodb_delete: async (params) => {
      const { MongoClient } = await import('mongodb')

      const connectionString = buildConnectionString(params)
      const database = params.database as string
      const collection = params.collection as string
      const filterRaw = params.filter

      if (!database) {
        return { success: false, output: {}, error: 'Missing required parameter: database' }
      }
      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }
      if (!filterRaw) {
        return { success: false, output: {}, error: 'Missing required parameter: filter' }
      }

      validateCollectionName(collection)

      const filterDoc = parseJsonParam(filterRaw) as Record<string, unknown>

      const client = new MongoClient(connectionString, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        maxPoolSize: 1,
      })

      try {
        await client.connect()
        const db = client.db(database)
        const coll = db.collection(collection)

        const result = await coll.deleteMany(filterDoc)

        return {
          success: true,
          output: {
            message: 'Documents deleted successfully',
            deletedCount: result.deletedCount,
            documentCount: result.deletedCount,
          },
        }
      } finally {
        await client.close()
      }
    },

    mongodb_execute: async (params) => {
      const { MongoClient } = await import('mongodb')

      const connectionString = buildConnectionString(params)
      const database = params.database as string
      const collection = params.collection as string
      const pipelineRaw = params.pipeline

      if (!database) {
        return { success: false, output: {}, error: 'Missing required parameter: database' }
      }
      if (!collection) {
        return { success: false, output: {}, error: 'Missing required parameter: collection' }
      }
      if (!pipelineRaw) {
        return { success: false, output: {}, error: 'Missing required parameter: pipeline' }
      }

      validateCollectionName(collection)

      let pipeline: Record<string, unknown>[]
      if (typeof pipelineRaw === 'string') {
        const parsed = JSON.parse(pipelineRaw)
        if (!Array.isArray(parsed)) {
          return { success: false, output: {}, error: 'Pipeline must be an array' }
        }
        pipeline = parsed
      } else if (Array.isArray(pipelineRaw)) {
        pipeline = pipelineRaw as Record<string, unknown>[]
      } else {
        return { success: false, output: {}, error: 'Pipeline must be a JSON array' }
      }

      const client = new MongoClient(connectionString, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        maxPoolSize: 1,
      })

      try {
        await client.connect()
        const db = client.db(database)
        const coll = db.collection(collection)

        const cursor = coll.aggregate(pipeline)
        const documents = await cursor.toArray()

        return {
          success: true,
          output: {
            message: 'Aggregation executed successfully',
            documents,
            documentCount: documents.length,
          },
        }
      } finally {
        await client.close()
      }
    },

    mongodb_introspect: async (params) => {
      const { MongoClient } = await import('mongodb')

      const connectionString = buildConnectionString(params)
      const database = params.database as string

      if (!database) {
        return { success: false, output: {}, error: 'Missing required parameter: database' }
      }

      const client = new MongoClient(connectionString, {
        connectTimeoutMS: 10000,
        socketTimeoutMS: 10000,
        maxPoolSize: 1,
      })

      try {
        await client.connect()
        const db = client.db(database)
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

        return {
          success: true,
          output: {
            message: `Introspection completed, found ${collections.length} collections`,
            collections,
          },
        }
      } finally {
        await client.close()
      }
    },
  },
}

export default handler
