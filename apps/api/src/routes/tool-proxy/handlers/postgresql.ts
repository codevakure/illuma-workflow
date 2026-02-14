import postgres from 'postgres'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('PostgreSQLProxyHandler')

/**
 * Shared Zod schema for PostgreSQL connection parameters.
 */
const ConnectionSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  ssl: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false),
})

type ConnectionInfo = z.infer<typeof ConnectionSchema>

/**
 * Creates a postgres.js connection with SSL support.
 * The ssl param can be: boolean true (rejectUnauthorized: false),
 * or string 'require'/'prefer'/'verify-full'.
 */
async function createConnection(body: ConnectionInfo) {
  let sslConfig: boolean | string | object = false

  if (body.ssl === true) {
    sslConfig = { rejectUnauthorized: false }
  } else if (body.ssl === 'require' || body.ssl === 'prefer' || body.ssl === 'verify-full') {
    sslConfig = body.ssl
  } else if (typeof body.ssl === 'string' && body.ssl !== 'false' && body.ssl !== '') {
    sslConfig = body.ssl
  }

  const sql = postgres({
    host: body.host,
    port: body.port,
    database: body.database,
    username: body.username,
    password: body.password,
    ssl: sslConfig as any,
    connect_timeout: 10,
    max: 1,
  })

  return sql
}

/**
 * Sanitizes a SQL identifier to prevent injection.
 */
function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    return identifier.split('.').map(sanitizeSingleIdentifier).join('.')
  }
  return sanitizeSingleIdentifier(identifier)
}

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/"/g, '')
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }
  return `"${cleaned}"`
}

/**
 * Validates a WHERE clause to prevent SQL injection attacks.
 */
function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke)/i,
    /union\s+(all\s+)?select/i,
    /into\s+outfile/i,
    /load_file\s*\(/i,
    /pg_read_file/i,
    /--/,
    /\/\*/,
    /\*\//,
    /\bor\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\bor\s+true\b/i,
    /\bor\s+false\b/i,
    /\band\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\band\s+true\b/i,
    /\band\s+false\b/i,
    /\bsleep\s*\(/i,
    /\bwaitfor\s+delay/i,
    /\bpg_sleep\s*\(/i,
    /\bbenchmark\s*\(/i,
    /;\s*\w+/,
    /information_schema/i,
    /pg_catalog/i,
    /\bxp_cmdshell/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}

/**
 * Executes a SELECT query against PostgreSQL.
 */
const handleQuery: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Query is required'),
    params: z.array(z.unknown()).optional(),
  })

  const validated = schema.parse(body)
  const sql = await createConnection(validated)

  try {
    logger.info(
      `[${requestId}] Executing PostgreSQL query on ${validated.host}:${validated.port}/${validated.database}`
    )

    const result = await sql.unsafe(validated.query, (validated.params as any[]) || [])
    const rowCount = result.count ?? result.length ?? 0

    logger.info(`[${requestId}] Query executed successfully, returned ${rowCount} rows`)

    return {
      success: true,
      output: {
        rows: Array.isArray(result) ? result : [result],
        rowCount,
      },
    }
  } finally {
    await sql.end()
  }
}

/**
 * Executes an INSERT/UPDATE/DELETE statement against PostgreSQL.
 */
const handleExecute: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Query is required'),
    params: z.array(z.unknown()).optional(),
  })

  const validated = schema.parse(body)
  const sql = await createConnection(validated)

  try {
    logger.info(
      `[${requestId}] Executing PostgreSQL statement on ${validated.host}:${validated.port}/${validated.database}`
    )

    const result = await sql.unsafe(validated.query, (validated.params as any[]) || [])
    const rowCount = result.count ?? result.length ?? 0

    const queryType = validated.query.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN'

    logger.info(`[${requestId}] Statement executed successfully, ${rowCount} row(s) affected`)

    return {
      success: true,
      output: {
        rowCount,
        command: queryType,
      },
    }
  } finally {
    await sql.end()
  }
}

/**
 * Inserts data into a PostgreSQL table using parameterized queries.
 */
const handleInsert: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    table: z.string().min(1, 'Table name is required'),
    data: z.union([
      z
        .record(z.unknown())
        .refine((obj) => Object.keys(obj).length > 0, 'Data object cannot be empty'),
      z.array(
        z
          .record(z.unknown())
          .refine((obj) => Object.keys(obj).length > 0, 'Data object cannot be empty')
      ).min(1, 'Data array cannot be empty'),
      z.string().min(1).transform((str) => {
        const parsed = JSON.parse(str)
        if (Array.isArray(parsed)) return parsed
        if (typeof parsed === 'object' && parsed !== null) return parsed
        throw new Error('Data must be a JSON object or array of objects')
      }),
    ]),
  })

  const validated = schema.parse(body)
  const sql = await createConnection(validated)

  try {
    const dataArray = Array.isArray(validated.data) ? validated.data : [validated.data]
    const sanitizedTable = sanitizeIdentifier(validated.table)
    const allRows: unknown[] = []

    logger.info(
      `[${requestId}] Inserting ${dataArray.length} row(s) into ${validated.table} on ${validated.host}:${validated.port}/${validated.database}`
    )

    for (const row of dataArray) {
      const record = row as Record<string, unknown>
      const columns = Object.keys(record)
      const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
      const placeholders = columns.map((_, index) => `$${index + 1}`)
      const values = columns.map((col) => record[col])

      const query = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
      const result = await sql.unsafe(query, values as any[])
      allRows.push(...(Array.isArray(result) ? result : [result]))
    }

    logger.info(`[${requestId}] Insert executed successfully, ${allRows.length} row(s) inserted`)

    return {
      success: true,
      output: {
        rows: allRows,
        rowCount: allRows.length,
      },
    }
  } finally {
    await sql.end()
  }
}

/**
 * Deletes rows from a PostgreSQL table with a WHERE clause.
 */
const handleDelete: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    table: z.string().min(1, 'Table name is required'),
    where: z.string().min(1, 'WHERE clause is required'),
    params: z.array(z.unknown()).optional(),
  })

  const validated = schema.parse(body)

  validateWhereClause(validated.where)

  const sql = await createConnection(validated)

  try {
    const sanitizedTable = sanitizeIdentifier(validated.table)
    const query = `DELETE FROM ${sanitizedTable} WHERE ${validated.where} RETURNING *`

    logger.info(
      `[${requestId}] Deleting from ${validated.table} on ${validated.host}:${validated.port}/${validated.database}`
    )

    const result = await sql.unsafe(query, (validated.params as any[]) || [])
    const rowCount = result.count ?? result.length ?? 0

    logger.info(`[${requestId}] Delete executed successfully, ${rowCount} row(s) deleted`)

    return {
      success: true,
      output: {
        rowCount,
      },
    }
  } finally {
    await sql.end()
  }
}

/**
 * Introspects the PostgreSQL database schema, listing tables and their columns.
 */
const handleIntrospect: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema
  const validated = schema.parse(body)
  const sql = await createConnection(validated)

  try {
    logger.info(
      `[${requestId}] Introspecting PostgreSQL schema on ${validated.host}:${validated.port}/${validated.database}`
    )

    const tablesResult = await sql`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `

    const tables: Array<{
      name: string
      schema: string
      columns: Array<{
        name: string
        type: string
        nullable: boolean
        default: string | null
      }>
    }> = []

    for (const tableRow of tablesResult) {
      const tableName = tableRow.table_name
      const tableSchema = tableRow.table_schema

      const columnsResult = await sql`
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.column_default,
          c.udt_name
        FROM information_schema.columns c
        WHERE c.table_schema = ${tableSchema}
          AND c.table_name = ${tableName}
        ORDER BY c.ordinal_position
      `

      const columns = (columnsResult as Array<Record<string, unknown>>).map(
        (col) => ({
          name: col.column_name as string,
          type: col.data_type === 'USER-DEFINED' ? (col.udt_name as string) : (col.data_type as string),
          nullable: col.is_nullable === 'YES',
          default: col.column_default as string | null,
        })
      )

      tables.push({
        name: tableName,
        schema: tableSchema,
        columns,
      })
    }

    logger.info(
      `[${requestId}] Introspection completed successfully, found ${tables.length} tables`
    )

    return {
      success: true,
      output: {
        tables,
      },
    }
  } finally {
    await sql.end()
  }
}

export const postgresqlHandlers: Record<string, ToolProxyHandler> = {
  'query': handleQuery,
  'execute': handleExecute,
  'insert': handleInsert,
  'delete': handleDelete,
  'introspect': handleIntrospect,
}
