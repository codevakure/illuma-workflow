/**
 * Integration Marketplace Service
 *
 * Standalone service that owns all integration manifest JSON files
 * and serves them via a registry API. Both the API server and web app
 * consume manifests from this service.
 *
 * Default port: 3002
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { marked } from 'marked'
import { createLogger } from '@/lib/logger'
import { apiKeyAuth } from '@/middleware/api-key'
import { initializeManifests } from '@/manifest-loader'
import { openApiSpec } from '@/openapi'
import { registryRoutes } from '@/routes/registry'

const log = createLogger('Marketplace')

const app = new Hono()

// Middleware
app.use('*', honoLogger())
app.use(
  '*',
  cors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3001,http://localhost:3000').split(','),
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Marketplace-Key'],
  })
)

// API key authentication
app.use('/api/marketplace/*', apiKeyAuth)

// Mount registry routes
app.route('/api/marketplace', registryRoutes)

// OpenAPI spec + Swagger UI
app.get('/openapi.json', (c) => c.json(openApiSpec))
app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// Documentation guide — renders CONTRIBUTING.md as styled HTML
app.get('/guide', (c) => {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const mdPath = resolve(__dirname, '..', 'CONTRIBUTING.md')
    const markdown = readFileSync(mdPath, 'utf-8')
    const content = marked.parse(markdown) as string

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sim Marketplace — Integration Guide</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --surface: #141414;
      --border: #262626;
      --text: #e5e5e5;
      --text-muted: #a3a3a3;
      --accent: #6366f1;
      --accent-dim: #4f46e5;
      --code-bg: #1a1a2e;
      --inline-code: #1e1e2e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      padding: 0;
    }
    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header h1 {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text);
    }
    .header a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.85rem;
      padding: 0.3rem 0.8rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      transition: all 0.15s;
    }
    .header a:hover {
      color: var(--text);
      border-color: var(--accent);
    }
    .content {
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 2rem 4rem;
    }
    h1, h2, h3, h4 {
      color: var(--text);
      margin-top: 2.5rem;
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    h1 { font-size: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
    h3 { font-size: 1.2rem; }
    h4 { font-size: 1rem; color: var(--text-muted); }
    p { margin-bottom: 1rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul, ol { padding-left: 1.5rem; margin-bottom: 1rem; }
    li { margin-bottom: 0.3rem; }
    code {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.88em;
      background: var(--inline-code);
      padding: 0.15em 0.4em;
      border-radius: 4px;
      color: #c4b5fd;
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      overflow-x: auto;
      margin-bottom: 1.25rem;
      line-height: 1.5;
    }
    pre code {
      background: none;
      padding: 0;
      color: #e2e8f0;
      font-size: 0.85em;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.25rem;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.6rem 0.8rem;
      text-align: left;
    }
    th {
      background: var(--surface);
      font-weight: 600;
      color: var(--text-muted);
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    td { font-size: 0.92rem; }
    blockquote {
      border-left: 3px solid var(--accent);
      padding: 0.5rem 1rem;
      margin-bottom: 1rem;
      background: var(--surface);
      border-radius: 0 6px 6px 0;
      color: var(--text-muted);
    }
    hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 2rem 0;
    }
    img { max-width: 100%; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Sim Marketplace</h1>
    <a href="/docs">API Reference</a>
    <a href="/">Health Check</a>
  </div>
  <div class="content">
    ${content}
  </div>
</body>
</html>`

    return c.html(html)
  } catch (err) {
    log.error('Failed to render guide', err)
    return c.text('Failed to load documentation guide', 500)
  }
})

// Root health check
app.get('/', (c) => {
  return c.json({
    service: 'sim-marketplace',
    version: '0.0.1',
    docs: '/docs',
    guide: '/guide',
  })
})

// Initialize manifests at startup
initializeManifests()

// Start server
const port = Number(process.env.MARKETPLACE_PORT || 3002)

log.info(`Starting marketplace service on port ${port}`)

serve({
  fetch: app.fetch,
  port,
})

log.info(`Marketplace service running at http://localhost:${port}`)

export { app }
