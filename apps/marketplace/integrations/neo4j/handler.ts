import type { ToolHandler } from '../../sdk/types'

/**
 * Converts Neo4j native types (Integer, Node, Relationship, Path) to plain JSON-safe objects.
 */
function convertNeo4jTypesToJSON(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber()
  }

  if (Array.isArray(value)) {
    return value.map(convertNeo4jTypesToJSON)
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>

    if (obj.labels && obj.properties && obj.identity) {
      return {
        identity: (obj.identity as { toNumber?: () => number }).toNumber
          ? (obj.identity as { toNumber: () => number }).toNumber()
          : obj.identity,
        labels: obj.labels,
        properties: convertNeo4jTypesToJSON(obj.properties),
      }
    }

    if (obj.type && obj.properties && obj.identity && obj.start && obj.end) {
      return {
        identity: (obj.identity as { toNumber?: () => number }).toNumber
          ? (obj.identity as { toNumber: () => number }).toNumber()
          : obj.identity,
        start: (obj.start as { toNumber?: () => number }).toNumber
          ? (obj.start as { toNumber: () => number }).toNumber()
          : obj.start,
        end: (obj.end as { toNumber?: () => number }).toNumber
          ? (obj.end as { toNumber: () => number }).toNumber()
          : obj.end,
        type: obj.type,
        properties: convertNeo4jTypesToJSON(obj.properties),
      }
    }

    if (obj.start && obj.end && obj.segments) {
      return {
        start: convertNeo4jTypesToJSON(obj.start),
        end: convertNeo4jTypesToJSON(obj.end),
        segments: (obj.segments as Array<Record<string, unknown>>).map((seg) => ({
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
function extractRecords(result: Record<string, unknown>): Record<string, unknown>[] {
  const records = result.records as Array<{ keys: string[]; get: (key: string) => unknown }>
  return records.map((record) => {
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
 * Extracts summary counters from a Neo4j result.
 */
function extractSummary(result: Record<string, unknown>) {
  const summary = result.summary as Record<string, unknown>
  const counters = summary.counters as { updates: () => Record<string, number> }
  const updates = counters.updates()
  const resultAvailableAfter = summary.resultAvailableAfter as { toNumber?: () => number }
  const resultConsumedAfter = summary.resultConsumedAfter as { toNumber?: () => number }

  return {
    resultAvailableAfter: resultAvailableAfter.toNumber ? resultAvailableAfter.toNumber() : resultAvailableAfter,
    resultConsumedAfter: resultConsumedAfter.toNumber ? resultConsumedAfter.toNumber() : resultConsumedAfter,
    counters: {
      nodesCreated: updates.nodesCreated,
      nodesDeleted: updates.nodesDeleted,
      relationshipsCreated: updates.relationshipsCreated,
      relationshipsDeleted: updates.relationshipsDeleted,
      propertiesSet: updates.propertiesSet,
      labelsAdded: updates.labelsAdded,
      labelsRemoved: updates.labelsRemoved,
      indexesAdded: updates.indexesAdded,
      indexesRemoved: updates.indexesRemoved,
      constraintsAdded: updates.constraintsAdded,
      constraintsRemoved: updates.constraintsRemoved,
    },
  }
}

/**
 * Creates a Neo4j driver and session.
 */
async function createDriverAndSession(
  params: Record<string, unknown>,
  mode: 'READ' | 'WRITE' = 'READ'
) {
  const neo4j = (await import('neo4j-driver')).default

  const uri = params.uri as string
  const username = params.username as string
  const password = params.password as string
  const database = params.database as string | undefined

  const driver = neo4j.driver(
    uri,
    neo4j.auth.basic(username, password),
    {
      maxConnectionPoolSize: 1,
      connectionTimeout: 10000,
    }
  )

  await driver.verifyConnectivity()

  const sessionConfig: { database?: string; defaultAccessMode?: unknown } = {}
  if (database) {
    sessionConfig.database = database
  }
  sessionConfig.defaultAccessMode = mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE

  const session = driver.session(sessionConfig)

  return { driver, session }
}

/**
 * Runs a Cypher query in the given mode and returns records + summary.
 */
async function runCypherQuery(params: Record<string, unknown>, mode: 'READ' | 'WRITE') {
  const query = params.query as string
  if (!query) {
    return { success: false, output: {}, error: 'Missing required parameter: query' }
  }

  const queryParams = (params.params as Record<string, unknown>) || {}
  const { driver, session } = await createDriverAndSession(params, mode)

  try {
    const result = await session.run(query, queryParams)
    const records = extractRecords(result as unknown as Record<string, unknown>)
    const summary = extractSummary(result as unknown as Record<string, unknown>)

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

const handler: ToolHandler = {
  operations: {
    neo4j_query: async (params) => {
      return runCypherQuery(params, 'READ')
    },

    neo4j_create: async (params) => {
      return runCypherQuery(params, 'WRITE')
    },

    neo4j_update: async (params) => {
      return runCypherQuery(params, 'WRITE')
    },

    neo4j_delete: async (params) => {
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const queryParams = (params.params as Record<string, unknown>) || {}
      const { driver, session } = await createDriverAndSession(params, 'WRITE')

      try {
        const result = await session.run(query, queryParams)
        const summary = extractSummary(result as unknown as Record<string, unknown>)

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
    },

    neo4j_execute: async (params) => {
      return runCypherQuery(params, 'WRITE')
    },

    neo4j_merge: async (params) => {
      return runCypherQuery(params, 'WRITE')
    },

    neo4j_introspect: async (params) => {
      const { driver, session } = await createDriverAndSession(params, 'READ')

      try {
        const labelsResult = await session.run(
          'CALL db.labels() YIELD label RETURN label ORDER BY label'
        )
        const labels: string[] = labelsResult.records.map(
          (record: { get: (key: string) => string }) => record.get('label')
        )

        const relationshipTypesResult = await session.run(
          'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType'
        )
        const relationshipTypes: string[] = relationshipTypesResult.records.map(
          (record: { get: (key: string) => string }) => record.get('relationshipType')
        )

        let schemaVisualization: unknown = null
        try {
          const schemaResult = await session.run('CALL db.schema.visualization()')
          schemaVisualization = schemaResult.records.map((record: { keys: string[]; get: (key: string) => unknown }) => {
            const obj: Record<string, unknown> = {}
            record.keys.forEach((key) => {
              if (typeof key === 'string') {
                obj[key] = convertNeo4jTypesToJSON(record.get(key))
              }
            })
            return obj
          })
        } catch {
          // Schema visualization may not be supported on all editions
        }

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
    },
  },
}

export default handler
