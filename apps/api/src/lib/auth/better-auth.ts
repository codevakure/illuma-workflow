import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { genericOAuth } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getMicrosoftRefreshTokenExpiry, isMicrosoftProvider } from '@/lib/oauth/microsoft'
import { getOAuthProviderConfigs } from './oauth-providers'

const logger = createLogger('BetterAuth')

export const auth = betterAuth({
  baseURL: process.env.API_BASE_URL || 'http://localhost:3001',
  basePath: '/api/auth',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      trustedProviders: [
        'google',
        'github',
        'email-password',
        'confluence',
        'x',
        'notion',
        'microsoft',
        'slack',
        'reddit',
        'webflow',
        'asana',
        'pipedrive',
        'hubspot',
        'linkedin',
        'spotify',
        'google-email',
        'google-calendar',
        'google-drive',
        'google-docs',
        'google-sheets',
        'google-forms',
        'google-vault',
        'google-groups',
        'vertex-ai',
        'github-repo',
        'microsoft-teams',
        'microsoft-excel',
        'microsoft-planner',
        'outlook',
        'onedrive',
        'sharepoint',
        'jira',
        'airtable',
        'dropbox',
        'salesforce',
        'wealthbox',
        'zoom',
        'wordpress',
        'linear',
        'calcom',
      ],
    },
  },
  databaseHooks: {
    account: {
      create: {
        before: async (account) => {
          // Only one credential per (userId, providerId) is allowed.
          // If user reconnects, delete the old one and preserve the ID.
          const existing = await db.query.account.findFirst({
            where: and(
              eq(schema.account.userId, account.userId),
              eq(schema.account.providerId, account.providerId)
            ),
          })

          const modifiedAccount = { ...account }

          // Handle Salesforce instance URL
          if (account.providerId === 'salesforce' && account.accessToken) {
            try {
              const response = await fetch(
                'https://login.salesforce.com/services/oauth2/userinfo',
                {
                  headers: {
                    Authorization: `Bearer ${account.accessToken}`,
                  },
                }
              )

              if (response.ok) {
                const data = await response.json()
                if (data.profile) {
                  const match = data.profile.match(/^(https:\/\/[^/]+)/)
                  if (match && match[1] !== 'https://login.salesforce.com') {
                    const instanceUrl = match[1]
                    modifiedAccount.scope = `__sf_instance__:${instanceUrl} ${account.scope}`
                  }
                }
              }
            } catch (error) {
              logger.error('Failed to fetch Salesforce instance URL', error)
            }
          }

          // Handle Microsoft refresh token expiry
          if (isMicrosoftProvider(account.providerId)) {
            modifiedAccount.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
          }

          if (existing) {
            // Delete the existing account so Better Auth can create the new one
            await db.delete(schema.account).where(eq(schema.account.id, existing.id))

            // Preserve the existing account ID so references continue to work
            modifiedAccount.id = existing.id

            logger.info('Deleted existing account for re-authorization', {
              userId: account.userId,
              providerId: account.providerId,
              existingAccountId: existing.id,
            })
          }

          return { data: modifiedAccount }
        },
        after: async (account) => {
          // Handle Salesforce: set default expiry if missing
          if (account.providerId === 'salesforce') {
            const updates: Record<string, unknown> = {}

            if (!account.accessTokenExpiresAt) {
              updates.accessTokenExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
            }

            if (account.accessToken) {
              try {
                const response = await fetch(
                  'https://login.salesforce.com/services/oauth2/userinfo',
                  {
                    headers: {
                      Authorization: `Bearer ${account.accessToken}`,
                    },
                  }
                )

                if (response.ok) {
                  const data = await response.json()
                  if (data.profile) {
                    const match = data.profile.match(/^(https:\/\/[^/]+)/)
                    if (match && match[1] !== 'https://login.salesforce.com') {
                      updates.scope = `__sf_instance__:${match[1]} ${account.scope}`
                    }
                  }
                }
              } catch (error) {
                logger.error('Failed to fetch Salesforce instance URL', error)
              }
            }

            if (Object.keys(updates).length > 0) {
              await db
                .update(schema.account)
                .set(updates)
                .where(eq(schema.account.id, account.id))
            }
          }

          // Handle Microsoft refresh token expiry
          if (isMicrosoftProvider(account.providerId)) {
            await db
              .update(schema.account)
              .set({ refreshTokenExpiresAt: getMicrosoftRefreshTokenExpiry() })
              .where(eq(schema.account.id, account.id))
          }
        },
      },
    },
  },
  plugins: [
    genericOAuth({
      config: getOAuthProviderConfigs(),
    }),
  ],
})
