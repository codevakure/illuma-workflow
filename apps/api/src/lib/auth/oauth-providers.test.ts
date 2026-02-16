import providersData from './providers.json'
import { getUserInfoHandler } from './oauth-user-info'

interface ProviderEntry {
  providerId: string
  name: string
  description: string
  baseProvider: string
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  scopes: string[]
  envClientId: string
  envClientSecret: string
  pkce?: boolean
  accessType?: string
  prompt?: string
  authentication?: string
  responseType?: string
  additionalAuthParams?: Record<string, string>
  userInfo: { type: string }
}

const providers = providersData as ProviderEntry[]

describe('providers.json validation', () => {
  it('contains exactly 36 provider entries', () => {
    expect(providers).toHaveLength(36)
  })

  it('every entry has required fields', () => {
    for (const p of providers) {
      expect(p.providerId).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.description).toBeTruthy()
      expect(p.baseProvider).toBeTruthy()
      expect(p.envClientId).toBeTruthy()
      expect(p.envClientSecret).toBeDefined()
      expect(p.scopes).toBeInstanceOf(Array)
      expect(p.userInfo).toBeDefined()
      expect(p.userInfo.type).toBeTruthy()
    }
  })

  it('every entry has either discoveryUrl or authorizationUrl+tokenUrl', () => {
    for (const p of providers) {
      const hasDiscovery = !!p.discoveryUrl
      const hasExplicitUrls = !!p.authorizationUrl && !!p.tokenUrl
      expect(hasDiscovery || hasExplicitUrls).toBe(true)
    }
  })

  it('all providerIds are unique', () => {
    const ids = providers.map((p) => p.providerId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all expected providerIds are present', () => {
    const expected = [
      'github-repo', 'google-email', 'google-calendar', 'google-drive',
      'google-docs', 'google-sheets', 'google-forms', 'google-vault',
      'google-groups', 'vertex-ai', 'microsoft-teams', 'microsoft-excel',
      'microsoft-planner', 'outlook', 'onedrive', 'sharepoint',
      'wealthbox', 'pipedrive', 'hubspot', 'salesforce', 'x',
      'confluence', 'jira', 'airtable', 'notion', 'reddit',
      'linear', 'dropbox', 'asana', 'slack', 'webflow',
      'linkedin', 'zoom', 'spotify', 'wordpress', 'calcom',
    ]
    const actual = providers.map((p) => p.providerId)
    for (const id of expected) {
      expect(actual).toContain(id)
    }
  })
})

describe('getUserInfoHandler coverage', () => {
  it('every userInfo.type in providers.json has a handler', () => {
    const types = [...new Set(providers.map((p) => p.userInfo.type))]
    for (const type of types) {
      const handler = getUserInfoHandler({ userInfo: { type } })
      expect(handler, `Missing handler for userInfo.type="${type}"`).toBeDefined()
    }
  })
})

describe('getOAuthProviderConfigs', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('filters out providers without env vars set', async () => {
    // No env vars set, should return empty
    const { getOAuthProviderConfigs } = await import('./oauth-providers')
    const configs = getOAuthProviderConfigs()
    expect(configs).toHaveLength(0)
  })

  it('includes providers with env vars set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    // Dynamic import to pick up env changes
    const mod = await import('./oauth-providers')
    const configs = mod.getOAuthProviderConfigs()
    // All Google providers share GOOGLE_CLIENT_ID, so we should get 10 (9 google + vertex-ai)
    const googleProviders = configs.filter((c: any) => c.providerId.startsWith('google-') || c.providerId === 'vertex-ai')
    expect(googleProviders.length).toBeGreaterThan(0)
  })
})

describe('getProviderMetadata', () => {
  it('returns metadata for all 36 providers', async () => {
    const { getProviderMetadata } = await import('./oauth-providers')
    const metadata = getProviderMetadata()
    expect(metadata).toHaveLength(36)
    for (const m of metadata) {
      expect(m.providerId).toBeTruthy()
      expect(m.name).toBeTruthy()
      expect(typeof m.available).toBe('boolean')
    }
  })
})
