/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSpec } from '@/integrations/types'
import { verifyWebhookAuth } from './auth-engine'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

function makeHeaders(entries: Record<string, string>): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(entries)) {
    headers.set(key, value)
  }
  return headers
}

describe('verifyWebhookAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('HMAC auth', () => {
    const rawBody = '{"event":"test","data":"payload"}'

    it('verifies valid HMAC-SHA256 hex signature (GitHub-style)', async () => {
      const secret = 'test-webhook-secret'
      const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'X-Hub-Signature-256',
        secretField: 'secret',
        algorithm: 'sha256',
        encoding: 'hex',
        signaturePrefix: 'sha256=',
      }

      const result = await verifyWebhookAuth(
        auth,
        { secret },
        makeHeaders({ 'X-Hub-Signature-256': `sha256=${computed}` }),
        rawBody
      )

      expect(result.valid).toBe(true)
    })

    it('rejects invalid HMAC signature', async () => {
      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'X-Hub-Signature-256',
        secretField: 'secret',
        algorithm: 'sha256',
        encoding: 'hex',
        signaturePrefix: 'sha256=',
      }

      const result = await verifyWebhookAuth(
        auth,
        { secret: 'my-secret' },
        makeHeaders({ 'X-Hub-Signature-256': 'sha256=deadbeef0000000000000000000000000000000000000000000000000000dead' }),
        rawBody
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid signature')
    })

    it('returns error when signature header is missing', async () => {
      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'X-Hub-Signature-256',
        secretField: 'secret',
        algorithm: 'sha256',
        encoding: 'hex',
      }

      const result = await verifyWebhookAuth(
        auth,
        { secret: 'my-secret' },
        makeHeaders({}),
        rawBody
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Missing signature header')
    })

    it('skips verification when secret is not configured', async () => {
      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'X-Hub-Signature-256',
        secretField: 'secret',
        algorithm: 'sha256',
        encoding: 'hex',
      }

      const result = await verifyWebhookAuth(
        auth,
        {},
        makeHeaders({}),
        rawBody
      )

      expect(result.valid).toBe(true)
    })

    it('verifies Linear-style signature (no prefix, hex)', async () => {
      const secret = 'linear-signing-secret'
      const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'Linear-Signature',
        secretField: 'secret',
        algorithm: 'sha256',
        encoding: 'hex',
      }

      const result = await verifyWebhookAuth(
        auth,
        { secret },
        makeHeaders({ 'Linear-Signature': computed }),
        rawBody
      )

      expect(result.valid).toBe(true)
    })

    it('verifies Typeform-style signature (base64 encoding, sha256= prefix)', async () => {
      const secret = 'typeform-secret'
      const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')

      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'Typeform-Signature',
        secretField: 'secret',
        algorithm: 'sha256',
        encoding: 'base64',
        signaturePrefix: 'sha256=',
      }

      const result = await verifyWebhookAuth(
        auth,
        { secret },
        makeHeaders({ 'Typeform-Signature': `sha256=${computed}` }),
        rawBody
      )

      expect(result.valid).toBe(true)
    })

    it('verifies Microsoft Teams signature (base64 secret encoding + base64 output)', async () => {
      const rawSecret = crypto.randomBytes(32)
      const base64Secret = rawSecret.toString('base64')
      const computed = crypto.createHmac('sha256', rawSecret).update(rawBody, 'utf8').digest('base64')

      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'authorization',
        secretField: 'hmacSecret',
        algorithm: 'sha256',
        encoding: 'base64',
        signaturePrefix: 'HMAC ',
        secretEncoding: 'base64',
      }

      const result = await verifyWebhookAuth(
        auth,
        { hmacSecret: base64Secret },
        makeHeaders({ authorization: `HMAC ${computed}` }),
        rawBody
      )

      expect(result.valid).toBe(true)
    })

    it('rejects signature with wrong prefix', async () => {
      const auth: AuthSpec = {
        type: 'hmac',
        headerName: 'X-Hub-Signature-256',
        secretField: 'secret',
        algorithm: 'sha256',
        encoding: 'hex',
        signaturePrefix: 'sha256=',
      }

      const result = await verifyWebhookAuth(
        auth,
        { secret: 'test' },
        makeHeaders({ 'X-Hub-Signature-256': 'sha1=abcdef' }),
        rawBody
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('prefix')
    })
  })

  describe('bearer auth', () => {
    it('verifies valid bearer token', async () => {
      const auth: AuthSpec = {
        type: 'bearer',
        headerName: 'Authorization',
        secretField: 'token',
      }

      const result = await verifyWebhookAuth(
        auth,
        { token: 'my-secret-token' },
        makeHeaders({ Authorization: 'Bearer my-secret-token' }),
        ''
      )

      expect(result.valid).toBe(true)
    })

    it('rejects invalid bearer token', async () => {
      const auth: AuthSpec = {
        type: 'bearer',
        headerName: 'Authorization',
        secretField: 'token',
      }

      const result = await verifyWebhookAuth(
        auth,
        { token: 'correct-token' },
        makeHeaders({ Authorization: 'Bearer wrong-token' }),
        ''
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid token')
    })

    it('returns error when auth header is missing', async () => {
      const auth: AuthSpec = {
        type: 'bearer',
        headerName: 'Authorization',
        secretField: 'token',
      }

      const result = await verifyWebhookAuth(
        auth,
        { token: 'my-token' },
        makeHeaders({}),
        ''
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Missing auth header')
    })

    it('skips verification when token is not configured', async () => {
      const auth: AuthSpec = {
        type: 'bearer',
        headerName: 'Authorization',
        secretField: 'token',
      }

      const result = await verifyWebhookAuth(
        auth,
        {},
        makeHeaders({}),
        ''
      )

      expect(result.valid).toBe(true)
    })

    it('handles non-bearer format (raw header value)', async () => {
      const auth: AuthSpec = {
        type: 'bearer',
        headerName: 'X-Custom-Token',
        secretField: 'token',
      }

      const result = await verifyWebhookAuth(
        auth,
        { token: 'raw-token-value' },
        makeHeaders({ 'X-Custom-Token': 'raw-token-value' }),
        ''
      )

      expect(result.valid).toBe(true)
    })
  })

  describe('custom auth', () => {
    it('calls marketplace handler and returns valid result', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ output: { valid: true } }),
        })
      )

      const auth: AuthSpec = {
        type: 'custom',
        handler: 'slack_verify_webhook',
      }

      const result = await verifyWebhookAuth(
        auth,
        { signingSecret: 'xoxb-secret' },
        makeHeaders({ 'x-slack-signature': 'v0=abc123' }),
        '{"test":true}'
      )

      expect(result.valid).toBe(true)
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/marketplace/tools/slack_verify_webhook/execute'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('returns invalid when marketplace handler rejects', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ output: { valid: false, error: 'Invalid Slack signature' } }),
        })
      )

      const auth: AuthSpec = {
        type: 'custom',
        handler: 'slack_verify_webhook',
      }

      const result = await verifyWebhookAuth(
        auth,
        { signingSecret: 'wrong-secret' },
        makeHeaders({}),
        ''
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid Slack signature')
    })

    it('returns error when marketplace handler HTTP fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        })
      )

      const auth: AuthSpec = {
        type: 'custom',
        handler: 'stripe_verify_webhook',
      }

      const result = await verifyWebhookAuth(
        auth,
        {},
        makeHeaders({}),
        ''
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('returned 500')
    })

    it('returns error when marketplace handler is unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
      )

      const auth: AuthSpec = {
        type: 'custom',
        handler: 'slack_verify_webhook',
      }

      const result = await verifyWebhookAuth(
        auth,
        {},
        makeHeaders({}),
        ''
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Failed to reach auth handler')
    })

    it('passes request URL and form params in extra context', async () => {
      let capturedBody: string | undefined

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, init: { body?: string }) => {
          capturedBody = init.body
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ output: { valid: true } }),
          })
        })
      )

      const auth: AuthSpec = {
        type: 'custom',
        handler: 'twilio_voice_verify_webhook',
      }

      await verifyWebhookAuth(
        auth,
        { authToken: 'twilio-token' },
        makeHeaders({}),
        'AccountSid=AC123&CallSid=CA456',
        { requestUrl: 'https://example.com/webhook', formParams: { AccountSid: 'AC123' } }
      )

      const parsed = JSON.parse(capturedBody!)
      expect(parsed.params.requestUrl).toBe('https://example.com/webhook')
      expect(parsed.params.formParams).toEqual({ AccountSid: 'AC123' })
    })
  })

  describe('unknown auth type', () => {
    it('returns invalid for unknown auth type', async () => {
      const auth = { type: 'unknown_type' } as unknown as AuthSpec

      const result = await verifyWebhookAuth(
        auth,
        {},
        makeHeaders({}),
        ''
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Unknown auth type')
    })
  })
})
