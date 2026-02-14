/**
 * Alert rules for workspace notification subscriptions.
 */

export interface AlertConfig {
  type?: string
  threshold?: number
  cooldownMinutes?: number
  [key: string]: unknown
}

export interface AlertCheckContext {
  workflowId: string
  executionId: string
  status: 'error' | 'success'
  durationMs: number
  cost: number
  triggerFilter: string[]
}

/**
 * Determines whether an alert should be triggered based on configuration and context.
 */
export async function shouldTriggerAlert(
  _config: AlertConfig,
  _context: AlertCheckContext,
  _lastAlertAt: Date | null
): Promise<boolean> {
  return false
}
