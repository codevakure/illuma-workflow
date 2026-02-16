import { db } from '@sim/db'
import { user, session, account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

const DEV_USER_ID = 'test-user-id'
const DEV_SESSION_ID = 'dev-session-id'
const DEV_SESSION_TOKEN = 'dev-session-token'

/**
 * Seeds a test user and session for dev mode.
 * better-auth's oauth2/link endpoint requires an authenticated session.
 * This ensures the dev user exists in the database.
 */
export async function seedDevSession(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return

  try {
    // Check if dev user exists
    const existingUser = await db.query.user.findFirst({
      where: eq(user.id, DEV_USER_ID),
    })

    if (!existingUser) {
      const now = new Date()
      await db.insert(user).values({
        id: DEV_USER_ID,
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      console.log('[dev-seed] Created dev user')
    }

    // Check if dev session exists and is not expired
    const existingSession = await db.query.session.findFirst({
      where: eq(session.id, DEV_SESSION_ID),
    })

    const now = new Date()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    if (!existingSession) {
      await db.insert(session).values({
        id: DEV_SESSION_ID,
        token: DEV_SESSION_TOKEN,
        userId: DEV_USER_ID,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      console.log('[dev-seed] Created dev session')
    } else if (existingSession.expiresAt < now) {
      // Session expired, update it
      await db
        .update(session)
        .set({ expiresAt, updatedAt: now })
        .where(eq(session.id, DEV_SESSION_ID))
      console.log('[dev-seed] Renewed expired dev session')
    }
  } catch (error) {
    console.error('[dev-seed] Failed to seed dev session:', error)
  }
}
