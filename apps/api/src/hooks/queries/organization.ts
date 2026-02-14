/**
 * Organization query stubs for the API server.
 * The web app uses React Query hooks; here we export just the key factories
 * and minimal stubs for any server-side references.
 */

/**
 * Query key factories for organization queries
 */
export const organizationKeys = {
  all: ['organization'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  detail: (orgId: string) => [...organizationKeys.all, 'detail', orgId] as const,
  subscription: (orgId: string) => [...organizationKeys.all, 'subscription', orgId] as const,
  billing: (orgId: string) => [...organizationKeys.all, 'billing', orgId] as const,
  members: (orgId: string) => [...organizationKeys.all, 'members', orgId] as const,
}

/**
 * Server-side stub - throws if called since these are React hooks.
 */
export function useOrganizations(): never {
  throw new Error('useOrganizations is a client-side hook and cannot be used on the API server.')
}

/**
 * Server-side stub - throws if called since these are React hooks.
 */
export function useOrganization(_orgId: string): never {
  throw new Error('useOrganization is a client-side hook and cannot be used on the API server.')
}
