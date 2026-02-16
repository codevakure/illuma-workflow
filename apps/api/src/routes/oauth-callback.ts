import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { handleOAuthCallback } from '@/lib/auth/oauth-link'

const logger = createLogger('OAuthCallback')

const app = new Hono()

/**
 * GET /api/auth/oauth2/callback/:providerId
 *
 * Handles the OAuth provider redirect after user authorization.
 * This is a public route (no auth required) because the browser is redirected
 * here directly from the OAuth provider.
 *
 * The state cookie (set during /oauth/link) provides CSRF protection
 * and carries the userId + callbackURL.
 */
app.get('/callback/:providerId', async (c) => {
  const providerId = c.req.param('providerId')
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  const errorDescription = c.req.query('error_description')

  // Extract the state token from cookie
  const cookieHeader = c.req.header('Cookie') || ''
  const stateTokenMatch = cookieHeader.match(/__oauth_state=([^;]+)/)
  const stateToken = stateTokenMatch ? stateTokenMatch[1] : null

  if (error) {
    logger.error('OAuth provider returned error', { providerId, error, errorDescription })
    // Redirect to a generic error page or the web app
    const webUrl = process.env.WEB_BASE_URL || 'http://localhost:5173'
    return c.redirect(`${webUrl}/settings?oauth_error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    logger.error('Missing code or state in OAuth callback', { providerId })
    const webUrl = process.env.WEB_BASE_URL || 'http://localhost:5173'
    return c.redirect(`${webUrl}/settings?oauth_error=missing_params`)
  }

  if (!stateToken) {
    logger.error('Missing state cookie in OAuth callback', { providerId })
    const webUrl = process.env.WEB_BASE_URL || 'http://localhost:5173'
    return c.redirect(`${webUrl}/settings?oauth_error=missing_state`)
  }

  try {
    const { callbackURL } = await handleOAuthCallback(code, state, stateToken)

    // Clear the state cookie
    c.header('Set-Cookie', '__oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')

    logger.info('OAuth callback successful', { providerId })

    // Redirect to the callbackURL provided during link
    return c.redirect(callbackURL)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error('OAuth callback failed', { providerId, error: message })

    const webUrl = process.env.WEB_BASE_URL || 'http://localhost:5173'
    return c.redirect(`${webUrl}/settings?oauth_error=${encodeURIComponent(message)}`)
  }
})

export { app as oauthCallbackRoutes }
