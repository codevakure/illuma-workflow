import {
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('DynamoDBProxyHandler')

interface DynamoDBClientConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
}

/**
 * Creates a DynamoDB Document Client from the provided configuration.
 */
function createDynamoDBClient(config: DynamoDBClientConfig): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint && { endpoint: config.endpoint }),
  })

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  })
}

/**
 * Creates a raw DynamoDB client for operations that do not require DocumentClient.
 */
function createRawDynamoDBClient(config: DynamoDBClientConfig): DynamoDBClient {
  return new DynamoDBClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint && { endpoint: config.endpoint }),
  })
}

const baseSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  endpoint: z.string().optional(),
})

/**
 * Retrieves a single item from a DynamoDB table by its primary key.
 */
const handleGet: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    tableName: z.string().min(1, 'Table name is required'),
    key: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
      message: 'Key is required',
    }),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Getting item from DynamoDB table ${params.tableName}`)

  const client = createDynamoDBClient(params)

  const command = new GetCommand({
    TableName: params.tableName,
    Key: params.key,
  })

  const response = await client.send(command)
  const item = (response.Item as Record<string, unknown>) || null

  logger.info(`[${requestId}] Get completed: ${item ? 'item found' : 'item not found'}`)

  return {
    success: true,
    output: { item },
  }
}

/**
 * Writes a single item to a DynamoDB table.
 */
const handlePut: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    tableName: z.string().min(1, 'Table name is required'),
    item: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
      message: 'Item is required',
    }),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Putting item into DynamoDB table ${params.tableName}`)

  const client = createDynamoDBClient(params)

  const command = new PutCommand({
    TableName: params.tableName,
    Item: params.item,
  })

  await client.send(command)

  logger.info(`[${requestId}] Item put successfully`)

  return {
    success: true,
    output: { item: params.item },
  }
}

/**
 * Deletes a single item from a DynamoDB table by its primary key.
 */
const handleDelete: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    tableName: z.string().min(1, 'Table name is required'),
    key: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
      message: 'Key is required',
    }),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Deleting item from DynamoDB table ${params.tableName}`)

  const client = createDynamoDBClient(params)

  const command = new DeleteCommand({
    TableName: params.tableName,
    Key: params.key,
  })

  await client.send(command)

  logger.info(`[${requestId}] Item deleted successfully`)

  return {
    success: true,
    output: {},
  }
}

/**
 * Queries items from a DynamoDB table using a key condition expression.
 */
const handleQuery: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    tableName: z.string().min(1, 'Table name is required'),
    keyConditionExpression: z.string().min(1, 'Key condition expression is required'),
    expressionAttributeValues: z.record(z.unknown()).optional(),
    expressionAttributeNames: z.record(z.string()).optional(),
    filterExpression: z.string().optional(),
    limit: z.number().positive().optional(),
    scanIndexForward: z.boolean().optional(),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Querying DynamoDB table ${params.tableName}`)

  const client = createDynamoDBClient(params)

  const command = new QueryCommand({
    TableName: params.tableName,
    KeyConditionExpression: params.keyConditionExpression,
    ...(params.expressionAttributeValues && {
      ExpressionAttributeValues: params.expressionAttributeValues,
    }),
    ...(params.expressionAttributeNames && {
      ExpressionAttributeNames: params.expressionAttributeNames,
    }),
    ...(params.filterExpression && { FilterExpression: params.filterExpression }),
    ...(params.limit && { Limit: params.limit }),
    ...(params.scanIndexForward !== undefined && { ScanIndexForward: params.scanIndexForward }),
  })

  const response = await client.send(command)

  const items = (response.Items as Record<string, unknown>[]) || []
  const count = response.Count || 0
  const scannedCount = response.ScannedCount || 0

  logger.info(`[${requestId}] Query returned ${count} items (scanned ${scannedCount})`)

  return {
    success: true,
    output: { items, count, scannedCount },
  }
}

/**
 * Scans all items in a DynamoDB table with optional filter expressions.
 */
const handleScan: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    tableName: z.string().min(1, 'Table name is required'),
    filterExpression: z.string().optional(),
    expressionAttributeValues: z.record(z.unknown()).optional(),
    expressionAttributeNames: z.record(z.string()).optional(),
    limit: z.number().positive().optional(),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Scanning DynamoDB table ${params.tableName}`)

  const client = createDynamoDBClient(params)

  const command = new ScanCommand({
    TableName: params.tableName,
    ...(params.filterExpression && { FilterExpression: params.filterExpression }),
    ...(params.expressionAttributeValues && {
      ExpressionAttributeValues: params.expressionAttributeValues,
    }),
    ...(params.expressionAttributeNames && {
      ExpressionAttributeNames: params.expressionAttributeNames,
    }),
    ...(params.limit && { Limit: params.limit }),
  })

  const response = await client.send(command)

  const items = (response.Items as Record<string, unknown>[]) || []
  const count = response.Count || 0
  const scannedCount = response.ScannedCount || 0

  logger.info(`[${requestId}] Scan returned ${count} items (scanned ${scannedCount})`)

  return {
    success: true,
    output: { items, count, scannedCount },
  }
}

/**
 * Updates an item in a DynamoDB table using an update expression.
 */
const handleUpdate: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema.extend({
    tableName: z.string().min(1, 'Table name is required'),
    key: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
      message: 'Key is required',
    }),
    updateExpression: z.string().min(1, 'Update expression is required'),
    expressionAttributeValues: z.record(z.unknown()).optional(),
    expressionAttributeNames: z.record(z.string()).optional(),
    conditionExpression: z.string().optional(),
  })

  const params = schema.parse(body)

  logger.info(`[${requestId}] Updating item in DynamoDB table ${params.tableName}`)

  const client = createDynamoDBClient(params)

  const command = new UpdateCommand({
    TableName: params.tableName,
    Key: params.key,
    UpdateExpression: params.updateExpression,
    ...(params.expressionAttributeValues && {
      ExpressionAttributeValues: params.expressionAttributeValues,
    }),
    ...(params.expressionAttributeNames && {
      ExpressionAttributeNames: params.expressionAttributeNames,
    }),
    ...(params.conditionExpression && { ConditionExpression: params.conditionExpression }),
    ReturnValues: 'ALL_NEW',
  })

  const response = await client.send(command)
  const attributes = (response.Attributes as Record<string, unknown>) || null

  logger.info(`[${requestId}] Item updated successfully`)

  return {
    success: true,
    output: { attributes },
  }
}

/**
 * Introspects all DynamoDB tables in the configured region, returning schema details.
 */
const handleIntrospect: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = baseSchema

  const params = schema.parse(body)

  logger.info(`[${requestId}] Introspecting DynamoDB in region ${params.region}`)

  const client = createRawDynamoDBClient(params)

  try {
    const tableNames: string[] = []
    let exclusiveStartTableName: string | undefined

    do {
      const listCommand = new ListTablesCommand({
        ExclusiveStartTableName: exclusiveStartTableName,
      })

      const listResponse = await client.send(listCommand)
      if (listResponse.TableNames) {
        tableNames.push(...listResponse.TableNames)
      }
      exclusiveStartTableName = listResponse.LastEvaluatedTableName
    } while (exclusiveStartTableName)

    logger.info(`[${requestId}] Found ${tableNames.length} tables, describing each`)

    const tables = []

    for (const tableName of tableNames) {
      const describeCommand = new DescribeTableCommand({ TableName: tableName })
      const describeResponse = await client.send(describeCommand)
      const table = describeResponse.Table

      if (table) {
        tables.push({
          name: table.TableName || tableName,
          keySchema:
            table.KeySchema?.map((key) => ({
              attributeName: key.AttributeName || '',
              keyType: key.KeyType || 'HASH',
            })) || [],
          attributeDefinitions:
            table.AttributeDefinitions?.map((attr) => ({
              attributeName: attr.AttributeName || '',
              attributeType: attr.AttributeType || 'S',
            })) || [],
          itemCount: Number(table.ItemCount) || 0,
        })
      }
    }

    logger.info(`[${requestId}] Introspection completed, described ${tables.length} tables`)

    return {
      success: true,
      output: { tables },
    }
  } finally {
    client.destroy()
  }
}

export const dynamodbHandlers: Record<string, ToolProxyHandler> = {
  'get': handleGet,
  'put': handlePut,
  'delete': handleDelete,
  'query': handleQuery,
  'scan': handleScan,
  'update': handleUpdate,
  'introspect': handleIntrospect,
}
