import { SignJWT, jwtVerify } from 'jose'
import { nanoid } from 'nanoid'
import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getMicrosoftRefreshTokenExpiry, isMicrosoftProvider } from '@/lib/oauth/microsoft'
import { getUserInfoHandler } from './oauth-user-info'
import { getProviderData, type ProviderEntry } from './oauth-providers'

const logger = createLogger('OAuthLink')

const OAUTH_SECRET = new TextEncoder().encode(
  process.env.OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET || 'dev-oauth-state-secret-change-me'
)

interface OAuthState {
  /** Random state string for CSRF protection */
  state: string
  /** User ID initiating the OAuth flow */
  userId: string
  /** Provider ID */
  providerId: string
  /** URL to redirect to after completion */
  callbackURL: string
  /** PKCE code verifier (if PKCE enabled) */
  codeVerifier?: string
}

/** OIDC discovery document cache */
const discoveryCache = new Map<string, { authorizationUrl: string; tokenUrl: string; expiresAt: number }>()

/**
 * Fetches OIDC discovery document and extracts authorization + token endpoints.
 */
async function resolveDiscovery(discoveryUrl: string): Promise<{ authorizationUrl: string; tokenUrl: string }> {
  const cached = discoveryCache.get(discoveryUrl)
  if (cached && cached.expiresAt > Date.now()) {
    return cached
  }

  const res = await fetch(discoveryUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch OIDC discovery: ${res.status}`)
  }
  const doc = await res.json()
  const result = {
    authorizationUrl: doc.authorization_endpoint,
    tokenUrl: doc.token_endpoint,
    expiresAt: Date.now() + 60 * 60 * 1000, // cache for 1 hour
  }
  discoveryCache.set(discoveryUrl, result)
  return result
}

/**
 * Generates a PKCE code verifier and challenge.
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
  const codeVerifier = base64UrlEncode(verifierBytes)

  // S256 challenge
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  // We need to compute SHA-256 synchronously - use SubtleCrypto
  // But SubtleCrypto is async, so we return a placeholder and compute in the caller
  return { codeVerifier, codeChallenge: '' }
}

async function computeCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Signs the OAuth state as a JWT for CSRF protection.
 */
async function signState(state: OAuthState): Promise<string> {
  return new SignJWT(state as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(OAUTH_SECRET)
}

/**
 * Verifies and decodes the OAuth state JWT.
 */
async function verifyState(token: string): Promise<OAuthState> {
  const { payload } = await jwtVerify(token, OAUTH_SECRET)
  return payload as unknown as OAuthState
}

/**
 * Builds the OAuth authorization URL for a given provider.
 */
export async function buildAuthorizationUrl(
  userId: string,
  providerId: string,
  callbackURL: string
): Promise<{ url: string; stateToken: string }> {
  const providers = getProviderData()
  const provider = providers.find((p) => p.providerId === providerId)

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  const clientId = process.env[provider.envClientId]
  if (!clientId) {
    throw new Error(`Provider ${providerId} is not configured (missing ${provider.envClientId})`)
  }

  // Resolve authorization URL
  let authorizationUrl = provider.authorizationUrl
  let tokenUrl = provider.tokenUrl

  if (provider.discoveryUrl && !authorizationUrl) {
    const discovery = await resolveDiscovery(provider.discoveryUrl)
    authorizationUrl = discovery.authorizationUrl
    tokenUrl = discovery.tokenUrl
  }

  if (!authorizationUrl) {
    throw new Error(`No authorization URL for provider ${providerId}`)
  }

  // Generate state
  const stateString = nanoid(32)

  // Generate PKCE if needed
  let codeVerifier: string | undefined
  let codeChallenge: string | undefined

  if (provider.pkce) {
    const pkce = generatePKCE()
    codeVerifier = pkce.codeVerifier
    codeChallenge = await computeCodeChallenge(codeVerifier)
  }

  // Sign state as JWT
  const stateData: OAuthState = {
    state: stateString,
    userId,
    providerId,
    callbackURL,
    codeVerifier,
  }
  const stateToken = await signState(stateData)

  // Build URL
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/oauth2/callback/${providerId}`

  const url = new URL(authorizationUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', provider.responseType || 'code')
  url.searchParams.set('state', stateString)

  if (provider.scopes.length > 0) {
    url.searchParams.set('scope', provider.scopes.join(' '))
  }

  if (provider.accessType) {
    url.searchParams.set('access_type', provider.accessType)
  }

  if (provider.prompt) {
    url.searchParams.set('prompt', provider.prompt)
  }

  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }

  // Additional auth params
  if (provider.additionalAuthParams) {
    for (const [key, value] of Object.entries(provider.additionalAuthParams)) {
      url.searchParams.set(key, value)
    }
  }

  // Atlassian requires audience parameter
  if (provider.baseProvider === 'confluence' || provider.baseProvider === 'jira') {
    url.searchParams.set('audience', 'api.atlassian.com')
  }

  return { url: url.toString(), stateToken }
}

/**
 * Exchanges the authorization code for tokens and stores the account.
 */
export async function handleOAuthCallback(
  code: string,
  stateString: string,
  stateToken: string
): Promise<{ callbackURL: string }> {
  // Verify state
  const stateData = await verifyState(stateToken)

  if (stateData.state !== stateString) {
    throw new Error('State mismatch - possible CSRF attack')
  }

  const { userId, providerId, callbackURL, codeVerifier } = stateData

  const providers = getProviderData()
  const provider = providers.find((p) => p.providerId === providerId)

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  const clientId = process.env[provider.envClientId]
  const clientSecret = provider.envClientSecret ? (process.env[provider.envClientSecret] || '') : ''

  if (!clientId) {
    throw new Error(`Provider ${providerId} is not configured`)
  }

  // Resolve token URL
  let tokenUrl = provider.tokenUrl
  if (provider.discoveryUrl && !tokenUrl) {
    const discovery = await resolveDiscovery(provider.discoveryUrl)
    tokenUrl = discovery.tokenUrl
  }

  if (!tokenUrl) {
    throw new Error(`No token URL for provider ${providerId}`)
  }

  // Exchange code for tokens
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/oauth2/callback/${providerId}`

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  })

  if (codeVerifier) {
    tokenParams.set('code_verifier', codeVerifier)
  }

  // Some providers require client_secret in body, others use Basic auth
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }

  if (provider.authentication === 'basic' && clientSecret) {
    headers['Authorization'] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`
  } else if (clientSecret) {
    tokenParams.set('client_secret', clientSecret)
  }

  logger.info('Exchanging authorization code for tokens', { providerId })

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: tokenParams.toString(),
  })

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text()
    logger.error('Token exchange failed', { providerId, status: tokenRes.status, error: errorText })
    throw new Error(`Token exchange failed: ${tokenRes.status} ${errorText}`)
  }

  const tokenData = await tokenRes.json()

  const accessToken = tokenData.access_token || tokenData.authed_user?.access_token
  const refreshToken = tokenData.refresh_token || tokenData.authed_user?.refresh_token
  const idToken = tokenData.id_token
  const expiresIn = tokenData.expires_in
  const scope = tokenData.scope || provider.scopes.join(' ')

  if (!accessToken) {
    logger.error('No access token in response', { providerId, tokenData })
    throw new Error('No access token received from provider')
  }

  // Fetch user info
  let accountId = 'unknown'
  const tokens = {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    scopes: scope ? scope.split(/[\s,]+/) : [],
  }

  const getUserInfo = getUserInfoHandler(provider)
  if (getUserInfo) {
    try {
      const userInfo = await getUserInfo(tokens)
      if (userInfo) {
        accountId = userInfo.id
      }
    } catch (error) {
      logger.warn('Failed to fetch user info, using fallback', { providerId, error })
    }
  }

  // Calculate expiry
  const now = new Date()
  const accessTokenExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : new Date(Date.now() + 3600 * 1000) // default 1 hour

  // Handle reconnection: delete existing account for same user+provider
  const existing = await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, providerId)),
  })

  let accountRecordId = nanoid()

  if (existing) {
    // Preserve the existing ID for continuity
    accountRecordId = existing.id
    await db.delete(account).where(eq(account.id, existing.id))
    logger.info('Deleted existing account for re-authorization', {
      userId,
      providerId,
      existingAccountId: existing.id,
    })
  }

  // Build scope string, including Salesforce instance URL if applicable
  let finalScope = scope
  if (providerId === 'salesforce' && accessToken) {
    try {
      const sfRes = await fetch('https://login.salesforce.com/services/oauth2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (sfRes.ok) {
        const sfData = await sfRes.json()
        if (sfData.profile) {
          const match = sfData.profile.match(/^(https:\/\/[^/]+)/)
          if (match && match[1] !== 'https://login.salesforce.com') {
            finalScope = `__sf_instance__:${match[1]} ${finalScope}`
          }
        }
      }
    } catch (error) {
      logger.error('Failed to fetch Salesforce instance URL', error)
    }
  }

  // Calculate refresh token expiry for Microsoft
  let refreshTokenExpiresAt: Date | undefined
  if (isMicrosoftProvider(providerId)) {
    refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
  }

  // Insert the account record
  await db.insert(account).values({
    id: accountRecordId,
    accountId,
    providerId,
    userId,
    accessToken,
    refreshToken: refreshToken || null,
    idToken: idToken || null,
    accessTokenExpiresAt,
    refreshTokenExpiresAt: refreshTokenExpiresAt || null,
    scope: finalScope,
    createdAt: now,
    updatedAt: now,
  })

  logger.info('OAuth account linked successfully', {
    userId,
    providerId,
    accountId: accountRecordId,
  })

  return { callbackURL }
}
