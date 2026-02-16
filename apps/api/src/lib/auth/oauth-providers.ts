import type { GenericOAuthConfig } from 'better-auth/plugins'
import { getUserInfoHandler } from './oauth-user-info'
import providersData from './providers.json'

/** Shape of each entry in providers.json */
export interface ProviderEntry {
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

/** Provider metadata returned to the web client (no secrets) */
export interface ProviderMetadata {
  providerId: string
  name: string
  description: string
  baseProvider: string
  scopes: string[]
  available: boolean
}

/**
 * Transforms providers.json entries into better-auth GenericOAuthConfig[].
 * Filters out providers whose env vars are not set.
 */
export function getOAuthProviderConfigs(): GenericOAuthConfig[] {
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001'

  return (providersData as ProviderEntry[])
    .filter((p) => {
      const clientId = process.env[p.envClientId]
      return !!clientId
    })
    .map((p) => {
      const config: GenericOAuthConfig = {
        providerId: p.providerId,
        clientId: process.env[p.envClientId]!,
        clientSecret: p.envClientSecret ? (process.env[p.envClientSecret] || '') : '',
        scopes: p.scopes,
        redirectURI: `${baseUrl}/api/auth/oauth2/callback/${p.providerId}`,
      }

      // Set URL fields
      if (p.discoveryUrl) config.discoveryUrl = p.discoveryUrl
      if (p.authorizationUrl) config.authorizationUrl = p.authorizationUrl
      if (p.tokenUrl) config.tokenUrl = p.tokenUrl

      // Optional fields
      if (p.pkce !== undefined) config.pkce = p.pkce
      if (p.accessType) config.accessType = p.accessType
      if (p.prompt) config.prompt = p.prompt as GenericOAuthConfig['prompt']
      if (p.authentication) config.authentication = p.authentication as GenericOAuthConfig['authentication']
      if (p.responseType) config.responseType = p.responseType
      if (p.additionalAuthParams) config.authorizationUrlParams = p.additionalAuthParams

      // Custom getUserInfo handler
      const handler = getUserInfoHandler(p)
      if (handler) config.getUserInfo = handler as unknown as GenericOAuthConfig['getUserInfo']

      return config
    })
}

/**
 * Returns provider metadata for the web client.
 * Does NOT include secrets -- only display info + availability.
 */
export function getProviderMetadata(): ProviderMetadata[] {
  return (providersData as ProviderEntry[]).map((p) => ({
    providerId: p.providerId,
    name: p.name,
    description: p.description,
    baseProvider: p.baseProvider,
    scopes: p.scopes,
    available: !!process.env[p.envClientId],
  }))
}

/**
 * Returns the raw provider data for internal use.
 */
export function getProviderData(): ProviderEntry[] {
  return providersData as ProviderEntry[]
}
