import neo4j from 'neo4j-driver'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('Neo4jProxyHandler')

/**
 * Shared Zod schema for Neo4j connection parameters.
 */
const ConnectionSchema = z.object({
  uri: z.string().min(1, 'URI is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  database: z.string().optional(),
})

type ConnectionInfo = z.infer<typeof ConnectionSchema>

/**
 * Creates a Neo4j driver and verifies connectivity.
 */
async function createDriverAndSession(
  info: ConnectionInfo,
  mode: 'READ' | 'WRITE' = 'READ'
) {
  const driver = neo4j.driver(
    info.uri,
    neo4j.auth.basic(info.username, info.password),
    {
      maxConnectionPoolSize: 1,
      connectionTimeout: 10000,
    }
  )

  await driver.verifyConnectivity()

  const sessionConfig: { database?: string; defaultAccessMode?: any } = {}
  if (info.database) {
    sessionConfig.database = info.database
  }
  sessionConfig.defaultAccessMode = mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE

  const session = driver.session(sessionConfig)

  return { driver, session }
}

/**
 * Converts Neo4j native types (Integer, Node, Relationship, Path) to plain JSON-safe objects.
 */
function convertNeo4jTypesToJSON(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as any).toNumber()
  }

  if (Array.isArray(value)) {
    return value.map(convertNeo4jTypesToJSON)
  }

  if (typeof value === 'object') {
    const obj = value as any

    if (obj.labels && obj.properties && obj.identity) {
      return {
        identity: obj.identity.toNumber ? obj.identity.toNumber() : obj.identity,
        labels: obj.labels,
        properties: convertNeo4jTypesToJSON(obj.properties),
      }
    }

    if (obj.type && obj.properties && obj.identity && obj.start && obj.end) {
      return {
        identity: obj.identity.toNumber ? obj.identity.toNumber() : obj.identity,
        start: obj.start.toNumber ? obj.start.toNumber() : obj.start,
        end: obj.end.toNumber ? obj.end.toNumber() : obj.end,
        type: obj.type,
        properties: convertNeo4jTypesToJSON(obj.properties),
      }
    }

    if (obj.start && obj.end && obj.segments) {
      return {
        start: convertNeo4jTypesToJSON(obj.start),
        end: convertNeo4jTypesToJSON(obj.end),
        segments: obj.segments.map((seg: any) => ({
          start: convertNeo4jTypesToJSON(seg.start),
          relationship: convertNeo4jTypesToJSON(seg.relationship),
          end: convertNeo4jTypesToJSON(seg.end),
        })),
        length: obj.length,
      }
    }

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      result[key] = convertNeo4jTypesToJSON(val)
    }
    return result
  }

  return value
}

/**
 * Extracts records from a Neo4j result into plain objects.
 */
function extractRecords(result: any): Record<string, unknown>[] {
  return result.records.map((record: any) => {
    const obj: Record<string, unknown> = {}
    record.keys.forEach((key: string) => {
      if (typeof key === 'string') {
        obj[key] = convertNeo4jTypesToJSON(record.get(key))
      }
    })
    return obj
  })
}

/**
 * Extracts a summary counters object from a Neo4j result.
 */
function extractSummary(result: any) {
  return {
    resultAvailableAfter: result.summary.resultAvailableAfter.toNumber(),
    resultConsumedAfter: result.summary.resultConsumedAfter.toNumber(),
    counters: {
      nodesCreated: result.summary.counters.updates().nodesCreated,
      nodesDeleted: result.summary.counters.updates().nodesDeleted,
      relationshipsCreated: result.summary.counters.updates().relationshipsCreated,
      relationshipsDeleted: result.summary.counters.updates().relationshipsDeleted,
      propertiesSet: result.summary.counters.updates().propertiesSet,
      labelsAdded: result.summary.counters.updates().labelsAdded,
      labelsRemoved: result.summary.counters.updates().labelsRemoved,
      indexesAdded: result.summary.counters.updates().indexesAdded,
      indexesRemoved: result.summary.counters.updates().indexesRemoved,
      constraintsAdded: result.summary.counters.updates().constraintsAdded,
      constraintsRemoved: result.summary.counters.updates().constraintsRemoved,
    },
  }
}

/**
 * Executes a read-mode Cypher query against Neo4j.
 */
const handleQuery: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Cypher query is required'),
    params: z.record(z.unknown()).nullable().optional().default({}),
  })

  const validated = schema.parse(body)
  const { driver, session } = await createDriverAndSession(validated, 'READ')

  try {
    logger.info(`[${requestId}] Executing Neo4j read query on ${validated.uri}`)

    const result = await session.run(validated.query, validated.params || {})
    const records = extractRecords(result)
    const summary = extractSummary(result)

    logger.info(`[${requestId}] Query executed successfully, returned ${records.length} records`)

    return {
      success: true,
      output: {
        records,
        summary,
      },
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

/**
 * Executes a write-mode CREATE Cypher query against Neo4j.
 */
const handleCreate: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Cypher query is required'),
    params: z.record(z.unknown()).nullable().optional().default({}),
  })

  const validated = schema.parse(body)
  const { driver, session } = await createDriverAndSession(validated, 'WRITE')

  try {
    logger.info(`[${requestId}] Executing Neo4j CREATE on ${validated.uri}`)

    const result = await session.run(validated.query, validated.params || {})
    const records = extractRecords(result)
    const summary = extractSummary(result)

    logger.info(
      `[${requestId}] Create executed successfully, created ${summary.counters.nodesCreated} nodes and ${summary.counters.relationshipsCreated} relationships`
    )

    return {
      success: true,
      output: {
        records,
        summary,
      },
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

/**
 * Executes a write-mode SET/MERGE update Cypher query against Neo4j.
 */
const handleUpdate: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Cypher query is required'),
    params: z.record(z.unknown()).nullable().optional().default({}),
  })

  const validated = schema.parse(body)
  const { driver, session } = await createDriverAndSession(validated, 'WRITE')

  try {
    logger.info(`[${requestId}] Executing Neo4j UPDATE on ${validated.uri}`)

    const result = await session.run(validated.query, validated.params || {})
    const records = extractRecords(result)
    const summary = extractSummary(result)

    logger.info(
      `[${requestId}] Update executed successfully, ${summary.counters.propertiesSet} properties set`
    )

    return {
      success: true,
      output: {
        records,
        summary,
      },
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

/**
 * Executes a write-mode DELETE Cypher query against Neo4j.
 */
const handleDelete: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Cypher query is required'),
    params: z.record(z.unknown()).nullable().optional().default({}),
  })

  const validated = schema.parse(body)
  const { driver, session } = await createDriverAndSession(validated, 'WRITE')

  try {
    logger.info(`[${requestId}] Executing Neo4j DELETE on ${validated.uri}`)

    const result = await session.run(validated.query, validated.params || {})
    const summary = extractSummary(result)

    logger.info(
      `[${requestId}] Delete executed successfully, deleted ${summary.counters.nodesDeleted} nodes and ${summary.counters.relationshipsDeleted} relationships`
    )

    return {
      success: true,
      output: {
        nodesDeleted: summary.counters.nodesDeleted,
        relationshipsDeleted: summary.counters.relationshipsDeleted,
      },
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

/**
 * Executes an arbitrary write-mode Cypher query against Neo4j.
 */
const handleExecute: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Cypher query is required'),
    params: z.record(z.unknown()).nullable().optional().default({}),
  })

  const validated = schema.parse(body)
  const { driver, session } = await createDriverAndSession(validated, 'WRITE')

  try {
    logger.info(`[${requestId}] Executing Neo4j query on ${validated.uri}`)

    const result = await session.run(validated.query, validated.params || {})
    const records = extractRecords(result)
    const summary = extractSummary(result)

    logger.info(`[${requestId}] Query executed successfully, returned ${records.length} records`)

    return {
      success: true,
      output: {
        records,
        summary,
      },
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

/**
 * Executes a write-mode MERGE Cypher query against Neo4j.
 */
const handleMerge: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Cypher query is required'),
    params: z.record(z.unknown()).nullable().optional().default({}),
  })

  const validated = schema.parse(body)
  const { driver, session } = await createDriverAndSession(validated, 'WRITE')

  try {
    logger.info(`[${requestId}] Executing Neo4j MERGE on ${validated.uri}`)

    const result = await session.run(validated.query, validated.params || {})
    const records = extractRecords(result)
    const summary = extractSummary(result)

    logger.info(
      `[${requestId}] Merge executed successfully, created ${summary.counters.nodesCreated} nodes, ${summary.counters.relationshipsCreated} relationships`
    )

    return {
      success: true,
      output: {
        records,
        summary,
      },
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

/**
 * Introspects a Neo4j database, returning labels, relationship types, and schema.
 */
const handleIntrospect: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema
  const validated = schema.parse(body)
  const { driver, session } = await createDriverAndSession(validated, 'READ')

  try {
    logger.info(`[${requestId}] Introspecting Neo4j database at ${validated.uri}`)

    const labelsResult = await session.run(
      'CALL db.labels() YIELD label RETURN label ORDER BY label'
    )
    const labels: string[] = labelsResult.records.map(
      (record) => record.get('label') as string
    )

    const relationshipTypesResult = await session.run(
      'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType'
    )
    const relationshipTypes: string[] = relationshipTypesResult.records.map(
      (record) => record.get('relationshipType') as string
    )

    let schemaVisualization: unknown = null
    try {
      const schemaResult = await session.run('CALL db.schema.visualization()')
      schemaVisualization = schemaResult.records.map((record) => {
        const obj: Record<string, unknown> = {}
        record.keys.forEach((key) => {
          if (typeof key === 'string') {
            obj[key] = convertNeo4jTypesToJSON(record.get(key))
          }
        })
        return obj
      })
    } catch (schemaError) {
      logger.warn(
        `[${requestId}] Could not fetch schema visualization (may not be supported): ${schemaError}`
      )
    }

    logger.info(
      `[${requestId}] Introspection completed: ${labels.length} labels, ${relationshipTypes.length} relationship types`
    )

    return {
      success: true,
      output: {
        labels,
        relationshipTypes,
        schema: schemaVisualization,
      },
    }
  } finally {
    await session.close()
    await driver.close()
  }
}

export const neo4jHandlers: Record<string, ToolProxyHandler> = {
  'query': handleQuery,
  'create': handleCreate,
  'update': handleUpdate,
  'delete': handleDelete,
  'execute': handleExecute,
  'merge': handleMerge,
  'introspect': handleIntrospect,
}
