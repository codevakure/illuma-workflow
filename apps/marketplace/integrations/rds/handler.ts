import type { ToolHandler } from '../../sdk/types'

const encoder = new TextEncoder()

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof ArrayBuffer ? new Uint8Array(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

async function sha256(data: string | Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function executeRdsStatement(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  resourceArn: string,
  secretArn: string,
  database: string,
  sql: string,
  parameters?: Array<{ name: string; value: Record<string, unknown> }>
): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  const service = 'rds-data'
  const host = `rds-data.${region}.amazonaws.com`
  const endpoint = `https://${host}`

  const requestBody: Record<string, unknown> = {
    resourceArn,
    secretArn,
    database,
    sql,
    includeResultMetadata: true,
  }
  if (parameters && parameters.length > 0) {
    requestBody.parameters = parameters
  }

  const body = JSON.stringify(requestBody)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const target = 'RdsDataService.ExecuteStatement'
  const payloadHash = await sha256(body)

  const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`

  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  const kSigning = await hmac(kService, 'aws4_request')
  const signatureBuffer = await hmac(kSigning, stringToSign)
  const signature = Array.from(new Uint8Array(signatureBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('')

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      Host: host,
      'X-Amz-Date': amzDate,
      'X-Amz-Target': target,
      Authorization: authorization,
    },
    body,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    return { success: false, output: {}, error: `RDS Data API error: ${response.status} ${errorText}` }
  }

  const data = await response.json()
  return { success: true, output: data }
}

function formatRdsResults(data: Record<string, unknown>): Record<string, unknown> {
  const metadata = (data.columnMetadata as Array<Record<string, unknown>>) ?? []
  const records = (data.records as Array<Array<Record<string, unknown>>>) ?? []
  const columnNames = metadata.map((col) => (col.name as string) ?? '')

  const rows = records.map((row) => {
    const obj: Record<string, unknown> = {}
    row.forEach((cell, i) => {
      const key = columnNames[i] || `col_${i}`
      const valueKeys = Object.keys(cell)
      if (valueKeys.includes('isNull') && cell.isNull) {
        obj[key] = null
      } else {
        const valueKey = valueKeys.find((k) => k !== 'isNull') || valueKeys[0]
        obj[key] = cell[valueKey]
      }
    })
    return obj
  })

  return {
    rows,
    columnNames,
    rowCount: rows.length,
    numberOfRecordsUpdated: data.numberOfRecordsUpdated,
    generatedFields: data.generatedFields,
  }
}

const handler: ToolHandler = {
  operations: {
    rds_query: async (params) => {
      const accessKeyId = (params.accessKeyId as string || '').trim()
      const secretAccessKey = (params.secretAccessKey as string || '').trim()
      const region = (params.region as string || '').trim()
      const resourceArn = (params.resourceArn as string || '').trim()
      const secretArn = (params.secretArn as string || '').trim()
      const database = (params.database as string || '').trim()
      const sql = (params.sql as string || '').trim()

      if (!accessKeyId || !secretAccessKey || !region || !resourceArn || !secretArn || !database || !sql) {
        return { success: false, output: {}, error: 'Missing required parameters: accessKeyId, secretAccessKey, region, resourceArn, secretArn, database, sql' }
      }

      const result = await executeRdsStatement(accessKeyId, secretAccessKey, region, resourceArn, secretArn, database, sql)
      if (!result.success) return result

      return { success: true, output: formatRdsResults(result.output) }
    },

    rds_insert: async (params) => {
      const accessKeyId = (params.accessKeyId as string || '').trim()
      const secretAccessKey = (params.secretAccessKey as string || '').trim()
      const region = (params.region as string || '').trim()
      const resourceArn = (params.resourceArn as string || '').trim()
      const secretArn = (params.secretArn as string || '').trim()
      const database = (params.database as string || '').trim()
      const table = (params.table as string || '').trim()
      const values = params.values as Record<string, unknown>

      if (!accessKeyId || !secretAccessKey || !region || !resourceArn || !secretArn || !database || !table || !values) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const columns = Object.keys(values)
      const placeholders = columns.map((_, i) => `:p${i}`)
      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
      const parameters = columns.map((col, i) => {
        const val = values[col]
        const param: Record<string, unknown> = { name: `p${i}` }
        if (val === null) param.value = { isNull: true }
        else if (typeof val === 'number') param.value = Number.isInteger(val) ? { longValue: val } : { doubleValue: val }
        else if (typeof val === 'boolean') param.value = { booleanValue: val }
        else param.value = { stringValue: String(val) }
        return param as { name: string; value: Record<string, unknown> }
      })

      const result = await executeRdsStatement(accessKeyId, secretAccessKey, region, resourceArn, secretArn, database, sql, parameters)
      if (!result.success) return result

      return { success: true, output: { numberOfRecordsUpdated: result.output.numberOfRecordsUpdated, generatedFields: result.output.generatedFields } }
    },

    rds_update: async (params) => {
      const accessKeyId = (params.accessKeyId as string || '').trim()
      const secretAccessKey = (params.secretAccessKey as string || '').trim()
      const region = (params.region as string || '').trim()
      const resourceArn = (params.resourceArn as string || '').trim()
      const secretArn = (params.secretArn as string || '').trim()
      const database = (params.database as string || '').trim()
      const sql = (params.sql as string || '').trim()

      if (!accessKeyId || !secretAccessKey || !region || !resourceArn || !secretArn || !database || !sql) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const result = await executeRdsStatement(accessKeyId, secretAccessKey, region, resourceArn, secretArn, database, sql)
      if (!result.success) return result

      return { success: true, output: { numberOfRecordsUpdated: result.output.numberOfRecordsUpdated } }
    },

    rds_delete: async (params) => {
      const accessKeyId = (params.accessKeyId as string || '').trim()
      const secretAccessKey = (params.secretAccessKey as string || '').trim()
      const region = (params.region as string || '').trim()
      const resourceArn = (params.resourceArn as string || '').trim()
      const secretArn = (params.secretArn as string || '').trim()
      const database = (params.database as string || '').trim()
      const sql = (params.sql as string || '').trim()

      if (!accessKeyId || !secretAccessKey || !region || !resourceArn || !secretArn || !database || !sql) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const result = await executeRdsStatement(accessKeyId, secretAccessKey, region, resourceArn, secretArn, database, sql)
      if (!result.success) return result

      return { success: true, output: { numberOfRecordsUpdated: result.output.numberOfRecordsUpdated } }
    },

    rds_execute: async (params) => {
      const accessKeyId = (params.accessKeyId as string || '').trim()
      const secretAccessKey = (params.secretAccessKey as string || '').trim()
      const region = (params.region as string || '').trim()
      const resourceArn = (params.resourceArn as string || '').trim()
      const secretArn = (params.secretArn as string || '').trim()
      const database = (params.database as string || '').trim()
      const sql = (params.sql as string || '').trim()

      if (!accessKeyId || !secretAccessKey || !region || !resourceArn || !secretArn || !database || !sql) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const result = await executeRdsStatement(accessKeyId, secretAccessKey, region, resourceArn, secretArn, database, sql)
      if (!result.success) return result

      return { success: true, output: formatRdsResults(result.output) }
    },

    rds_introspect: async (params) => {
      const accessKeyId = (params.accessKeyId as string || '').trim()
      const secretAccessKey = (params.secretAccessKey as string || '').trim()
      const region = (params.region as string || '').trim()
      const resourceArn = (params.resourceArn as string || '').trim()
      const secretArn = (params.secretArn as string || '').trim()
      const database = (params.database as string || '').trim()

      if (!accessKeyId || !secretAccessKey || !region || !resourceArn || !secretArn || !database) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const sql = `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`

      const result = await executeRdsStatement(accessKeyId, secretAccessKey, region, resourceArn, secretArn, database, sql)
      if (!result.success) return result

      const formatted = formatRdsResults(result.output)
      const rows = formatted.rows as Array<Record<string, unknown>>

      const tables: Record<string, Array<Record<string, unknown>>> = {}
      for (const row of rows) {
        const tableName = row.table_name as string
        if (!tables[tableName]) tables[tableName] = []
        tables[tableName].push({
          column: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
          default: row.column_default,
        })
      }

      return { success: true, output: { tables, tableNames: Object.keys(tables) } }
    },
  },
}

export default handler
