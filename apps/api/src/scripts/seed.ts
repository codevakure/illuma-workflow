/**
 * Seed script — creates a test user and default workspace for local development.
 *
 * Usage:
 *   bun run apps/api/src/scripts/seed.ts
 *
 * Requires DATABASE_URL to be set (reads from apps/api/.env or packages/db/.env).
 */

import { db, user, workspace, settings } from '@sim/db'
import { eq } from 'drizzle-orm'

const TEST_USER_ID = 'test-user-id'
const DEFAULT_WORKSPACE_ID = 'default'

async function seed() {
  console.log('Seeding database...')

  // Upsert test user
  const [existingUser] = await db.select().from(user).where(eq(user.id, TEST_USER_ID)).limit(1)

  if (!existingUser) {
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: 'Test User',
      email: 'test@test.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    console.log('Created test user: test-user-id')
  } else {
    console.log('Test user already exists')
  }

  // Upsert default workspace
  const [existingWorkspace] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, DEFAULT_WORKSPACE_ID))
    .limit(1)

  if (!existingWorkspace) {
    await db.insert(workspace).values({
      id: DEFAULT_WORKSPACE_ID,
      name: 'Default Workspace',
      ownerId: TEST_USER_ID,
      billedAccountUserId: TEST_USER_ID,
    })
    console.log('Created default workspace')
  } else {
    console.log('Default workspace already exists')
  }

  // Upsert default settings
  const [existingSettings] = await db
    .select()
    .from(settings)
    .where(eq(settings.userId, TEST_USER_ID))
    .limit(1)

  if (!existingSettings) {
    await db.insert(settings).values({
      id: TEST_USER_ID,
      userId: TEST_USER_ID,
      theme: 'dark',
      autoConnect: true,
      telemetryEnabled: true,
      emailPreferences: {},
    })
    console.log('Created default settings')
  } else {
    console.log('Default settings already exist')
  }

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
