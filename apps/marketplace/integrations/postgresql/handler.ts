import type { ToolHandler } from '../../sdk/types'

/**
 * Sanitizes a SQL identifier using double quotes for PostgreSQL.
 */
function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    return identifier.split('.').map(sanitizeSingle).join('.')
  }
  return sanitizeSingle(identifier)
}

function sanitizeSingle(identifier: string): string {
  const cleaned = identifier.replace(/"/g, '')
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }
  return `"${cleaned}"`
}

/**
 * Validates a WHERE clause to prevent SQL injection.
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
    /\bsleep\s*\(/i,
    /\bwaitfor\s+delay/i,
    /\bpg_sleep\s*\(/i,
    /;\s*\w+/,
    /information_schema/i,
    /pg_catalog/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}

/**
 * Creates a postgres.js connection with SSL support.
 */
async function createConnection(params: Record<string, unknown>) {
  const postgres = (await import('postgres')).default

  const host = params.host as string
  const port = Number(params.port)
  const database = params.database as string
  const username = params.username as string
  const password = params.password as string
  const ssl = params.ssl

  let sslConfig: boolean | string | object = false

  if (ssl === true) {
    sslConfig = { rejectUnauthorized: false }
  } else if (ssl === 'require' || ssl === 'prefer' || ssl === 'verify-full') {
    sslConfig = ssl as string
  } else if (typeof ssl === 'string' && ssl !== 'false' && ssl !== '') {
    sslConfig = ssl
  }

  return postgres({
    host,
    port,
    database,
    username,
    password,
    ssl: sslConfig as boolean,
    connect_timeout: 10,
    max: 1,
  })
}

const handler: ToolHandler = {
  operations: {
    postgresql_query: async (params) => {
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const sql = await createConnection(params)

      try {
        const queryParams = (params.params as unknown[]) || []
        const result = await sql.unsafe(query, queryParams)
        const rowCount = result.count ?? result.length ?? 0

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
    },

    postgresql_execute: async (params) => {
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const sql = await createConnection(params)

      try {
        const queryParams = (params.params as unknown[]) || []
        const result = await sql.unsafe(query, queryParams)
        const rowCount = result.count ?? result.length ?? 0
        const command = query.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN'

        return {
          success: true,
          output: {
            rowCount,
            command,
          },
        }
      } finally {
        await sql.end()
      }
    },

    postgresql_insert: async (params) => {
      const table = params.table as string
      if (!table) {
        return { success: false, output: {}, error: 'Missing required parameter: table' }
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

      const sql = await createConnection(params)

      try {
        const sanitizedTable = sanitizeIdentifier(table)
        const allRows: unknown[] = []

        for (const row of data) {
          const columns = Object.keys(row)
          const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
          const placeholders = columns.map((_, index) => `$${index + 1}`)
          const values = columns.map((col) => row[col])

          const query = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
          const result = await sql.unsafe(query, values as unknown[])
          allRows.push(...(Array.isArray(result) ? result : [result]))
        }

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
    },

    postgresql_delete: async (params) => {
      const table = params.table as string
      const where = params.where as string

      if (!table) {
        return { success: false, output: {}, error: 'Missing required parameter: table' }
      }
      if (!where) {
        return { success: false, output: {}, error: 'Missing required parameter: where' }
      }

      validateWhereClause(where)

      const sql = await createConnection(params)

      try {
        const sanitizedTable = sanitizeIdentifier(table)
        const query = `DELETE FROM ${sanitizedTable} WHERE ${where} RETURNING *`
        const queryParams = (params.params as unknown[]) || []

        const result = await sql.unsafe(query, queryParams)
        const rowCount = result.count ?? result.length ?? 0

        return {
          success: true,
          output: {
            rowCount,
          },
        }
      } finally {
        await sql.end()
      }
    },

    postgresql_update: async (params) => {
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const sql = await createConnection(params)

      try {
        const queryParams = (params.params as unknown[]) || []
        const result = await sql.unsafe(query, queryParams)
        const rowCount = result.count ?? result.length ?? 0
        const command = query.trim().split(/\s+/)[0]?.toUpperCase() || 'UNKNOWN'

        return {
          success: true,
          output: {
            rowCount,
            command,
          },
        }
      } finally {
        await sql.end()
      }
    },

    postgresql_introspect: async (params) => {
      const sql = await createConnection(params)

      try {
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
          const tableName = tableRow.table_name as string
          const tableSchema = tableRow.table_schema as string

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

          const columns = (columnsResult as Array<Record<string, unknown>>).map((col) => ({
            name: col.column_name as string,
            type: col.data_type === 'USER-DEFINED' ? (col.udt_name as string) : (col.data_type as string),
            nullable: col.is_nullable === 'YES',
            default: col.column_default as string | null,
          }))

          tables.push({
            name: tableName,
            schema: tableSchema,
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
        await sql.end()
      }
    },
  },
}

export default handler
