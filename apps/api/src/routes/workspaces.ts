import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '../middleware/auth'

const logger = createLogger('WorkspaceRoutes')

const app = new Hono<{ Variables: AuthContext }>()

let db: any
let workspace: any
let permissions: any
let workspaceEnvironment: any
let apiKey: any
let user: any
let useInMemory = false
let dbInitialized = false

interface InMemoryWorkspace {
  id: string
  name: string
  ownerId: string
  billedAccountUserId: string
  allowPersonalApiKeys: boolean
  createdAt: Date
  updatedAt: Date
}

const inMemoryStore = new Map<string, InMemoryWorkspace>()

async function initDb() {
  try {
    const dbModule = await import('@sim/db')
    db = dbModule.db
    workspace = dbModule.workspace
    permissions = dbModule.permissions
    workspaceEnvironment = dbModule.workspaceEnvironment
    apiKey = dbModule.apiKey
    user = dbModule.user

    const { eq } = await import('drizzle-orm')
    await db.select().from(workspace).limit(1)
    logger.info('Database connection established for workspaces')
    return true
  } catch (error) {
    logger.warn('Database not available for workspaces, using in-memory store:', error)
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

function ensureDefaultInMemory(userId: string): void {
  if (!inMemoryStore.has('default')) {
    inMemoryStore.set('default', {
      id: 'default',
      name: 'Default Workspace',
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
}

/**
 * GET /api/workspaces
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  await ensureInit()

  try {
    if (useInMemory) {
      ensureDefaultInMemory(userId)
      const workspaces = Array.from(inMemoryStore.values())
        .filter((w) => w.ownerId === userId)
        .map((w) => ({ ...w, role: 'admin' }))
      return c.json({ workspaces })
    }

    const { eq, or } = await import('drizzle-orm')

    // Get workspaces owned by user or where user has permissions
    const ownedWorkspaces = await db
      .select()
      .from(workspace)
      .where(eq(workspace.ownerId, userId))

    const workspaces = ownedWorkspaces.map((w: any) => ({ ...w, role: 'admin' }))
    logger.info(`Listed ${workspaces.length} workspaces for user ${userId}`)
    return c.json({ workspaces })
  } catch (error) {
    logger.error('Error listing workspaces', error)
    return c.json({ error: 'Failed to list workspaces' }, 500)
  }
})

/**
 * POST /api/workspaces
 */
app.post('/', async (c) => {
  const userId = getUserId(c)
  await ensureInit()

  try {
    const body = await c.req.json()
    const id = crypto.randomUUID()
    const now = new Date()

    if (useInMemory) {
      const ws: InMemoryWorkspace = {
        id,
        name: body.name || 'New Workspace',
        ownerId: userId,
        billedAccountUserId: userId,
        allowPersonalApiKeys: true,
        createdAt: now,
        updatedAt: now,
      }
      inMemoryStore.set(id, ws)
      return c.json({ workspace: { ...ws, role: 'admin' } }, 201)
    }

    const [created] = await db
      .insert(workspace)
      .values({
        id,
        name: body.name || 'New Workspace',
        ownerId: userId,
        billedAccountUserId: userId,
      })
      .returning()

    logger.info(`Created workspace ${id} for user ${userId}`)
    return c.json({ workspace: { ...created, role: 'admin' } }, 201)
  } catch (error) {
    logger.error('Error creating workspace', error)
    return c.json({ error: 'Failed to create workspace' }, 500)
  }
})

/**
 * GET /api/workspaces/:id
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  await ensureInit()

  try {
    if (useInMemory) {
      ensureDefaultInMemory(userId)
      const ws = inMemoryStore.get(id)
      if (!ws) return c.json({ error: 'Workspace not found' }, 404)
      return c.json({ workspace: { ...ws, role: 'admin' } })
    }

    const { eq } = await import('drizzle-orm')
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, id)).limit(1)
    if (!ws) return c.json({ error: 'Workspace not found' }, 404)

    return c.json({ workspace: { ...ws, role: 'admin' } })
  } catch (error) {
    logger.error(`Error getting workspace ${id}`, error)
    return c.json({ error: 'Failed to get workspace' }, 500)
  }
})

/**
 * PATCH /api/workspaces/:id
 */
app.patch('/:id', async (c) => {
  const id = c.req.param('id')
  await ensureInit()

  try {
    const body = await c.req.json()

    if (useInMemory) {
      const ws = inMemoryStore.get(id)
      if (!ws) return c.json({ error: 'Workspace not found' }, 404)
      const updated = { ...ws, ...body, updatedAt: new Date() }
      inMemoryStore.set(id, updated)
      return c.json({ workspace: { ...updated, role: 'admin' } })
    }

    const { eq } = await import('drizzle-orm')
    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name !== undefined) updateData.name = body.name

    const [updated] = await db
      .update(workspace)
      .set(updateData)
      .where(eq(workspace.id, id))
      .returning()

    if (!updated) return c.json({ error: 'Workspace not found' }, 404)
    return c.json({ workspace: { ...updated, role: 'admin' } })
  } catch (error) {
    logger.error(`Error updating workspace ${id}`, error)
    return c.json({ error: 'Failed to update workspace' }, 500)
  }
})

/**
 * DELETE /api/workspaces/:id
 */
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await ensureInit()

  try {
    if (useInMemory) {
      if (!inMemoryStore.has(id)) return c.json({ error: 'Workspace not found' }, 404)
      inMemoryStore.delete(id)
      return c.json({ success: true })
    }

    const { eq } = await import('drizzle-orm')
    await db.delete(workspace).where(eq(workspace.id, id))
    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting workspace ${id}`, error)
    return c.json({ error: 'Failed to delete workspace' }, 500)
  }
})

/**
 * GET /api/workspaces/:id/permissions
 */
app.get('/:id/permissions', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  await ensureInit()

  try {
    let userEmail = 'test@test.com'
    let userName: string | null = 'Test User'
    let userImage: string | null = null
    let permissionType: 'admin' | 'write' | 'read' = 'admin'

    if (!useInMemory) {
      const { and, eq } = await import('drizzle-orm')

      // Get user info
      const [userRecord] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
      if (userRecord) {
        userEmail = userRecord.email ?? userEmail
        userName = userRecord.name ?? userName
        userImage = userRecord.image ?? null
      }

      // Check if user is workspace owner
      const [ws] = await db.select().from(workspace).where(eq(workspace.id, id)).limit(1)
      if (!ws || ws.ownerId === userId) {
        permissionType = 'admin'
      } else {
        // Check permissions table
        const [perm] = await db
          .select()
          .from(permissions)
          .where(
            and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, id)
            )
          )
          .limit(1)

        permissionType = (perm?.permissionType as 'admin' | 'write' | 'read') ?? 'read'
      }
    }

    return c.json({
      users: [
        {
          userId,
          email: userEmail,
          name: userName,
          image: userImage,
          permissionType,
        },
      ],
      total: 1,
    })
  } catch (error) {
    logger.error(`Error getting permissions for workspace ${id}`, error)
    return c.json({ error: 'Failed to get permissions' }, 500)
  }
})

/**
 * GET /api/workspaces/:id/environment
 */
app.get('/:id/environment', async (c) => {
  const id = c.req.param('id')
  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ variables: {} })
    }

    const { eq } = await import('drizzle-orm')
    const [env] = await db
      .select()
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, id))
      .limit(1)

    return c.json({ variables: env?.variables ?? {} })
  } catch (error) {
    logger.error(`Error getting environment for workspace ${id}`, error)
    return c.json({ error: 'Failed to get environment' }, 500)
  }
})

/**
 * GET /api/workspaces/:id/api-keys
 */
app.get('/:id/api-keys', async (c) => {
  const id = c.req.param('id')
  await ensureInit()

  try {
    if (useInMemory) {
      return c.json({ apiKeys: [] })
    }

    const { eq } = await import('drizzle-orm')
    const keys = await db.select().from(apiKey).where(eq(apiKey.workspaceId, id))

    return c.json({ apiKeys: keys })
  } catch (error) {
    logger.error(`Error getting API keys for workspace ${id}`, error)
    return c.json({ error: 'Failed to get API keys' }, 500)
  }
})

export { app as workspaceRoutes }
