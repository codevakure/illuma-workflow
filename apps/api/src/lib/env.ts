import { z } from 'zod'

/**
 * Environment configuration for the API server.
 * Uses a simpler approach than t3-env since we're not in Next.js.
 */

const envSchema = z.object({
  // Server
  PORT: z.string().optional().default('3001'),
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
  CORS_ORIGIN: z.string().optional().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().url(),

  // Auth (placeholder for now)
  GATEWAY_JWT_SECRET: z.string().min(32).optional(),
  INTERNAL_API_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  ENCRYPTION_KEY: z.string().min(32).optional(),
  API_ENCRYPTION_KEY: z.string().optional(),

  // Socket server
  SOCKET_SERVER_URL: z.string().url().optional(),

  // Storage (optional)
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),

  // LLM Providers (optional)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_KEY_1: z.string().optional(),
  OPENAI_API_KEY_2: z.string().optional(),
  OPENAI_API_KEY_3: z.string().optional(),
  ANTHROPIC_API_KEY_1: z.string().optional(),
  ANTHROPIC_API_KEY_2: z.string().optional(),
  ANTHROPIC_API_KEY_3: z.string().optional(),
  GEMINI_API_KEY_1: z.string().optional(),
  GEMINI_API_KEY_2: z.string().optional(),
  GEMINI_API_KEY_3: z.string().optional(),

  // Azure OpenAI
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().optional(),

  // Vertex AI
  VERTEX_PROJECT: z.string().optional(),
  VERTEX_LOCATION: z.string().optional(),

  // vLLM
  VLLM_BASE_URL: z.string().optional(),
  VLLM_API_KEY: z.string().optional(),

  // OAuth Providers
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  CONFLUENCE_CLIENT_ID: z.string().optional(),
  CONFLUENCE_CLIENT_SECRET: z.string().optional(),
  JIRA_CLIENT_ID: z.string().optional(),
  JIRA_CLIENT_SECRET: z.string().optional(),
  CALCOM_CLIENT_ID: z.string().optional(),
  AIRTABLE_CLIENT_ID: z.string().optional(),
  AIRTABLE_CLIENT_SECRET: z.string().optional(),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  DROPBOX_CLIENT_ID: z.string().optional(),
  DROPBOX_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  WEALTHBOX_CLIENT_ID: z.string().optional(),
  WEALTHBOX_CLIENT_SECRET: z.string().optional(),
  WEBFLOW_CLIENT_ID: z.string().optional(),
  WEBFLOW_CLIENT_SECRET: z.string().optional(),
  ASANA_CLIENT_ID: z.string().optional(),
  ASANA_CLIENT_SECRET: z.string().optional(),
  PIPEDRIVE_CLIENT_ID: z.string().optional(),
  PIPEDRIVE_CLIENT_SECRET: z.string().optional(),
  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  WORDPRESS_CLIENT_ID: z.string().optional(),
  WORDPRESS_CLIENT_SECRET: z.string().optional(),

  // Feature Flags
  BILLING_ENABLED: z.string().optional(),
  EMAIL_VERIFICATION_ENABLED: z.string().optional(),
  DISABLE_AUTH: z.string().optional(),
  DISABLE_REGISTRATION: z.string().optional(),
  EMAIL_PASSWORD_SIGNUP_ENABLED: z.string().optional(),
  TRIGGER_DEV_ENABLED: z.string().optional(),
  SSO_ENABLED: z.string().optional(),
  CREDENTIAL_SETS_ENABLED: z.string().optional(),
  ACCESS_CONTROL_ENABLED: z.string().optional(),
  ORGANIZATIONS_ENABLED: z.string().optional(),
  E2B_ENABLED: z.string().optional(),
  DISABLE_INVITATIONS: z.string().optional(),
  REACT_GRAB_ENABLED: z.string().optional(),
  REACT_SCAN_ENABLED: z.string().optional(),
  COST_MULTIPLIER: z.coerce.number().optional(),

  // Execution Limits
  EXECUTION_TIMEOUT_FREE: z.string().optional(),
  EXECUTION_TIMEOUT_PRO: z.string().optional(),
  EXECUTION_TIMEOUT_TEAM: z.string().optional(),
  EXECUTION_TIMEOUT_ENTERPRISE: z.string().optional(),
  EXECUTION_TIMEOUT_ASYNC_FREE: z.string().optional(),
  EXECUTION_TIMEOUT_ASYNC_PRO: z.string().optional(),
  EXECUTION_TIMEOUT_ASYNC_TEAM: z.string().optional(),
  EXECUTION_TIMEOUT_ASYNC_ENTERPRISE: z.string().optional(),

  // CSP / Public URLs
  S3_KB_BUCKET_NAME: z.string().optional(),
  S3_CHAT_BUCKET_NAME: z.string().optional(),
  NEXT_PUBLIC_BRAND_LOGO_URL: z.string().optional(),
  NEXT_PUBLIC_BRAND_FAVICON_URL: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  OLLAMA_URL: z.string().optional(),
  NEXT_PUBLIC_SOCKET_URL: z.string().optional(),
  NEXT_PUBLIC_PRIVACY_URL: z.string().optional(),
  NEXT_PUBLIC_TERMS_URL: z.string().optional(),

  // External Services
  E2B_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),

  // Azure Storage
  AZURE_CONNECTION_STRING: z.string().optional(),
  AZURE_ACCOUNT_NAME: z.string().optional(),
  AZURE_ACCOUNT_KEY: z.string().optional(),
  AZURE_STORAGE_CONTAINER_NAME: z.string().optional(),
  AZURE_STORAGE_KB_CONTAINER_NAME: z.string().optional(),
  AZURE_STORAGE_COPILOT_CONTAINER_NAME: z.string().optional(),

  // S3 Copilot
  S3_COPILOT_BUCKET_NAME: z.string().optional(),

  // Spotify OAuth
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),

  // Execution files storage
  S3_EXECUTION_FILES_BUCKET_NAME: z.string().optional(),
  AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME: z.string().optional(),

  // Chat storage
  AZURE_STORAGE_CHAT_CONTAINER_NAME: z.string().optional(),

  // Profile pictures storage
  S3_PROFILE_PICTURES_BUCKET_NAME: z.string().optional(),
  AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME: z.string().optional(),

  // OG images storage
  S3_OG_IMAGES_BUCKET_NAME: z.string().optional(),
  AZURE_STORAGE_OG_IMAGES_CONTAINER_NAME: z.string().optional(),

  // Other
  TRELLO_API_KEY: z.string().optional(),
  BLACKLISTED_PROVIDERS: z.string().optional(),
  BLACKLISTED_MODELS: z.string().optional(),
})

type Env = z.infer<typeof envSchema>

let _env: Env | null = null

export function getEnv(): Env {
  if (_env) return _env

  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    console.error('Invalid environment variables:')
    console.error(result.error.format())

    // In development, allow running with missing optional vars
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Running with partial env config in development mode')
      _env = {
        PORT: process.env.PORT || '3001',
        NODE_ENV: (process.env.NODE_ENV as 'development') || 'development',
        CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
        DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:5432/sim',
      } as Env
      return _env
    }

    throw new Error('Invalid environment variables')
  }

  _env = result.data
  return _env
}

export const env = new Proxy({} as Env, {
  get(_, prop: string) {
    return getEnv()[prop as keyof Env]
  },
})

export const isTruthy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value)

export const isFalsy = (value: string | boolean | number | undefined) =>
  typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false
