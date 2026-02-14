/**
 * Subscription management stubs
 * TODO: Implement full billing logic
 */

export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'enterprise'

/**
 * Get the highest priority subscription for a user.
 * Returns the most relevant subscription considering personal and organization plans.
 */
export async function getHighestPrioritySubscription(
  _userId: string
): Promise<{
  plan: string
  status: string
  referenceId: string
  seats: number | null
  periodStart: Date | null
  periodEnd: Date | null
} | null> {
  return null
}

/**
 * Check if a referenceId (user ID or org ID) has an active subscription
 */
export async function hasActiveSubscription(_referenceId: string): Promise<boolean> {
  return false
}

/**
 * Check if user is on Pro plan (direct or via organization)
 */
export async function isProPlan(_userId: string): Promise<boolean> {
  return false
}

/**
 * Check if user is on Team plan (direct or via organization)
 */
export async function isTeamPlan(_userId: string): Promise<boolean> {
  return false
}

/**
 * Check if user is on Enterprise plan (direct or via organization)
 */
export async function isEnterprisePlan(_userId: string): Promise<boolean> {
  return false
}

/**
 * Check if an organization has an enterprise plan
 * Used for Access Control (Permission Groups) feature gating
 */
export async function isOrganizationOnEnterprisePlan(
  _organizationId: string
): Promise<boolean> {
  return false
}

/**
 * Check if an organization has team or enterprise plan
 */
export async function isOrganizationOnTeamOrEnterprisePlan(
  _organizationId: string
): Promise<boolean> {
  return false
}

/**
 * Check if user has access to credential sets feature
 */
export async function hasCredentialSetsAccess(_userId: string): Promise<boolean> {
  return false
}

/**
 * Check if user has access to SSO feature
 */
export async function hasSSOAccess(_userId: string): Promise<boolean> {
  return false
}

/**
 * Check if user has access to Access Control (Permission Groups) feature
 */
export async function hasAccessControlAccess(_userId: string): Promise<boolean> {
  return false
}

/**
 * Check if user has exceeded their cost limit
 */
export async function hasExceededCostLimit(_userId: string): Promise<boolean> {
  return false
}

/**
 * Send welcome email for Pro and Team plan subscriptions
 */
export async function sendPlanWelcomeEmail(_subscription: unknown): Promise<void> {}
