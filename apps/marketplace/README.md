# Sim Integration Marketplace

Standalone service that manages integration manifests for the Sim platform. Each integration is defined by a single `manifest.json` file that describes its block UI, tools, and triggers.

## Running

```bash
# Development (with hot reload)
cd apps/marketplace
bun run dev

# Or from monorepo root
bun run dev:marketplace
```

The service runs on port 3002 by default (configurable via `MARKETPLACE_PORT` env var).

## API Endpoints

All endpoints are under `/api/marketplace/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/integrations` | List all integrations |
| GET | `/integrations/:id` | Get a single integration |
| GET | `/blocks` | List all block definitions |
| GET | `/blocks/:type` | Get a single block |
| GET | `/tools` | List all tool definitions |
| GET | `/tools/:id` | Get a single tool |
| GET | `/triggers` | List all trigger definitions |
| GET | `/triggers/:provider` | Get a single trigger |
| GET | `/stats` | Manifest counts |
| GET | `/health` | Health check |

### Query Parameters

- `GET /blocks?category=tools` — Filter by category
- `GET /tools?executionMode=proxy` — Filter by execution mode

## Authentication

Set `MARKETPLACE_API_KEY` environment variable to require API key auth. Requests must include `X-Marketplace-Key` header. If no key is set, auth is disabled (development mode).

The API server at `apps/api` passes the key automatically when proxying requests.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MARKETPLACE_PORT` | `3002` | Server port |
| `MARKETPLACE_API_KEY` | (none) | API key for authentication |
| `CORS_ORIGIN` | `localhost` | Allowed CORS origins (comma-separated) |
| `DEBUG` | (none) | Enable debug logging |

## Structure

```
apps/marketplace/
├── integrations/           # 129 integration manifests
│   ├── slack/manifest.json
│   ├── github/manifest.json
│   └── ...
├── scripts/
│   └── generate-manifests.ts  # Auto-generate from legacy code
├── src/
│   ├── index.ts               # Server entry point
│   ├── types.ts               # Manifest type definitions
│   ├── manifest-loader.ts     # Loader + validator + registry
│   ├── middleware/api-key.ts   # API key auth middleware
│   ├── lib/logger.ts          # Logger utility
│   └── routes/registry.ts     # API route definitions
├── package.json
├── tsconfig.json
├── CONTRIBUTING.md            # How to add new integrations
└── README.md                  # This file
```

## Adding New Integrations

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide on how to add new tools, blocks, and triggers.

## Core vs Connector Blocks

**Core blocks** stay in the API server (`apps/api`):
- agent, function, condition, router, parallel, evaluator
- starter, triggers (start, manual, api, input, chat, generic_webhook)
- variables, note, wait, response, guardrails, human_in_the_loop
- knowledge, memory, thinking, webhook_request

**Connector blocks** are served from the marketplace (this service):
- All third-party service integrations (Slack, GitHub, Jira, Gmail, etc.)
- 129 integrations, 1300+ tools

## Regenerating Manifests

To regenerate manifests from the existing TypeScript definitions:

```bash
cd apps/marketplace
bun run scripts/generate-manifests.ts
```

This reads block definitions from `apps/web/src/blocks/` and tool definitions from `apps/api/src/tools/` and outputs `manifest.json` files for all connector integrations.
