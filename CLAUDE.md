# sim-v2 Development Guidelines

## Architecture Overview

sim-v2 is a monorepo with three apps and shared packages:

```
apps/
  api/          # Hono server (port 3001) - workflow engine, core blocks, executor, triggers, webhook processing
  marketplace/  # Hono server (port 3002) - tool integrations registry + execution + custom auth handlers
  web/          # Vite + React (port 5173) - frontend UI
packages/
  testing/      # @sim/testing - shared test utilities, mocks, factories
  ts-sdk/       # @sim/ts-sdk - TypeScript SDK
  tsconfig/     # Shared TypeScript configs
```

### Separation of Concerns

**API owns core blocks and triggers.** Manifests live in `apps/api/src/blocks/manifests/`. These are blocks that control workflow traversal and need executor context:
- Core blocks (category=blocks): starter, agent, condition, router, router_v2, function, evaluator, response, variables, wait, note, knowledge, memory, workflow, human_in_the_loop, guardrails
- Core blocks (category=tools): thinking, parallel_ai (they appear in the tools toolbar but are executor-level)
- Trigger blocks (category=triggers): schedule, start_trigger, api_trigger, chat_trigger, generic_webhook, input_trigger, manual_trigger, webhook_request

**Marketplace owns tool integrations and trigger definitions.** Manifests + handlers live in `apps/marketplace/integrations/`. These call external APIs or run self-contained logic:
- ~135 integrations: slack, gmail, github, wikipedia, arxiv, google_books, etc.
- Each has: `manifest.json` (block UI + tool schemas + trigger definitions) and optionally `handler.ts` (operation logic)
- Trigger data (auth, challenge, outputs, credentials) is defined in each integration's `manifest.json` under the `triggers[]` array

**Web app fetches everything from one endpoint:** `GET /api/registry/integrations`. The API aggregates core blocks (local) + tools (marketplace). Trigger data flows through the same endpoint embedded in integrations.

### Data Flow

```
Web App  -->  API /api/registry/integrations  -->  core blocks (local manifests)
                                              -->  tool blocks (marketplace integrations)
                                              -->  trigger data (embedded in integration manifests)

Trigger Data Flow:
  manifest.json triggers[] --> API manifestRegistry indexes by trigger ID + provider
                           --> API getTrigger() adapts TriggerManifest → TriggerConfig
                           --> Web populateTriggerCache() from /api/registry/integrations response
                           --> Web getTrigger() adapts ManifestTrigger → TriggerConfig

Webhook Processing:
  Incoming webhook --> processor.ts handleProviderChallenges() --> challenge-engine.ts (manifest-driven)
                   --> processor.ts verifyProviderAuth()       --> auth-engine.ts (manifest-driven)
                   --> processor.ts queueWebhookExecution()    --> event-matching/{provider}.ts

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
# Marketplace tests
cd apps/marketplace && bunx vitest run

# API tests
cd apps/api && bunx vitest run

# Webhook/trigger-specific tests
cd apps/api && bunx vitest run src/lib/webhooks/ src/integrations/

# Specific marketplace handler tests
cd apps/marketplace && bunx vitest run integrations/{service}/
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
| `src/blocks/manifest-adapter.ts` | Converts BlockManifest → BlockConfig for executor |
| `src/integrations/manifest-loader.ts` | **Central manifest registry** — loads manifests from both `blocks/manifests/` (core) and `marketplace/integrations/` (tools+triggers), builds in-memory indexes |
| `src/integrations/types.ts` | **All manifest type definitions** — IntegrationManifest, BlockManifest, ToolManifest, TriggerManifest, AuthSpec, ChallengeSpec, etc. |
| `src/triggers/index.ts` | Trigger API — `getTrigger()`, `getAllTriggers()`, `isTriggerValid()`, reads from manifestRegistry |
| `src/triggers/manifest-adapter.ts` | Converts TriggerManifest → TriggerConfig (credentials→subBlocks, instructions→text) |
| `src/triggers/types.ts` | TriggerConfig, TriggerOutput, TriggerInstance interfaces |
| `src/triggers/constants.ts` | SYSTEM_SUBBLOCK_IDS, TRIGGER_RUNTIME_SUBBLOCK_IDS, MAX_CONSECUTIVE_FAILURES |
| `src/lib/webhooks/processor.ts` | Webhook processing — challenge handling, auth verification, event matching, execution queueing |
| `src/lib/webhooks/auth-engine.ts` | Generic webhook auth verification — reads AuthSpec from manifests (HMAC, bearer, custom) |
| `src/lib/webhooks/challenge-engine.ts` | Generic challenge handler — reads ChallengeSpec from manifests (body_echo, query_echo, hub_verify) |
| `src/lib/webhooks/event-matching/` | Provider-specific event matching utils (github.ts, jira.ts, hubspot.ts) |
| `src/lib/webhooks/utils.server.ts` | Webhook helper utilities (Jira data extraction, TwiML conversion) |
| `src/routes/registry.ts` | Registry API routes — aggregates core + marketplace |
| `src/tools/index.ts` | `executeTool()` — dispatches to custom/MCP/marketplace |
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
| `src/types.ts` | Marketplace-local type definitions (mirrors API's types.ts for AuthSpec, ChallengeSpec etc.) |
| `src/index.ts` | Hono server entry point |

### Web
| File | Purpose |
|------|---------|
| `src/hooks/queries/registry.ts` | React Query hook for `/api/registry/integrations` |
| `src/stores/registry/store.ts` | Zustand store for block/tool/trigger registry — calls `populateTriggerCache()` on load |
| `src/stores/registry/types.ts` | ManifestBlock, ManifestTool, ManifestTrigger, ManifestIntegration types |
| `src/blocks/registry.ts` | Block registry proxy (reads from registry store) |
| `src/triggers/index.ts` | Trigger API — `getTrigger()`, `getAllTriggers()`, `isTriggerValid()`, reads from trigger cache populated by registry store |
| `src/triggers/types.ts` | TriggerConfig, TriggerOutput, TriggerInstance interfaces |
| `src/triggers/constants.ts` | SYSTEM_SUBBLOCK_IDS, TRIGGER_RUNTIME_SUBBLOCK_IDS, MAX_CONSECUTIVE_FAILURES |
| `src/lib/registry/manifest-adapter.ts` | Converts ManifestBlock (JSON) → BlockConfig (runtime with React components) |

## Trigger System Architecture

Triggers are defined entirely in `manifest.json` files. There is **no per-provider TypeScript trigger code** — all trigger data is declarative JSON.

### Where Trigger Data Lives

**Single source of truth:** Each marketplace integration's `manifest.json` has a `triggers` array:

```json
{
  "id": "slack",
  "name": "Slack",
  "triggers": [
    {
      "id": "slack_webhook",
      "name": "Slack Webhook",
      "provider": "slack",
      "webhook": { "method": "POST" },
      "auth": { "type": "custom", "handler": "slack" },
      "challenge": { "type": "body_echo", "field": "challenge" },
      "credentials": [
        { "id": "signingSecret", "label": "Signing Secret", "type": "password", "required": true }
      ],
      "instructions": "Setup instructions HTML...",
      "outputs": {
        "event": { "type": "json" },
        "event_type": { "type": "string" }
      }
    }
  ]
}
```

Core trigger blocks (schedule, api_trigger, etc.) live in `apps/api/src/blocks/manifests/` and may also have `triggers` arrays.

### Single vs Multi-Trigger Integrations

- **Single-trigger** (1 entry): slack, stripe, telegram, airtable, typeform, generic_webhook, etc.
- **Multi-trigger** (multiple entries): github (12 triggers), linear (15), hubspot (18), jira (7), calcom (9), calendly (4), lemlist (9), grain (6), circleback (3)

Multi-trigger integrations use a `selectedTriggerId` dropdown subBlock so users pick which event they want. Each trigger's subBlocks are conditionally shown via `condition: { field: "selectedTriggerId", value: "trigger_id" }`.

### Trigger Manifest Schema (TriggerManifest in `apps/api/src/integrations/types.ts`)

```typescript
interface TriggerManifest {
  id: string           // e.g. "github_push", "slack_webhook"
  name: string         // Display name
  provider: string     // e.g. "github", "slack"
  description?: string
  version?: string
  webhook?: { method?: string }
  credentials: CredentialField[]  // Secret fields (signing secrets, tokens)
  auth?: AuthSpec                 // Webhook signature verification
  challenge?: ChallengeSpec       // Webhook URL verification challenges
  instructions?: string           // Setup instructions HTML
  outputs: Record<string, TriggerOutputDef>  // Event payload shape
}
```

### Webhook Auth Verification (AuthSpec)

Three auth types, all declarative:

| Type | Example Provider | How it Works |
|------|-----------------|--------------|
| `hmac` | GitHub, Linear, Typeform, Cal.com, Jira, Fireflies, Circleback | HMAC signature in header, compared with `timingSafeEqual` |
| `bearer` | Google Forms | Token in Authorization header |
| `custom` | Slack, Stripe, Twilio, Microsoft Teams | Delegates to marketplace handler operation |

**HMAC example** (GitHub):
```json
{ "type": "hmac", "headerName": "X-Hub-Signature-256", "secretField": "webhookSecret", "algorithm": "sha256", "encoding": "hex", "signaturePrefix": "sha256=" }
```

**Custom auth** delegates to marketplace handler operations (e.g. `slack_verify_webhook`, `stripe_verify_webhook`). The handler implements provider-specific logic (Slack's v0:timestamp:body scheme, Stripe's t=timestamp,v1=signature scheme) and returns `{ valid: boolean, error?: string }`.

Auth engine: `apps/api/src/lib/webhooks/auth-engine.ts`

### Webhook Challenge Handling (ChallengeSpec)

Three challenge types for URL verification:

| Type | Example | What it Does |
|------|---------|--------------|
| `body_echo` | Slack | Echoes `body[field]` back as JSON |
| `query_echo` | Microsoft Graph | Echoes `?param` value as plaintext |
| `hub_verify` | WhatsApp, Facebook | Verifies `hub.verify_token`, echoes `hub.challenge` |

Challenge engine: `apps/api/src/lib/webhooks/challenge-engine.ts`

### Event Matching

For multi-trigger providers (GitHub, Jira, HubSpot), event matching filters incoming webhooks to the correct trigger:

| Provider | Matching Logic | File |
|----------|---------------|------|
| GitHub | X-GitHub-Event header + action + payload validators | `api/src/lib/webhooks/event-matching/github.ts` |
| Jira | webhookEvent + issue_event_type_name | `api/src/lib/webhooks/event-matching/jira.ts` |
| HubSpot | subscriptionType field | `api/src/lib/webhooks/event-matching/hubspot.ts` |

### How Trigger Data Flows

**API side:**
1. `manifestRegistry.load()` scans marketplace `integrations/` directories, parses `manifest.json`
2. `triggers[]` arrays are indexed into `triggersById`, `triggersByProvider`, `triggerToIntegration` maps
3. `getTrigger(id)` calls `manifestRegistry.getTriggerById()` → `adaptTriggerManifest()` → applies namespacing + samplePayload injection → returns `TriggerConfig`
4. `processor.ts` uses manifest data for challenge handling, auth verification, and event matching

**Web side:**
1. `useRegistryStore.loadRegistry()` fetches `/api/registry/integrations`
2. Response includes `triggers[]` on each integration
3. `populateTriggerCache(integrations)` indexes triggers into a module-level Map
4. `getTrigger(id)` reads from cache → `adaptManifestTrigger()` → applies namespacing + samplePayload injection → returns `TriggerConfig`

### Adding Triggers to a New Integration

Work in the integration's `manifest.json`:

1. Add a `triggers` array at the root level of the manifest
2. Each trigger needs: `id`, `name`, `provider`, `outputs`, `credentials`
3. For webhook auth: add `auth` field (hmac/bearer/custom)
4. For URL verification: add `challenge` field (body_echo/query_echo/hub_verify)
5. For custom auth: add a `{provider}_verify_webhook` operation in `handler.ts`

No TypeScript trigger files needed. No API changes needed. The manifest registry auto-discovers triggers at startup.

### Trigger SubBlocks: mode: "trigger"

When a block is in **trigger mode**, the editor only shows subBlocks with `mode: "trigger"`. All other subBlocks are hidden. This is critical for integrations that work as both tools AND triggers (gmail, outlook, microsoft_teams, etc.).

**Two sources of trigger subBlocks:**

1. **`TriggerManifest.credentials`** — Automatically converted to `short-input` subBlocks with `mode: "trigger"` by the web app's `adaptManifestTrigger()`. Use this for simple secrets (HMAC keys, signing secrets, bearer tokens).

2. **Block `subBlocks` with `mode: "trigger"`** — For complex trigger configuration (OAuth credentials, folder selection, processing options), add subBlocks directly to the block's `subBlocks` array with `mode: "trigger"`. This is **required** for:
   - OAuth credential pickers (`type: "oauth-input"`) — not supported by `TriggerManifest.credentials`
   - Dropdowns, switches, and other complex UI — not expressible as `CredentialField`

**Pattern for poller triggers with OAuth** (gmail, outlook):

```json
{
  "block": {
    "subBlocks": [
      { "id": "operation", "type": "dropdown", "title": "Operation", ... },
      { "id": "credential", "type": "oauth-input", "title": "Account", ... },
      ... // tool-mode subBlocks (no mode property = shown in tool mode)

      // Trigger-mode subBlocks (only shown when block is in trigger mode)
      { "id": "triggerCredentials", "type": "oauth-input", "title": "Account", "mode": "trigger" },
      { "id": "triggerFolderIds", "type": "short-input", "title": "Folders", "mode": "trigger" },
      { "id": "triggerMarkAsRead", "type": "switch", "title": "Mark as Read", "mode": "trigger" },
      { "id": "triggerSave", "type": "trigger-save", "mode": "trigger", "triggerId": "..." },
      { "id": "triggerInstructions", "type": "text", "title": "Setup Instructions", "mode": "trigger" }
    ]
  }
}
```

**Key rules:**
- Use unique IDs for trigger-mode subBlocks (prefix with `trigger`) to avoid conflicts with tool-mode subBlocks
- Trigger-mode subBlocks are filtered by `displayTriggerMode && block.mode !== 'trigger'` → hidden
- For multi-trigger blocks, use `condition: { field: "selectedTriggerId", value: "trigger_id" }` on subBlocks
- IMAP is a pure trigger block (`category: "triggers"`) — all its subBlocks have `mode: "trigger"`
- RSS is also a pure trigger block with a single `feedUrl` subBlock in trigger mode

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
- Phase 4: Triggers made marketplace-native
  - Extended types with AuthSpec, ChallengeSpec, TriggerOutputDef
  - ManifestRegistry updated for multi-trigger indexing (triggersById, triggersByProvider, triggerToIntegration)
  - Added triggers[] arrays to all 26 marketplace manifest.json files with trigger support
  - Built generic auth verification engine (auth-engine.ts) — replaces ~320 lines of inline validators
  - Built generic challenge handler engine (challenge-engine.ts) — replaces inline challenge code
  - Added custom auth handlers: slack_verify_webhook, stripe_verify_webhook (P0 fix — were previously no-ops)
  - Wired engines into processor.ts (manifest-driven auth + challenges)
  - Rewrote API triggers/index.ts to read from manifestRegistry
  - Rewrote Web triggers/index.ts to read from registry store trigger cache
  - Deleted ~31K lines of duplicated trigger TypeScript (50 provider directories across API + Web)
  - Moved event matching utils to api/src/lib/webhooks/event-matching/

### Future: Phase 5 - Documentation Portal
- Create `apps/marketplace/docs/` with markdown guides
- Create `src/routes/docs.ts` to serve rendered docs
- Auto-generate integration reference from manifests

### Future: Phase 6 - Marketplace UI
- React SPA at `/ui` for browsing/testing tools

### Future: Phase 7 - Batch Migrate Remaining ~131 Tool Integrations
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
| `api/src/lib/webhooks/processor.ts` | `sim/apps/sim/lib/webhooks/processor.ts` |
| `marketplace/integrations/{service}/manifest.json` triggers[] | `sim/apps/sim/triggers/{service}/` (old TS trigger files) |
