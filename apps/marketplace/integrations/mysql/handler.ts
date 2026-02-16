import type { ToolHandler } from '../../sdk/types'

/**
 * Sanitizes a SQL identifier using backticks for MySQL.
 */
function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    return identifier.split('.').map(sanitizeSingle).join('.')
  }
  return sanitizeSingle(identifier)
}

function sanitizeSingle(identifier: string): string {
  const cleaned = identifier.replace(/`/g, '')
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }
  return `\`${cleaned}\``
}

/**
 * Validates a WHERE clause to prevent SQL injection.
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
    /\bsleep\s*\(/i,
    /\bbenchmark\s*\(/i,
    /\bwaitfor\s+delay/i,
    /;\s*\w+/,
    /information_schema/i,
    /mysql\./i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}

const handler: ToolHandler = {
  operations: {
    mysql_query: async (params) => {
      const mysql = await import('mysql2/promise')

      const host = params.host as string
      const port = Number(params.port)
      const database = params.database as string
      const username = params.username as string
      const password = params.password as string
      const query = params.query as string

      if (!host || !database || !username || !password || !query) {
        return { success: false, output: {}, error: 'Missing required connection parameters or query' }
      }

      const connectionConfig: Record<string, unknown> = {
        host,
        port,
        database,
        user: username,
        password,
        connectTimeout: 10000,
      }

      const ssl = params.ssl
      if (ssl === true || ssl === 'require') {
        connectionConfig.ssl = { rejectUnauthorized: true }
      } else if (ssl === 'prefer') {
        connectionConfig.ssl = { rejectUnauthorized: false }
      } else if (ssl === 'verify-full') {
        connectionConfig.ssl = { rejectUnauthorized: true }
      }

      const connection = await mysql.createConnection(connectionConfig as mysql.ConnectionOptions)

      try {
        const queryParams = (params.params as unknown[]) || []
        const [rows] = await connection.execute(query, queryParams)
        const rowArray = Array.isArray(rows) ? rows : []

        return {
          success: true,
          output: {
            rows: rowArray,
            rowCount: rowArray.length,
          },
        }
      } finally {
        await connection.end()
      }
    },

    mysql_execute: async (params) => {
      const mysql = await import('mysql2/promise')

      const host = params.host as string
      const port = Number(params.port)
      const database = params.database as string
      const username = params.username as string
      const password = params.password as string
      const query = params.query as string

      if (!host || !database || !username || !password || !query) {
        return { success: false, output: {}, error: 'Missing required connection parameters or query' }
      }

      const connectionConfig: Record<string, unknown> = {
        host,
        port,
        database,
        user: username,
        password,
        connectTimeout: 10000,
      }

      const ssl = params.ssl
      if (ssl === true || ssl === 'require') {
        connectionConfig.ssl = { rejectUnauthorized: true }
      } else if (ssl === 'prefer') {
        connectionConfig.ssl = { rejectUnauthorized: false }
      }

      const connection = await mysql.createConnection(connectionConfig as mysql.ConnectionOptions)

      try {
        const queryParams = (params.params as unknown[]) || []
        const [result] = await connection.execute(query, queryParams)

        let rowCount = 0
        const command = query.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN'

        if (Array.isArray(result)) {
          rowCount = result.length
        } else {
          rowCount = (result as { affectedRows?: number }).affectedRows || 0
        }

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
    },

    mysql_insert: async (params) => {
      const mysql = await import('mysql2/promise')

      const host = params.host as string
      const port = Number(params.port)
      const database = params.database as string
      const username = params.username as string
      const password = params.password as string
      const table = params.table as string

      if (!host || !database || !username || !password || !table) {
        return { success: false, output: {}, error: 'Missing required connection parameters or table' }
      }

      let data: Record<string, unknown>[]
      if (typeof params.data === 'string') {
        const parsed = JSON.parse(params.data as string)
        data = Array.isArray(parsed) ? parsed : [parsed]
      } else if (Array.isArray(params.data)) {
        data = params.data as Record<string, unknown>[]
      } else if (typeof params.data === 'object' && params.data !== null) {
        data = [params.data as Record<string, unknown>]
      } else {
        return { success: false, output: {}, error: 'Missing required parameter: data' }
      }

      const connectionConfig: Record<string, unknown> = {
        host,
        port,
        database,
        user: username,
        password,
        connectTimeout: 10000,
      }

      const ssl = params.ssl
      if (ssl === true || ssl === 'require') {
        connectionConfig.ssl = { rejectUnauthorized: true }
      } else if (ssl === 'prefer') {
        connectionConfig.ssl = { rejectUnauthorized: false }
      }

      const connection = await mysql.createConnection(connectionConfig as mysql.ConnectionOptions)

      try {
        const sanitizedTable = sanitizeIdentifier(table)
        const allRows: unknown[] = []

        for (const row of data) {
          const columns = Object.keys(row)
          const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
          const placeholders = columns.map(() => '?').join(', ')
          const values = columns.map((col) => row[col])

          const query = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders})`
          const [result] = await connection.execute(query, values)
          const insertId = (result as { insertId?: number }).insertId

          allRows.push({ ...row, insertId })
        }

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
    },

    mysql_delete: async (params) => {
      const mysql = await import('mysql2/promise')

      const host = params.host as string
      const port = Number(params.port)
      const database = params.database as string
      const username = params.username as string
      const password = params.password as string
      const table = params.table as string
      const where = params.where as string

      if (!host || !database || !username || !password || !table || !where) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      validateWhereClause(where)

      const connectionConfig: Record<string, unknown> = {
        host,
        port,
        database,
        user: username,
        password,
        connectTimeout: 10000,
      }

      const ssl = params.ssl
      if (ssl === true || ssl === 'require') {
        connectionConfig.ssl = { rejectUnauthorized: true }
      } else if (ssl === 'prefer') {
        connectionConfig.ssl = { rejectUnauthorized: false }
      }

      const connection = await mysql.createConnection(connectionConfig as mysql.ConnectionOptions)

      try {
        const sanitizedTable = sanitizeIdentifier(table)
        const query = `DELETE FROM ${sanitizedTable} WHERE ${where}`
        const queryParams = (params.params as unknown[]) || []

        const [result] = await connection.execute(query, queryParams)
        const rowCount = (result as { affectedRows?: number }).affectedRows || 0

        return {
          success: true,
          output: {
            rowCount,
          },
        }
      } finally {
        await connection.end()
      }
    },

    mysql_update: async (params) => {
      const mysql = await import('mysql2/promise')

      const host = params.host as string
      const port = Number(params.port)
      const database = params.database as string
      const username = params.username as string
      const password = params.password as string
      const query = params.query as string

      if (!host || !database || !username || !password || !query) {
        return { success: false, output: {}, error: 'Missing required connection parameters or query' }
      }

      const connectionConfig: Record<string, unknown> = {
        host,
        port,
        database,
        user: username,
        password,
        connectTimeout: 10000,
      }

      const ssl = params.ssl
      if (ssl === true || ssl === 'require') {
        connectionConfig.ssl = { rejectUnauthorized: true }
      } else if (ssl === 'prefer') {
        connectionConfig.ssl = { rejectUnauthorized: false }
      }

      const connection = await mysql.createConnection(connectionConfig as mysql.ConnectionOptions)

      try {
        const queryParams = (params.params as unknown[]) || []
        const [result] = await connection.execute(query, queryParams)

        let rowCount = 0
        const command = query.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN'

        if (Array.isArray(result)) {
          rowCount = result.length
        } else {
          rowCount = (result as { affectedRows?: number }).affectedRows || 0
        }

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
    },

    mysql_introspect: async (params) => {
      const mysql = await import('mysql2/promise')

      const host = params.host as string
      const port = Number(params.port)
      const database = params.database as string
      const username = params.username as string
      const password = params.password as string

      if (!host || !database || !username || !password) {
        return { success: false, output: {}, error: 'Missing required connection parameters' }
      }

      const connectionConfig: Record<string, unknown> = {
        host,
        port,
        database,
        user: username,
        password,
        connectTimeout: 10000,
      }

      const ssl = params.ssl
      if (ssl === true || ssl === 'require') {
        connectionConfig.ssl = { rejectUnauthorized: true }
      } else if (ssl === 'prefer') {
        connectionConfig.ssl = { rejectUnauthorized: false }
      }

      const connection = await mysql.createConnection(connectionConfig as mysql.ConnectionOptions)

      try {
        const [tablesRows] = await connection.execute(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
           ORDER BY TABLE_NAME`,
          [database]
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

        for (const tableRow of tablesRows as Array<Record<string, unknown>>) {
          const tableName = tableRow.TABLE_NAME as string

          const [columnsRows] = await connection.execute(
            `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`,
            [database, tableName]
          )

          const columns = (columnsRows as Array<Record<string, unknown>>).map((col) => ({
            name: col.COLUMN_NAME as string,
            type: (col.COLUMN_TYPE as string) || (col.DATA_TYPE as string),
            nullable: col.IS_NULLABLE === 'YES',
            default: col.COLUMN_DEFAULT as string | null,
          }))

          tables.push({
            name: tableName,
            database,
            columns,
          })
        }

        return {
          success: true,
          output: {
            tables,
          },
        }
      } finally {
        await connection.end()
      }
    },
  },
}

export default handler
