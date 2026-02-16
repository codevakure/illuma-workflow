/**
 * @vitest-environment node
 */
import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './handler'

describe('slack_verify_webhook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function makeSlackSignature(secret: string, timestamp: number, body: string): string {
    const sigBaseString = `v0:${timestamp}:${body}`
    return 'v0=' + crypto.createHmac('sha256', secret).update(sigBaseString, 'utf8').digest('hex')
  }

  it('accepts valid Slack signature', async () => {
    const secret = 'test-signing-secret'
    const body = '{"type":"event_callback","event":{"type":"message"}}'
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = makeSlackSignature(secret, timestamp, body)

    const result = await handler.operations.slack_verify_webhook(
      {
        headers: {
          'x-slack-request-timestamp': String(timestamp),
          'x-slack-signature': signature,
        },
        body,
        config: { signingSecret: secret },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(true)
  })

  it('rejects invalid Slack signature', async () => {
    const body = '{"type":"event_callback"}'
    const timestamp = Math.floor(Date.now() / 1000)

    const result = await handler.operations.slack_verify_webhook(
      {
        headers: {
          'x-slack-request-timestamp': String(timestamp),
          'x-slack-signature': 'v0=0000000000000000000000000000000000000000000000000000000000000000',
        },
        body,
        config: { signingSecret: 'wrong-secret' },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(false)
    expect(result.output.error).toContain('Invalid Slack signature')
  })

  it('rejects when timestamp is too old (replay attack)', async () => {
    const secret = 'test-signing-secret'
    const body = '{"type":"event_callback"}'
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600 // 10 minutes ago
    const signature = makeSlackSignature(secret, oldTimestamp, body)

    const result = await handler.operations.slack_verify_webhook(
      {
        headers: {
          'x-slack-request-timestamp': String(oldTimestamp),
          'x-slack-signature': signature,
        },
        body,
        config: { signingSecret: secret },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(false)
    expect(result.output.error).toContain('replay attack')
  })

  it('rejects when signature header is missing', async () => {
    const result = await handler.operations.slack_verify_webhook(
      {
        headers: {},
        body: '{}',
        config: { signingSecret: 'secret' },
      },
      { apiKey: '' }
    )

    expect(result.success).toBe(true)
    expect(result.output.valid).toBe(false)
    expect(result.output.error).toContain('Missing')
  })

  it('skips verification when no signing secret configured', async () => {
    const result = await handler.operations.slack_verify_webhook(
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
})
