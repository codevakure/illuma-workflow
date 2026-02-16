import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { resolve } from 'path'
import type { ToolHandler } from '../sdk/types'
import { createLogger } from './lib/logger'

const logger = createLogger('handler-loader')

/** Registry mapping integration ID → loaded ToolHandler */
const handlerRegistry = new Map<string, ToolHandler>()

/** Maps tool ID → integration ID for fast lookup */
const toolToIntegration = new Map<string, string>()

/**
 * Validates that a handler module exports the correct shape.
 */
function validateHandler(handler: unknown, integrationId: string): handler is ToolHandler {
  if (!handler || typeof handler !== 'object') {
    logger.warn(`Handler for ${integrationId} is not an object`)
    return false
  }

  const h = handler as Record<string, unknown>

  if (!h.operations || typeof h.operations !== 'object') {
    logger.warn(`Handler for ${integrationId} missing operations map`)
    return false
  }

  const ops = h.operations as Record<string, unknown>
  for (const [name, fn] of Object.entries(ops)) {
    if (typeof fn !== 'function') {
      logger.warn(`Handler for ${integrationId}: operation "${name}" is not a function`)
      return false
    }
  }

  return true
}

/**
 * Scans integration directories for handler.ts files and loads them.
 */
export async function loadHandlers(
  integrationsDir: string,
  toolIdMappings: Map<string, string>
): Promise<void> {
  handlerRegistry.clear()
  toolToIntegration.clear()

  const entries = await readdir(integrationsDir, { withFileTypes: true })
  let loaded = 0
  let skipped = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('_')) continue

    const handlerPath = resolve(integrationsDir, entry.name, 'handler.ts')
    if (!existsSync(handlerPath)) {
      skipped++
      continue
    }

    try {
      const module = await import(handlerPath)
      const handler = module.default ?? module

      if (!validateHandler(handler, entry.name)) {
        logger.warn(`Skipping invalid handler: ${entry.name}`)
        skipped++
        continue
      }

      handlerRegistry.set(entry.name, handler)
      loaded++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to load handler for ${entry.name}: ${message}`)
      skipped++
    }
  }

  // Build tool ID → integration ID mapping
  for (const [toolId, integrationId] of toolIdMappings) {
    if (handlerRegistry.has(integrationId)) {
      toolToIntegration.set(toolId, integrationId)
    }
  }

  logger.info(`Loaded ${loaded} handlers, skipped ${skipped}`)
}

/**
 * Gets the handler for an integration by ID.
 */
export function getHandler(integrationId: string): ToolHandler | undefined {
  return handlerRegistry.get(integrationId)
}

/**
 * Gets the integration ID for a tool ID.
 */
export function getIntegrationForTool(toolId: string): string | undefined {
  return toolToIntegration.get(toolId)
}

/**
 * Gets the handler for a specific tool ID.
 */
export function getHandlerForTool(toolId: string): ToolHandler | undefined {
  const integrationId = toolToIntegration.get(toolId)
  if (!integrationId) return undefined
  return handlerRegistry.get(integrationId)
}

/**
 * Returns the number of loaded handlers.
 */
export function getHandlerCount(): number {
  return handlerRegistry.size
}

/**
 * Returns all loaded integration IDs.
 */
export function getLoadedIntegrations(): string[] {
  return Array.from(handlerRegistry.keys())
}
