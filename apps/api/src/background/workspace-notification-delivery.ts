/**
 * Workspace notification delivery background task stub.
 */

export interface NotificationDeliveryPayload {
  deliveryId: string
  subscriptionId: string
  notificationType: string
  log: unknown
  alertConfig?: unknown
}

/**
 * Execute a notification delivery directly (non-queued).
 */
export async function executeNotificationDelivery(
  _payload: NotificationDeliveryPayload
): Promise<void> {
  // No-op stub
}

/**
 * Trigger.dev task handle for workspace notification delivery.
 */
export const workspaceNotificationDeliveryTask = {
  trigger: async (_payload: NotificationDeliveryPayload): Promise<void> => {
    // No-op stub
  },
}
