import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('EnvironmentRoutes')

const app = new Hono<{ Variables: AuthContext }>()

let db: any
let environment: any
let useInMemory = false
let dbInitialized = false

async function initDb() {
  try {
    const dbModule = await import('@sim/db')
    db = dbModule.db
    environment = dbModule.environment

    await db.select().from(environment).limit(1)
    logger.info('Database connection established for environment')
    return true
  } catch (error) {
    logger.warn('Database not available for environment, using in-memory store:', error)
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
 * GET /api/environment
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ variables: {} })
    }

    const { eq } = await import('drizzle-orm')
    const [env] = await db.select().from(environment).where(eq(environment.userId, userId)).limit(1)

    return c.json({ variables: env?.variables ?? {} })
  } catch (error) {
    logger.error('Error getting environment', error)
    return c.json({ error: 'Failed to get environment' }, 500)
  }
})

export { app as environmentRoutes }
