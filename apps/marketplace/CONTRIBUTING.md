# Contributing to the  Marketplace

This guide explains how to add new integrations (tools, blocks, and triggers) to the Sim Integration Marketplace. Each integration is defined by a single `manifest.json` file — no TypeScript code required for the manifest itself.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [Manifest Schema Reference](#manifest-schema-reference)
- [Adding a New Integration](#adding-a-new-integration)
- [SubBlock Types](#subblock-types)
- [Execution Modes](#execution-modes)
- [Authentication](#authentication)
- [Triggers](#triggers)
- [Icons](#icons)
- [Testing Your Integration](#testing-your-integration)
- [Publishing Checklist](#publishing-checklist)
- [Examples](#examples)

---

## Architecture Overview

```
apps/marketplace/
├── integrations/           # One directory per integration
│   ├── slack/
│   │   └── manifest.json   # Defines block UI + tool config + trigger
│   ├── github/
│   │   └── manifest.json
│   └── ...
├── src/                    # Marketplace service code
│   ├── index.ts            # Hono server (port 3002)
│   ├── manifest-loader.ts  # Loads all manifests at startup
│   ├── types.ts            # TypeScript type definitions
│   └── routes/registry.ts  # API endpoints
└── scripts/
    └── generate-manifests.ts  # Auto-generator from legacy code
```

**How it works:**

1. The marketplace service starts and loads all `manifest.json` files from `integrations/`
2. The API server proxies registry requests to the marketplace (with API key auth)
3. The web app fetches block/tool definitions from the API's registry endpoint
4. When a tool is executed, the API server routes to the appropriate handler based on the manifest's `executionMode`

**Core blocks** (agent, function, condition, router, etc.) live in the API server — they don't need manifests. The marketplace only contains **connector** integrations (third-party service integrations like Slack, GitHub, Jira, etc.).

---

## Quick Start

1. Create a directory for your integration:
   ```
   mkdir integrations/myservice
   ```

2. Create `integrations/myservice/manifest.json` (see examples below)

3. Restart the marketplace service:
   ```
   cd apps/marketplace
   bun run dev
   ```

4. Verify your integration loaded:
   ```
   curl http://localhost:3002/api/marketplace/integrations/myservice
   ```

---

## Manifest Schema Reference

Every manifest.json must conform to this structure:

```jsonc
{
  // Top-level integration metadata
  "id": "myservice",           // Must match directory name
  "name": "My Service",        // Display name
  "version": "1.0.0",          // Semver version
  "description": "...",        // Short description
  "icon": "MyServiceIcon",     // Icon component name (see Icons section)

  // Block definition (UI configuration for the workflow canvas)
  "block": { ... },

  // Tool definitions (one or more)
  "tools": [ ... ],

  // Trigger definitions (optional, for webhook-triggered workflows)
  "triggers": [ ... ]
}
```

### Block Definition

The `block` object defines how the integration appears in the workflow editor:

```jsonc
{
  "block": {
    "type": "myservice",           // Unique block type ID
    "name": "My Service",          // Display name in toolbar
    "description": "Short desc",   // Tooltip description
    "longDescription": "...",      // Extended description (optional)
    "docsLink": "https://...",     // Link to docs (optional)
    "category": "tools",           // "tools" | "triggers" | "blocks"
    "bgColor": "#4A90D9",         // Hex color for the block
    "icon": "MyServiceIcon",       // Icon component name
    "authMode": "oauth",           // "oauth" | "api_key" | "bot_token" (optional)
    "hideFromToolbar": false,      // Hide from the block palette (optional)
    "triggerAllowed": false,       // Can this block be used as a trigger? (optional)

    "subBlocks": [ ... ],          // UI form fields (see SubBlock Types)

    "tools": {
      "access": ["myservice_action1", "myservice_action2"],
      "config": {
        "tool": "myservice_{{operation}}"  // Tool ID pattern
      }
    },

    "inputs": {
      "fieldName": { "type": "string", "description": "..." }
    },
    "outputs": {
      "result": { "type": "json", "description": "..." }
    }
  }
}
```

### Tool Definition

Each tool in the `tools` array defines one operation:

```jsonc
{
  "tools": [
    {
      "id": "myservice_search",        // Unique tool ID
      "name": "Search",                // Display name
      "description": "Search for...",  // What this tool does
      "version": "1.0.0",
      "executionMode": "proxy",        // "direct" | "proxy" | "sandbox"

      // Parameters the tool accepts
      "params": {
        "query": {
          "type": "string",
          "required": true,
          "description": "Search query"
        },
        "limit": {
          "type": "number",
          "required": false,
          "default": 10,
          "description": "Max results"
        }
      },

      // For proxy mode: which handler to use
      "proxy": {
        "handler": "myservice",        // Handler directory name
        "operation": "myservice_search" // Operation ID
      },

      // For direct mode: HTTP request config (see Execution Modes)
      "request": { ... },
      "response": { ... },

      // OAuth requirements
      "oauth": {
        "required": true,
        "provider": "myservice"
      },

      // Output definitions
      "outputs": {
        "results": { "type": "array", "description": "..." },
        "total": { "type": "number", "description": "..." }
      }
    }
  ]
}
```

### Trigger Definitions (Optional)

Triggers are defined as an array at the root level of the manifest. Single-trigger integrations have one entry; multi-trigger integrations (like GitHub with 12 event types) have multiple entries.

```jsonc
{
  "triggers": [
    {
      "id": "myservice_webhook",
      "name": "My Service Trigger",
      "provider": "myservice",
      "webhook": {
        "method": "POST"
      },
      "credentials": [
        {
          "id": "webhookSecret",
          "label": "Webhook Secret",
          "type": "password",
          "required": true,
          "description": "Secret for verifying webhook signatures"
        }
      ],
      "auth": {
        "type": "hmac",
        "headerName": "X-Signature",
        "secretField": "webhookSecret",
        "algorithm": "sha256"
      },
      "instructions": "1. Go to My Service settings\n2. Add webhook URL\n3. Copy the secret",
      "outputs": {
        "event": { "type": "json", "description": "The webhook event payload" },
        "eventType": { "type": "string", "description": "Type of event" }
      }
    }
  ]
}
```

---

## Adding a New Integration

### Step 1: Research the API

Before writing anything:

1. Read the service's API documentation thoroughly
2. Identify the key operations users would want (CRUD, search, etc.)
3. Note the authentication method (OAuth, API key, etc.)
4. Note the base URL, required headers, request/response formats
5. Get the brand color and find/create an SVG icon

### Step 2: Plan Your Operations

List all operations as tool IDs:

```
myservice_list_items
myservice_get_item
myservice_create_item
myservice_update_item
myservice_delete_item
myservice_search
```

### Step 3: Create the Manifest

Create `integrations/myservice/manifest.json`:

```json
{
  "id": "myservice",
  "name": "My Service",
  "version": "1.0.0",
  "description": "Manage items in My Service",
  "icon": "MyServiceIcon",
  "block": {
    "type": "myservice",
    "name": "My Service",
    "description": "Manage items in My Service",
    "category": "tools",
    "bgColor": "#4A90D9",
    "icon": "MyServiceIcon",
    "authMode": "api_key",
    "subBlocks": [
      {
        "id": "operation",
        "type": "dropdown",
        "title": "Operation",
        "options": [
          { "value": "list", "label": "List Items" },
          { "value": "get", "label": "Get Item" },
          { "value": "create", "label": "Create Item" },
          { "value": "update", "label": "Update Item" },
          { "value": "delete", "label": "Delete Item" },
          { "value": "search", "label": "Search" }
        ]
      },
      {
        "id": "credential",
        "type": "credential-selector",
        "title": "API Key"
      },
      {
        "id": "itemId",
        "type": "short-input",
        "title": "Item ID",
        "placeholder": "Enter item ID...",
        "condition": { "field": "operation", "value": ["get", "update", "delete"] }
      },
      {
        "id": "query",
        "type": "short-input",
        "title": "Search Query",
        "placeholder": "Search...",
        "condition": { "field": "operation", "value": "search" }
      },
      {
        "id": "data",
        "type": "long-input",
        "title": "Item Data (JSON)",
        "placeholder": "{ \"name\": \"...\", \"value\": \"...\" }",
        "condition": { "field": "operation", "value": ["create", "update"] }
      }
    ],
    "tools": {
      "access": [
        "myservice_list",
        "myservice_get",
        "myservice_create",
        "myservice_update",
        "myservice_delete",
        "myservice_search"
      ],
      "config": {
        "tool": "myservice_{{operation}}"
      }
    },
    "inputs": {
      "operation": { "type": "string" },
      "credential": { "type": "string" },
      "itemId": { "type": "string" },
      "query": { "type": "string" },
      "data": { "type": "json" }
    },
    "outputs": {
      "result": { "type": "json", "description": "Operation result" }
    }
  },
  "tools": [
    {
      "id": "myservice_list",
      "name": "List Items",
      "description": "List all items",
      "version": "1.0.0",
      "executionMode": "proxy",
      "params": {
        "limit": { "type": "number", "required": false, "default": 50 }
      },
      "proxy": { "handler": "myservice", "operation": "myservice_list" }
    },
    {
      "id": "myservice_get",
      "name": "Get Item",
      "description": "Get a single item by ID",
      "version": "1.0.0",
      "executionMode": "proxy",
      "params": {
        "itemId": { "type": "string", "required": true }
      },
      "proxy": { "handler": "myservice", "operation": "myservice_get" }
    },
    {
      "id": "myservice_create",
      "name": "Create Item",
      "description": "Create a new item",
      "version": "1.0.0",
      "executionMode": "proxy",
      "params": {
        "data": { "type": "object", "required": true }
      },
      "proxy": { "handler": "myservice", "operation": "myservice_create" }
    },
    {
      "id": "myservice_update",
      "name": "Update Item",
      "description": "Update an existing item",
      "version": "1.0.0",
      "executionMode": "proxy",
      "params": {
        "itemId": { "type": "string", "required": true },
        "data": { "type": "object", "required": true }
      },
      "proxy": { "handler": "myservice", "operation": "myservice_update" }
    },
    {
      "id": "myservice_delete",
      "name": "Delete Item",
      "description": "Delete an item",
      "version": "1.0.0",
      "executionMode": "proxy",
      "params": {
        "itemId": { "type": "string", "required": true }
      },
      "proxy": { "handler": "myservice", "operation": "myservice_delete" }
    },
    {
      "id": "myservice_search",
      "name": "Search Items",
      "description": "Search for items",
      "version": "1.0.0",
      "executionMode": "proxy",
      "params": {
        "query": { "type": "string", "required": true },
        "limit": { "type": "number", "required": false, "default": 10 }
      },
      "proxy": { "handler": "myservice", "operation": "myservice_search" }
    }
  ]
}
```

### Step 4: Add the Icon

If your service's icon doesn't exist yet, add it to `apps/web/src/components/icons.tsx`:

```tsx
export function MyServiceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      {/* SVG paths from the service's brand assets */}
    </svg>
  )
}
```

Then register it in `apps/web/src/lib/registry/icon-resolver.ts`:

```typescript
import { MyServiceIcon } from '@/components/icons'

const ICON_MAP = {
  // ... existing icons
  MyServiceIcon,
}
```

### Step 5: Create the Tool Handler (Proxy Mode)

For proxy-mode tools, create a handler in the marketplace at `apps/marketplace/integrations/myservice/handler.ts`:

```typescript
import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    myservice_list: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const response = await fetch(`https://api.myservice.com/v1/items?limit=${params.limit || 50}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const data = await response.json()
      return { success: true, output: { items: data.items, total: data.total } }
    },

    myservice_get: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const response = await fetch(`https://api.myservice.com/v1/items/${params.itemId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const data = await response.json()
      return { success: true, output: { item: data } }
    },

    // ... other operations
  },
}

export default handler
```

The marketplace auto-discovers `handler.ts` files at startup. No registration step needed.

### Step 6: Create Tests

Create `apps/marketplace/integrations/myservice/handler.test.ts`:

```typescript
/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockFetch } from '../../sdk/testing'
import handler from './handler'

describe('myservice handler', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('lists items', async () => {
    vi.stubGlobal('fetch', createMockFetch([{
      body: { items: [{ id: '1', name: 'Test' }], total: 1 }
    }]))
    const result = await handler.operations.myservice_list(
      { apiKey: 'key' },
      createMockContext()
    )
    expect(result.success).toBe(true)
    expect(result.output.items).toHaveLength(1)
  })
})
```

Run tests: `cd apps/marketplace && bunx vitest run integrations/myservice/`

---

## SubBlock Types

SubBlocks are the UI form fields shown in the block configuration panel.

| Type | Description | Additional Props |
|------|-------------|-----------------|
| `dropdown` | Select from options | `options: [{value, label}]` |
| `short-input` | Single-line text input | `placeholder`, `password` |
| `long-input` | Multi-line text input | `placeholder` |
| `code` | Code editor | `language` |
| `slider` | Numeric slider | `min`, `max`, `step` |
| `switch` | Toggle on/off | - |
| `file-upload` | File upload | `canonicalParamId` |
| `checkbox-list` | Multiple checkboxes | `options: [{value, label}]` |
| `radio-group` | Radio buttons | `options: [{value, label}]` |
| `table` | Table editor | `columns: [{key, label}]` |
| `oauth-account` | OAuth account selector | - |
| `credential-selector` | API key selector | - |
| `tool-input` | Tool configuration | - |
| `eval-input` | Evaluation criteria | - |
| `date-picker` | Date selection | - |
| `time-picker` | Time selection | - |

### Conditional Visibility

Show/hide fields based on other field values:

```json
{
  "id": "channelId",
  "type": "short-input",
  "title": "Channel ID",
  "condition": { "field": "operation", "value": "send" }
}
```

**Condition patterns:**

```jsonc
// Show when operation === "send"
{ "field": "operation", "value": "send" }

// Show when operation is "send" OR "update"
{ "field": "operation", "value": ["send", "update"] }

// Show when operation !== "list"
{ "field": "operation", "value": "list", "not": true }

// Complex: operation is "send" AND destinationType is NOT "dm"
{
  "field": "operation",
  "value": "send",
  "and": { "field": "destinationType", "value": "dm", "not": true }
}
```

### Dependencies

Clear a field when its dependency changes:

```json
{
  "id": "channel",
  "type": "short-input",
  "title": "Channel",
  "dependsOn": ["credential"]
}
```

### Mode

Control when a field is shown:

```json
{
  "id": "fileUpload",
  "type": "file-upload",
  "title": "Upload File",
  "mode": "basic",
  "canonicalParamId": "file"
}
```

- `basic` - Shown only in basic mode
- `advanced` - Shown only in advanced mode
- `both` - Shown in both modes
- `trigger` - Shown only in trigger mode

---

## Execution Modes

### Proxy Mode (Recommended for Most Integrations)

The tool handler lives in the API server. The manifest just defines the UI and parameters.

```json
{
  "executionMode": "proxy",
  "proxy": {
    "handler": "slack",
    "operation": "slack_message"
  }
}
```

Use this when:
- The API interaction is complex (multi-step, file handling, pagination)
- You need OAuth token management
- The response needs significant transformation

### Direct Mode (Simple API Calls)

The marketplace handles the HTTP call directly using template interpolation.

```json
{
  "executionMode": "direct",
  "request": {
    "url": "https://api.service.com/search?q={{params.query}}",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer {{params.apiKey}}"
    }
  },
  "response": {
    "outputMapping": {
      "results": "$.data.items",
      "total": "$.meta.total"
    }
  }
}
```

Template syntax:
- `{{params.query}}` - Parameter value
- `{{params.limit|default:10}}` - With default
- `{{params.query|urlencode}}` - URL-encoded

Output mapping (JSONPath-lite):
- `$` - Entire response
- `$.field` - Top-level field
- `$.data.nested` - Nested field
- `$.items[0].name` - Array index
- `$.items[*].title` - Map over array

Use this when:
- The API call is a simple GET/POST with direct field mapping
- No OAuth token refresh needed
- Response maps cleanly to outputs

### Sandbox Mode (Code Execution)

For tools that require executing arbitrary code (not yet fully implemented).

---

## Authentication

### OAuth

```json
{
  "block": {
    "authMode": "oauth",
    "subBlocks": [
      { "id": "credential", "type": "oauth-account", "title": "Account" }
    ]
  },
  "tools": [{
    "oauth": { "required": true, "provider": "slack" }
  }]
}
```

### API Key

```json
{
  "block": {
    "authMode": "api_key",
    "subBlocks": [
      { "id": "credential", "type": "credential-selector", "title": "API Key" }
    ]
  }
}
```

### Bot Token

```json
{
  "block": {
    "authMode": "bot_token",
    "subBlocks": [
      { "id": "botToken", "type": "short-input", "title": "Bot Token", "password": true }
    ]
  }
}
```

---

## Triggers

Triggers allow integrations to start workflows via webhooks.

### Webhook Trigger

```json
{
  "triggers": [
    {
      "id": "github_push",
      "name": "GitHub Push",
      "provider": "github",
      "webhook": { "method": "POST" },
      "credentials": [
        {
          "id": "webhookSecret",
          "label": "Webhook Secret",
          "type": "password",
          "required": true
        }
      ],
      "auth": {
        "type": "hmac",
        "headerName": "X-Hub-Signature-256",
        "secretField": "webhookSecret",
        "algorithm": "sha256",
        "encoding": "hex",
        "signaturePrefix": "sha256="
      },
      "instructions": "1. Go to your GitHub repository Settings > Webhooks\n2. Add a new webhook\n3. Set the Payload URL to the webhook URL shown above\n4. Set Content type to application/json\n5. Enter a secret and paste it here\n6. Select the events you want to trigger on",
      "outputs": {
        "event": { "type": "json", "description": "Full webhook event payload" },
        "action": { "type": "string", "description": "Event action (created, updated, etc.)" }
      }
    }
  ]
}
```

### Auth Types for Triggers

**HMAC** (GitHub, Slack, Stripe):
```json
{ "type": "hmac", "headerName": "X-Signature", "secretField": "webhookSecret", "algorithm": "sha256" }
```

**Bearer Token** (simple token verification):
```json
{ "type": "bearer", "headerName": "Authorization", "secretField": "apiToken" }
```

**Custom** (complex verification logic):
```json
{ "type": "custom", "handler": "myservice" }
```

---

## Icons

Icons are React SVG components defined in `apps/web/src/components/icons.tsx`. The manifest references them by name (e.g., `"SlackIcon"`).

### Existing Icons

Check `apps/web/src/lib/registry/icon-resolver.ts` for all available icons. Common ones: `SlackIcon`, `GithubIcon`, `GmailIcon`, `JiraIcon`, `NotionIcon`, `DiscordIcon`, `StripeIcon`, etc.

### Adding a New Icon

1. Find the official SVG for the service (from brand resources or simpleicons.org)
2. Add it as a named export in `apps/web/src/components/icons.tsx`
3. Register it in `apps/web/src/lib/registry/icon-resolver.ts`

Naming convention: `{ServiceName}Icon` (PascalCase) — e.g., `MyServiceIcon`

---

## Testing Your Integration

### 1. Validate the Manifest

```bash
# Start the marketplace
cd apps/marketplace && bun run dev

# Check it loaded
curl http://localhost:3002/api/marketplace/stats
# Should show your integration in the counts

# Check your specific integration
curl http://localhost:3002/api/marketplace/integrations/myservice
```

### 2. Verify Block Renders

```bash
# Start all services
bun run dev

# Open the web app at http://localhost:5173
# Your block should appear in the toolbar under the correct category
# Click it and verify all subBlocks render correctly
# Test conditional visibility by changing the operation dropdown
```

### 3. Test Tool Execution

1. Create a workflow with your block
2. Configure all required fields
3. Execute the workflow
4. Verify the tool output matches expected format

### 4. Validate JSON Schema

```bash
# Quick JSON syntax check
cat integrations/myservice/manifest.json | bun -e "JSON.parse(await Bun.stdin.text()); console.log('Valid JSON')"
```

---

## Publishing Checklist

Before submitting your integration:

- [ ] `manifest.json` passes JSON validation
- [ ] `id` matches the directory name
- [ ] All tool IDs follow the convention: `{service}_{action}` (snake_case)
- [ ] Block `type` is unique and not used by any existing block
- [ ] All required subBlocks have `required: true` or appropriate conditions
- [ ] `bgColor` is the service's brand color (hex format)
- [ ] `icon` references a valid icon component
- [ ] `description` is concise (under 200 chars)
- [ ] `longDescription` explains all capabilities
- [ ] `docsLink` points to valid documentation
- [ ] All tool `params` have `type` and `description`
- [ ] All tool `outputs` have `type` and `description`
- [ ] Conditional visibility (`condition`) works correctly for operation-specific fields
- [ ] OAuth/API key requirements are properly declared
- [ ] Tool handler exists in `apps/marketplace/integrations/{service}/handler.ts` (for proxy mode)
- [ ] Handler tests exist in `apps/marketplace/integrations/{service}/handler.test.ts`
- [ ] Integration loads without errors on marketplace startup
- [ ] Block renders correctly in the web app
- [ ] At least one tool execution succeeds end-to-end

---

## Examples

### Simple Integration (1 tool, API key auth)

See: `integrations/duckduckgo/manifest.json`

### Multi-Operation Integration (OAuth)

See: `integrations/slack/manifest.json`

### Complex Integration (Many Operations)

See: `integrations/github/manifest.json`

### Integration with Trigger

See: `integrations/slack/manifest.json` (has `triggers` array)

### Direct-Mode Tool (No handler code needed)

See: `integrations/tavily/manifest.json` (for future direct-mode examples)

---

## Getting Help

- Check existing manifests in `integrations/` for patterns
- Look at the TypeScript types in `apps/marketplace/src/types.ts` and `apps/api/src/integrations/types.ts`
- For tool handler patterns, see `apps/marketplace/integrations/wikipedia/handler.ts` or `apps/marketplace/integrations/slack/handler.ts`
- For trigger patterns, see `apps/marketplace/integrations/github/manifest.json` (multi-trigger) or `apps/marketplace/integrations/stripe/manifest.json` (single-trigger with custom auth)
