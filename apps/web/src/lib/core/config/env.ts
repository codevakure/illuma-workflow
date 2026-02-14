/**
 * Vite-compatible environment configuration.
 *
 * In Vite, client-side env vars must be prefixed with VITE_ and accessed via import.meta.env.
 * For backwards compatibility with the original Illuma codebase, we map NEXT_PUBLIC_ vars
 * to their Vite equivalents and provide the same env/getEnv interface.
 *
 * Server-side env vars (DATABASE_URL, secrets, etc.) are NOT available in the browser.
 * They will be undefined here - the API server handles them.
 */

/**
 * Get an environment variable by name.
 * Checks both Vite env (VITE_ prefix) and NEXT_PUBLIC_ mapped equivalents.
 */
export function getEnv(variable: string): string | undefined {
  // Try direct Vite env first
  const viteValue = (import.meta.env as Record<string, string | undefined>)[variable]
  if (viteValue !== undefined) return viteValue

  // Map NEXT_PUBLIC_ to VITE_ prefix
  if (variable.startsWith('NEXT_PUBLIC_')) {
    const viteKey = 'VITE_' + variable.replace('NEXT_PUBLIC_', '')
    const mapped = (import.meta.env as Record<string, string | undefined>)[viteKey]
    if (mapped !== undefined) return mapped
  }

  return undefined
}

/**
 * Check if a value is truthy (handles string booleans from env vars).
 */
export const isTruthy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value)

/**
 * Check if a value is explicitly false.
 */
export const isFalsy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false

/**
 * Environment object that mirrors the original Illuma env shape.
 * Client-side (NEXT_PUBLIC_) vars are read from Vite env.
 * Server-side vars are undefined in the browser (handled by the API server).
 */
export const env = {
  // Shared
  NODE_ENV: import.meta.env.MODE as 'development' | 'test' | 'production' | undefined,

  // Client-side vars (NEXT_PUBLIC_ mapped from VITE_ or NEXT_PUBLIC_ directly)
  get NEXT_PUBLIC_APP_URL() { return getEnv('NEXT_PUBLIC_APP_URL') ?? window.location.origin },
  get NEXT_PUBLIC_SOCKET_URL() { return getEnv('NEXT_PUBLIC_SOCKET_URL') },
  get NEXT_PUBLIC_BILLING_ENABLED() { return getEnv('NEXT_PUBLIC_BILLING_ENABLED') },
  get NEXT_PUBLIC_POSTHOG_ENABLED() { return getEnv('NEXT_PUBLIC_POSTHOG_ENABLED') },
  get NEXT_PUBLIC_POSTHOG_KEY() { return getEnv('NEXT_PUBLIC_POSTHOG_KEY') },
  get NEXT_PUBLIC_BRAND_NAME() { return getEnv('NEXT_PUBLIC_BRAND_NAME') },
  get NEXT_PUBLIC_BRAND_LOGO_URL() { return getEnv('NEXT_PUBLIC_BRAND_LOGO_URL') },
  get NEXT_PUBLIC_BRAND_FAVICON_URL() { return getEnv('NEXT_PUBLIC_BRAND_FAVICON_URL') },
  get NEXT_PUBLIC_CUSTOM_CSS_URL() { return getEnv('NEXT_PUBLIC_CUSTOM_CSS_URL') },
  get NEXT_PUBLIC_SUPPORT_EMAIL() { return getEnv('NEXT_PUBLIC_SUPPORT_EMAIL') },
  get NEXT_PUBLIC_DOCUMENTATION_URL() { return getEnv('NEXT_PUBLIC_DOCUMENTATION_URL') },
  get NEXT_PUBLIC_TERMS_URL() { return getEnv('NEXT_PUBLIC_TERMS_URL') },
  get NEXT_PUBLIC_PRIVACY_URL() { return getEnv('NEXT_PUBLIC_PRIVACY_URL') },
  get NEXT_PUBLIC_BRAND_PRIMARY_COLOR() { return getEnv('NEXT_PUBLIC_BRAND_PRIMARY_COLOR') },
  get NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR() { return getEnv('NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR') },
  get NEXT_PUBLIC_BRAND_ACCENT_COLOR() { return getEnv('NEXT_PUBLIC_BRAND_ACCENT_COLOR') },
  get NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR() { return getEnv('NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR') },
  get NEXT_PUBLIC_BRAND_BACKGROUND_COLOR() { return getEnv('NEXT_PUBLIC_BRAND_BACKGROUND_COLOR') },
  get NEXT_PUBLIC_SSO_ENABLED() { return getEnv('NEXT_PUBLIC_SSO_ENABLED') },
  get NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED() { return getEnv('NEXT_PUBLIC_CREDENTIAL_SETS_ENABLED') },
  get NEXT_PUBLIC_ACCESS_CONTROL_ENABLED() { return getEnv('NEXT_PUBLIC_ACCESS_CONTROL_ENABLED') },
  get NEXT_PUBLIC_ORGANIZATIONS_ENABLED() { return getEnv('NEXT_PUBLIC_ORGANIZATIONS_ENABLED') },
  get NEXT_PUBLIC_DISABLE_INVITATIONS() { return getEnv('NEXT_PUBLIC_DISABLE_INVITATIONS') },
  get NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED() { return getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED') },
  get NEXT_PUBLIC_E2B_ENABLED() { return getEnv('NEXT_PUBLIC_E2B_ENABLED') },
  get NEXT_PUBLIC_COPILOT_TRAINING_ENABLED() { return getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED') },
  get NEXT_PUBLIC_ENABLE_PLAYGROUND() { return getEnv('NEXT_PUBLIC_ENABLE_PLAYGROUND') },

  // Server-side vars - undefined in browser, provided for type compatibility
  // These are only used by code that runs on the API server
  BETTER_AUTH_URL: undefined as string | undefined,
  BETTER_AUTH_SECRET: undefined as string | undefined,
  DATABASE_URL: undefined as string | undefined,
  ENCRYPTION_KEY: undefined as string | undefined,
  API_ENCRYPTION_KEY: undefined as string | undefined,
  INTERNAL_API_SECRET: undefined as string | undefined,
  DISABLE_REGISTRATION: undefined as boolean | undefined,
  EMAIL_PASSWORD_SIGNUP_ENABLED: undefined as boolean | undefined,
  DISABLE_AUTH: undefined as boolean | undefined,
  ALLOWED_LOGIN_EMAILS: undefined as string | undefined,
  ALLOWED_LOGIN_DOMAINS: undefined as string | undefined,
  BILLING_ENABLED: undefined as boolean | undefined,
  EMAIL_VERIFICATION_ENABLED: undefined as boolean | undefined,
  TRIGGER_DEV_ENABLED: undefined as boolean | undefined,
  SSO_ENABLED: undefined as boolean | undefined,
  CREDENTIAL_SETS_ENABLED: undefined as boolean | undefined,
  ACCESS_CONTROL_ENABLED: undefined as boolean | undefined,
  ORGANIZATIONS_ENABLED: undefined as boolean | undefined,
  E2B_ENABLED: undefined as string | undefined,
  DISABLE_INVITATIONS: undefined as boolean | undefined,
  REACT_GRAB_ENABLED: undefined as boolean | undefined,
  REACT_SCAN_ENABLED: undefined as boolean | undefined,
  COST_MULTIPLIER: undefined as number | undefined,
  COPILOT_PROVIDER: undefined as string | undefined,
  COPILOT_MODEL: undefined as string | undefined,
  COPILOT_API_KEY: undefined as string | undefined,
  STRIPE_SECRET_KEY: undefined as string | undefined,
  STRIPE_WEBHOOK_SECRET: undefined as string | undefined,
  STRIPE_FREE_PRICE_ID: undefined as string | undefined,
  STRIPE_PRO_PRICE_ID: undefined as string | undefined,
  STRIPE_TEAM_PRICE_ID: undefined as string | undefined,
  STRIPE_ENTERPRISE_PRICE_ID: undefined as string | undefined,
  LOG_LEVEL: undefined as string | undefined,
} as Record<string, any>
