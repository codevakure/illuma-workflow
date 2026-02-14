/**
 * Billing System Types
 */

export interface EnterpriseSubscriptionMetadata {
  plan: 'enterprise'
  referenceId: string
  monthlyPrice: string
  seats: string
}

export interface UsageData {
  currentUsage: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
  lastPeriodCost: number
}

export type PlanType = 'free' | 'pro' | 'team' | 'enterprise'
export type BillingStatusType = 'ok' | 'warning' | 'exceeded'
