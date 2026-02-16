# sim-v2 Development Guidelines

## Architecture Overview

sim-v2 is a monorepo with three apps and shared packages:

```
apps/
  api/          # Hono server (port 3001) - workflow engine, core blocks, executor
  marketplace/  # Hono server (port 3002) - tool integrations registry + execution
  web/          # Vite + React (port 5173) - frontend UI
packages/
  testing/      # @sim/testing - shared test utilities, mocks, factories
  ts-sdk/       # @sim/ts-sdk - TypeScript SDK
  tsconfig/     # Shared TypeScript configs
```

### Separation of Concerns

**API owns core blocks.** Manifests live in `apps/api/src/blocks/manifests/`. These are blocks that control workflow traversal and need executor context:
- Core blocks (category=blocks): starter, agent, condition, router, router_v2, function, evaluator, response, variables, wait, note, knowledge, memory, workflow, human_in_the_loop, guardrails
- Core blocks (category=tools): thinking, parallel_ai (they appear in the tools toolbar but are executor-level)
- Trigger blocks (category=triggers): schedule, start_trigger, api_trigger, chat_trigger, generic_webhook, input_trigger, manual_trigger, webhook_request

**Marketplace owns tool integrations.** Manifests + handlers live in `apps/marketplace/integrations/`. These call external APIs or run self-contained logic:
- ~135 integrations: slack, gmail, github, wikipedia, arxiv, google_books, etc.
- Each has: `manifest.json` (block UI + tool schemas) and optionally `handler.ts` (operation logic)

**Web app fetches everything from one endpoint:** `GET /api/registry/integrations`. The API aggregates core blocks (local) + tools (marketplace).

### Data Flow

```
Web App  -->  API /api/registry/integrations  -->  core blocks (local manifests)
                                              -->  tool blocks (marketplace proxy/fallback)

Workflow Execution:
  Executor --> getBlock(type) --> manifestRegistry (has all blocks)
  Executor --> executeTool(id) --> custom tool? DB lookup
                               --> MCP tool? MCP server
                               --> else? POST marketplace /api/marketplace/tools/:id/execute
```

## Global Standards

- **Logging**: Import `createLogger` from `@sim/logger`. Use `logger.info`, `logger.warn`, `logger.error`
- **Package Manager**: Use `bun` and `bunx`, not `npm` and `npx`
- **Testing**: Use Vitest. Import from `vitest`. Use `@sim/testing` for mocks/factories
- **TypeScript**: No `any`. Use proper types or `unknown` with type guards

## Running Tests

```bash
# Marketplace tests (131 tests)
cd apps/marketplace && bunx vitest run

# API tests (new tests for marketplace integration)
cd apps/api && bunx vitest run src/tools/marketplace-delegation.test.ts src/integrations/manifest-loader.test.ts

# All API tests (includes pre-existing tests)
cd apps/api && bunx vitest run
```

## Running Servers

```bash
# Start all three (from repo root)
bun run dev

# Or individually:
cd apps/api && bun run dev          # port 3001
cd apps/marketplace && bun run dev  # port 3002
cd apps/web && bun run dev          # port 5173
```

## Key Files

### API
| File | Purpose |
|------|---------|
| `src/blocks/manifests/` | 26 core block + trigger manifest JSON files |
| `src/blocks/registry.ts` | Block registry (lazy-loads from manifestRegistry) |
| `src/blocks/manifest-adapter.ts` | Converts BlockManifest -> BlockConfig for executor |
| `src/integrations/manifest-loader.ts` | Loads manifests from both `blocks/manifests/` (core) and `marketplace/integrations/` (tools) |
| `src/routes/registry.ts` | Registry API routes - aggregates core + marketplace |
| `src/tools/index.ts` | `executeTool()` - dispatches to custom/MCP/marketplace |
| `src/executor/` | Workflow execution engine |

### Marketplace
| File | Purpose |
|------|---------|
| `integrations/` | ~135 tool integration folders (manifest.json + optional handler.ts) |
| `sdk/types.ts` | HandlerContext, HandlerResult, ToolHandler, OperationHandler |
| `sdk/testing.ts` | createMockContext, createMockFetch, test helpers |
| `sdk/utils.ts` | SSRF validation, URL helpers |
| `src/manifest-loader.ts` | Loads and validates tool manifests at startup |
| `src/handler-loader.ts` | Loads handler.ts files, builds operation registry |
| `src/handler-runtime.ts` | Executes handler operations with timeout/error handling |
| `src/routes/execute.ts` | POST /tools/:id/execute, /test, /validate endpoints |
| `src/index.ts` | Hono server entry point |

### Web
| File | Purpose |
|------|---------|
| `src/hooks/queries/registry.ts` | React Query hook for `/api/registry/integrations` |
| `src/stores/registry/store.ts` | Zustand store for block/tool registry |
| `src/blocks/registry.ts` | Block registry proxy (reads from registry store) |

## Adding a New Tool Integration

Work entirely in `apps/marketplace/`:

1. Create `integrations/{service}/manifest.json` with block UI + tool schemas
2. Create `integrations/{service}/handler.ts` implementing `ToolHandler`
3. Create `integrations/{service}/handler.test.ts` with unit tests
4. Run tests: `cd apps/marketplace && bunx vitest run integrations/{service}/`

No API changes needed. The marketplace auto-discovers new integrations at startup.

### Handler Template

```typescript
import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    service_action: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      // ... implementation
      return { success: true, output: { /* results */ } }
    },
  },
}

export default handler
```

### Test Template

```typescript
/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockFetch } from '../../sdk/testing'
import handler from './handler'

describe('service handler', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns results', async () => {
    vi.stubGlobal('fetch', createMockFetch([{ body: { /* mock response */ } }]))
    const result = await handler.operations.service_action(
      { query: 'test', apiKey: 'key' },
      createMockContext()
    )
    expect(result.success).toBe(true)
  })
})
```

## Migration Status

### Completed
- Phase 0: Test infrastructure (vitest configs for API + marketplace)
- Phase 1: SDK + handler runtime + execute endpoint (sdk/, handler-loader, handler-runtime, routes/execute)
- Phase 2: First 4 tool handlers + API delegation (wikipedia, duckduckgo, arxiv, google_books)
- Phase 3: Core block manifests moved to API (26 manifests moved, registry routes updated)

### Next: Phase 4 - Documentation Portal
- Create `apps/marketplace/docs/` with markdown guides
- Create `src/routes/docs.ts` to serve rendered docs
- Auto-generate integration reference from manifests

### Future: Phase 5 - Marketplace UI
- React SPA at `/ui` for browsing/testing tools

### Future: Phase 6 - Batch Migrate Remaining ~131 Tool Integrations
- Write handler.ts + handler.test.ts for all remaining tools
- Remove corresponding ToolConfig + proxy handlers from API
- Eventually delete `apps/api/src/tools/` (except custom tool + MCP code)

## Cross-Reference: sim Legacy

The original sim monolith is at `C:\Projects\Chat\agent-builders\sim\`. Before modifying any tool handler, check the sim legacy equivalent:

| sim-v2 location | sim legacy equivalent |
|---|---|
| `api/src/tools/index.ts` | `sim/apps/sim/tools/index.ts` |
| `api/src/executor/handlers/` | `sim/apps/sim/executor/handlers/` |
| `api/src/blocks/registry.ts` | `sim/apps/sim/blocks/registry.ts` |
| `marketplace/integrations/{service}/handler.ts` | `sim/apps/sim/tools/{service}/` + `sim/apps/sim/app/api/tools/{service}/` |
