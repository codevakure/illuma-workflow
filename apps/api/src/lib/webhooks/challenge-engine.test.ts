/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChallengeSpec } from '@/integrations/types'
import { handleManifestChallenge } from './challenge-engine'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

function makeUrl(base: string, params?: Record<string, string>): URL {
  const url = new URL(base)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }
  return url
}

describe('handleManifestChallenge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('body_echo', () => {
    const challenge: ChallengeSpec = { type: 'body_echo', field: 'challenge' }

    it('echoes the challenge field from the body', async () => {
      const body = { type: 'url_verification', challenge: 'test-challenge-value' }
      const url = makeUrl('https://example.com/webhook')

      const response = handleManifestChallenge(challenge, body, url)

      expect(response).not.toBeNull()
      const json = await response!.json()
      expect(json).toEqual({ challenge: 'test-challenge-value' })
    })

    it('returns null when field is not present in body', () => {
      const body = { type: 'event_callback', event: {} }
      const url = makeUrl('https://example.com/webhook')

      const response = handleManifestChallenge(challenge, body, url)

      expect(response).toBeNull()
    })

    it('returns null when body is null', () => {
      const url = makeUrl('https://example.com/webhook')

      const response = handleManifestChallenge(challenge, null, url)

      expect(response).toBeNull()
    })

    it('returns null when body is not an object', () => {
      const url = makeUrl('https://example.com/webhook')

      const response = handleManifestChallenge(challenge, 'string-body', url)

      expect(response).toBeNull()
    })
  })

  describe('query_echo', () => {
    const challenge: ChallengeSpec = { type: 'query_echo', param: 'validationToken' }

    it('echoes the query parameter as plain text', async () => {
      const url = makeUrl('https://example.com/webhook', {
        validationToken: 'ms-graph-token-123',
      })

      const response = handleManifestChallenge(challenge, {}, url)

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      expect(response!.headers.get('Content-Type')).toBe('text/plain')
      expect(await response!.text()).toBe('ms-graph-token-123')
    })

    it('returns null when query param is not present', () => {
      const url = makeUrl('https://example.com/webhook')

      const response = handleManifestChallenge(challenge, {}, url)

      expect(response).toBeNull()
    })

    it('uses custom content type when specified', async () => {
      const customChallenge: ChallengeSpec = {
        type: 'query_echo',
        param: 'validationToken',
        contentType: 'application/json',
      }
      const url = makeUrl('https://example.com/webhook', {
        validationToken: '{"ok":true}',
      })

      const response = handleManifestChallenge(customChallenge, {}, url)

      expect(response).not.toBeNull()
      expect(response!.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('hub_verify', () => {
    const challenge: ChallengeSpec = {
      type: 'hub_verify',
      verifyTokenField: 'verificationToken',
    }

    it('echoes hub.challenge when token matches', async () => {
      const url = makeUrl('https://example.com/webhook', {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'my-verify-token',
        'hub.challenge': 'challenge-string-123',
      })

      const response = handleManifestChallenge(challenge, {}, url, {
        verificationToken: 'my-verify-token',
      })

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      expect(await response!.text()).toBe('challenge-string-123')
    })

    it('returns 403 when token does not match', async () => {
      const url = makeUrl('https://example.com/webhook', {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-123',
      })

      const response = handleManifestChallenge(challenge, {}, url, {
        verificationToken: 'correct-token',
      })

      expect(response).not.toBeNull()
      expect(response!.status).toBe(403)
    })

    it('returns 400 for invalid mode', async () => {
      const url = makeUrl('https://example.com/webhook', {
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'token',
        'hub.challenge': 'challenge',
      })

      const response = handleManifestChallenge(challenge, {}, url, {
        verificationToken: 'token',
      })

      expect(response).not.toBeNull()
      expect(response!.status).toBe(400)
    })

    it('returns null when hub params are missing', () => {
      const url = makeUrl('https://example.com/webhook')

      const response = handleManifestChallenge(challenge, {}, url)

      expect(response).toBeNull()
    })

    it('returns 403 when provider config has no token', async () => {
      const url = makeUrl('https://example.com/webhook', {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token',
        'hub.challenge': 'challenge',
      })

      const response = handleManifestChallenge(challenge, {}, url, {})

      expect(response).not.toBeNull()
      expect(response!.status).toBe(403)
    })

    it('returns 403 when no provider config is provided', async () => {
      const url = makeUrl('https://example.com/webhook', {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token',
        'hub.challenge': 'challenge',
      })

      const response = handleManifestChallenge(challenge, {}, url)

      expect(response).not.toBeNull()
      expect(response!.status).toBe(403)
    })
  })

  describe('unknown challenge type', () => {
    it('returns null for unknown challenge type', () => {
      const challenge = { type: 'unknown_type' } as unknown as ChallengeSpec
      const url = makeUrl('https://example.com/webhook')

      const response = handleManifestChallenge(challenge, {}, url)

      expect(response).toBeNull()
    })
  })
})
