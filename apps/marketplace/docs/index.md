# Sim Marketplace

The Sim Marketplace is the tool ecosystem for the Sim workflow platform. It provides a centralized registry of tool integrations that can be used as blocks in workflows.

## Architecture

```
Web App (5173)        API Server (3001)           Marketplace (3002)
     |                      |                           |
     | GET /api/registry    |                           |
     |   /integrations      |                           |
     |--------------------->|                           |
     |                      | reads integrations/       |
     |                      | directory at startup      |
     |                      |                           |
     |                      | POST /tools/:id/execute   |
     |                      |-------------------------->|
     |                      |<--------------------------|
     |<---------------------|                           |
```

**API Server** owns core blocks (agent, condition, function, etc.) and reads tool manifests from the marketplace `integrations/` directory.

**Marketplace** owns all tool integrations: manifests, handlers, tests, and this documentation.

## What's in an Integration

Each integration lives in `integrations/{service}/` and contains:

| File | Purpose |
|------|---------|
| `manifest.json` | Block UI definition, tool parameter schemas, trigger config |
| `handler.ts` | TypeScript implementation of all tool operations |
| `handler.test.ts` | Unit tests for the handler |

## Key Concepts

- **Block** — The visual node on the workflow canvas. Defined by `manifest.json`.
- **Tool** — An operation the block can perform (e.g., `slack_send_message`). One block can have multiple tools.
- **Handler** — The TypeScript code that executes a tool operation. Lives in `handler.ts`.
- **Trigger** — Optional webhook configuration that allows a block to start workflows.

## Links

- [Adding a New Tool](adding-tools) — Step-by-step guide
- [Manifest Schema](manifest-schema) — Complete JSON reference
- [SDK Reference](sdk-reference) — TypeScript types and utilities
- [Testing Guide](testing-guide) — How to write and run tests
- [Trigger Support](trigger-support) — Adding trigger capability
- [Integration Reference](/docs/integrations) — Browse all integrations
