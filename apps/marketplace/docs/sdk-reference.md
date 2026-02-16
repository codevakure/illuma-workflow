# SDK Reference

The marketplace SDK (`sdk/types.ts`) provides TypeScript types for writing handler files.

## ToolHandler

The default export of every `handler.ts` file.

```typescript
interface ToolHandler {
  operations: Record<string, OperationHandler>
  validateCredentials?: (credentials: Record<string, unknown>) => Promise<void>
}
```

## OperationHandler

A function that implements a single tool operation.

```typescript
type OperationHandler = (
  params: Record<string, unknown>,
  ctx: HandlerContext
) => Promise<HandlerResult>
```

## HandlerContext

Context passed to every operation invocation. Contains credentials and metadata.

```typescript
interface HandlerContext {
  /** OAuth access token (resolved by API before calling marketplace) */
  accessToken?: string

  /** API key or bot token (from user credentials) */
  apiKey?: string

  /** Workspace ID for multi-tenant isolation */
  workspaceId?: string

  /** Workflow ID for context */
  workflowId?: string

  /** Unique request ID for tracing */
  requestId: string

  /** Helper to download files from storage */
  downloadFile?: (fileRef: unknown) => Promise<Buffer>
}
```

### Credential Resolution

- **OAuth integrations**: Use `ctx.accessToken` for the Bearer token.
- **API key integrations**: Use `ctx.apiKey` or `params.apiKey` (fallback to param for user-provided keys).
- **No auth**: No credentials needed.

## HandlerResult

Standard return type from every operation.

```typescript
interface HandlerResult {
  success: boolean
  output: Record<string, unknown>
  error?: string
}
```

### Success Example

```typescript
return {
  success: true,
  output: {
    results: data.items,
    totalCount: data.total,
  },
}
```

### Error Example

```typescript
return {
  success: false,
  output: {},
  error: `API returned ${response.status}: ${errorMessage}`,
}
```

## Common Patterns

### OAuth API Call

```typescript
const response = await fetch('https://api.service.com/endpoint', {
  headers: { Authorization: `Bearer ${ctx.accessToken}` },
})
```

### API Key Authentication

```typescript
const apiKey = (ctx.apiKey || params.apiKey) as string
if (!apiKey) {
  return { success: false, output: {}, error: 'Missing API key' }
}
```

### Parameter Validation

```typescript
const query = params.query as string
if (!query) {
  return { success: false, output: {}, error: 'Missing required parameter: query' }
}
```

### Error Handling

```typescript
if (!response.ok) {
  const errorText = await response.text().catch(() => '')
  return {
    success: false,
    output: {},
    error: `Service error: ${response.status} ${errorText}`,
  }
}
```

### Multi-Step Operations

```typescript
// Step 1: Look up channel
const channelRes = await fetch(`https://api.slack.com/conversations.list`, { ... })
const channel = (await channelRes.json()).channels.find(c => c.name === params.channel)

// Step 2: Send message
const msgRes = await fetch(`https://api.slack.com/chat.postMessage`, {
  method: 'POST',
  body: JSON.stringify({ channel: channel.id, text: params.message }),
})
```
