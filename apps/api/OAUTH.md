# OAuth Integration Guide

## Architecture

All OAuth logic lives in the **API server** (`apps/api`). The web app is a lightweight client that calls better-auth's client SDK (`client.oauth2.link()`) and displays provider info fetched from the API.

### Key Design Decisions

- **JSON-driven**: All provider metadata (names, URLs, scopes, display info) lives in `providers.json`. Adding a new provider requires zero code changes (just a JSON entry + env vars).
- **API-centric**: The API handles redirect, callback, token exchange, storage, refresh, and provider metadata serving.
- **better-auth `genericOAuth`**: A single plugin handles all 36 OAuth providers. Each provider is a `GenericOAuthConfig` entry.

## File Structure

```
apps/api/src/lib/auth/
├── better-auth.ts        # betterAuth() server instance with genericOAuth plugin
├── oauth-providers.ts    # Loads providers.json, transforms to GenericOAuthConfig[]
├── oauth-user-info.ts    # Custom getUserInfo handlers for 21 non-standard providers
├── providers.json        # All 36 provider configs (data-driven)
├── dev-seed.ts           # Seeds test user/session for dev mode
├── oauth-utils.ts        # Token retrieval/refresh utilities
├── credential-access.ts  # Credential authorization logic
└── ...
```

## OAuth Flow

```
1. User clicks "Connect Gmail" in web app
   → client.oauth2.link({ providerId: 'google-email', callbackURL: '/settings' })

2. API: POST /api/auth/oauth2/link
   - Reads providers.json config for 'google-email'
   - Resolves GOOGLE_CLIENT_ID from env
   - Builds Google auth URL with scopes
   - Returns redirect URL

3. Browser redirects to Google → User authorizes → Google redirects back

4. API: GET /api/auth/oauth2/callback/google-email
   - Exchanges code for tokens
   - Calls getUserInfo (custom handler or OIDC standard)
   - Stores tokens in `account` table
   - Redirects to callbackURL

5. Web shows "Connected" via GET /api/auth/oauth/connections

6. Tool execution: POST /api/auth/oauth/token
   - Refreshes token if expired
   - Returns valid access token
```

## Adding a New OAuth Provider

### Step 1: Add to `providers.json`

Add an entry to the JSON array:

```json
{
  "providerId": "my-provider",
  "name": "My Provider",
  "description": "What this provider does",
  "baseProvider": "my-provider",
  "authorizationUrl": "https://my-provider.com/oauth/authorize",
  "tokenUrl": "https://my-provider.com/oauth/token",
  "scopes": ["read", "write"],
  "envClientId": "MY_PROVIDER_CLIENT_ID",
  "envClientSecret": "MY_PROVIDER_CLIENT_SECRET",
  "accessType": "offline",
  "prompt": "consent",
  "userInfo": { "type": "my-provider" }
}
```

### Step 2: Add getUserInfo handler (if non-standard)

If the provider doesn't support standard OIDC userinfo, add a handler in `oauth-user-info.ts`:

```typescript
function myProviderHandler(): GetUserInfoFn {
  return async (tokens) => {
    const res = await fetch('https://api.my-provider.com/me', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    return makeUserInfo(data.id, data.name, data.email, true, data.avatar)
  }
}
```

Then add the case to the `getUserInfoHandler` switch statement.

### Step 3: Set environment variables

```env
MY_PROVIDER_CLIENT_ID=your-client-id
MY_PROVIDER_CLIENT_SECRET=your-client-secret
```

### Step 4: Done

No other code changes needed. The provider will automatically appear in the metadata endpoint and be available for OAuth connections.

## providers.json Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `providerId` | string | Yes | Unique ID (e.g., `google-email`, `slack`) |
| `name` | string | Yes | Display name for web UI |
| `description` | string | Yes | Description for web UI |
| `baseProvider` | string | Yes | Base provider group (e.g., `google`, `microsoft`) |
| `discoveryUrl` | string | One of | OIDC discovery endpoint |
| `authorizationUrl` | string | these | OAuth authorization endpoint |
| `tokenUrl` | string | required | OAuth token endpoint |
| `scopes` | string[] | Yes | Required OAuth scopes |
| `envClientId` | string | Yes | Env var name for client ID |
| `envClientSecret` | string | Yes | Env var name for client secret |
| `pkce` | boolean | No | Use PKCE (default false) |
| `accessType` | string | No | e.g., `offline` for refresh tokens |
| `prompt` | string | No | e.g., `consent` to force consent screen |
| `authentication` | string | No | `basic` or `post` for token exchange |
| `additionalAuthParams` | object | No | Extra URL params for auth URL |
| `userInfo` | object | Yes | `{ "type": "handler-name" }` |

## API Endpoints

### Public (handled by better-auth)

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/oauth2/link` | POST | Initiate OAuth flow (returns redirect URL) |
| `/api/auth/oauth2/callback/:providerId` | GET | OAuth callback handler |

### Protected (require auth middleware)

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/oauth/token` | POST | Get access token for a credential |
| `/api/auth/oauth/token` | GET | Get access token (query string) |
| `/api/auth/oauth/credentials` | GET | Get credentials for a provider |
| `/api/auth/oauth/connections` | GET | Get all OAuth connections for user |
| `/api/auth/oauth/disconnect` | POST | Disconnect an OAuth provider |
| `/api/auth/oauth/providers` | GET | Get provider metadata (names, availability) |

## Environment Variables

All optional -- only providers with configured env vars are available:

```env
API_BASE_URL=http://localhost:3001

# Google (shared across 10 services)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Microsoft (shared across 6 services)
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=

# Individual providers
GITHUB_CLIENT_ID=          GITHUB_CLIENT_SECRET=
X_CLIENT_ID=               X_CLIENT_SECRET=
CONFLUENCE_CLIENT_ID=      CONFLUENCE_CLIENT_SECRET=
JIRA_CLIENT_ID=            JIRA_CLIENT_SECRET=
AIRTABLE_CLIENT_ID=        AIRTABLE_CLIENT_SECRET=
NOTION_CLIENT_ID=          NOTION_CLIENT_SECRET=
LINEAR_CLIENT_ID=          LINEAR_CLIENT_SECRET=
DROPBOX_CLIENT_ID=         DROPBOX_CLIENT_SECRET=
SLACK_CLIENT_ID=           SLACK_CLIENT_SECRET=
REDDIT_CLIENT_ID=          REDDIT_CLIENT_SECRET=
WEALTHBOX_CLIENT_ID=       WEALTHBOX_CLIENT_SECRET=
WEBFLOW_CLIENT_ID=         WEBFLOW_CLIENT_SECRET=
ASANA_CLIENT_ID=           ASANA_CLIENT_SECRET=
CALCOM_CLIENT_ID=          (no secret needed)
PIPEDRIVE_CLIENT_ID=       PIPEDRIVE_CLIENT_SECRET=
HUBSPOT_CLIENT_ID=         HUBSPOT_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=        LINKEDIN_CLIENT_SECRET=
SALESFORCE_CLIENT_ID=      SALESFORCE_CLIENT_SECRET=
ZOOM_CLIENT_ID=            ZOOM_CLIENT_SECRET=
WORDPRESS_CLIENT_ID=       WORDPRESS_CLIENT_SECRET=
SPOTIFY_CLIENT_ID=         SPOTIFY_CLIENT_SECRET=
```

## Database

OAuth connections are stored in the `account` table:

| Column | Type | Description |
|---|---|---|
| `id` | text | Primary key |
| `account_id` | text | Provider-specific user ID |
| `provider_id` | text | OAuth provider ID (e.g., `google-email`) |
| `user_id` | text | Foreign key to `user` table |
| `access_token` | text | OAuth access token |
| `refresh_token` | text | OAuth refresh token |
| `id_token` | text | OIDC ID token (for displaying user info) |
| `access_token_expires_at` | timestamp | Token expiry |
| `refresh_token_expires_at` | timestamp | Refresh token expiry |
| `scope` | text | Granted scopes (space-separated) |

## Token Refresh

Token refresh is handled by `oauth-utils.ts` when tools request tokens via `/api/auth/oauth/token`. The flow:

1. Check if `accessTokenExpiresAt` is in the past
2. If expired, use `refreshToken` to get a new access token
3. Update the `account` table with the new token and expiry
4. Return the fresh access token

Microsoft providers have a 90-day refresh token expiry (set in `better-auth.ts` database hooks).

Salesforce stores the instance URL in the `scope` field with a `__sf_instance__:` prefix.

## Dev Mode

In development, `dev-seed.ts` creates a test user and session so that better-auth's `oauth2/link` endpoint works without a real login session. The dev user has:
- ID: `test-user-id`
- Email: `test@example.com`
- Session token: `dev-session-token`
