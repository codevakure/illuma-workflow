/**
 * Usage management stubs
 * TODO: Implement full billing usage tracking
 */

export interface OrgUsageLimitResult {
  limit: number
  minimum: number
}

/**
 * Calculates the effective usage limit for a team or enterprise organization
 */
export async function getOrgUsageLimit(
  _organizationId: string,
  _plan: string,
  _seats: number | null
): Promise<OrgUsageLimitResult> {
  return { limit: 0, minimum: 0 }
}

/**
 * Check usage status with warning thresholds
 */
export async function checkUsageStatus(_userId: string): Promise<{
  status: 'ok' | 'warning' | 'exceeded'
  usageData: {
    currentUsage: number
    limit: number
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
  }
}> {
  return {
    status: 'ok',
    usageData: {
      currentUsage: 0,
      limit: 1000,
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
    },
  }
}

/**
 * Send usage threshold notification when crossing thresholds
 */
export async function maybeSendUsageThresholdEmail(_params: {
  scope: 'user' | 'organization'
  planName: string
  percentBefore: number
  percentAfter: number
  userId?: string
  userEmail?: string
  userName?: string
  organizationId?: string
  currentUsageAfter: number
  limit: number
}): Promise<void> {}

/**
 * Get usage limit for a user
 */
export async function getUserUsageLimit(_userId: string): Promise<number> {
  return 1000
}

/**
 * Get comprehensive usage data for a user
 */
export async function getUserUsageData(_userId: string): Promise<{
  currentUsage: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
}> {
  return {
    currentUsage: 0,
    limit: 1000,
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    lastPeriodCost: 0,
  }
}

/**
 * Handle new user setup when they join the platform
 */
export async function handleNewUser(_userId: string): Promise<void> {}

/**
 * Ensures a userStats record exists for a user
 */
export async function ensureUserStatsExists(_userId: string): Promise<void> {}
