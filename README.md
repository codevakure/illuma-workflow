# Sim V2

Standalone workspace for the Sim workflow builder, decoupled from the legacy Next.js monolith into a **Hono API backend** + **Vite React frontend**.

## Architecture

```
sim-v2/
├── apps/
│   ├── api/          # Hono backend (port 3001) — owns DB, LLM keys, secrets
│   └── web/          # Vite + React frontend (port 5173)
├── packages/
│   ├── db/           # Drizzle ORM schema + migrations (pure library, no .env)
│   ├── logger/       # Shared logger (@sim/logger)
│   └── shared/       # Shared utilities
├── docker-compose.yml
└── .env.example      # Documentation only — see apps/api/.env.example
```

| Component | Stack | Port |
|-----------|-------|------|
| API Server | Hono + Bun | 3001 |
| Frontend | Vite + React + ReactFlow | 5173 |
| Database | PostgreSQL 17 + pgvector | 5432 |

### Environment Ownership

Each app owns its own `.env`. There is **no root `.env`**.

| Location | Purpose |
|----------|---------|
| `apps/api/.env` | Database, LLM API keys, auth secrets, server config |
| `apps/web/.env` | `VITE_*` feature flags (optional) |
| `packages/db/` | **No .env** — receives `DATABASE_URL` from API at runtime |

This allows the API and frontend to be deployed independently behind a gateway.

## Prerequisites

- **Bun** >= 1.3.3 (`curl -fsSL https://bun.sh/install | bash`)
- **Docker** + Docker Compose (for PostgreSQL)
- At least one LLM API key (OpenAI, Anthropic, Gemini, or Groq)

## Quick Start

### 1. Install dependencies

```bash
cd sim-v2
bun install
```

### 2. Configure environment

```bash
cd apps/api
cp .env.example .env
```

Edit `apps/api/.env` and add your API keys:

```env
OPENAI_API_KEY=sk-...
# And/or:
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
GROQ_API_KEY=gsk_...
```

### 3. Start PostgreSQL

```bash
docker compose up -d db
```

Wait for it to be healthy:

```bash
docker compose ps
```

### 4. Push database schema

```bash
# Enable pgvector extension (first time only)
docker compose exec db psql -U postgres -d simstudio -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Push all 60+ tables to the database
bun run db:push
```

### 5. Seed test data

```bash
bun run db:seed
```

This creates:
- Test user (`test-user-id`)
- Default workspace (`default`)
- Default user settings

### 6. Start development servers

```bash
# Terminal 1 - API server
bun run dev:api

# Terminal 2 - Frontend
bun run dev:web
```

Or both at once:

```bash
bun run dev
```

### 7. Open the app

Navigate to http://localhost:5173 (or 5174 if 5173 is occupied).

## Docker Compose (Full Stack)

Run everything in containers:

```bash
# Ensure apps/api/.env is configured with your API keys
docker compose up -d
```

Services started:

| Service | Purpose | Lifecycle |
|---------|---------|-----------|
| `db` | PostgreSQL 17 + pgvector | Persistent |
| `migrations` | Push schema to DB | Runs once, exits |
| `seed` | Seed test data | Runs once, exits |
| `api` | Hono API server (port 3001) | Persistent |

The frontend runs locally for HMR:

```bash
bun run dev:web
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start all dev servers (turbo) |
| `bun run dev:api` | Start API server only |
| `bun run dev:web` | Start frontend only |
| `bun run db:up` | Start PostgreSQL container |
| `bun run db:down` | Stop all Docker containers |
| `bun run db:push` | Push Drizzle schema to database (reads `apps/api/.env`) |
| `bun run db:seed` | Seed test data |
| `bun run db:studio` | Open Drizzle Studio (reads `apps/api/.env`) |
| `bun run setup` | Full setup: Docker + schema push |

## Environment Variables

All environment variables live in `apps/api/.env`. See `apps/api/.env.example` for the full template.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| One LLM key | At least one of OPENAI/ANTHROPIC/GEMINI/GROQ |

### LLM Providers

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI (gpt-4o, gpt-4o-mini, o1, etc.) |
| `ANTHROPIC_API_KEY` | Anthropic (claude-sonnet, claude-haiku, etc.) |
| `GEMINI_API_KEY` | Google (gemini-2.0-flash, etc.) |
| `GROQ_API_KEY` | Groq (llama, mixtral, etc.) |

### Server Config

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `CORS_ORIGIN` | `http://localhost:5173` | CORS origins (comma-separated) |
| `DISABLE_AUTH` | `true` | Bypass auth for local dev |

### Security (for production)

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_SECRET` | Auth session secret (32+ chars) |
| `ENCRYPTION_KEY` | Encrypt environment variables |
| `INTERNAL_API_SECRET` | Internal API route protection |
| `API_ENCRYPTION_KEY` | API key encryption |

## API Endpoints

### Workflow CRUD
- `GET /api/workflows?workspaceId=` - List workflows
- `POST /api/workflows` - Create workflow
- `GET /api/workflows/:id` - Get workflow with state
- `PATCH /api/workflows/:id` - Update workflow
- `DELETE /api/workflows/:id` - Delete workflow
- `POST /api/workflows/:id/state` - Sync workflow state

### Workflow Execution
- `POST /api/workflows/:id/execute` - Execute workflow (SSE streaming)
- `POST /api/workflows/:id/log` - Persist execution logs
- `POST /api/workflows/:id/executions/:execId/cancel` - Cancel execution

### Workspaces
- `GET /api/workspaces` - List user workspaces
- `POST /api/workspaces` - Create workspace
- `GET /api/workspaces/:id` - Get workspace
- `PATCH /api/workspaces/:id` - Update workspace
- `DELETE /api/workspaces/:id` - Delete workspace
- `GET /api/workspaces/:id/permissions` - Workspace permissions
- `GET /api/workspaces/:id/environment` - Environment variables
- `GET /api/workspaces/:id/api-keys` - API keys

### Users & Settings
- `GET /api/users/me/settings` - User settings
- `PATCH /api/users/me/settings` - Update settings
- `GET /api/users/me/profile` - User profile

### Providers
- `GET /api/providers/base/models` - Available LLM models
- `GET /api/providers/ollama/models` - Ollama models
- `GET /api/providers/openrouter/models` - OpenRouter models

### Other
- `GET /api/folders?workspaceId=` - List folders
- `GET /api/environment` - Global environment variables
- `GET /api/auth/sso/providers` - SSO providers
- `GET /health` - Health check

## Supported Block Types

| Block Type | Description | LLM Required |
|------------|-------------|--------------|
| `agent` | LLM chat completion | Yes |
| `function` | JavaScript code execution | No |
| `condition` | Conditional branching | No |
| `api` | HTTP API calls | No |
| `starter` / `trigger` | Workflow entry point | No |
| `response` | Output collector | No |
| `evaluator` | LLM-based evaluation | Yes |
| `router` | LLM-based routing | Yes |

## Troubleshooting

### Database connection fails with ECONNRESET

On Windows, Docker may resolve `localhost` to IPv6. Use `127.0.0.1`:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/simstudio
```

### pgvector extension not found

```bash
docker compose exec db psql -U postgres -d simstudio -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Port already in use

```bash
# Windows
netstat -ano | findstr :3001
taskkill /F /PID <pid>

# Linux/Mac
lsof -i :3001
kill -9 <pid>
```

### "Not Found" when running workflow

The execute route must be mounted in `apps/api/src/index.ts`:

```typescript
import { executeRoutes } from './routes/workflows/execute'
api.route('/workflows', executeRoutes)
```

### Missing LLM API key error

Set the required `*_API_KEY` in `apps/api/.env`, then restart the API server.

## Development Notes

- **Auth**: Bypassed in development (`DISABLE_AUTH=true`). All requests authenticate as `test-user-id`.
- **DB Fallback**: All routes try the database first, then fall back to in-memory storage.
- **Vite Proxy**: The frontend proxies `/api/*` to `http://localhost:3001` via Vite config.
- **Watch Mode**: API server auto-reloads on file changes via `bun run --watch`.
- **Schema**: The `packages/db` package contains 60+ tables shared with the legacy sim project. It is a pure library with no `.env` — it receives `DATABASE_URL` from the consuming app at runtime.
- **Independent Deployment**: API and frontend can be deployed separately. The API owns all secrets and DB config. The frontend only needs `VITE_*` vars (optional).
