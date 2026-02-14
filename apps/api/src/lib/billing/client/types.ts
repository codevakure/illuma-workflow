/**
 * Client-side billing types
 */

export interface UsageData {
  current: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
}

export interface SubscriptionData {
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
}

export interface BillingStatus {
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  isFree: boolean
}

export interface UsageLimitData {
  currentLimit: number
  canEdit: boolean
  minimumLimit: number
  plan: string
  updatedAt: Date | null
}
