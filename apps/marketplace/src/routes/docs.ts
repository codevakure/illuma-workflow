/**
 * Documentation routes — renders markdown files and auto-generated
 * integration reference pages as styled HTML.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { marked } from 'marked'
import { manifestRegistry } from '@/manifest-loader'
import type { IntegrationManifest } from '@/types'

const app = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resolveDocsDir(): string {
  const __dirname_local = dirname(fileURLToPath(import.meta.url))
  const fromSrc = resolve(__dirname_local, '..', '..', 'docs')
  if (existsSync(fromSrc)) return fromSrc
  return resolve(process.cwd(), 'docs')
}

function getDocPages(): Array<{ slug: string; title: string }> {
  const dir = resolveDocsDir()
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => {
      if (a === 'index.md') return -1
      if (b === 'index.md') return 1
      return a.localeCompare(b)
    })
    .map((f) => {
      const slug = basename(f, '.md')
      const title = slug === 'index'
        ? 'Overview'
        : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return { slug, title }
    })
}

function renderMarkdown(content: string): string {
  return marked.parse(content) as string
}

// ---------------------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------------------

function docsLayout(title: string, content: string, activePage = ''): string {
  const pages = getDocPages()
  const integrations = manifestRegistry.getAllIntegrations()
    .sort((a, b) => a.name.localeCompare(b.name))

  const navItems = pages.map(
    (p) => `<a href="/docs/${p.slug === 'index' ? '' : p.slug}" class="sidebar-link ${activePage === p.slug ? 'active' : ''}">${escapeHtml(p.title)}</a>`
  ).join('')

  const integrationNavItems = `
    <div class="sidebar-section">Integrations</div>
    <a href="/docs/integrations" class="sidebar-link ${activePage === 'integrations-index' ? 'active' : ''}">All Integrations</a>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Sim Marketplace Docs</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <style>
    :root {
      --bg: #09090b;
      --surface-1: #0c0c0e;
      --surface-2: #141416;
      --surface-3: #1c1c1f;
      --border: #27272a;
      --text: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --code-bg: #18181b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { color: var(--accent-hover); }

    .header {
      background: var(--surface-1);
      border-bottom: 1px solid var(--border);
      padding: 0 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      height: 56px;
      gap: 2rem;
    }
    .header-brand {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text);
    }
    .header-brand span { color: var(--accent); }
    .header-nav { display: flex; gap: 0.25rem; }
    .header-nav a {
      color: var(--text-secondary);
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      transition: all 0.15s;
    }
    .header-nav a:hover { color: var(--text); background: var(--surface-3); }
    .header-nav a.active { color: var(--text); background: var(--surface-3); }

    .layout { display: flex; min-height: calc(100vh - 56px); }
    .sidebar {
      width: 240px;
      flex-shrink: 0;
      background: var(--surface-1);
      border-right: 1px solid var(--border);
      padding: 1rem 0;
      overflow-y: auto;
      position: sticky;
      top: 56px;
      height: calc(100vh - 56px);
    }
    .sidebar-section {
      padding: 0.5rem 1.25rem;
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-top: 1rem;
    }
    .sidebar-section:first-child { margin-top: 0; }
    .sidebar-link {
      display: block;
      padding: 0.35rem 1.25rem;
      font-size: 0.85rem;
      color: var(--text-secondary);
      transition: all 0.1s;
    }
    .sidebar-link:hover { color: var(--text); background: var(--surface-2); }
    .sidebar-link.active { color: var(--accent); background: var(--surface-2); font-weight: 500; }

    .content-area {
      flex: 1;
      padding: 2rem 3rem;
      max-width: 860px;
      overflow-x: hidden;
    }

    /* Markdown styles */
    .content-area h1 { font-size: 2rem; font-weight: 700; margin-top: 0; margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    .content-area h2 { font-size: 1.4rem; font-weight: 600; margin-top: 2rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
    .content-area h3 { font-size: 1.15rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    .content-area h4 { font-size: 1rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.4rem; color: var(--text-secondary); }
    .content-area p { margin-bottom: 1rem; }
    .content-area ul, .content-area ol { padding-left: 1.5rem; margin-bottom: 1rem; }
    .content-area li { margin-bottom: 0.3rem; }
    .content-area code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85em;
      background: var(--surface-3);
      padding: 0.15em 0.4em;
      border-radius: 4px;
      color: #c4b5fd;
    }
    .content-area pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      overflow-x: auto;
      margin-bottom: 1.25rem;
      line-height: 1.5;
    }
    .content-area pre code {
      background: none;
      padding: 0;
      color: #e2e8f0;
      font-size: 0.85em;
    }
    .content-area table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.25rem;
      font-size: 0.9rem;
    }
    .content-area th, .content-area td {
      border: 1px solid var(--border);
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    .content-area th {
      background: var(--surface-3);
      font-weight: 600;
      color: var(--text-muted);
      font-size: 0.8rem;
      text-transform: uppercase;
    }
    .content-area blockquote {
      border-left: 3px solid var(--accent);
      padding: 0.5rem 1rem;
      margin-bottom: 1rem;
      background: var(--surface-2);
      border-radius: 0 6px 6px 0;
      color: var(--text-secondary);
    }
    .content-area hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

    /* Badge */
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .badge-auth { background: #4c1d95; color: #c4b5fd; }
    .badge-apikey { background: #172554; color: #93c5fd; }
    .badge-noauth { background: #14532d; color: #86efac; }

    /* Integration list for /docs/integrations */
    .int-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 0.75rem;
    }
    .int-card {
      display: block;
      padding: 0.75rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      transition: all 0.15s;
      color: inherit;
    }
    .int-card:hover { border-color: var(--accent); color: inherit; }
    .int-card-name { font-weight: 600; font-size: 0.9rem; }
    .int-card-id { font-size: 0.75rem; color: var(--text-muted); font-family: monospace; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand"><span>Sim</span> Marketplace</div>
    <nav class="header-nav">
      <a href="/ui">Browse</a>
      <a href="/ui/stats">Stats</a>
      <a href="/docs" class="active">Docs</a>
      <a href="/openapi.json" target="_blank">API</a>
    </nav>
  </div>
  <div class="layout">
    <nav class="sidebar">
      <div class="sidebar-section">Guides</div>
      ${navItems}
      ${integrationNavItems}
    </nav>
    <div class="content-area">
      ${content}
    </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-bash.min.js"></script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Doc page routes
// ---------------------------------------------------------------------------

/** GET /docs — overview page (renders index.md) */
app.get('/', (c) => {
  const dir = resolveDocsDir()
  const indexPath = resolve(dir, 'index.md')

  if (!existsSync(indexPath)) {
    return c.html(docsLayout('Docs', '<h1>Documentation</h1><p>No docs found. Create markdown files in <code>apps/marketplace/docs/</code>.</p>', 'index'))
  }

  const md = readFileSync(indexPath, 'utf-8')
  return c.html(docsLayout('Overview', renderMarkdown(md), 'index'))
})

/** GET /docs/integrations — list all integrations */
app.get('/integrations', (c) => {
  const integrations = manifestRegistry.getAllIntegrations()
    .sort((a, b) => a.name.localeCompare(b.name))

  const grid = integrations.map((i) =>
    `<a href="/docs/integrations/${escapeHtml(i.id)}" class="int-card">
      <div class="int-card-name">${escapeHtml(i.name)}</div>
      <div class="int-card-id">${escapeHtml(i.id)} &mdash; ${i.tools.length} tool${i.tools.length !== 1 ? 's' : ''}</div>
    </a>`
  ).join('')

  const content = `
    <h1>Integration Reference</h1>
    <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">${integrations.length} integrations available. Click any integration to see its full API reference.</p>
    <div class="int-grid">${grid}</div>`

  return c.html(docsLayout('Integrations', content, 'integrations-index'))
})

/** GET /docs/integrations/:id — auto-generated reference from manifest */
app.get('/integrations/:id', (c) => {
  const id = c.req.param('id')
  const integration = manifestRegistry.getIntegration(id)
  if (!integration) {
    return c.html(docsLayout('Not Found', '<p>Integration not found.</p>'), 404)
  }

  const content = generateIntegrationReference(integration)
  return c.html(docsLayout(integration.name, content, ''))
})

/** GET /docs/:page — render a markdown file */
app.get('/:page', (c) => {
  const page = c.req.param('page')
  const dir = resolveDocsDir()
  const filePath = resolve(dir, `${page}.md`)

  if (!existsSync(filePath)) {
    return c.html(docsLayout('Not Found', '<p>Page not found.</p>'), 404)
  }

  const md = readFileSync(filePath, 'utf-8')
  const title = page.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
  return c.html(docsLayout(title, renderMarkdown(md), page))
})

// ---------------------------------------------------------------------------
// Auto-generated integration reference
// ---------------------------------------------------------------------------

function generateIntegrationReference(integration: IntegrationManifest): string {
  const block = integration.block
  const authMode = block?.authMode || 'none'

  let authBadge = ''
  if (authMode === 'oauth') authBadge = '<span class="badge badge-auth">OAuth</span>'
  else if (authMode === 'api_key') authBadge = '<span class="badge badge-apikey">API Key</span>'
  else authBadge = '<span class="badge badge-noauth">No Auth</span>'

  const toolDocs = integration.tools.map((tool) => {
    const paramsRows = Object.entries(tool.params || {}).map(([key, param]) =>
      `<tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td><code>${escapeHtml(param.type)}</code></td>
        <td>${param.required ? '<strong>Yes</strong>' : 'No'}</td>
        <td>${escapeHtml(param.description || '-')}</td>
      </tr>`
    ).join('')

    const outputRows = Object.entries(tool.outputs || {}).map(([key, output]) =>
      `<tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td><code>${escapeHtml(output.type)}</code></td>
        <td>${escapeHtml(output.description || '-')}</td>
      </tr>`
    ).join('')

    return `
      <h3><code>${escapeHtml(tool.id)}</code></h3>
      ${tool.description ? `<p style="color: var(--text-secondary);">${escapeHtml(tool.description)}</p>` : ''}
      ${paramsRows ? `
        <h4>Parameters</h4>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>${paramsRows}</tbody>
        </table>` : '<p><em>No parameters.</em></p>'}
      ${outputRows ? `
        <h4>Outputs</h4>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>${outputRows}</tbody>
        </table>` : ''}
      <p><a href="/ui/test/${escapeHtml(tool.id)}">Test this tool &rarr;</a></p>
      <hr>`
  }).join('')

  return `
    <h1>${escapeHtml(integration.name)}</h1>
    <p style="color: var(--text-secondary);">${escapeHtml(block?.description || integration.description || '')}</p>
    <p>${authBadge} <span class="badge" style="background: var(--surface-3); color: var(--text-muted);">v${escapeHtml(integration.version)}</span></p>
    ${block?.longDescription ? `<blockquote>${escapeHtml(block.longDescription)}</blockquote>` : ''}

    <h2>Operations (${integration.tools.length})</h2>
    ${toolDocs}

    ${integration.trigger ? `
      <h2>Trigger</h2>
      <p>Provider: <code>${escapeHtml(integration.trigger.provider)}</code></p>
      ${integration.trigger.instructions ? `<blockquote>${escapeHtml(integration.trigger.instructions)}</blockquote>` : ''}` : ''}

    <h2>Links</h2>
    <ul>
      <li><a href="/ui/integrations/${escapeHtml(integration.id)}">View in Marketplace UI</a></li>
      ${block?.docsLink ? `<li><a href="${escapeHtml(block.docsLink)}" target="_blank">External Documentation</a></li>` : ''}
    </ul>`
}

export { app as docsRoutes }
