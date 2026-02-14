/**
 * No-op rate limiter stub.
 */

export class RateLimiter {
  /**
   * Checks the rate limit for a user, returning whether the request is allowed.
   */
  async checkRateLimitWithSubscription(
    _userId: string,
    _subscription: unknown,
    _triggerType: string,
    _isAsync: boolean
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetAt: new Date(Date.now() + 60_000),
    }
  }
}
