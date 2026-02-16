import { db } from '@sim/db'
import { account, user, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { z } from 'zod'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import {
  getCredential,
  getOAuthToken,
  refreshTokenIfNeeded,
} from '@/lib/auth/oauth-utils'
import { generateRequestId } from '@/lib/core/utils/request'
import type { AuthContext } from '@/middleware/auth'
import { evaluateScopeCoverage, parseProvider } from '@/lib/oauth/utils'
import type { OAuthProvider } from '@/lib/oauth/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('AuthRoutes')

const app = new Hono<{ Variables: AuthContext }>()

const SALESFORCE_INSTANCE_URL_REGEX = /__sf_instance__:([^\s]+)/

// ─── OAuth Token Schemas ────────────────────────────────────────────

const tokenRequestSchema = z
  .object({
    credentialId: z.string().min(1).optional(),
    credentialAccountUserId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    workflowId: z.string().min(1).nullish(),
  })
  .refine(
    (data) => data.credentialId || (data.credentialAccountUserId && data.providerId),
    'Either credentialId or (credentialAccountUserId + providerId) is required'
  )

const tokenQuerySchema = z.object({
  credentialId: z
    .string({
      required_error: 'Credential ID is required',
      invalid_type_error: 'Credential ID is required',
    })
    .min(1, 'Credential ID is required'),
})

const credentialsQuerySchema = z
  .object({
    provider: z.string().nullish(),
    workflowId: z.string().uuid('Workflow ID must be a valid UUID').nullish(),
    credentialId: z
      .string()
      .min(1, 'Credential ID must not be empty')
      .max(255, 'Credential ID is too long')
      .nullish(),
  })
  .refine((data) => data.provider || data.credentialId, {
    message: 'Provider or credentialId is required',
    path: ['provider'],
  })

interface GoogleIdToken {
  email?: string
  sub?: string
  name?: string
}

// ─── POST /api/auth/socket-token ────────────────────────────────────

app.post('/socket-token', (c) => {
  return c.json({ token: 'placeholder-socket-token' })
})

// ─── POST /api/auth/oauth/token ─────────────────────────────────────

/**
 * Exchange a credential ID for an access token.
 * Supports both credentialId-based and credentialAccountUserId+providerId-based lookups.
 */
app.post('/oauth/token', async (c) => {
  const requestId = generateRequestId()
  const userId = c.get('userId')
  const authType = c.get('authType')

  logger.info(`[${requestId}] OAuth token API POST request received`)

  try {
    const rawBody = await c.req.json()
    const parseResult = tokenRequestSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn(`[${requestId}] Invalid token request`, {
        errors: parseResult.error.errors,
      })

      return c.json({ error: errorMessage }, 400)
    }

    const { credentialId, credentialAccountUserId, providerId, workflowId } = parseResult.data

    // Path 1: Lookup by credentialAccountUserId + providerId
    if (credentialAccountUserId && providerId) {
      logger.info(`[${requestId}] Fetching token by credentialAccountUserId + providerId`, {
        credentialAccountUserId,
        providerId,
      })

      // In placeholder auth mode, allow if the user matches
      if (userId !== credentialAccountUserId && authType !== 'placeholder') {
        logger.warn(
          `[${requestId}] User ${userId} attempted to access credentials for ${credentialAccountUserId}`
        )
        return c.json({ error: 'Unauthorized' }, 403)
      }

      try {
        const accessToken = await getOAuthToken(credentialAccountUserId, providerId)
        if (!accessToken) {
          return c.json(
            {
              error: `No credential found for user ${credentialAccountUserId} and provider ${providerId}`,
            },
            404
          )
        }

        return c.json({ accessToken }, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get OAuth token'
        logger.warn(`[${requestId}] OAuth token error: ${message}`)
        return c.json({ error: message }, 403)
      }
    }

    // Path 2: Lookup by credentialId
    if (!credentialId) {
      return c.json({ error: 'Credential ID is required' }, 400)
    }

    const authz = await authorizeCredentialUse(userId, authType, {
      credentialId,
      workflowId: workflowId ?? undefined,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return c.json({ error: authz.error || 'Unauthorized' }, 403)
    }

    const credential = await getCredential(requestId, credentialId, authz.credentialOwnerUserId)

    if (!credential) {
      return c.json({ error: 'Credential not found' }, 404)
    }

    try {
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)

      let instanceUrl: string | undefined
      if (credential.providerId === 'salesforce' && credential.scope) {
        const instanceMatch = credential.scope.match(SALESFORCE_INSTANCE_URL_REGEX)
        if (instanceMatch) {
          instanceUrl = instanceMatch[1]
        }
      }

      return c.json(
        {
          accessToken,
          idToken: credential.idToken || undefined,
          ...(instanceUrl && { instanceUrl }),
        },
        200
      )
    } catch (error) {
      logger.error(`[${requestId}] Failed to refresh access token:`, error)
      return c.json({ error: 'Failed to refresh access token' }, 401)
    }
  } catch (error) {
    logger.error(`[${requestId}] Error getting access token`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── GET /api/auth/oauth/token ──────────────────────────────────────

/**
 * Get the access token for a specific credential (query-string based).
 */
app.get('/oauth/token', async (c) => {
  const requestId = generateRequestId()
  const userId = c.get('userId')

  try {
    const rawQuery = {
      credentialId: c.req.query('credentialId'),
    }

    const parseResult = tokenQuerySchema.safeParse(rawQuery)

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn(`[${requestId}] Invalid query parameters`, {
        errors: parseResult.error.errors,
      })

      return c.json({ error: errorMessage }, 400)
    }

    const { credentialId } = parseResult.data

    const credential = await getCredential(requestId, credentialId, userId)

    if (!credential) {
      return c.json({ error: 'Credential not found' }, 404)
    }

    if (!credential.accessToken) {
      logger.warn(`[${requestId}] No access token available for credential`)
      return c.json({ error: 'No access token available' }, 400)
    }

    try {
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)

      let instanceUrl: string | undefined
      if (credential.providerId === 'salesforce' && credential.scope) {
        const instanceMatch = credential.scope.match(SALESFORCE_INSTANCE_URL_REGEX)
        if (instanceMatch) {
          instanceUrl = instanceMatch[1]
        }
      }

      return c.json(
        {
          accessToken,
          idToken: credential.idToken || undefined,
          ...(instanceUrl && { instanceUrl }),
        },
        200
      )
    } catch (_error) {
      return c.json({ error: 'Failed to refresh access token' }, 401)
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching access token`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── GET /api/auth/oauth/credentials ────────────────────────────────

/**
 * Get credentials for a specific provider.
 */
app.get('/oauth/credentials', async (c) => {
  const requestId = generateRequestId()
  const userId = c.get('userId')

  try {
    const rawQuery = {
      provider: c.req.query('provider'),
      workflowId: c.req.query('workflowId'),
      credentialId: c.req.query('credentialId'),
    }

    const parseResult = credentialsQuerySchema.safeParse(rawQuery)

    if (!parseResult.success) {
      const refinementError = parseResult.error.errors.find((err) => err.code === 'custom')
      if (refinementError) {
        logger.warn(`[${requestId}] Invalid query parameters: ${refinementError.message}`)
        return c.json({ error: refinementError.message }, 400)
      }

      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn(`[${requestId}] Invalid query parameters`, {
        errors: parseResult.error.errors,
      })

      return c.json({ error: errorMessage }, 400)
    }

    const { provider: providerParam, workflowId, credentialId } = parseResult.data

    // Resolve effective user id: workflow owner if workflowId provided (with access check); else requester
    let effectiveUserId: string = userId
    if (workflowId) {
      const rows = await db
        .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!rows.length) {
        logger.warn(`[${requestId}] Workflow not found for credentials request`, { workflowId })
        return c.json({ error: 'Workflow not found' }, 404)
      }

      const wf = rows[0]

      if (userId !== wf.userId) {
        if (!wf.workspaceId) {
          logger.warn(
            `[${requestId}] Forbidden - workflow has no workspace and requester is not owner`,
            { requesterUserId: userId }
          )
          return c.json({ error: 'Forbidden' }, 403)
        }

        const perm = await getUserEntityPermissions(userId, 'workspace', wf.workspaceId)
        if (perm === null) {
          logger.warn(`[${requestId}] Forbidden credentials request - no workspace access`, {
            requesterUserId: userId,
            workspaceId: wf.workspaceId,
          })
          return c.json({ error: 'Forbidden' }, 403)
        }
      }

      effectiveUserId = wf.userId
    }

    // Parse the provider to get base provider and feature type (if provider is present)
    const { baseProvider } = parseProvider((providerParam || 'google') as OAuthProvider)

    let accountsData

    if (credentialId) {
      if (workflowId) {
        accountsData = await db.select().from(account).where(eq(account.id, credentialId))
      } else {
        accountsData = await db
          .select()
          .from(account)
          .where(and(eq(account.userId, effectiveUserId), eq(account.id, credentialId)))
      }
    } else {
      accountsData = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, effectiveUserId), eq(account.providerId, providerParam!)))
    }

    // Transform accounts into credentials
    const credentials = await Promise.all(
      accountsData.map(async (acc) => {
        const [_, featureType = 'default'] = acc.providerId.split('-')

        let displayName = ''

        // Try to extract email from ID token
        if (acc.idToken) {
          try {
            const decoded = jwtDecode<GoogleIdToken>(acc.idToken)
            if (decoded.email) {
              displayName = decoded.email
            } else if (decoded.name) {
              displayName = decoded.name
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error decoding ID token`, {
              accountId: acc.id,
            })
          }
        }

        // For GitHub, the accountId might be the username
        if (!displayName && baseProvider === 'github') {
          displayName = `${acc.accountId} (GitHub)`
        }

        // Try to get the user's email from our database
        if (!displayName) {
          try {
            const userRecord = await db
              .select({ email: user.email })
              .from(user)
              .where(eq(user.id, acc.userId))
              .limit(1)

            if (userRecord.length > 0) {
              displayName = userRecord[0].email
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error fetching user email`, {
              userId: acc.userId,
            })
          }
        }

        // Fallback: Use accountId with provider type as context
        if (!displayName) {
          displayName = `${acc.accountId} (${baseProvider})`
        }

        const storedScope = acc.scope?.trim()
        const grantedScopes = storedScope ? storedScope.split(/[\s,]+/).filter(Boolean) : []
        const scopeEvaluation = evaluateScopeCoverage(acc.providerId, grantedScopes)

        return {
          id: acc.id,
          name: displayName,
          provider: acc.providerId,
          lastUsed: acc.updatedAt.toISOString(),
          isDefault: featureType === 'default',
          scopes: scopeEvaluation.grantedScopes,
          canonicalScopes: scopeEvaluation.canonicalScopes,
          missingScopes: scopeEvaluation.missingScopes,
          extraScopes: scopeEvaluation.extraScopes,
          requiresReauthorization: scopeEvaluation.requiresReauthorization,
        }
      })
    )

    return c.json({ credentials }, 200)
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── GET /api/auth/oauth/connections ────────────────────────────────

/**
 * Get all OAuth connections for the current user.
 */
app.get('/oauth/connections', async (c) => {
  const requestId = generateRequestId()
  const userId = c.get('userId')

  try {
    // Get all accounts for this user
    const accounts = await db.select().from(account).where(eq(account.userId, userId))

    // Get the user's email for fallback
    const userRecord = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    const userEmail = userRecord.length > 0 ? userRecord[0]?.email : null

    // Process accounts to determine connections
    const connections: Array<Record<string, unknown>> = []

    for (const acc of accounts) {
      const { baseProvider, featureType } = parseProvider(acc.providerId as OAuthProvider)
      const grantedScopes = acc.scope ? acc.scope.split(/\s+/).filter(Boolean) : []
      const scopeEvaluation = evaluateScopeCoverage(acc.providerId, grantedScopes)

      if (baseProvider) {
        let displayName = ''

        if (acc.idToken) {
          try {
            const decoded = jwtDecode<GoogleIdToken>(acc.idToken)
            if (decoded.email) {
              displayName = decoded.email
            } else if (decoded.name) {
              displayName = decoded.name
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error decoding ID token`, {
              accountId: acc.id,
            })
          }
        }

        if (!displayName && baseProvider === 'github') {
          displayName = `${acc.accountId} (GitHub)`
        }

        if (!displayName && userEmail) {
          displayName = userEmail
        }

        if (!displayName) {
          displayName = `${acc.accountId} (${baseProvider})`
        }

        const connectionKey = acc.providerId
        const existingConnection = connections.find((conn) => conn.provider === connectionKey) as
          | Record<string, unknown>
          | undefined

        const accountSummary = {
          id: acc.id,
          name: displayName,
          scopes: scopeEvaluation.grantedScopes,
          missingScopes: scopeEvaluation.missingScopes,
          extraScopes: scopeEvaluation.extraScopes,
          requiresReauthorization: scopeEvaluation.requiresReauthorization,
        }

        if (existingConnection) {
          const existingAccounts = existingConnection.accounts as Array<Record<string, unknown>>
          existingAccounts.push(accountSummary)

          existingConnection.scopes = Array.from(
            new Set([
              ...((existingConnection.scopes as string[]) || []),
              ...scopeEvaluation.grantedScopes,
            ])
          )
          existingConnection.missingScopes = Array.from(
            new Set([
              ...((existingConnection.missingScopes as string[]) || []),
              ...scopeEvaluation.missingScopes,
            ])
          )
          existingConnection.extraScopes = Array.from(
            new Set([
              ...((existingConnection.extraScopes as string[]) || []),
              ...scopeEvaluation.extraScopes,
            ])
          )
          existingConnection.canonicalScopes =
            (existingConnection.canonicalScopes as string[])?.length > 0
              ? existingConnection.canonicalScopes
              : scopeEvaluation.canonicalScopes
          existingConnection.requiresReauthorization =
            (existingConnection.requiresReauthorization as boolean) ||
            scopeEvaluation.requiresReauthorization

          const existingTimestamp = existingConnection.lastConnected
            ? new Date(existingConnection.lastConnected as string).getTime()
            : 0
          const candidateTimestamp = acc.updatedAt.getTime()

          if (candidateTimestamp > existingTimestamp) {
            existingConnection.lastConnected = acc.updatedAt.toISOString()
          }
        } else {
          connections.push({
            provider: connectionKey,
            baseProvider,
            featureType,
            isConnected: true,
            scopes: scopeEvaluation.grantedScopes,
            canonicalScopes: scopeEvaluation.canonicalScopes,
            missingScopes: scopeEvaluation.missingScopes,
            extraScopes: scopeEvaluation.extraScopes,
            requiresReauthorization: scopeEvaluation.requiresReauthorization,
            lastConnected: acc.updatedAt.toISOString(),
            accounts: [accountSummary],
          })
        }
      }
    }

    return c.json({ connections }, 200)
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth connections`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── POST /api/auth/oauth/disconnect ───────────────────────────────

app.post('/oauth/disconnect', async (c) => {
  const requestId = generateRequestId()
  const userId = c.get('userId')

  try {
    const { providerId } = await c.req.json<{ providerId: string }>()

    if (!providerId) {
      return c.json({ error: 'providerId is required' }, 400)
    }

    const deleted = await db
      .delete(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))

    logger.info(`[${requestId}] Disconnected OAuth provider`, { userId, providerId })
    return c.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error disconnecting OAuth provider`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── GET /api/auth/oauth/providers ─────────────────────────────────

app.get('/oauth/providers', async (c) => {
  try {
    const { getProviderMetadata } = await import('@/lib/auth/oauth-providers')
    return c.json({ providers: getProviderMetadata() })
  } catch (error) {
    logger.error('Error fetching provider metadata', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── Static Routes ──────────────────────────────────────────────────

app.get('/sso/providers', (c) => {
  return c.json({ providers: [] })
})

app.get('/organization/list', (c) => {
  return c.json([])
})

app.get('/organization/get-full-organization', (c) => {
  return c.json({ organization: null })
})

export { app as authRoutes }
