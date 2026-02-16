import type { ToolHandler } from '../../sdk/types'

/**
 * Creates a DynamoDB Document Client from params.
 */
async function createDocumentClient(params: Record<string, unknown>) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb')
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb')

  const region = params.region as string
  const accessKeyId = params.accessKeyId as string
  const secretAccessKey = params.secretAccessKey as string
  const endpoint = params.endpoint as string | undefined

  const client = new DynamoDBClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint && { endpoint }),
  })

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
    unmarshallOptions: { wrapNumbers: false },
  })
}

/**
 * Creates a raw DynamoDB client for operations that do not require DocumentClient.
 */
async function createRawClient(params: Record<string, unknown>) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb')

  const region = params.region as string
  const accessKeyId = params.accessKeyId as string
  const secretAccessKey = params.secretAccessKey as string
  const endpoint = params.endpoint as string | undefined

  return new DynamoDBClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint && { endpoint }),
  })
}

const handler: ToolHandler = {
  operations: {
    dynamodb_get: async (params) => {
      const { GetCommand } = await import('@aws-sdk/lib-dynamodb')

      const tableName = params.tableName as string
      const key = params.key as Record<string, unknown>

      if (!tableName) {
        return { success: false, output: {}, error: 'Missing required parameter: tableName' }
      }
      if (!key || Object.keys(key).length === 0) {
        return { success: false, output: {}, error: 'Missing required parameter: key' }
      }

      const client = await createDocumentClient(params)
      const command = new GetCommand({ TableName: tableName, Key: key })
      const response = await client.send(command)
      const item = (response.Item as Record<string, unknown>) || null

      return {
        success: true,
        output: { item },
      }
    },

    dynamodb_put: async (params) => {
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb')

      const tableName = params.tableName as string
      const item = params.item as Record<string, unknown>

      if (!tableName) {
        return { success: false, output: {}, error: 'Missing required parameter: tableName' }
      }
      if (!item || Object.keys(item).length === 0) {
        return { success: false, output: {}, error: 'Missing required parameter: item' }
      }

      const client = await createDocumentClient(params)
      const command = new PutCommand({ TableName: tableName, Item: item })
      await client.send(command)

      return {
        success: true,
        output: { item },
      }
    },

    dynamodb_delete: async (params) => {
      const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb')

      const tableName = params.tableName as string
      const key = params.key as Record<string, unknown>

      if (!tableName) {
        return { success: false, output: {}, error: 'Missing required parameter: tableName' }
      }
      if (!key || Object.keys(key).length === 0) {
        return { success: false, output: {}, error: 'Missing required parameter: key' }
      }

      const client = await createDocumentClient(params)
      const command = new DeleteCommand({ TableName: tableName, Key: key })
      await client.send(command)

      return {
        success: true,
        output: {},
      }
    },

    dynamodb_query: async (params) => {
      const { QueryCommand } = await import('@aws-sdk/lib-dynamodb')

      const tableName = params.tableName as string
      const keyConditionExpression = params.keyConditionExpression as string

      if (!tableName) {
        return { success: false, output: {}, error: 'Missing required parameter: tableName' }
      }
      if (!keyConditionExpression) {
        return { success: false, output: {}, error: 'Missing required parameter: keyConditionExpression' }
      }

      const client = await createDocumentClient(params)

      const commandInput: Record<string, unknown> = {
        TableName: tableName,
        KeyConditionExpression: keyConditionExpression,
      }

      if (params.expressionAttributeValues) {
        commandInput.ExpressionAttributeValues = params.expressionAttributeValues
      }
      if (params.expressionAttributeNames) {
        commandInput.ExpressionAttributeNames = params.expressionAttributeNames
      }
      if (params.filterExpression) {
        commandInput.FilterExpression = params.filterExpression
      }
      if (params.limit) {
        commandInput.Limit = Number(params.limit)
      }
      if (params.scanIndexForward !== undefined) {
        commandInput.ScanIndexForward = params.scanIndexForward
      }

      const command = new QueryCommand(commandInput as Parameters<typeof QueryCommand['prototype']['constructor']>[0])
      const response = await client.send(command)

      const items = (response.Items as Record<string, unknown>[]) || []
      const count = response.Count || 0
      const scannedCount = response.ScannedCount || 0

      return {
        success: true,
        output: { items, count, scannedCount },
      }
    },

    dynamodb_scan: async (params) => {
      const { ScanCommand } = await import('@aws-sdk/lib-dynamodb')

      const tableName = params.tableName as string

      if (!tableName) {
        return { success: false, output: {}, error: 'Missing required parameter: tableName' }
      }

      const client = await createDocumentClient(params)

      const commandInput: Record<string, unknown> = {
        TableName: tableName,
      }

      if (params.filterExpression) {
        commandInput.FilterExpression = params.filterExpression
      }
      if (params.expressionAttributeValues) {
        commandInput.ExpressionAttributeValues = params.expressionAttributeValues
      }
      if (params.expressionAttributeNames) {
        commandInput.ExpressionAttributeNames = params.expressionAttributeNames
      }
      if (params.limit) {
        commandInput.Limit = Number(params.limit)
      }

      const command = new ScanCommand(commandInput as Parameters<typeof ScanCommand['prototype']['constructor']>[0])
      const response = await client.send(command)

      const items = (response.Items as Record<string, unknown>[]) || []
      const count = response.Count || 0
      const scannedCount = response.ScannedCount || 0

      return {
        success: true,
        output: { items, count, scannedCount },
      }
    },

    dynamodb_update: async (params) => {
      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb')

      const tableName = params.tableName as string
      const key = params.key as Record<string, unknown>
      const updateExpression = params.updateExpression as string

      if (!tableName) {
        return { success: false, output: {}, error: 'Missing required parameter: tableName' }
      }
      if (!key || Object.keys(key).length === 0) {
        return { success: false, output: {}, error: 'Missing required parameter: key' }
      }
      if (!updateExpression) {
        return { success: false, output: {}, error: 'Missing required parameter: updateExpression' }
      }

      const client = await createDocumentClient(params)

      const commandInput: Record<string, unknown> = {
        TableName: tableName,
        Key: key,
        UpdateExpression: updateExpression,
        ReturnValues: 'ALL_NEW',
      }

      if (params.expressionAttributeValues) {
        commandInput.ExpressionAttributeValues = params.expressionAttributeValues
      }
      if (params.expressionAttributeNames) {
        commandInput.ExpressionAttributeNames = params.expressionAttributeNames
      }
      if (params.conditionExpression) {
        commandInput.ConditionExpression = params.conditionExpression
      }

      const command = new UpdateCommand(commandInput as Parameters<typeof UpdateCommand['prototype']['constructor']>[0])
      const response = await client.send(command)
      const attributes = (response.Attributes as Record<string, unknown>) || null

      return {
        success: true,
        output: { attributes },
      }
    },

    dynamodb_introspect: async (params) => {
      const { ListTablesCommand, DescribeTableCommand } = await import('@aws-sdk/client-dynamodb')

      const region = params.region as string
      if (!region) {
        return { success: false, output: {}, error: 'Missing required parameter: region' }
      }

      const client = await createRawClient(params)

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

        return {
          success: true,
          output: { tables },
        }
      } finally {
        client.destroy()
      }
    },
  },
}

export default handler
