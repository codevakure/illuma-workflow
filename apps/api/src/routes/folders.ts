import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('FolderRoutes')

const app = new Hono<{ Variables: AuthContext }>()

let db: any
let workflowFolder: any
let useInMemory = false
let dbInitialized = false

interface InMemoryFolder {
  id: string
  name: string
  userId: string
  workspaceId: string
  parentId: string | null
  color: string
  isExpanded: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

const inMemoryStore = new Map<string, InMemoryFolder>()

async function initDb() {
  try {
    const dbModule = await import('@sim/db')
    db = dbModule.db
    workflowFolder = dbModule.workflowFolder

    await db.select().from(workflowFolder).limit(1)
    logger.info('Database connection established for folders')
    return true
  } catch (error) {
    logger.warn('Database not available for folders, using in-memory store:', error)
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
 * GET /api/folders
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')
  await ensureInit()

  try {
    if (useInMemory) {
      const folders = Array.from(inMemoryStore.values()).filter((f) => {
        if (workspaceId) return f.workspaceId === workspaceId
        return f.userId === userId
      })
      return c.json({ folders })
    }

    const { eq, and, asc } = await import('drizzle-orm')

    let folders
    if (workspaceId) {
      folders = await db
        .select()
        .from(workflowFolder)
        .where(
          and(eq(workflowFolder.workspaceId, workspaceId), eq(workflowFolder.userId, userId))
        )
        .orderBy(asc(workflowFolder.sortOrder))
    } else {
      folders = await db
        .select()
        .from(workflowFolder)
        .where(eq(workflowFolder.userId, userId))
        .orderBy(asc(workflowFolder.sortOrder))
    }

    logger.info(`Listed ${folders.length} folders for user ${userId}`)
    return c.json({ folders })
  } catch (error) {
    logger.error('Error listing folders', error)
    return c.json({ error: 'Failed to list folders' }, 500)
  }
})

/**
 * POST /api/folders
 */
app.post('/', async (c) => {
  const userId = getUserId(c)
  await ensureInit()

  try {
    const body = await c.req.json()
    const id = crypto.randomUUID()
    const now = new Date()

    if (useInMemory) {
      const folder: InMemoryFolder = {
        id,
        name: body.name || 'New Folder',
        userId,
        workspaceId: body.workspaceId || 'default',
        parentId: body.parentId || null,
        color: body.color || '#6B7280',
        isExpanded: true,
        sortOrder: body.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      }
      inMemoryStore.set(id, folder)
      return c.json({ folder }, 201)
    }

    const [created] = await db
      .insert(workflowFolder)
      .values({
        id,
        name: body.name || 'New Folder',
        userId,
        workspaceId: body.workspaceId || 'default',
        parentId: body.parentId || null,
        color: body.color || '#6B7280',
        isExpanded: true,
        sortOrder: body.sortOrder ?? 0,
      })
      .returning()

    logger.info(`Created folder ${id} for user ${userId}`)
    return c.json({ folder: created }, 201)
  } catch (error) {
    logger.error('Error creating folder', error)
    return c.json({ error: 'Failed to create folder' }, 500)
  }
})

/**
 * DELETE /api/folders/:id
 */
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await ensureInit()

  try {
    if (useInMemory) {
      if (!inMemoryStore.has(id)) return c.json({ error: 'Folder not found' }, 404)
      inMemoryStore.delete(id)
      return c.json({ success: true })
    }

    const { eq } = await import('drizzle-orm')
    await db.delete(workflowFolder).where(eq(workflowFolder.id, id))
    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting folder ${id}`, error)
    return c.json({ error: 'Failed to delete folder' }, 500)
  }
})

export { app as folderRoutes }
