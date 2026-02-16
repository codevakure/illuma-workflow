# Adding a New Tool Integration

This guide walks through creating a new tool integration for the marketplace.

## 1. Create the Directory

```bash
mkdir integrations/my_service
```

## 2. Write the Manifest

Create `integrations/my_service/manifest.json`:

```json
{
  "id": "my_service",
  "name": "My Service",
  "version": "1.0.0",
  "description": "Integration with My Service",
  "icon": "MyServiceIcon",
  "block": {
    "type": "my_service",
    "name": "My Service",
    "description": "Interact with My Service",
    "category": "tools",
    "bgColor": "#6366f1",
    "icon": "MyServiceIcon",
    "subBlocks": [
      {
        "id": "operation",
        "title": "Operation",
        "type": "dropdown",
        "options": [
          { "value": "search", "label": "Search" },
          { "value": "create", "label": "Create" }
        ],
        "default": "search"
      },
      {
        "id": "query",
        "title": "Query",
        "type": "short-input",
        "placeholder": "Enter search query...",
        "condition": { "field": "operation", "value": "search" }
      },
      {
        "id": "apiKey",
        "title": "API Key",
        "type": "short-input",
        "placeholder": "Enter API key...",
        "password": true,
        "required": true
      }
    ],
    "tools": {
      "access": ["my_service_search", "my_service_create"],
      "config": {
        "tool": "my_service_{{operation}}"
      }
    },
    "inputs": {
      "query": { "type": "string", "description": "Search query" },
      "apiKey": { "type": "string", "description": "API key" }
    },
    "outputs": {
      "results": { "type": "json", "description": "Search results" }
    }
  },
  "tools": [
    {
      "id": "my_service_search",
      "name": "Search",
      "description": "Search My Service",
      "version": "1.0.0",
      "executionMode": "proxy",
      "params": {
        "query": { "type": "string", "required": true, "description": "Search query" },
        "apiKey": { "type": "string", "required": true, "description": "API key" }
      },
      "outputs": {
        "results": { "type": "json", "description": "Search results" }
      },
      "proxy": {
        "handler": "my_service",
        "operation": "my_service_search"
      }
    }
  ]
}
```

### Key Rules

- `id` must match the directory name
- `block.type` must match `id`
- Every tool must be listed in `block.tools.access`
- `block.tools.config.tool` maps block params to tool IDs (use `{{param}}` templates)

## 3. Write the Handler

Create `integrations/my_service/handler.ts`:

```typescript
import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    my_service_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const query = params.query as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing API key' }
      }
      if (!query) {
        return { success: false, output: {}, error: 'Missing query' }
      }

      const response = await fetch('https://api.myservice.com/search', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: `API error: ${response.status} ${response.statusText}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: { results: data.results },
      }
    },
  },
}

export default handler
```

### Handler Pattern

- Import `ToolHandler` from `../../sdk/types`
- Export a default `ToolHandler` object with an `operations` map
- Each operation key matches a tool ID from the manifest
- Operations receive `(params, ctx)` and return `HandlerResult`
- Use `ctx.apiKey` for API keys, `ctx.accessToken` for OAuth tokens

## 4. Add an Icon

Add your service's SVG icon to the web app's icon registry at `apps/web/src/components/icons.tsx`. The icon name must match the `icon` field in your manifest.

## 5. Test

Start the marketplace server and use the test UI:

```bash
cd apps/marketplace && bun run dev
```

Visit `http://localhost:3002/ui` to find your integration, then click "Test" on any tool.

## Checklist

- [ ] Directory created: `integrations/{service}/`
- [ ] `manifest.json` with valid block + tools
- [ ] `handler.ts` with all operations implemented
- [ ] Icon added to web app (if new service)
- [ ] Tested via marketplace UI
- [ ] `bun run type-check` passes
