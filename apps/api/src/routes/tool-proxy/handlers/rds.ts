import {
  ExecuteStatementCommand,
  type ExecuteStatementCommandOutput,
  type Field,
  RDSDataClient,
  type SqlParameter,
} from '@aws-sdk/client-rds-data'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('RDSProxyHandler')

interface RDSClientConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Creates an RDS Data API client from the provided configuration.
 */
function createRdsClient(config: RDSClientConfig): RDSDataClient {
  return new RDSDataClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/**
 * Parses a single RDS Data API field value into a native JS type.
 */
function parseFieldValue(field: Field): unknown {
  if (field.isNull) return null
  if (field.stringValue !== undefined) return field.stringValue
  if (field.longValue !== undefined) return field.longValue
  if (field.doubleValue !== undefined) return field.doubleValue
  if (field.booleanValue !== undefined) return field.booleanValue
  if (field.blobValue !== undefined) return Buffer.from(field.blobValue).toString('base64')
  if (field.arrayValue !== undefined) {
    const arr = field.arrayValue
    if (arr.stringValues) return arr.stringValues
    if (arr.longValues) return arr.longValues
    if (arr.doubleValues) return arr.doubleValues
    if (arr.booleanValues) return arr.booleanValues
    if (arr.arrayValues) return arr.arrayValues.map((f) => parseFieldValue({ arrayValue: f }))
    return []
  }
  return null
}

/**
 * Parses an RDS Data API response into an array of row objects.
 */
function parseRdsResponse(response: ExecuteStatementCommandOutput): Record<string, unknown>[] {
  if (!response.records || !response.columnMetadata) {
    return []
  }

  const columnNames = response.columnMetadata.map((col) => col.name || col.label || 'unknown')

  return response.records.map((record) => {
    const row: Record<string, unknown> = {}
    record.forEach((field, index) => {
      const columnName = columnNames[index] || `column_${index}`
      row[columnName] = parseFieldValue(field)
    })
    return row
  })
}

/**
 * Executes a SQL statement via the RDS Data API.
 */
async function executeStatement(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  sql: string,
  parameters?: SqlParameter[]
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const command = new ExecuteStatementCommand({
    resourceArn,
    secretArn,
    ...(database && { database }),
    sql,
    ...(parameters && parameters.length > 0 && { parameters }),
    includeResultMetadata: true,
  })

  const response = await client.send(command)
  const rows = parseRdsResponse(response)

  return {
    rows,
    rowCount: response.numberOfRecordsUpdated ?? rows.length,
  }
}

/**
 * Sanitizes a single SQL identifier to prevent injection.
 */
function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/`/g, '').replace(/"/g, '')

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  return cleaned
}

/**
 * Sanitizes a SQL identifier, supporting dotted notation for schema.table.
 */
function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    const parts = identifier.split('.')
    return parts.map((part) => sanitizeSingleIdentifier(part)).join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

/**
 * Converts a JS value to an RDS Data API SqlParameter value.
 */
function toSqlParameterValue(value: unknown): SqlParameter['value'] {
  if (value === null || value === undefined) {
    return { isNull: true }
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value }
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { longValue: value }
    }
    return { doubleValue: value }
  }
  if (typeof value === 'string') {
    return { stringValue: value }
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { blobValue: value }
  }
  return { stringValue: JSON.stringify(value) }
}

/**
 * Validates that a SQL query uses only allowed statement types.
 */
function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim().toLowerCase()

  const allowedStatements = /^(select|insert|update|delete|with|explain|show)\s+/i
  if (!allowedStatements.test(trimmedQuery)) {
    return {
      isValid: false,
      error: 'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, and SHOW statements are allowed',
    }
  }

  return { isValid: true }
}

const baseSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
})

/**
 * Executes a validated SQL query via the RDS Data API.
 */
const handleQuery: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    query: z.string().min(1, 'Query is required'),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Executing RDS query on ${params.database || '(default)'}`)

  const validation = validateQuery(params.query)
  if (!validation.isValid) {
    logger.warn(`[${requestId}] Query validation failed: ${validation.error}`)
    return { success: false, output: {}, error: validation.error }
  }

  const client = createRdsClient(params)

  try {
    const result = await executeStatement(
      client,
      params.resourceArn,
      params.secretArn,
      params.database,
      params.query
    )

    logger.info(`[${requestId}] Query executed successfully, returned ${result.rowCount} rows`)

    return {
      success: true,
      output: {
        records: result.rows,
        numberOfRecordsUpdated: result.rowCount,
      },
    }
  } finally {
    client.destroy()
  }
}

/**
 * Executes a raw SQL statement via the RDS Data API without validation.
 */
const handleExecute: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    query: z.string().min(1, 'Query is required'),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Executing raw SQL on RDS database ${params.database || '(default)'}`)

  const client = createRdsClient(params)

  try {
    const result = await executeStatement(
      client,
      params.resourceArn,
      params.secretArn,
      params.database,
      params.query
    )

    logger.info(`[${requestId}] Execute completed successfully, affected ${result.rowCount} rows`)

    return {
      success: true,
      output: {
        records: result.rows,
        numberOfRecordsUpdated: result.rowCount,
      },
    }
  } finally {
    client.destroy()
  }
}

/**
 * Builds and executes a parameterized INSERT statement via the RDS Data API.
 */
const handleInsert: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    table: z.string().min(1, 'Table name is required'),
    data: z.record(z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
      message: 'Data object must have at least one field',
    }),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Inserting into RDS table ${params.table}`)

  const client = createRdsClient(params)

  try {
    const sanitizedTable = sanitizeIdentifier(params.table)
    const columns = Object.keys(params.data)
    const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))

    const placeholders = columns.map((col) => `:${col}`)
    const parameters: SqlParameter[] = columns.map((col) => ({
      name: col,
      value: toSqlParameterValue(params.data[col]),
    }))

    const sql = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders.join(', ')})`

    const result = await executeStatement(
      client,
      params.resourceArn,
      params.secretArn,
      params.database,
      sql,
      parameters
    )

    logger.info(`[${requestId}] Insert executed successfully, affected ${result.rowCount} rows`)

    return {
      success: true,
      output: {
        records: result.rows,
        numberOfRecordsUpdated: result.rowCount,
      },
    }
  } finally {
    client.destroy()
  }
}

/**
 * Builds and executes a parameterized DELETE statement via the RDS Data API.
 */
const handleDelete: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    table: z.string().min(1, 'Table name is required'),
    conditions: z.record(z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
      message: 'At least one condition is required',
    }),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Deleting from RDS table ${params.table}`)

  const client = createRdsClient(params)

  try {
    const sanitizedTable = sanitizeIdentifier(params.table)

    const conditionColumns = Object.keys(params.conditions)
    const whereClause = conditionColumns
      .map((col) => `${sanitizeIdentifier(col)} = :${col}`)
      .join(' AND ')

    const parameters: SqlParameter[] = conditionColumns.map((col) => ({
      name: col,
      value: toSqlParameterValue(params.conditions[col]),
    }))

    const sql = `DELETE FROM ${sanitizedTable} WHERE ${whereClause}`

    const result = await executeStatement(
      client,
      params.resourceArn,
      params.secretArn,
      params.database,
      sql,
      parameters
    )

    logger.info(`[${requestId}] Delete executed successfully, affected ${result.rowCount} rows`)

    return {
      success: true,
      output: {
        numberOfRecordsUpdated: result.rowCount,
      },
    }
  } finally {
    client.destroy()
  }
}

/**
 * Introspects the RDS database schema by querying information_schema for all
 * tables and columns in the public schema.
 */
const handleIntrospect: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema

  const params = schema.parse(body)

  logger.info(
    `[${requestId}] Introspecting RDS database${params.database ? ` (${params.database})` : ''}`
  )

  const client = createRdsClient(params)

  try {
    const sql = `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`

    const result = await executeStatement(
      client,
      params.resourceArn,
      params.secretArn,
      params.database,
      sql
    )

    const tableMap = new Map<
      string,
      Array<{ columnName: string; dataType: string }>
    >()

    for (const row of result.rows) {
      const tableName = row.table_name as string
      const columnName = row.column_name as string
      const dataType = row.data_type as string

      if (!tableMap.has(tableName)) {
        tableMap.set(tableName, [])
      }
      tableMap.get(tableName)!.push({ columnName, dataType })
    }

    const tables = Array.from(tableMap.entries()).map(([name, columns]) => ({
      name,
      columns: columns.map((col) => ({
        name: col.columnName,
        type: col.dataType,
      })),
    }))

    logger.info(`[${requestId}] Introspection completed, found ${tables.length} tables`)

    return {
      success: true,
      output: { tables },
    }
  } finally {
    client.destroy()
  }
}

export const rdsHandlers: Record<string, ToolProxyHandler> = {
  'query': handleQuery,
  'execute': handleExecute,
  'insert': handleInsert,
  'delete': handleDelete,
  'introspect': handleIntrospect,
}
