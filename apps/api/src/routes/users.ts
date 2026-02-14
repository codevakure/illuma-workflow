import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('UserRoutes')

const app = new Hono<{ Variables: AuthContext }>()

let db: any
let settings: any
let user: any
let useInMemory = false
let dbInitialized = false

interface InMemorySettings {
  [key: string]: unknown
  theme: string
  autoConnect: boolean
  telemetryEnabled: boolean
}

const settingsStore = new Map<string, InMemorySettings>()

const DEFAULT_SETTINGS: InMemorySettings = {
  theme: 'dark',
  autoConnect: true,
  telemetryEnabled: true,
}

async function initDb() {
  try {
    const dbModule = await import('@sim/db')
    db = dbModule.db
    settings = dbModule.settings
    user = dbModule.user

    const { eq } = await import('drizzle-orm')
    await db.select().from(user).limit(1)
    logger.info('Database connection established for users')
    return true
  } catch (error) {
    logger.warn('Database not available for users, using in-memory store:', error)
    useInMemory = true
    return false
  }
}

async function ensureInit() {
  if (!dbInitialized) {
    await initDb()
    dbInitialized = true
  }
}

/**
 * GET /api/users/me/settings
 */
app.get('/me/settings', async (c) => {
  const userId = getUserId(c)
  await ensureInit()

  try {
    if (useInMemory) {
      const s = settingsStore.get(userId) ?? { ...DEFAULT_SETTINGS }
      return c.json({ data: s })
    }

    const { eq } = await import('drizzle-orm')
    const [s] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    return c.json({ data: s ?? DEFAULT_SETTINGS })
  } catch (error) {
    logger.error('Error getting user settings', error)
    return c.json({ error: 'Failed to get settings' }, 500)
  }
})

/**
 * PATCH /api/users/me/settings
 */
app.patch('/me/settings', async (c) => {
  const userId = getUserId(c)
  await ensureInit()

  try {
    const body = await c.req.json()

    if (useInMemory) {
      const existing = settingsStore.get(userId) ?? { ...DEFAULT_SETTINGS }
      const updated = { ...existing, ...body }
      settingsStore.set(userId, updated)
      return c.json({ data: updated })
    }

    const { eq } = await import('drizzle-orm')

    // Check if settings exist
    const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (existing) {
      const updateData: Record<string, unknown> = {}
      if (body.theme !== undefined) updateData.theme = body.theme
      if (body.autoConnect !== undefined) updateData.autoConnect = body.autoConnect
      if (body.telemetryEnabled !== undefined) updateData.telemetryEnabled = body.telemetryEnabled
      if (body.emailPreferences !== undefined) updateData.emailPreferences = body.emailPreferences
      if (body.billingUsageNotificationsEnabled !== undefined) {
        updateData.billingUsageNotificationsEnabled = body.billingUsageNotificationsEnabled
      }

      const [updated] = await db
        .update(settings)
        .set(updateData)
        .where(eq(settings.userId, userId))
        .returning()

      logger.info(`Updated settings for user ${userId}`)
      return c.json({ data: updated })
    }

    // Create new settings
    const [created] = await db
      .insert(settings)
      .values({
        id: userId,
        userId,
        theme: body.theme ?? 'dark',
        autoConnect: body.autoConnect ?? true,
        telemetryEnabled: body.telemetryEnabled ?? true,
        emailPreferences: body.emailPreferences ?? {},
      })
      .returning()

    logger.info(`Created settings for user ${userId}`)
    return c.json({ data: created })
  } catch (error) {
    logger.error('Error updating user settings', error)
    return c.json({ error: 'Failed to update settings' }, 500)
  }
})

/**
 * GET /api/users/me/profile
 */
app.get('/me/profile', async (c) => {
  const userId = getUserId(c)
  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({
        data: { id: userId, name: 'Test User', email: 'test@test.com', image: null },
      })
    }

    const { eq } = await import('drizzle-orm')
    const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1)

    if (!u) {
      return c.json({
        data: { id: userId, name: 'Test User', email: 'test@test.com', image: null },
      })
    }

    return c.json({
      data: { id: u.id, name: u.name, email: u.email, image: u.image },
    })
  } catch (error) {
    logger.error('Error getting user profile', error)
    return c.json({ error: 'Failed to get profile' }, 500)
  }
})

export { app as userRoutes }
