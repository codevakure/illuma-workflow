import { createLogger } from '@sim/logger'
import { tools } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ToolProxyRouteMap')

/**
 * Maps route paths (e.g., "asana/create-task") to tool IDs (e.g., "asana_create_task").
 * Built once at startup by scanning all ToolConfig objects.
 */
let routeToToolMap: Map<string, string> | null = null

/**
 * Build the reverse mapping from /api/tools/{service}/{action} paths to tool IDs.
 * Scans every ToolConfig's request.url to find tools that point to internal proxy routes.
 */
function buildRouteMap(): Map<string, string> {
  const map = new Map<string, string>()

  for (const [toolId, tool] of Object.entries(tools)) {
    try {
      // Get the URL - if it's a function, we can't resolve it statically
      // (it depends on runtime params). We'll handle those via dedicated handlers.
      const url = typeof tool.request?.url === 'string' ? tool.request.url : null

      if (!url) continue

      // Match /api/tools/{service}/{action} pattern
      const internalMatch = url.match(/^\/api\/tools\/(.+)$/)
      if (internalMatch) {
        const routePath = internalMatch[1]
        // Avoid duplicates - first match wins (usually the latest version)
        if (!map.has(routePath)) {
          map.set(routePath, toolId)
        }
      }
    } catch {
      // Skip tools with invalid configs
    }
  }

  logger.info(`Built tool proxy route map: ${map.size} routes mapped`)
  return map
}

/**
 * Resolve a route path (e.g., "asana/create-task") to a tool ID.
 * Returns undefined if no tool is mapped to this route.
 */
export function resolveRouteToToolId(routePath: string): string | undefined {
  if (!routeToToolMap) {
    routeToToolMap = buildRouteMap()
  }
  return routeToToolMap.get(routePath)
}

/**
 * Get all mapped routes (for debugging/admin purposes).
 */
export function getAllMappedRoutes(): Record<string, string> {
  if (!routeToToolMap) {
    routeToToolMap = buildRouteMap()
  }
  return Object.fromEntries(routeToToolMap)
}

/**
 * Invalidate the route map cache (call when tools are added/removed dynamically).
 */
export function invalidateRouteMap(): void {
  routeToToolMap = null
}
