/**
 * Client-side billing utility stubs
 */

import type { SubscriptionData } from './types'

/**
 * Get subscription status flags from subscription data
 */
export function getSubscriptionStatus(subscriptionData: SubscriptionData | null | undefined) {
  return {
    isPaid: subscriptionData?.isPaid ?? false,
    isPro: subscriptionData?.isPro ?? false,
    isTeam: subscriptionData?.isTeam ?? false,
    isEnterprise: subscriptionData?.isEnterprise ?? false,
    isFree: !(subscriptionData?.isPaid ?? false),
  }
}
