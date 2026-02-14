/**
 * Redis client stub for the API server.
 *
 * Returns null (no Redis available) by default.
 * Callers already handle the null case gracefully.
 */

import { createLogger } from '@sim/logger'

const logger = createLogger('Redis')

/**
 * Get a Redis client instance.
 * Returns null when Redis is not configured.
 */
export function getRedisClient(): any {
  return null
}

/**
 * Acquire a distributed lock using Redis SET NX.
 * Returns true (lock "acquired") when Redis is unavailable.
 */
export async function acquireLock(
  _lockKey: string,
  _value: string,
  _expirySeconds: number
): Promise<boolean> {
  return true
}

/**
 * Release a distributed lock safely.
 * Returns true (no-op) when Redis is unavailable.
 */
export async function releaseLock(_lockKey: string, _value: string): Promise<boolean> {
  return true
}

/**
 * Close the Redis connection.
 */
export async function closeRedisConnection(): Promise<void> {
  // No-op
}
