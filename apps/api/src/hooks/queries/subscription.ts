/**
 * Subscription query stubs for the API server.
 * The web app uses React Query hooks; here we export just the key factories
 * and minimal stubs for any server-side references.
 */

/**
 * Query key factories for subscription queries
 */
export const subscriptionKeys = {
  all: ['subscription'] as const,
  data: (userId?: string) => [...subscriptionKeys.all, 'data', userId ?? ''] as const,
  usageLimit: (userId?: string) => [...subscriptionKeys.all, 'usageLimit', userId ?? ''] as const,
}

/**
 * Server-side stub - throws if called since this is a React hook.
 */
export function useSubscriptionData(_options?: Record<string, unknown>): never {
  throw new Error(
    'useSubscriptionData is a client-side hook and cannot be used on the API server.'
  )
}
