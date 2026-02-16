/**
 * Marketplace UI routes — server-rendered HTML pages.
 *
 * Browse integrations, view details, test tools, and see stats.
 * All pages use a shared dark-themed HTML template rendered via
 * Hono route handlers with template literals.
 */

import { Hono } from 'hono'
import { manifestRegistry } from '@/manifest-loader'
import { getHandlerCount, getLoadedIntegrations } from '@/handler-loader'
import { getIconSvg } from '@/icons'
import type { IntegrationManifest, ToolManifest } from '@/types'

const app = new Hono()

// ---------------------------------------------------------------------------
// Shared HTML template
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function layout(title: string, content: string, activeNav = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Sim Marketplace</title>
  <style>
    :root {
      --bg: #09090b;
      --surface-1: #0c0c0e;
      --surface-2: #141416;
      --surface-3: #1c1c1f;
      --surface-4: #27272a;
      --border: #27272a;
      --border-light: #3f3f46;
      --text: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --success: #22c55e;
      --error: #ef4444;
      --warning: #eab308;
      --code-bg: #18181b;
      --radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { color: var(--accent-hover); }

    /* Header */
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
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }
    .header-brand span { color: var(--accent); }
    .header-nav {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }
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

    /* Main container */
    .main { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .main-wide { max-width: 1400px; margin: 0 auto; padding: 2rem; }

    /* Stats bar */
    .stats-bar {
      display: flex;
      gap: 1.5rem;
      padding: 1rem 0;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .stat { display: flex; align-items: baseline; gap: 0.4rem; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: var(--text); }
    .stat-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

    /* Search */
    .search-container { margin-bottom: 1.5rem; }
    .search-input {
      width: 100%;
      max-width: 400px;
      padding: 0.6rem 1rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus { border-color: var(--accent); }
    .search-input::placeholder { color: var(--text-muted); }

    /* Filter chips */
    .filters { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .filter-chip {
      padding: 0.35rem 0.75rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 20px;
      color: var(--text-secondary);
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
    }
    .filter-chip:hover { border-color: var(--accent); color: var(--text); }
    .filter-chip.active { background: var(--accent); border-color: var(--accent); color: white; }

    /* Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }

    /* Card */
    .card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      transition: all 0.15s;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      display: block;
    }
    .card:hover { border-color: var(--border-light); background: var(--surface-3); color: inherit; }
    .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
    .card-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 0.75rem;
      font-weight: 700;
      color: white;
      overflow: hidden;
    }
    .card-title { font-weight: 600; font-size: 0.95rem; }
    .card-desc {
      font-size: 0.82rem;
      color: var(--text-secondary);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-meta {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
      flex-wrap: wrap;
    }

    /* Badge */
    .badge {
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-auth { background: #1e1b4b; color: #a5b4fc; }
    .badge-apikey { background: #172554; color: #93c5fd; }
    .badge-noauth { background: #14532d; color: #86efac; }
    .badge-oauth { background: #4c1d95; color: #c4b5fd; }
    .badge-handler { background: #14532d; color: #86efac; }
    .badge-no-handler { background: #451a03; color: #fbbf24; }
    .badge-tools { background: var(--surface-3); color: var(--text-secondary); }
    .badge-trigger { background: #1e1b4b; color: #c4b5fd; }
    .badge-hidden { background: #451a03; color: #fbbf24; }

    /* Detail page */
    .detail-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .detail-icon {
      width: 48px;
      height: 48px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      font-weight: 700;
      color: white;
      flex-shrink: 0;
      overflow: hidden;
    }
    .icon-svg { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
    .icon-svg svg { color: white; max-width: 100%; max-height: 100%; }
    .detail-title { font-size: 1.5rem; font-weight: 700; }
    .detail-desc { color: var(--text-secondary); margin-top: 0.25rem; font-size: 0.9rem; }
    .detail-badges { display: flex; gap: 0.5rem; margin-top: 0.5rem; }

    /* Section */
    .section { margin-bottom: 2rem; }
    .section-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.6rem 0.8rem;
      text-align: left;
    }
    th {
      background: var(--surface-3);
      font-weight: 600;
      color: var(--text-secondary);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td { color: var(--text); }
    tr:hover td { background: var(--surface-2); }

    /* Code / JSON */
    .code-block {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      overflow-x: auto;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.82rem;
      line-height: 1.5;
      color: #e2e8f0;
      max-height: 500px;
      overflow-y: auto;
    }
    code {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.85em;
      background: var(--surface-3);
      padding: 0.1em 0.35em;
      border-radius: 3px;
      color: #c4b5fd;
    }

    /* Collapsible */
    .collapsible-header {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .collapsible-header::before {
      content: '\\25B6';
      font-size: 0.7rem;
      transition: transform 0.15s;
      color: var(--text-muted);
    }
    .collapsible-header.open::before { transform: rotate(90deg); }
    .collapsible-body { display: none; margin-top: 0.75rem; }
    .collapsible-body.open { display: block; }

    /* Test page form */
    .form-group { margin-bottom: 1rem; }
    .form-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 0.3rem;
    }
    .form-label .required { color: var(--error); }
    .form-input, .form-textarea {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.875rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-input:focus, .form-textarea:focus { border-color: var(--accent); }
    .form-textarea { min-height: 80px; resize: vertical; }
    .form-hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem; }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary { background: var(--surface-3); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: var(--surface-4); }

    /* Result panel */
    .result-panel {
      margin-top: 1.5rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .result-header {
      padding: 0.6rem 1rem;
      background: var(--surface-3);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .result-body { padding: 1rem; }
    .result-success { color: var(--success); }
    .result-error { color: var(--error); }

    /* Two-column layout */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
    @media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }

    /* Empty state */
    .empty {
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
    }

    /* Back link */
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--text-secondary);
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }
    .back-link:hover { color: var(--text); }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand"><span>Sim</span> Marketplace</div>
    <nav class="header-nav">
      <a href="/ui" class="${activeNav === 'browse' ? 'active' : ''}">Browse</a>
      <a href="/ui/stats" class="${activeNav === 'stats' ? 'active' : ''}">Stats</a>
      <a href="/docs" class="${activeNav === 'docs' ? 'active' : ''}">Docs</a>
      <a href="/openapi.json" target="_blank">API</a>
    </nav>
  </div>
  ${content}
</body>
</html>`
}

function getAuthBadge(integration: IntegrationManifest): string {
  const authMode = integration.block?.authMode
  if (authMode === 'oauth') return '<span class="badge badge-oauth">OAuth</span>'
  if (authMode === 'api_key') return '<span class="badge badge-apikey">API Key</span>'
  if (authMode === 'bot_token') return '<span class="badge badge-apikey">Bot Token</span>'
  return '<span class="badge badge-noauth">No Auth</span>'
}

function getIconInitials(name: string): string {
  return name.split(/[\s_-]+/).map(w => w[0]?.toUpperCase() || '').slice(0, 2).join('')
}

function renderIcon(iconId: string | undefined, name: string, size: 'sm' | 'lg' = 'sm'): string {
  const svg = iconId ? getIconSvg(iconId) : null
  if (svg) {
    const px = size === 'lg' ? '28' : '18'
    let scaled = svg
    const hasWidth = /width=['"][^'"]*['"]/.test(scaled)
    const hasHeight = /height=['"][^'"]*['"]/.test(scaled)
    if (hasWidth) {
      scaled = scaled.replace(/width=['"][^'"]*['"]/, `width="${px}"`)
    } else {
      scaled = scaled.replace(/^<svg/, `<svg width="${px}"`)
    }
    if (hasHeight) {
      scaled = scaled.replace(/height=['"][^'"]*['"]/, `height="${px}"`)
    } else {
      scaled = scaled.replace(/^<svg/, `<svg height="${px}"`)
    }
    return `<div class="icon-svg">${scaled}</div>`
  }
  return getIconInitials(name)
}

// ---------------------------------------------------------------------------
// Browse page
// ---------------------------------------------------------------------------

app.get('/', (c) => {
  const integrations = manifestRegistry.getAllIntegrations()
  const stats = manifestRegistry.stats()
  const handlerCount = getHandlerCount()
  const loadedIntegrations = new Set(getLoadedIntegrations())

  const cards = integrations
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => {
      const toolCount = i.tools.length
      const hasHandler = i.hasHandler || loadedIntegrations.has(i.id)
      const authMode = i.block?.authMode || 'none'
      const bgColor = i.block?.bgColor || '#6366f1'
      const isHidden = i.block?.hideFromToolbar
      const hasTrigger = !!i.trigger

      return `<a href="/ui/integrations/${escapeHtml(i.id)}" class="card"
        data-name="${escapeHtml(i.name.toLowerCase())}"
        data-id="${escapeHtml(i.id)}"
        data-auth="${escapeHtml(authMode)}"
        data-handler="${hasHandler ? 'yes' : 'no'}"
        data-trigger="${hasTrigger ? 'yes' : 'no'}"
        data-hidden="${isHidden ? 'yes' : 'no'}">
        <div class="card-header">
          <div class="card-icon" style="background: ${escapeHtml(bgColor)}">${renderIcon(i.icon || i.block?.icon, i.name, 'sm')}</div>
          <div class="card-title">${escapeHtml(i.name)}</div>
        </div>
        <div class="card-desc">${escapeHtml(i.block?.description || i.description || '')}</div>
        <div class="card-meta">
          <span class="badge badge-tools">${toolCount} tool${toolCount !== 1 ? 's' : ''}</span>
          ${hasHandler ? '<span class="badge badge-handler">Handler</span>' : '<span class="badge badge-no-handler">No Handler</span>'}
          ${getAuthBadge(i)}
          ${hasTrigger ? '<span class="badge badge-trigger">Trigger</span>' : ''}
          ${isHidden ? '<span class="badge badge-hidden">Hidden</span>' : ''}
        </div>
      </a>`
    })
    .join('\n')

  const content = `
    <div class="main-wide">
      <div class="stats-bar">
        <div class="stat">
          <span class="stat-value">${stats.integrations}</span>
          <span class="stat-label">Integrations</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.tools}</span>
          <span class="stat-label">Tools</span>
        </div>
        <div class="stat">
          <span class="stat-value">${handlerCount}</span>
          <span class="stat-label">Handlers</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.triggers}</span>
          <span class="stat-label">Triggers</span>
        </div>
      </div>

      <div class="search-container">
        <input type="text" class="search-input" id="search" placeholder="Search integrations..." autocomplete="off">
      </div>

      <div class="filters">
        <span class="filter-chip active" data-filter="all">All</span>
        <span class="filter-chip" data-filter="noauth">No Auth</span>
        <span class="filter-chip" data-filter="api_key">API Key</span>
        <span class="filter-chip" data-filter="oauth">OAuth</span>
        <span class="filter-chip" data-filter="handler">Has Handler</span>
        <span class="filter-chip" data-filter="trigger">Has Trigger</span>
        <span class="filter-chip" data-filter="no-handler">No Handler</span>
      </div>

      <div class="grid" id="grid">
        ${cards}
      </div>

      <div class="empty" id="empty" style="display:none">No integrations match your search.</div>
    </div>

    <script>
      const search = document.getElementById('search');
      const grid = document.getElementById('grid');
      const empty = document.getElementById('empty');
      const chips = document.querySelectorAll('.filter-chip');
      let activeFilter = 'all';

      function filterCards() {
        const q = search.value.toLowerCase().trim();
        const cards = grid.querySelectorAll('.card');
        let visible = 0;
        cards.forEach(card => {
          const name = card.dataset.name;
          const id = card.dataset.id;
          const auth = card.dataset.auth;
          const handler = card.dataset.handler;
          const trigger = card.dataset.trigger;

          let matchFilter = true;
          if (activeFilter === 'noauth' || activeFilter === 'none') matchFilter = auth === 'none';
          else if (activeFilter === 'api_key') matchFilter = auth === 'api_key' || auth === 'bot_token';
          else if (activeFilter === 'oauth') matchFilter = auth === 'oauth';
          else if (activeFilter === 'handler') matchFilter = handler === 'yes';
          else if (activeFilter === 'no-handler') matchFilter = handler === 'no';
          else if (activeFilter === 'trigger') matchFilter = trigger === 'yes';

          const matchSearch = !q || name.includes(q) || id.includes(q);
          const show = matchFilter && matchSearch;
          card.style.display = show ? '' : 'none';
          if (show) visible++;
        });
        empty.style.display = visible === 0 ? '' : 'none';
      }

      search.addEventListener('input', filterCards);
      chips.forEach(chip => {
        chip.addEventListener('click', () => {
          chips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          activeFilter = chip.dataset.filter;
          filterCards();
        });
      });
    </script>`

  return c.html(layout('Browse', content, 'browse'))
})

// ---------------------------------------------------------------------------
// Integration detail page
// ---------------------------------------------------------------------------

app.get('/integrations/:id', (c) => {
  const id = c.req.param('id')
  const integration = manifestRegistry.getIntegration(id)
  if (!integration) {
    return c.html(layout('Not Found', '<div class="main"><div class="empty">Integration not found.</div></div>'), 404)
  }

  const block = integration.block
  const bgColor = block?.bgColor || '#6366f1'
  const loadedIntegrations = new Set(getLoadedIntegrations())
  const hasHandler = integration.hasHandler || loadedIntegrations.has(id)

  const operationsHtml = integration.tools.map((tool) => {
    const paramsHtml = Object.entries(tool.params || {}).map(([key, param]) =>
      `<tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td>${escapeHtml(param.type)}</td>
        <td>${param.required ? 'Yes' : 'No'}</td>
        <td>${escapeHtml(param.description || '-')}</td>
      </tr>`
    ).join('')

    const outputsHtml = Object.entries(tool.outputs || {}).map(([key, output]) =>
      `<tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td>${escapeHtml(output.type)}</td>
        <td>${escapeHtml(output.description || '-')}</td>
      </tr>`
    ).join('')

    return `
      <div style="margin-bottom: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;">
        <div style="padding: 0.75rem 1rem; background: var(--surface-3); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${escapeHtml(tool.name || tool.id)}</strong>
            <code style="margin-left: 0.5rem; font-size: 0.78rem;">${escapeHtml(tool.id)}</code>
          </div>
          <a href="/ui/test/${escapeHtml(tool.id)}" class="btn btn-secondary" style="font-size: 0.78rem; padding: 0.3rem 0.6rem;">Test</a>
        </div>
        ${tool.description ? `<div style="padding: 0.5rem 1rem; font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(tool.description)}</div>` : ''}
        ${paramsHtml ? `
          <div style="padding: 0 1rem 0.5rem;">
            <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted); margin: 0.5rem 0; text-transform: uppercase;">Parameters</div>
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
              <tbody>${paramsHtml}</tbody>
            </table>
          </div>` : ''}
        ${outputsHtml ? `
          <div style="padding: 0 1rem 0.75rem;">
            <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted); margin: 0.5rem 0; text-transform: uppercase;">Outputs</div>
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>${outputsHtml}</tbody>
            </table>
          </div>` : ''}
      </div>`
  }).join('')

  const triggerHtml = integration.trigger ? `
    <div class="section">
      <h2 class="section-title">Trigger Configuration</h2>
      <table>
        <tr><td style="width: 150px; font-weight: 600;">Provider</td><td>${escapeHtml(integration.trigger.provider)}</td></tr>
        <tr><td style="font-weight: 600;">Name</td><td>${escapeHtml(integration.trigger.name)}</td></tr>
        ${integration.trigger.webhook?.method ? `<tr><td style="font-weight: 600;">Webhook Method</td><td>${escapeHtml(integration.trigger.webhook.method)}</td></tr>` : ''}
        ${integration.trigger.instructions ? `<tr><td style="font-weight: 600;">Instructions</td><td style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(integration.trigger.instructions)}</td></tr>` : ''}
      </table>
      ${integration.trigger.credentials.length > 0 ? `
        <div style="margin-top: 1rem;">
          <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.5rem;">Credentials</div>
          <table>
            <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
            <tbody>
              ${integration.trigger.credentials.map(cred =>
                `<tr>
                  <td><code>${escapeHtml(cred.id)}</code></td>
                  <td>${escapeHtml(cred.type)}</td>
                  <td>${cred.required ? 'Yes' : 'No'}</td>
                  <td>${escapeHtml(cred.description || '-')}</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
        </div>` : ''}
    </div>` : ''

  const manifestJson = JSON.stringify(integration, null, 2)

  const content = `
    <div class="main">
      <a href="/ui" class="back-link">&larr; Back to browse</a>

      <div class="detail-header">
        <div class="detail-icon" style="background: ${escapeHtml(bgColor)}">${renderIcon(integration.icon || integration.block?.icon, integration.name, 'lg')}</div>
        <div>
          <div class="detail-title">${escapeHtml(integration.name)}</div>
          <div class="detail-desc">${escapeHtml(block?.description || integration.description || '')}</div>
          <div class="detail-badges">
            <span class="badge badge-tools">${integration.tools.length} tool${integration.tools.length !== 1 ? 's' : ''}</span>
            ${hasHandler ? '<span class="badge badge-handler">Handler Ready</span>' : '<span class="badge badge-no-handler">No Handler</span>'}
            ${getAuthBadge(integration)}
            ${integration.trigger ? '<span class="badge badge-trigger">Trigger</span>' : ''}
            ${block?.hideFromToolbar ? '<span class="badge badge-hidden">Hidden</span>' : ''}
            <span class="badge" style="background: var(--surface-3); color: var(--text-muted);">v${escapeHtml(integration.version)}</span>
          </div>
        </div>
      </div>

      ${block?.longDescription ? `
        <div class="section">
          <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.7;">${escapeHtml(block.longDescription)}</p>
        </div>` : ''}

      <div class="section">
        <h2 class="section-title">Operations (${integration.tools.length})</h2>
        ${operationsHtml}
      </div>

      ${triggerHtml}

      <div class="section">
        <div class="collapsible-header section-title" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
          Raw Manifest JSON
        </div>
        <div class="collapsible-body">
          <pre class="code-block">${escapeHtml(manifestJson)}</pre>
        </div>
      </div>
    </div>`

  return c.html(layout(integration.name, content))
})

// ---------------------------------------------------------------------------
// Tool test page
// ---------------------------------------------------------------------------

app.get('/test/:toolId', (c) => {
  const toolId = c.req.param('toolId')
  const tool = manifestRegistry.getTool(toolId)
  if (!tool) {
    return c.html(layout('Not Found', '<div class="main"><div class="empty">Tool not found.</div></div>'), 404)
  }

  const integration = manifestRegistry.getIntegrationForTool(toolId)
  const authMode = integration?.block?.authMode || 'none'

  const paramFields = Object.entries(tool.params || {}).map(([key, param]) => {
    const isJson = param.type === 'json' || param.type === 'object' || param.type === 'array'
    const inputType = param.type === 'number' ? 'number' : 'text'

    return `
      <div class="form-group">
        <label class="form-label">
          ${escapeHtml(key)} ${param.required ? '<span class="required">*</span>' : ''}
        </label>
        ${isJson
          ? `<textarea class="form-textarea" name="${escapeHtml(key)}" placeholder="${escapeHtml(param.description || `Enter ${key} (JSON)...`)}">${escapeHtml(typeof param.default === 'object' ? JSON.stringify(param.default, null, 2) : '')}</textarea>`
          : `<input type="${inputType}" class="form-input" name="${escapeHtml(key)}" placeholder="${escapeHtml(param.description || `Enter ${key}...`)}" value="${escapeHtml(String(param.default ?? ''))}">`
        }
        ${param.description ? `<div class="form-hint">${escapeHtml(param.description)}</div>` : ''}
        ${param.enum ? `<div class="form-hint">Allowed: ${param.enum.map(v => `<code>${escapeHtml(v)}</code>`).join(', ')}</div>` : ''}
      </div>`
  }).join('')

  const credentialFields = authMode === 'api_key' || authMode === 'bot_token'
    ? `<div class="form-group">
        <label class="form-label">API Key / Token <span class="required">*</span></label>
        <input type="password" class="form-input" id="credential-key" placeholder="Enter API key...">
      </div>`
    : authMode === 'oauth'
    ? `<div class="form-group">
        <label class="form-label">Access Token <span class="required">*</span></label>
        <input type="password" class="form-input" id="credential-key" placeholder="Enter OAuth access token...">
        <div class="form-hint">Paste a valid OAuth access token for testing.</div>
      </div>`
    : ''

  const content = `
    <div class="main">
      <a href="/ui/integrations/${escapeHtml(integration?.id || '')}" class="back-link">&larr; Back to ${escapeHtml(integration?.name || 'integration')}</a>

      <h1 style="font-size: 1.3rem; font-weight: 700; margin-bottom: 0.25rem;">Test: ${escapeHtml(tool.name || tool.id)}</h1>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">
        <code>${escapeHtml(tool.id)}</code>
        ${tool.description ? ` &mdash; ${escapeHtml(tool.description)}` : ''}
      </p>

      <div class="two-col">
        <div>
          <h2 class="section-title">Parameters</h2>
          <form id="test-form">
            ${credentialFields}
            ${paramFields || '<div class="empty" style="padding: 1rem;">No parameters required.</div>'}
            <button type="submit" class="btn btn-primary" id="execute-btn">Execute</button>
          </form>
        </div>

        <div>
          <h2 class="section-title">Result</h2>
          <div id="result" class="result-panel" style="display: none;">
            <div class="result-header">
              <span id="result-status">-</span>
              <span id="result-time" style="color: var(--text-muted); font-weight: 400;">-</span>
            </div>
            <div class="result-body">
              <pre class="code-block" id="result-body" style="max-height: 400px;">-</pre>
            </div>
          </div>

          <div class="section" style="margin-top: 1.5rem;">
            <div class="collapsible-header section-title" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
              Request Body
            </div>
            <div class="collapsible-body">
              <pre class="code-block" id="request-body">Submit the form to see the request body.</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      const form = document.getElementById('test-form');
      const resultPanel = document.getElementById('result');
      const resultStatus = document.getElementById('result-status');
      const resultTime = document.getElementById('result-time');
      const resultBody = document.getElementById('result-body');
      const requestBody = document.getElementById('request-body');
      const executeBtn = document.getElementById('execute-btn');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        executeBtn.disabled = true;
        executeBtn.textContent = 'Executing...';

        const params = {};
        const inputs = form.querySelectorAll('input[name], textarea[name]');
        inputs.forEach(input => {
          const val = input.value.trim();
          if (!val) return;
          // Try parsing JSON for textarea
          if (input.tagName === 'TEXTAREA') {
            try { params[input.name] = JSON.parse(val); } catch { params[input.name] = val; }
          } else if (input.type === 'number') {
            params[input.name] = Number(val);
          } else {
            params[input.name] = val;
          }
        });

        const credInput = document.getElementById('credential-key');
        const context = {};
        if (credInput && credInput.value.trim()) {
          const authMode = '${escapeHtml(authMode)}';
          if (authMode === 'oauth') {
            context.accessToken = credInput.value.trim();
          } else {
            context.apiKey = credInput.value.trim();
          }
        }

        const body = { params, context };
        requestBody.textContent = JSON.stringify(body, null, 2);

        try {
          const start = performance.now();
          const res = await fetch('/api/marketplace/tools/${escapeHtml(toolId)}/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const elapsed = Math.round(performance.now() - start);
          const data = await res.json();

          resultPanel.style.display = '';
          resultTime.textContent = elapsed + 'ms';

          if (data.success) {
            resultStatus.className = 'result-success';
            resultStatus.textContent = 'Success';
          } else {
            resultStatus.className = 'result-error';
            resultStatus.textContent = 'Error: ' + (data.error || 'Unknown');
          }
          resultBody.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
          resultPanel.style.display = '';
          resultStatus.className = 'result-error';
          resultStatus.textContent = 'Network Error';
          resultBody.textContent = err.message;
          resultTime.textContent = '-';
        }

        executeBtn.disabled = false;
        executeBtn.textContent = 'Execute';
      });
    </script>`

  return c.html(layout(`Test ${tool.name || tool.id}`, content))
})

// ---------------------------------------------------------------------------
// Stats page
// ---------------------------------------------------------------------------

app.get('/stats', (c) => {
  const integrations = manifestRegistry.getAllIntegrations()
  const stats = manifestRegistry.stats()
  const handlerCount = getHandlerCount()
  const loadedIntegrations = new Set(getLoadedIntegrations())

  let oauthCount = 0, apiKeyCount = 0, noAuthCount = 0, botTokenCount = 0
  let triggerCount = 0, hiddenCount = 0
  const missingHandlers: string[] = []

  for (const i of integrations) {
    const auth = i.block?.authMode || 'none'
    if (auth === 'oauth') oauthCount++
    else if (auth === 'api_key') apiKeyCount++
    else if (auth === 'bot_token') botTokenCount++
    else noAuthCount++

    if (i.trigger) triggerCount++
    if (i.block?.hideFromToolbar) hiddenCount++
    if (!i.hasHandler && !loadedIntegrations.has(i.id)) missingHandlers.push(i.id)
  }

  const triggersHtml = integrations
    .filter(i => i.trigger)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(i => `<tr><td><a href="/ui/integrations/${escapeHtml(i.id)}">${escapeHtml(i.name)}</a></td><td>${escapeHtml(i.trigger?.provider || '-')}</td></tr>`)
    .join('')

  const missingHtml = missingHandlers
    .sort()
    .map(id => `<tr><td><a href="/ui/integrations/${escapeHtml(id)}">${escapeHtml(id)}</a></td></tr>`)
    .join('')

  const content = `
    <div class="main">
      <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem;">Marketplace Statistics</h1>

      <div class="stats-bar" style="flex-wrap: wrap;">
        <div class="stat">
          <span class="stat-value">${stats.integrations}</span>
          <span class="stat-label">Integrations</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.tools}</span>
          <span class="stat-label">Tools</span>
        </div>
        <div class="stat">
          <span class="stat-value">${handlerCount}</span>
          <span class="stat-label">Handlers Loaded</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.triggers}</span>
          <span class="stat-label">Triggers</span>
        </div>
        <div class="stat">
          <span class="stat-value">${hiddenCount}</span>
          <span class="stat-label">Hidden</span>
        </div>
      </div>

      <div class="two-col">
        <div class="section">
          <h2 class="section-title">Auth Breakdown</h2>
          <table>
            <thead><tr><th>Auth Mode</th><th>Count</th></tr></thead>
            <tbody>
              <tr><td>No Auth</td><td>${noAuthCount}</td></tr>
              <tr><td>API Key</td><td>${apiKeyCount}</td></tr>
              <tr><td>OAuth</td><td>${oauthCount}</td></tr>
              <tr><td>Bot Token</td><td>${botTokenCount}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2 class="section-title">Missing Handlers (${missingHandlers.length})</h2>
          ${missingHandlers.length > 0
            ? `<table><thead><tr><th>Integration</th></tr></thead><tbody>${missingHtml}</tbody></table>`
            : '<p style="color: var(--text-muted); font-size: 0.85rem;">All integrations have handlers.</p>'}
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">Trigger-Capable Integrations (${triggerCount})</h2>
        ${triggersHtml
          ? `<table><thead><tr><th>Integration</th><th>Provider</th></tr></thead><tbody>${triggersHtml}</tbody></table>`
          : '<p style="color: var(--text-muted);">No trigger-capable integrations.</p>'}
      </div>
    </div>`

  return c.html(layout('Stats', content, 'stats'))
})

export { app as uiRoutes }
