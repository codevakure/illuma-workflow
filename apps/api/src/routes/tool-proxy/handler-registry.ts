import type { Context } from 'hono'
import type { ToolResponse } from '@/tools/types'

/**
 * Handler function signature for dedicated tool proxy handlers.
 * Receives the request body and Hono context, returns a ToolResponse.
 */
export type ToolProxyHandler = (
  body: Record<string, any>,
  c: Context
) => Promise<ToolResponse>

/**
 * Registry of dedicated handlers for complex tools that need server-side logic
 * beyond simple API forwarding (file uploads, MIME assembly, DB connections, etc.)
 *
 * Key format: "{service}/{action}" or "{service}" for single-level routes.
 */
const handlers = new Map<string, ToolProxyHandler>()

/**
 * Register a dedicated handler for a specific route.
 */
export function registerHandler(routeKey: string, handler: ToolProxyHandler): void {
  handlers.set(routeKey, handler)
}

/**
 * Register multiple handlers for a service at once.
 * Convenience method for services with many operations (Slack, Gmail, etc.)
 */
export function registerServiceHandlers(
  service: string,
  actionHandlers: Record<string, ToolProxyHandler>
): void {
  for (const [action, handler] of Object.entries(actionHandlers)) {
    handlers.set(`${service}/${action}`, handler)
  }
}

/**
 * Get the dedicated handler for a specific route.
 * Returns undefined if no dedicated handler exists (falls through to generic handler).
 */
export function getDedicatedHandler(
  service: string,
  action?: string
): ToolProxyHandler | undefined {
  if (action) {
    // Try specific route first
    const specific = handlers.get(`${service}/${action}`)
    if (specific) return specific
  }

  // Try service-level handler
  return handlers.get(service)
}

/**
 * Get all registered handler route keys (for debugging).
 */
export function getRegisteredHandlers(): string[] {
  return Array.from(handlers.keys())
}
