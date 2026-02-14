/**
 * Server-side stub for useEnvironmentStore.
 * The API resolves environment variables from the database, not a client store.
 */
import type { EnvironmentVariable } from './types'

export const useEnvironmentStore = {
  getState: () => ({
    variables: {} as Record<string, EnvironmentVariable>,
    isLoading: false,
    error: null,
    loadEnvironmentVariables: async () => {},
    setVariables: (_variables: Record<string, EnvironmentVariable>) => {},
    getAllVariables: () => ({}) as Record<string, EnvironmentVariable>,
    reset: () => {},
  }),
}
