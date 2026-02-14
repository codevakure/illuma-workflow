/**
 * Manifest loader for the Integration Marketplace.
 *
 * Scans integrations subdirectories at startup, loads and validates
 * each manifest.json, and builds in-memory lookup maps for blocks,
 * tools, and triggers.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '@/lib/logger'
import type {
  BlockManifest,
  IntegrationManifest,
  ToolManifest,
  TriggerManifest,
} from '@/types'

const logger = createLogger('ManifestLoader')

/** In-memory registry populated at startup */
class ManifestRegistry {
  private integrations = new Map<string, IntegrationManifest>()
  private blocksByType = new Map<string, BlockManifest>()
  private toolsById = new Map<string, ToolManifest>()
  private triggersByProvider = new Map<string, TriggerManifest>()
  private toolToIntegration = new Map<string, string>()

  /**
   * Scans the integrations directory and loads all manifest.json files.
   * Invalid manifests are logged and skipped.
   */
  load(integrationsDir: string): void {
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

      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(raw) as IntegrationManifest

        const errors = this.validate(manifest, entry.name)
        if (errors.length > 0) {
          logger.warn(`Skipping invalid manifest: ${entry.name}`, { errors })
          skipped++
          continue
        }

        this.register(manifest)
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
      triggers: this.triggersByProvider.size,
    })
  }

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

    if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
      errors.push('Must have at least one tool')
    } else {
      for (const tool of manifest.tools) {
        if (!tool.id) errors.push('Tool missing id')
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

    if (manifest.id !== dirName) {
      errors.push(`Manifest id "${manifest.id}" does not match directory name "${dirName}"`)
    }

    return errors
  }

  private register(manifest: IntegrationManifest): void {
    this.integrations.set(manifest.id, manifest)

    if (manifest.block) {
      this.blocksByType.set(manifest.block.type, manifest.block)
    }

    for (const tool of manifest.tools) {
      this.toolsById.set(tool.id, tool)
      this.toolToIntegration.set(tool.id, manifest.id)
    }

    if (manifest.trigger) {
      this.triggersByProvider.set(manifest.trigger.provider, manifest.trigger)
    }
  }

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

  getTrigger(provider: string): TriggerManifest | undefined {
    return this.triggersByProvider.get(provider)
  }

  getAllTriggers(): TriggerManifest[] {
    return Array.from(this.triggersByProvider.values())
  }

  getIntegrationForTool(toolId: string): IntegrationManifest | undefined {
    const integrationId = this.toolToIntegration.get(toolId)
    return integrationId ? this.integrations.get(integrationId) : undefined
  }

  hasManifestTool(toolId: string): boolean {
    return this.toolsById.has(toolId)
  }

  stats(): { integrations: number; blocks: number; tools: number; triggers: number } {
    return {
      integrations: this.integrations.size,
      blocks: this.blocksByType.size,
      tools: this.toolsById.size,
      triggers: this.triggersByProvider.size,
    }
  }
}

/** Singleton registry instance */
export const manifestRegistry = new ManifestRegistry()

/**
 * Resolves the integrations directory path.
 * Looks for the integrations/ folder relative to the marketplace app root.
 */
function resolveIntegrationsDir(): string {
  // When running from src/, go up one level to find integrations/
  const fromSrc = path.resolve(__dirname, '..', '..', 'integrations')
  if (fs.existsSync(fromSrc)) {
    return fromSrc
  }

  // Fallback: check relative to CWD
  const fromCwd = path.resolve(process.cwd(), 'integrations')
  if (fs.existsSync(fromCwd)) {
    return fromCwd
  }

  return fromSrc
}

/**
 * Initializes the manifest registry by scanning the integrations directory.
 * Call this once at server startup.
 */
export function initializeManifests(): void {
  const integrationsDir = resolveIntegrationsDir()
  logger.info('Initializing manifest registry', { dir: integrationsDir })
  manifestRegistry.load(integrationsDir)
}
