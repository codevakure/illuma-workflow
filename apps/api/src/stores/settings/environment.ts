/**
 * Environment variable store stub for the API server.
 * In the web app this is a Zustand store; here we provide a minimal compatible interface.
 */

export interface EnvironmentVariable {
  value: string
}

interface EnvironmentStoreState {
  getAllVariables: () => Record<string, EnvironmentVariable>
}

/**
 * Server-side stub for the environment store.
 * Returns an empty variables map since environment variables
 * are resolved differently on the server.
 */
export const useEnvironmentStore = {
  getState: (): EnvironmentStoreState => ({
    getAllVariables: () => ({}),
  }),
}
