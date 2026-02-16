/**
 * @vitest-environment node
 */
import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './handler'

describe('stripe_verify_webhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function makeStripeSignature(secret: string, timestamp: number, body: string): string {
    const signedPayload = `${timestamp}.${body}`
    const sig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')
    return `t=${timestamp},v1=${sig}`
  }

  it('accepts valid Stripe signature', async () => {
    const secret = 'whsec_test_secret'
    const body = '{"id":"evt_123","type":"payment_intent.succeeded"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const sigHeader = makeStripeSignature(secret, timestamp, body)

    const result = await handler.operations.stripe_verify_webhook(
      {
        headers: { 'stripe-signature': sigHeader },
        body,
        config: { webhookSecret: secret },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(true)
  })

  it('rejects invalid Stripe signature', async () => {
    const body = '{"id":"evt_123"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const sigHeader = `t=${timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000`

    const result = await handler.operations.stripe_verify_webhook(
      {
        headers: { 'stripe-signature': sigHeader },
        body,
        config: { webhookSecret: 'wrong-secret' },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(false)
    expect(result.output.error).toContain('Invalid Stripe signature')
  })

  it('rejects when timestamp is too old (replay attack)', async () => {
    const secret = 'whsec_test'
    const body = '{"id":"evt_123"}'
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600
    const sigHeader = makeStripeSignature(secret, oldTimestamp, body)

    const result = await handler.operations.stripe_verify_webhook(
      {
        headers: { 'stripe-signature': sigHeader },
        body,
        config: { webhookSecret: secret },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(false)
    expect(result.output.error).toContain('replay attack')
  })

  it('rejects when Stripe-Signature header is missing', async () => {
    const result = await handler.operations.stripe_verify_webhook(
      {
        headers: {},
        body: '{}',
        config: { webhookSecret: 'secret' },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(false)
    expect(result.output.error).toContain('Missing Stripe-Signature')
  })

  it('rejects malformed signature header', async () => {
    const result = await handler.operations.stripe_verify_webhook(
      {
        headers: { 'stripe-signature': 'garbage' },
        body: '{}',
        config: { webhookSecret: 'secret' },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(false)
    expect(result.output.error).toContain('Invalid Stripe-Signature header format')
  })

  it('skips verification when no webhook secret configured', async () => {
    const result = await handler.operations.stripe_verify_webhook(
      {
        headers: {},
        body: '{}',
        config: {},
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(true)
  })

  it('handles multiple v1 signatures (Stripe sends old + new during rotation)', async () => {
    const secret = 'whsec_test'
    const body = '{"id":"evt_123"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const correctSig = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex')

    // Simulate Stripe sending both old and new signatures
    const sigHeader = `t=${timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${correctSig}`

    const result = await handler.operations.stripe_verify_webhook(
      {
        headers: { 'stripe-signature': sigHeader },
        body,
        config: { webhookSecret: secret },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(true)
  })
})
