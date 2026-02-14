/**
 * Auth client stub for the API server.
 * The web app creates a better-auth client with React hooks;
 * the API server does not need these, so we export minimal stubs.
 */

/**
 * Minimal auth client stub - the API server authenticates via
 * server-side session/token validation, not the browser client.
 */
export const client = {
  signIn: {} as Record<string, unknown>,
  signUp: {} as Record<string, unknown>,
  signOut: (() => Promise.resolve()) as () => Promise<void>,
  getSession: async (): Promise<{ data: { user?: { id?: string; email?: string; name?: string } } | null }> => {
    return { data: null }
  },
  useActiveOrganization: () => ({ data: undefined, isPending: false, error: null }),
  subscription: {
    list: undefined,
    upgrade: undefined,
    cancel: undefined,
    restore: undefined,
  },
}

/**
 * Server-side session stub. Use server-side auth utilities (e.g. getSession)
 * from @/lib/auth instead.
 */
export function useSession(): never {
  throw new Error(
    'useSession is a client-side hook and cannot be used on the API server. ' +
    'Use server-side authentication utilities from @/lib/auth instead.'
  )
}

export const useActiveOrganization = () => ({ data: undefined, isPending: false, error: null })

export const useSubscription = () => ({
  list: undefined,
  upgrade: undefined,
  cancel: undefined,
  restore: undefined,
})

export const { signIn, signUp, signOut } = client
