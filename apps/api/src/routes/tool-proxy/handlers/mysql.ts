import mysql from 'mysql2/promise'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('MySQLProxyHandler')

/**
 * Shared Zod schema for MySQL connection parameters.
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
 * Creates a MySQL connection with SSL support.
 * The ssl param can be: boolean true (rejectUnauthorized: false),
 * or string 'require'/'prefer'/'verify-full'.
 */
async function createConnection(body: ConnectionInfo): Promise<mysql.Connection> {
  const connectionConfig: mysql.ConnectionOptions = {
    host: body.host,
    port: body.port,
    database: body.database,
    user: body.username,
    password: body.password,
    connectTimeout: 10000,
  }

  if (body.ssl === true || body.ssl === 'require') {
    connectionConfig.ssl = { rejectUnauthorized: true }
  } else if (body.ssl === 'prefer') {
    connectionConfig.ssl = { rejectUnauthorized: false }
  } else if (body.ssl === 'verify-full') {
    connectionConfig.ssl = { rejectUnauthorized: true }
  }

  return mysql.createConnection(connectionConfig)
}

/**
 * Sanitizes a SQL identifier to prevent injection (uses backticks for MySQL).
 */
function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    return identifier.split('.').map(sanitizeSingleIdentifier).join('.')
  }
  return sanitizeSingleIdentifier(identifier)
}

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/`/g, '')
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }
  return `\`${cleaned}\``
}

/**
 * Validates a WHERE clause to prevent SQL injection attacks.
 */
function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke)/i,
    /union\s+(all\s+)?select/i,
    /into\s+outfile/i,
    /into\s+dumpfile/i,
    /load_file\s*\(/i,
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
    /\bbenchmark\s*\(/i,
    /\bwaitfor\s+delay/i,
    /;\s*\w+/,
    /information_schema/i,
    /mysql\./i,
    /\bxp_cmdshell/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}

/**
 * Executes a SELECT query against MySQL.
 */
const handleQuery: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Query is required'),
    params: z.array(z.unknown()).optional(),
  })

  const validated = schema.parse(body)
  const connection = await createConnection(validated)

  try {
    logger.info(
      `[${requestId}] Executing MySQL query on ${validated.host}:${validated.port}/${validated.database}`
    )

    const [rows] = await connection.execute(validated.query, validated.params || [])
    const rowArray = Array.isArray(rows) ? rows : []
    const rowCount = rowArray.length

    logger.info(`[${requestId}] Query executed successfully, returned ${rowCount} rows`)

    return {
      success: true,
      output: {
        rows: rowArray,
        rowCount,
      },
    }
  } finally {
    await connection.end()
  }
}

/**
 * Executes an INSERT/UPDATE/DELETE statement against MySQL.
 */
const handleExecute: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema.extend({
    query: z.string().min(1, 'Query is required'),
    params: z.array(z.unknown()).optional(),
  })

  const validated = schema.parse(body)
  const connection = await createConnection(validated)

  try {
    logger.info(
      `[${requestId}] Executing MySQL statement on ${validated.host}:${validated.port}/${validated.database}`
    )

    const [result] = await connection.execute(validated.query, validated.params || [])

    let rowCount = 0
    let command = validated.query.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN'

    if (Array.isArray(result)) {
      rowCount = result.length
    } else {
      rowCount = (result as mysql.ResultSetHeader).affectedRows || 0
    }

    logger.info(`[${requestId}] Statement executed successfully, ${rowCount} row(s) affected`)

    return {
      success: true,
      output: {
        rowCount,
        command,
      },
    }
  } finally {
    await connection.end()
  }
}

/**
 * Inserts data into a MySQL table using parameterized queries.
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
  const connection = await createConnection(validated)

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
      const placeholders = columns.map(() => '?').join(', ')
      const values = columns.map((col) => record[col])

      const query = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders})`
      const [result] = await connection.execute(query, values)
      const insertId = (result as mysql.ResultSetHeader).insertId

      allRows.push({ ...record, insertId })
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
    await connection.end()
  }
}

/**
 * Deletes rows from a MySQL table with a WHERE clause.
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

  const connection = await createConnection(validated)

  try {
    const sanitizedTable = sanitizeIdentifier(validated.table)
    const query = `DELETE FROM ${sanitizedTable} WHERE ${validated.where}`

    logger.info(
      `[${requestId}] Deleting from ${validated.table} on ${validated.host}:${validated.port}/${validated.database}`
    )

    const [result] = await connection.execute(query, validated.params || [])
    const rowCount = (result as mysql.ResultSetHeader).affectedRows || 0

    logger.info(`[${requestId}] Delete executed successfully, ${rowCount} row(s) deleted`)

    return {
      success: true,
      output: {
        rowCount,
      },
    }
  } finally {
    await connection.end()
  }
}

/**
 * Introspects the MySQL database schema, listing tables and their columns.
 */
const handleIntrospect: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = ConnectionSchema
  const validated = schema.parse(body)
  const connection = await createConnection(validated)

  try {
    logger.info(
      `[${requestId}] Introspecting MySQL schema on ${validated.host}:${validated.port}/${validated.database}`
    )

    const [tablesRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [validated.database]
    )

    const tables: Array<{
      name: string
      database: string
      columns: Array<{
        name: string
        type: string
        nullable: boolean
        default: string | null
      }>
    }> = []

    for (const tableRow of tablesRows) {
      const tableName = tableRow.TABLE_NAME

      const [columnsRows] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [validated.database, tableName]
      )

      const columns = columnsRows.map((col) => ({
        name: col.COLUMN_NAME,
        type: col.COLUMN_TYPE || col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        default: col.COLUMN_DEFAULT,
      }))

      tables.push({
        name: tableName,
        database: validated.database,
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
    await connection.end()
  }
}

export const mysqlHandlers: Record<string, ToolProxyHandler> = {
  'query': handleQuery,
  'execute': handleExecute,
  'insert': handleInsert,
  'delete': handleDelete,
  'introspect': handleIntrospect,
}
