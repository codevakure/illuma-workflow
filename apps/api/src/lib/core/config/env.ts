/**
 * Environment variable configuration for the API server.
 * Provides the same interface as the sim app's `@/lib/core/config/env` module.
 */
export { env, isTruthy, isFalsy } from '@/lib/env'

/**
 * Get a specific environment variable by name.
 * In the sim app this delegates to next-runtime-env; here we read process.env directly.
 */
export function getEnv(variable: string): string | undefined {
  return process.env[variable]
}
