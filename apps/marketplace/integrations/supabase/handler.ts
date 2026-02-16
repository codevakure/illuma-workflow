import type { ToolHandler } from '../../sdk/types'

/**
 * Builds the Supabase base URL from a project ID or supabaseUrl param.
 */
function getBaseUrl(params: Record<string, unknown>): string {
  if (params.supabaseUrl) {
    return (params.supabaseUrl as string).replace(/\/$/, '')
  }
  const projectId = params.projectId as string
  if (!projectId) {
    throw new Error('Either supabaseUrl or projectId is required')
  }
  return `https://${projectId}.supabase.co`
}

/**
 * Builds standard Supabase auth headers.
 */
function getAuthHeaders(params: Record<string, unknown>, schema?: string): Record<string, string> {
  const apiKey = params.apiKey as string
  const headers: Record<string, string> = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  }
  if (schema) {
    headers['Accept-Profile'] = schema
    headers['Content-Profile'] = schema
  }
  return headers
}

const handler: ToolHandler = {
  operations: {
    supabase_query: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const schema = params.schema as string | undefined
      const apiKey = params.apiKey as string

      if (!table) {
        return { success: false, output: {}, error: 'Missing required parameter: table' }
      }

      const selectColumns = (params.select as string)?.trim() || '*'
      let url = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(selectColumns)}`

      if (params.filter) {
        url += `&${(params.filter as string).trim()}`
      }

      if (params.orderBy) {
        let orderParam = (params.orderBy as string).trim()
        if (/\s+DESC$/i.test(orderParam)) {
          orderParam = `${orderParam.replace(/\s+DESC$/i, '').trim()}.desc`
        } else if (/\s+ASC$/i.test(orderParam)) {
          orderParam = `${orderParam.replace(/\s+ASC$/i, '').trim()}.asc`
        } else {
          orderParam = `${orderParam}.asc`
        }
        url += `&order=${orderParam}`
      }

      if (params.limit) {
        url += `&limit=${Number(params.limit)}`
      }

      const headers = getAuthHeaders(params, schema)
      const response = await fetch(url, { method: 'GET', headers })
      const data = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: data.message || data.error || `Supabase error: ${response.status}` }
      }

      const rowCount = Array.isArray(data) ? data.length : 0
      return {
        success: true,
        output: {
          message: rowCount === 0 ? 'No rows found' : `Successfully queried ${rowCount} row${rowCount === 1 ? '' : 's'}`,
          results: data,
        },
      }
    },

    supabase_insert: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const schema = params.schema as string | undefined

      if (!table) {
        return { success: false, output: {}, error: 'Missing required parameter: table' }
      }

      let data = params.data
      if (typeof data === 'string') {
        data = JSON.parse(data as string)
      }

      const headers = {
        ...getAuthHeaders(params, schema),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }

      const response = await fetch(`${baseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || result.error || `Insert failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Data inserted successfully',
          results: result,
        },
      }
    },

    supabase_get_row: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const filter = params.filter as string
      const schema = params.schema as string | undefined

      if (!table || !filter) {
        return { success: false, output: {}, error: 'Missing required parameters: table, filter' }
      }

      const selectColumns = (params.select as string)?.trim() || '*'
      const url = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(selectColumns)}&${filter.trim()}&limit=1`

      const headers = {
        ...getAuthHeaders(params, schema),
        Accept: 'application/vnd.pgrst.object+json',
      }

      const response = await fetch(url, { method: 'GET', headers })
      const data = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: data.message || data.error || `Get row failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Row retrieved successfully',
          results: data,
        },
      }
    },

    supabase_update: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const filter = params.filter as string
      const schema = params.schema as string | undefined

      if (!table || !filter) {
        return { success: false, output: {}, error: 'Missing required parameters: table, filter' }
      }

      let data = params.data
      if (typeof data === 'string') {
        data = JSON.parse(data as string)
      }

      const url = `${baseUrl}/rest/v1/${table}?${filter.trim()}`
      const headers = {
        ...getAuthHeaders(params, schema),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || result.error || `Update failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Data updated successfully',
          results: result,
        },
      }
    },

    supabase_delete: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const filter = params.filter as string
      const schema = params.schema as string | undefined

      if (!table || !filter) {
        return { success: false, output: {}, error: 'Missing required parameters: table, filter' }
      }

      const url = `${baseUrl}/rest/v1/${table}?${filter.trim()}`
      const headers = {
        ...getAuthHeaders(params, schema),
        Prefer: 'return=representation',
      }

      const response = await fetch(url, { method: 'DELETE', headers })
      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || result.error || `Delete failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Data deleted successfully',
          results: result,
        },
      }
    },

    supabase_upsert: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const schema = params.schema as string | undefined

      if (!table) {
        return { success: false, output: {}, error: 'Missing required parameter: table' }
      }

      let data = params.data
      if (typeof data === 'string') {
        data = JSON.parse(data as string)
      }

      const headers = {
        ...getAuthHeaders(params, schema),
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates',
      }

      const response = await fetch(`${baseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || result.error || `Upsert failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Data upserted successfully',
          results: result,
        },
      }
    },

    supabase_rpc: async (params) => {
      const baseUrl = getBaseUrl(params)
      const functionName = params.functionName as string

      if (!functionName) {
        return { success: false, output: {}, error: 'Missing required parameter: functionName' }
      }

      let rpcParams = params.params
      if (typeof rpcParams === 'string') {
        rpcParams = JSON.parse(rpcParams as string)
      }

      const headers = {
        ...getAuthHeaders(params),
        'Content-Type': 'application/json',
      }

      const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rpcParams || {}),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || result.error || `RPC failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'RPC executed successfully',
          results: result,
        },
      }
    },

    supabase_vector_search: async (params) => {
      const baseUrl = getBaseUrl(params)
      const functionName = params.functionName as string
      const queryEmbedding = params.queryEmbedding as number[]

      if (!functionName || !queryEmbedding) {
        return { success: false, output: {}, error: 'Missing required parameters: functionName, queryEmbedding' }
      }

      const headers = {
        ...getAuthHeaders(params),
        'Content-Type': 'application/json',
      }

      const body: Record<string, unknown> = {
        query_embedding: queryEmbedding,
      }
      if (params.matchThreshold !== undefined) {
        body.match_threshold = Number(params.matchThreshold)
      }
      if (params.matchCount !== undefined) {
        body.match_count = Number(params.matchCount)
      }

      const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || result.error || `Vector search failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Vector search completed successfully',
          results: result,
        },
      }
    },

    supabase_text_search: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const column = params.column as string
      const query = params.query as string
      const schema = params.schema as string | undefined

      if (!table || !column || !query) {
        return { success: false, output: {}, error: 'Missing required parameters: table, column, query' }
      }

      const searchType = (params.searchType as string) || 'fts'
      const language = (params.language as string) || 'english'
      const limit = params.limit ? Number(params.limit) : undefined

      let url = `${baseUrl}/rest/v1/${table}?${column}=${searchType}(${language}).${encodeURIComponent(query)}`
      if (limit) {
        url += `&limit=${limit}`
      }

      const headers = getAuthHeaders(params, schema)
      const response = await fetch(url, { method: 'GET', headers })
      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || result.error || `Text search failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Text search completed successfully',
          results: result,
        },
      }
    },

    supabase_count: async (params) => {
      const baseUrl = getBaseUrl(params)
      const table = params.table as string
      const schema = params.schema as string | undefined

      if (!table) {
        return { success: false, output: {}, error: 'Missing required parameter: table' }
      }

      const countType = (params.countType as string) || 'exact'
      let url = `${baseUrl}/rest/v1/${table}?select=count`

      if (params.filter) {
        url += `&${(params.filter as string).trim()}`
      }

      const headers = {
        ...getAuthHeaders(params, schema),
        Prefer: `count=${countType}`,
      }

      const response = await fetch(url, { method: 'HEAD', headers })

      if (!response.ok) {
        return { success: false, output: {}, error: `Count failed: ${response.status}` }
      }

      const contentRange = response.headers.get('content-range')
      let count = 0
      if (contentRange) {
        const match = contentRange.match(/\/(\d+|\*)$/)
        if (match && match[1] !== '*') {
          count = parseInt(match[1], 10)
        }
      }

      return {
        success: true,
        output: {
          message: `Count: ${count}`,
          count,
        },
      }
    },

    supabase_introspect: async (params) => {
      const baseUrl = getBaseUrl(params)
      const schema = (params.schema as string) || 'public'

      const headers = {
        ...getAuthHeaders(params),
        'Content-Type': 'application/json',
      }

      const response = await fetch(`${baseUrl}/rest/v1/rpc/sim_introspect_schema`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ target_schema: schema }),
      })

      if (response.ok) {
        const result = await response.json()
        return {
          success: true,
          output: {
            message: 'Introspection completed',
            tables: result,
            schemas: [schema],
          },
        }
      }

      // Fallback: use OpenAPI spec endpoint
      const specResponse = await fetch(`${baseUrl}/rest/v1/`, {
        method: 'GET',
        headers: { ...getAuthHeaders(params, schema), Accept: 'application/openapi+json' },
      })

      if (!specResponse.ok) {
        return { success: false, output: {}, error: `Introspection failed: ${specResponse.status}` }
      }

      const spec = await specResponse.json()
      const paths = spec.paths || {}
      const definitions = spec.definitions || {}

      const tables = Object.keys(definitions).map((tableName) => {
        const def = definitions[tableName]
        const properties = def.properties || {}
        const requiredFields = def.required || []

        const columns = Object.entries(properties).map(([colName, colDef]: [string, Record<string, unknown>]) => ({
          name: colName,
          type: (colDef.format || colDef.type || 'unknown') as string,
          nullable: !requiredFields.includes(colName),
          default: (colDef.default as string | null) ?? null,
          isPrimaryKey: false,
          isForeignKey: false,
        }))

        return {
          name: tableName,
          schema,
          columns,
          primaryKey: [] as string[],
          foreignKeys: [] as Array<{ column: string; referencesTable: string; referencesColumn: string }>,
          indexes: [] as Array<{ name: string; columns: string[]; unique: boolean }>,
        }
      })

      return {
        success: true,
        output: {
          message: `Introspection completed, found ${tables.length} tables`,
          tables,
          schemas: [schema],
        },
      }
    },

    supabase_storage_upload: async (params, ctx) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string
      const fileName = params.fileName as string

      if (!bucket || !fileName) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, fileName' }
      }

      const rawFile = params.fileData || params.file
      if (!rawFile) {
        return { success: false, output: {}, error: 'File is required' }
      }

      let uploadBody: Buffer | Uint8Array
      let uploadContentType: string

      if (typeof rawFile === 'string') {
        const dataUrlMatch = rawFile.match(/^data:([^;]+);base64,(.+)$/s)
        if (dataUrlMatch) {
          uploadBody = Buffer.from(dataUrlMatch[2], 'base64')
          uploadContentType = (params.contentType as string) || dataUrlMatch[1]
        } else {
          uploadBody = Buffer.from(rawFile, 'utf-8')
          uploadContentType = (params.contentType as string) || 'application/octet-stream'
        }
      } else if (ctx.downloadFile) {
        uploadBody = await ctx.downloadFile(rawFile)
        uploadContentType = (params.contentType as string) || 'application/octet-stream'
      } else {
        return { success: false, output: {}, error: 'Cannot process file input' }
      }

      let fullPath = fileName
      if (params.path) {
        const folderPath = (params.path as string).endsWith('/')
          ? params.path as string
          : `${params.path}/`
        fullPath = `${folderPath}${fileName}`
      }

      const uploadUrl = `${baseUrl}/storage/v1/object/${bucket}/${fullPath}`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': uploadContentType,
      }
      if (params.upsert) {
        headers['x-upsert'] = 'true'
      }

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers,
        body: new Uint8Array(uploadBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData: Record<string, unknown>
        try { errorData = JSON.parse(errorText) } catch { errorData = { message: errorText } }
        return {
          success: false,
          output: {},
          error: (errorData.message as string) || (errorData.error as string) || `Upload failed: ${response.statusText}`,
        }
      }

      const result = await response.json()
      const publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${fullPath}`

      return {
        success: true,
        output: {
          message: 'File uploaded successfully',
          results: {
            key: result.Key || fullPath,
            path: fullPath,
            bucket,
            publicUrl,
          },
        },
      }
    },

    supabase_storage_download: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string
      const path = params.path as string

      if (!bucket || !path) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, path' }
      }

      const url = `${baseUrl}/storage/v1/object/${bucket}/${path}`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
      }

      const response = await fetch(url, { method: 'GET', headers })

      if (!response.ok) {
        return { success: false, output: {}, error: `Download failed: ${response.status}` }
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const buffer = Buffer.from(await response.arrayBuffer())
      const fileName = params.fileName || path.split('/').pop() || 'download'

      return {
        success: true,
        output: {
          file: {
            name: fileName,
            mimeType: contentType,
            data: buffer.toString('base64'),
            size: buffer.length,
          },
        },
      }
    },

    supabase_storage_list: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string

      if (!bucket) {
        return { success: false, output: {}, error: 'Missing required parameter: bucket' }
      }

      const body: Record<string, unknown> = {}
      if (params.limit) body.limit = Number(params.limit)
      if (params.offset) body.offset = Number(params.offset)
      if (params.search) body.search = params.search
      if (params.sortBy) {
        body.sortBy = {
          column: params.sortBy,
          order: params.sortOrder || 'asc',
        }
      }

      const prefix = (params.path as string) || ''
      const url = `${baseUrl}/storage/v1/object/list/${bucket}`

      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, prefix }),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || `List failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: `Found ${Array.isArray(result) ? result.length : 0} files`,
          results: result,
        },
      }
    },

    supabase_storage_delete: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string
      const paths = params.paths as string[]

      if (!bucket || !paths || paths.length === 0) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, paths' }
      }

      const url = `${baseUrl}/storage/v1/object/${bucket}`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }

      const response = await fetch(url, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ prefixes: paths }),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || `Delete failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Files deleted successfully',
          results: result,
        },
      }
    },

    supabase_storage_move: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string

      if (!bucket || !params.fromPath || !params.toPath) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, fromPath, toPath' }
      }

      const url = `${baseUrl}/storage/v1/object/move`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bucketId: bucket,
          sourceKey: params.fromPath,
          destinationKey: params.toPath,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        return { success: false, output: {}, error: result.message || `Move failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'File moved successfully',
          results: { message: 'Successfully moved' },
        },
      }
    },

    supabase_storage_copy: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string

      if (!bucket || !params.fromPath || !params.toPath) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, fromPath, toPath' }
      }

      const url = `${baseUrl}/storage/v1/object/copy`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bucketId: bucket,
          sourceKey: params.fromPath,
          destinationKey: params.toPath,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || `Copy failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'File copied successfully',
          results: result,
        },
      }
    },

    supabase_storage_create_bucket: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string

      if (!bucket) {
        return { success: false, output: {}, error: 'Missing required parameter: bucket' }
      }

      const body: Record<string, unknown> = {
        id: bucket,
        name: bucket,
        public: params.isPublic || false,
      }
      if (params.fileSizeLimit) body.file_size_limit = Number(params.fileSizeLimit)
      if (params.allowedMimeTypes) body.allowed_mime_types = params.allowedMimeTypes

      const url = `${baseUrl}/storage/v1/bucket`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || `Create bucket failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Bucket created successfully',
          results: result,
        },
      }
    },

    supabase_storage_list_buckets: async (params) => {
      const baseUrl = getBaseUrl(params)

      const url = `${baseUrl}/storage/v1/bucket`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
      }

      const response = await fetch(url, { method: 'GET', headers })
      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || `List buckets failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: `Found ${Array.isArray(result) ? result.length : 0} buckets`,
          results: result,
        },
      }
    },

    supabase_storage_delete_bucket: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string

      if (!bucket) {
        return { success: false, output: {}, error: 'Missing required parameter: bucket' }
      }

      // First empty the bucket
      await fetch(`${baseUrl}/storage/v1/bucket/${bucket}/empty`, {
        method: 'POST',
        headers: {
          apikey: params.apiKey as string,
          Authorization: `Bearer ${params.apiKey}`,
        },
      })

      const url = `${baseUrl}/storage/v1/bucket/${bucket}`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
      }

      const response = await fetch(url, { method: 'DELETE', headers })

      if (!response.ok) {
        const result = await response.json()
        return { success: false, output: {}, error: result.message || `Delete bucket failed: ${response.status}` }
      }

      return {
        success: true,
        output: {
          message: 'Bucket deleted successfully',
          results: { message: 'Successfully deleted' },
        },
      }
    },

    supabase_storage_get_public_url: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string
      const path = params.path as string

      if (!bucket || !path) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, path' }
      }

      let publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${path}`
      if (params.download) {
        publicUrl += '?download='
      }

      return {
        success: true,
        output: {
          message: 'Public URL generated',
          publicUrl,
        },
      }
    },

    supabase_storage_create_signed_url: async (params) => {
      const baseUrl = getBaseUrl(params)
      const bucket = params.bucket as string
      const path = params.path as string
      const expiresIn = Number(params.expiresIn)

      if (!bucket || !path || !expiresIn) {
        return { success: false, output: {}, error: 'Missing required parameters: bucket, path, expiresIn' }
      }

      const url = `${baseUrl}/storage/v1/object/sign/${bucket}/${path}`
      const headers: Record<string, string> = {
        apikey: params.apiKey as string,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expiresIn }),
      })

      const result = await response.json()

      if (!response.ok) {
        return { success: false, output: {}, error: result.message || `Create signed URL failed: ${response.status}` }
      }

      const signedUrl = result.signedURL
        ? `${baseUrl}/storage/v1${result.signedURL}`
        : result.signedUrl || ''

      return {
        success: true,
        output: {
          message: 'Signed URL created',
          signedUrl,
        },
      }
    },
  },
}

export default handler
