/**
 * Manifest loader for the Integration Marketplace.
 *
 * Scans `apps/api/src/integrations/` subdirectories at startup, loads and
 * validates each `manifest.json`, and builds in-memory lookup maps for
 * blocks, tools, and triggers.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import type {
  BlockManifest,
  IntegrationManifest,
  ToolManifest,
  TriggerManifest,
} from '@/integrations/types'

const logger = createLogger('ManifestLoader')

/** In-memory registry populated at startup */
class ManifestRegistry {
  private integrations = new Map<string, IntegrationManifest>()
  private blocksByType = new Map<string, BlockManifest>()
  private toolsById = new Map<string, ToolManifest>()

  /** Trigger ID → TriggerManifest (e.g. "slack_webhook" → manifest) */
  private triggersById = new Map<string, TriggerManifest>()

  /** Provider → TriggerManifest[] (e.g. "github" → [github_push, github_pr, ...]) */
  private triggersByProvider = new Map<string, TriggerManifest[]>()

  /** Trigger ID → Integration ID (for reverse lookup) */
  private triggerToIntegration = new Map<string, string>()

  /** Integration ID → manifest for tool-to-integration resolution */
  private toolToIntegration = new Map<string, string>()

  /** Integration IDs that are core blocks (loaded from API's blocks/manifests/) */
  private coreIntegrationIds = new Set<string>()

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------

  /**
   * Scans the integrations directory and loads all manifest.json files.
   * Invalid manifests are logged and skipped — they don't block startup.
   * @param isCore - If true, marks loaded integrations as core (API-owned)
   * @param handlerOnly - If true, only loads integrations that have a handler.ts file
   */
  load(integrationsDir: string, isCore = false, handlerOnly = false): void {
    if (!fs.existsSync(integrationsDir)) {
      logger.info('Integrations directory does not exist, no manifests loaded', {
        dir: integrationsDir,
      })
      return
    }

    const entries = fs.readdirSync(integrationsDir, { withFileTypes: true })
    let loaded = 0
    let skipped = 0

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const manifestPath = path.join(integrationsDir, entry.name, 'manifest.json')
      if (!fs.existsSync(manifestPath)) continue

      // When handlerOnly is true, skip integrations without a handler.ts file
      if (handlerOnly) {
        const handlerPath = path.join(integrationsDir, entry.name, 'handler.ts')
        if (!fs.existsSync(handlerPath)) {
          skipped++
          continue
        }
      }

      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(raw) as IntegrationManifest

        const errors = this.validate(manifest, entry.name)
        if (errors.length > 0) {
          logger.warn(`Skipping invalid manifest: ${entry.name}`, { errors })
          skipped++
          continue
        }

        this.register(manifest, isCore)
        loaded++
      } catch (error) {
        logger.error(`Failed to load manifest: ${entry.name}`, { error })
        skipped++
      }
    }

    logger.info('Manifest loading complete', {
      loaded,
      skipped,
      blocks: this.blocksByType.size,
      tools: this.toolsById.size,
      triggers: this.triggersById.size,
    })
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  private validate(manifest: IntegrationManifest, dirName: string): string[] {
    const errors: string[] = []

    if (!manifest.id) errors.push('Missing id')
    if (!manifest.name) errors.push('Missing name')
    if (!manifest.version) errors.push('Missing version')

    if (!manifest.block) {
      errors.push('Missing block definition')
    } else {
      if (!manifest.block.type) errors.push('Block missing type')
      if (!manifest.block.name) errors.push('Block missing name')
      if (!manifest.block.category) errors.push('Block missing category')
      if (!Array.isArray(manifest.block.subBlocks)) errors.push('Block missing subBlocks array')
    }

    if (!Array.isArray(manifest.tools)) {
      errors.push('Missing tools array')
    } else if (manifest.tools.length > 0) {
      for (const tool of manifest.tools) {
        if (!tool.id) errors.push(`Tool missing id`)
        if (!tool.executionMode) errors.push(`Tool ${tool.id || '?'} missing executionMode`)

        if (tool.executionMode === 'direct') {
          if (!tool.request?.url) errors.push(`Direct tool ${tool.id} missing request.url`)
          if (!tool.request?.method) errors.push(`Direct tool ${tool.id} missing request.method`)
        }

        if (tool.executionMode === 'proxy') {
          if (!tool.proxy?.handler) errors.push(`Proxy tool ${tool.id} missing proxy.handler`)
        }

        if (tool.executionMode === 'sandbox') {
          if (!tool.codeModule) errors.push(`Sandbox tool ${tool.id} missing codeModule`)
        }
      }
    }

    // Validate triggers array if present
    if (manifest.triggers) {
      if (!Array.isArray(manifest.triggers)) {
        errors.push('triggers must be an array')
      } else {
        for (const trigger of manifest.triggers) {
          if (!trigger.id) errors.push('Trigger missing id')
          if (!trigger.name) errors.push(`Trigger ${trigger.id || '?'} missing name`)
          if (!trigger.provider) errors.push(`Trigger ${trigger.id || '?'} missing provider`)
        }
      }
    }

    if (manifest.id !== dirName) {
      errors.push(`Manifest id "${manifest.id}" does not match directory name "${dirName}"`)
    }

    return errors
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  private register(manifest: IntegrationManifest, isCore = false): void {
    // Enrich with icon SVG from the marketplace icon registry
    const iconId = manifest.icon || manifest.block?.icon
    if (iconId && iconSvgMap[iconId]) {
      manifest.iconSvg = iconSvgMap[iconId]
      if (manifest.block) {
        manifest.block.iconSvg = iconSvgMap[iconId]
      }
    }

    this.integrations.set(manifest.id, manifest)

    if (isCore) {
      this.coreIntegrationIds.add(manifest.id)
    }

    // Block
    if (manifest.block) {
      this.blocksByType.set(manifest.block.type, manifest.block)
    }

    // Tools
    for (const tool of manifest.tools) {
      this.toolsById.set(tool.id, tool)
      this.toolToIntegration.set(tool.id, manifest.id)
    }

    // Triggers
    for (const trigger of manifest.triggers ?? []) {
      this.triggersById.set(trigger.id, trigger)
      this.triggerToIntegration.set(trigger.id, manifest.id)

      const existing = this.triggersByProvider.get(trigger.provider) ?? []
      existing.push(trigger)
      this.triggersByProvider.set(trigger.provider, existing)
    }
  }

  // -----------------------------------------------------------------------
  // Query API
  // -----------------------------------------------------------------------

  getIntegration(id: string): IntegrationManifest | undefined {
    return this.integrations.get(id)
  }

  getAllIntegrations(): IntegrationManifest[] {
    return Array.from(this.integrations.values())
  }

  getBlock(type: string): BlockManifest | undefined {
    return this.blocksByType.get(type)
  }

  getAllBlocks(): BlockManifest[] {
    return Array.from(this.blocksByType.values())
  }

  getTool(id: string): ToolManifest | undefined {
    return this.toolsById.get(id)
  }

  getAllTools(): ToolManifest[] {
    return Array.from(this.toolsById.values())
  }

  /** Get a single trigger by its ID (e.g. "slack_webhook", "github_push") */
  getTriggerById(triggerId: string): TriggerManifest | undefined {
    return this.triggersById.get(triggerId)
  }

  /** Get triggers for a provider (e.g. "github" → [github_push, github_pr, ...]) */
  getTriggersForProvider(provider: string): TriggerManifest[] {
    return this.triggersByProvider.get(provider) ?? []
  }

  /** Get triggers for a provider, returning the first match (used by /triggers/:provider route) */
  getTrigger(provider: string): TriggerManifest | undefined {
    return this.triggersByProvider.get(provider)?.[0]
  }

  /** Returns all registered trigger manifests */
  getAllTriggers(): TriggerManifest[] {
    return Array.from(this.triggersById.values())
  }

  /** Returns the integration manifest that owns a given trigger */
  getIntegrationForTrigger(triggerId: string): IntegrationManifest | undefined {
    const integrationId = this.triggerToIntegration.get(triggerId)
    return integrationId ? this.integrations.get(integrationId) : undefined
  }

  /** Returns the integration manifest that owns a given tool */
  getIntegrationForTool(toolId: string): IntegrationManifest | undefined {
    const integrationId = this.toolToIntegration.get(toolId)
    return integrationId ? this.integrations.get(integrationId) : undefined
  }

  /** Check if a tool ID is backed by a manifest */
  hasManifestTool(toolId: string): boolean {
    return this.toolsById.has(toolId)
  }

  /** Check if an integration is a core block (loaded from API's blocks/manifests/) */
  isCoreIntegration(id: string): boolean {
    return this.coreIntegrationIds.has(id)
  }

  /** Returns all core integration manifests */
  getCoreIntegrations(): IntegrationManifest[] {
    return Array.from(this.integrations.values()).filter((i) =>
      this.coreIntegrationIds.has(i.id)
    )
  }

  /** Returns counts for monitoring */
  stats(): { integrations: number; blocks: number; tools: number; triggers: number } {
    return {
      integrations: this.integrations.size,
      blocks: this.blocksByType.size,
      tools: this.toolsById.size,
      triggers: this.triggersById.size,
    }
  }
}

/** In-memory icon SVG map loaded from marketplace icons.json */
let iconSvgMap: Record<string, string> = {}

/** Singleton registry instance */
export const manifestRegistry = new ManifestRegistry()

/**
 * Resolves the core blocks manifest directory.
 * Core blocks (starter, agent, condition, etc.) and trigger blocks live in
 * the API's own blocks/manifests/ directory.
 */
function resolveCoreManifestsDir(): string {
  const dir = path.resolve(__dirname, '..', 'blocks', 'manifests')
  return dir
}

/**
 * Resolves the marketplace integrations directory for tool manifests.
 *
 * Checks in order:
 * 1. Marketplace app's integrations directory (canonical location)
 * 2. Local integrations directory (for backward compatibility)
 * 3. CWD-relative path
 */
function resolveIntegrationsDir(): string {
  // Prefer marketplace's integrations directory (the canonical source)
  const marketplaceDir = path.resolve(__dirname, '..', '..', '..', 'marketplace', 'integrations')
  if (fs.existsSync(marketplaceDir)) {
    return marketplaceDir
  }

  // Fallback: local integrations directory (src/integrations/)
  const dirFromModule = path.resolve(__dirname)
  if (fs.existsSync(dirFromModule)) {
    return dirFromModule
  }

  // Fallback: resolve from CWD (project root)
  const dirFromCwd = path.resolve(process.cwd(), 'src', 'integrations')
  if (fs.existsSync(dirFromCwd)) {
    return dirFromCwd
  }

  return marketplaceDir
}

/**
 * Loads the marketplace icon registry (icons.json) so that integration
 * manifests can be enriched with inline SVG data. This allows the web app
 * to render icons without maintaining a separate icon registry.
 */
function loadIconRegistry(): void {
  // Look for icons.json in the marketplace app root
  const marketplaceRoot = path.resolve(__dirname, '..', '..', '..', 'marketplace')
  const iconsPath = path.join(marketplaceRoot, 'icons.json')

  if (fs.existsSync(iconsPath)) {
    try {
      const raw = fs.readFileSync(iconsPath, 'utf-8')
      iconSvgMap = JSON.parse(raw) as Record<string, string>
      logger.info('Loaded icon registry', { icons: Object.keys(iconSvgMap).length })
    } catch (error) {
      logger.warn('Failed to load icons.json', { error })
    }
  } else {
    logger.info('No icons.json found, icons will not be enriched', { path: iconsPath })
  }
}

/**
 * Initializes the manifest registry by scanning both the core blocks
 * directory (API-local) and the marketplace integrations directory.
 * Call this once at server startup.
 */
export function initializeManifests(): void {
  // 0. Load icon SVG registry from marketplace
  loadIconRegistry()

  // 1. Load core block + trigger manifests from API's blocks/manifests/
  const coreDir = resolveCoreManifestsDir()
  if (fs.existsSync(coreDir)) {
    logger.info('Loading core block manifests', { dir: coreDir })
    manifestRegistry.load(coreDir, true)
  }

  // 2. Load tool integration manifests from marketplace
  const integrationsDir = resolveIntegrationsDir()
  logger.info('Loading tool integration manifests', { dir: integrationsDir })
  manifestRegistry.load(integrationsDir, false)
}
