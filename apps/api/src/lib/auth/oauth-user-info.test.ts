import { createMockResponse } from '@sim/testing'
import { getUserInfoHandler } from './oauth-user-info'

// Each handler needs a mock fetch set up, then call the handler with tokens

describe('oauth-user-info handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const tokens = { accessToken: 'test-access-token' }

  describe('google handler', () => {
    it('returns user info from Google userinfo endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          json: {
            sub: '12345',
            name: 'Test User',
            email: 'test@gmail.com',
            email_verified: true,
            picture: 'https://example.com/photo.jpg',
          },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const handler = getUserInfoHandler({ userInfo: { type: 'google' } })
      expect(handler).toBeDefined()
      const result = await handler!(tokens)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Test User')
      expect(result!.email).toBe('test@gmail.com')
      expect(result!.emailVerified).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openidconnect.googleapis.com/v1/userinfo',
        expect.objectContaining({ headers: expect.any(Object) })
      )
    })

    it('returns null on fetch failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(createMockResponse({ ok: false, status: 401 })))
      const handler = getUserInfoHandler({ userInfo: { type: 'google' } })
      const result = await handler!(tokens)
      expect(result).toBeNull()
    })
  })

  describe('github handler', () => {
    it('fetches user and falls back to /user/emails for email', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            json: { id: 123, login: 'octocat', name: 'Octo Cat', email: null, avatar_url: 'https://avatars.githubusercontent.com/u/123' },
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            json: [{ email: 'octocat@github.com', primary: true, verified: true }],
          })
        )
      vi.stubGlobal('fetch', mockFetch)

      const handler = getUserInfoHandler({ userInfo: { type: 'github' } })
      const result = await handler!(tokens)
      expect(result).not.toBeNull()
      expect(result!.email).toBe('octocat@github.com')
      expect(result!.name).toBe('Octo Cat')
    })
  })

  describe('slack handler', () => {
    it('returns synthetic email from auth.test', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          json: { team_id: 'T123', user_id: 'U456', team: 'My Team' },
        })
      ))

      const handler = getUserInfoHandler({ userInfo: { type: 'slack' } })
      const result = await handler!(tokens)
      expect(result).not.toBeNull()
      expect(result!.email).toBe('T123-U456@slack.bot')
      expect(result!.name).toBe('My Team')
    })
  })

  describe('wealthbox handler', () => {
    it('returns synthetic profile without API call', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const handler = getUserInfoHandler({ userInfo: { type: 'wealthbox' } })
      const result = await handler!(tokens)
      expect(result).not.toBeNull()
      expect(result!.email).toBe('wealthbox-user@wealthbox.user')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('linear handler', () => {
    it('fetches user from GraphQL endpoint', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          json: {
            data: { viewer: { id: 'lin-1', email: 'user@linear.app', name: 'Linear User', avatarUrl: null } },
          },
        })
      ))

      const handler = getUserInfoHandler({ userInfo: { type: 'linear' } })
      const result = await handler!(tokens)
      expect(result).not.toBeNull()
      expect(result!.email).toBe('user@linear.app')
    })
  })

  describe('x handler', () => {
    it('fetches user from X API v2', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          json: {
            data: { id: 'x123', name: 'X User', username: 'xuser', verified: true, profile_image_url: null },
          },
        })
      ))

      const handler = getUserInfoHandler({ userInfo: { type: 'x' } })
      const result = await handler!(tokens)
      expect(result).not.toBeNull()
      expect(result!.email).toBe('xuser@x.com')
    })
  })

  describe('unknown handler type', () => {
    it('returns undefined for unknown type', () => {
      const handler = getUserInfoHandler({ userInfo: { type: 'unknown_type' } })
      expect(handler).toBeUndefined()
    })
  })

  // Quick smoke test for all handler types
  const allTypes = [
    'google', 'microsoft', 'github', 'slack', 'atlassian', 'notion',
    'reddit', 'wealthbox', 'hubspot', 'linear', 'dropbox', 'webflow',
    'calcom', 'salesforce', 'x', 'pipedrive', 'airtable', 'linkedin',
    'zoom', 'spotify', 'wordpress',
  ]

  it.each(allTypes)('handler for type "%s" is defined', (type) => {
    const handler = getUserInfoHandler({ userInfo: { type } })
    expect(handler).toBeDefined()
  })
})
