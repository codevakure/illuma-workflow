import { Hono } from 'hono'
import { db } from '@sim/db'
import {
  credentialSet,
  credentialSetMember,
  credentialSetInvitation,
  user,
  organization,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, desc, sql } from 'drizzle-orm'
import { getUserId, type AuthContext } from '@/middleware/auth'

const logger = createLogger('CredentialSetRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * GET /
 * Lists credential sets for the workspace/organization.
 * Returns creator info and member count for each set.
 *
 * Query params:
 *   - organizationId: filter by organization
 *   - workspaceId: alias for organizationId (legacy compat)
 */
app.get('/', async (c) => {
  const userId = getUserId(c)
  const organizationId = c.req.query('organizationId') ?? c.req.query('workspaceId')

  try {
    const creatorUser = db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .as('creator_user')

    const memberCountSq = db
      .select({
        credentialSetId: credentialSetMember.credentialSetId,
        count: sql<number>`count(*)`.as('member_count'),
      })
      .from(credentialSetMember)
      .where(eq(credentialSetMember.status, 'active'))
      .groupBy(credentialSetMember.credentialSetId)
      .as('member_count_sq')

    const conditions = organizationId
      ? and(
          eq(credentialSet.organizationId, organizationId),
          eq(credentialSet.createdBy, userId)
        )
      : eq(credentialSet.createdBy, userId)

    const results = await db
      .select({
        id: credentialSet.id,
        name: credentialSet.name,
        description: credentialSet.description,
        providerId: credentialSet.providerId,
        createdBy: credentialSet.createdBy,
        createdAt: credentialSet.createdAt,
        updatedAt: credentialSet.updatedAt,
        creatorName: creatorUser.name,
        creatorEmail: creatorUser.email,
        memberCount: sql<number>`coalesce(${memberCountSq.count}, 0)`,
      })
      .from(credentialSet)
      .leftJoin(creatorUser, eq(credentialSet.createdBy, creatorUser.id))
      .leftJoin(memberCountSq, eq(credentialSet.id, memberCountSq.credentialSetId))
      .where(conditions)
      .orderBy(desc(credentialSet.createdAt))

    logger.info(`Listed ${results.length} credential sets for user ${userId}`)
    return c.json({ credentialSets: results })
  } catch (error) {
    logger.error('Error listing credential sets', error)
    return c.json({ error: 'Failed to list credential sets' }, 500)
  }
})

/**
 * POST /
 * Creates a new credential set.
 * Also adds the creator as an active member.
 *
 * Body: { name, description?, providerId, organizationId }
 */
app.post('/', async (c) => {
  const userId = getUserId(c)

  try {
    const body = await c.req.json()
    const { name, description, providerId, organizationId } = body

    if (!name) {
      return c.json({ error: 'name is required' }, 400)
    }
    if (!providerId) {
      return c.json({ error: 'providerId is required' }, 400)
    }
    if (!organizationId) {
      return c.json({ error: 'organizationId is required' }, 400)
    }

    const id = crypto.randomUUID()
    const now = new Date()

    const [created] = await db
      .insert(credentialSet)
      .values({
        id,
        organizationId,
        name,
        description: description ?? null,
        providerId,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    // Add creator as an active member
    await db.insert(credentialSetMember).values({
      id: crypto.randomUUID(),
      credentialSetId: id,
      userId,
      status: 'active',
      joinedAt: now,
      invitedBy: userId,
      createdAt: now,
      updatedAt: now,
    })

    logger.info(`Created credential set ${id} for user ${userId}`)
    return c.json({ credentialSet: created }, 201)
  } catch (error: unknown) {
    const dbError = error as { code?: string }
    if (dbError.code === '23505') {
      return c.json(
        { error: 'A credential set with this name already exists in the organization' },
        409
      )
    }
    logger.error('Error creating credential set', error)
    return c.json({ error: 'Failed to create credential set' }, 500)
  }
})

/**
 * GET /invitations
 * Returns pending invitations for the authenticated user (by email).
 * Joins credential set, organization, and inviter info.
 */
app.get('/invitations', async (c) => {
  const userId = getUserId(c)

  try {
    // Look up the user's email
    const [currentUser] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!currentUser) {
      return c.json({ invitations: [] })
    }

    const inviterUser = db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .as('inviter_user')

    const results = await db
      .select({
        invitationId: credentialSetInvitation.id,
        token: credentialSetInvitation.token,
        status: credentialSetInvitation.status,
        expiresAt: credentialSetInvitation.expiresAt,
        createdAt: credentialSetInvitation.createdAt,
        credentialSetId: credentialSet.id,
        credentialSetName: credentialSet.name,
        providerId: credentialSet.providerId,
        organizationId: organization.id,
        organizationName: organization.name,
        invitedByName: inviterUser.name,
        invitedByEmail: inviterUser.email,
      })
      .from(credentialSetInvitation)
      .innerJoin(credentialSet, eq(credentialSetInvitation.credentialSetId, credentialSet.id))
      .innerJoin(organization, eq(credentialSet.organizationId, organization.id))
      .leftJoin(inviterUser, eq(credentialSetInvitation.invitedBy, inviterUser.id))
      .where(
        and(
          eq(credentialSetInvitation.email, currentUser.email),
          eq(credentialSetInvitation.status, 'pending'),
          sql`${credentialSetInvitation.expiresAt} > now()`
        )
      )
      .orderBy(desc(credentialSetInvitation.createdAt))

    logger.info(`Listed ${results.length} pending invitations for user ${userId}`)
    return c.json({ invitations: results })
  } catch (error) {
    logger.error('Error listing invitations', error)
    return c.json({ error: 'Failed to list invitations' }, 500)
  }
})

/**
 * GET /memberships
 * Returns active credential set memberships for the authenticated user.
 * Joins credential set and organization info.
 */
app.get('/memberships', async (c) => {
  const userId = getUserId(c)

  try {
    const results = await db
      .select({
        membershipId: credentialSetMember.id,
        status: credentialSetMember.status,
        joinedAt: credentialSetMember.joinedAt,
        credentialSetId: credentialSet.id,
        credentialSetName: credentialSet.name,
        credentialSetDescription: credentialSet.description,
        providerId: credentialSet.providerId,
        organizationId: organization.id,
        organizationName: organization.name,
      })
      .from(credentialSetMember)
      .innerJoin(credentialSet, eq(credentialSetMember.credentialSetId, credentialSet.id))
      .innerJoin(organization, eq(credentialSet.organizationId, organization.id))
      .where(
        and(eq(credentialSetMember.userId, userId), eq(credentialSetMember.status, 'active'))
      )
      .orderBy(desc(credentialSetMember.createdAt))

    logger.info(`Listed ${results.length} memberships for user ${userId}`)
    return c.json({ memberships: results })
  } catch (error) {
    logger.error('Error listing memberships', error)
    return c.json({ error: 'Failed to list memberships' }, 500)
  }
})

/**
 * DELETE /memberships
 * Leave a credential set. Removes the user's membership.
 *
 * Query/body: { credentialSetId }
 */
app.delete('/memberships', async (c) => {
  const userId = getUserId(c)

  try {
    let credentialSetId = c.req.query('credentialSetId')
    if (!credentialSetId) {
      const body = await c.req.json().catch(() => ({}))
      credentialSetId = (body as { credentialSetId?: string }).credentialSetId
    }

    if (!credentialSetId) {
      return c.json({ error: 'credentialSetId is required' }, 400)
    }

    // Verify the user is not the owner (creator) of the credential set
    const [set] = await db
      .select({ createdBy: credentialSet.createdBy })
      .from(credentialSet)
      .where(eq(credentialSet.id, credentialSetId))
      .limit(1)

    if (set && set.createdBy === userId) {
      return c.json({ error: 'Cannot leave a credential set you own. Delete it instead.' }, 400)
    }

    const deleted = await db
      .delete(credentialSetMember)
      .where(
        and(
          eq(credentialSetMember.credentialSetId, credentialSetId),
          eq(credentialSetMember.userId, userId)
        )
      )
      .returning()

    if (deleted.length === 0) {
      return c.json({ error: 'Membership not found' }, 404)
    }

    logger.info(`User ${userId} left credential set ${credentialSetId}`)
    return c.json({ success: true })
  } catch (error) {
    logger.error('Error leaving credential set', error)
    return c.json({ error: 'Failed to leave credential set' }, 500)
  }
})

/**
 * POST /invite/:token
 * Accept a credential set invitation by token.
 * Creates an active membership and marks the invitation as accepted.
 */
app.post('/invite/:token', async (c) => {
  const userId = getUserId(c)
  const token = c.req.param('token')

  try {
    // Find the pending invitation by token
    const [invitation] = await db
      .select()
      .from(credentialSetInvitation)
      .where(
        and(
          eq(credentialSetInvitation.token, token),
          eq(credentialSetInvitation.status, 'pending'),
          sql`${credentialSetInvitation.expiresAt} > now()`
        )
      )
      .limit(1)

    if (!invitation) {
      return c.json({ error: 'Invitation not found, expired, or already used' }, 404)
    }

    const now = new Date()

    // Mark invitation as accepted
    await db
      .update(credentialSetInvitation)
      .set({
        status: 'accepted',
        acceptedAt: now,
        acceptedByUserId: userId,
      })
      .where(eq(credentialSetInvitation.id, invitation.id))

    // Create or update the membership
    const existingMember = await db
      .select()
      .from(credentialSetMember)
      .where(
        and(
          eq(credentialSetMember.credentialSetId, invitation.credentialSetId),
          eq(credentialSetMember.userId, userId)
        )
      )
      .limit(1)

    if (existingMember.length > 0) {
      // Reactivate existing membership
      await db
        .update(credentialSetMember)
        .set({
          status: 'active',
          joinedAt: now,
          updatedAt: now,
        })
        .where(eq(credentialSetMember.id, existingMember[0].id))
    } else {
      // Create new membership
      await db.insert(credentialSetMember).values({
        id: crypto.randomUUID(),
        credentialSetId: invitation.credentialSetId,
        userId,
        status: 'active',
        joinedAt: now,
        invitedBy: invitation.invitedBy,
        createdAt: now,
        updatedAt: now,
      })
    }

    logger.info(
      `User ${userId} accepted invitation ${invitation.id} for credential set ${invitation.credentialSetId}`
    )
    return c.json({ success: true })
  } catch (error: unknown) {
    const dbError = error as { code?: string }
    if (dbError.code === '23505') {
      return c.json({ error: 'You are already a member of this credential set' }, 409)
    }
    logger.error('Error accepting invitation', error)
    return c.json({ error: 'Failed to accept invitation' }, 500)
  }
})

/**
 * GET /:id
 * Returns a single credential set by ID with creator info and member count.
 * Accessible by the owner or active members.
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    const creatorUser = db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .as('creator_user')

    const memberCountSq = db
      .select({
        credentialSetId: credentialSetMember.credentialSetId,
        count: sql<number>`count(*)`.as('member_count'),
      })
      .from(credentialSetMember)
      .where(eq(credentialSetMember.status, 'active'))
      .groupBy(credentialSetMember.credentialSetId)
      .as('member_count_sq')

    const [result] = await db
      .select({
        id: credentialSet.id,
        name: credentialSet.name,
        description: credentialSet.description,
        providerId: credentialSet.providerId,
        createdBy: credentialSet.createdBy,
        createdAt: credentialSet.createdAt,
        updatedAt: credentialSet.updatedAt,
        creatorName: creatorUser.name,
        creatorEmail: creatorUser.email,
        memberCount: sql<number>`coalesce(${memberCountSq.count}, 0)`,
      })
      .from(credentialSet)
      .leftJoin(creatorUser, eq(credentialSet.createdBy, creatorUser.id))
      .leftJoin(memberCountSq, eq(credentialSet.id, memberCountSq.credentialSetId))
      .where(eq(credentialSet.id, id))
      .limit(1)

    if (!result) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    // Verify access: must be owner or active member
    if (result.createdBy !== userId) {
      const [membership] = await db
        .select()
        .from(credentialSetMember)
        .where(
          and(
            eq(credentialSetMember.credentialSetId, id),
            eq(credentialSetMember.userId, userId),
            eq(credentialSetMember.status, 'active')
          )
        )
        .limit(1)

      if (!membership) {
        return c.json({ error: 'Credential set not found' }, 404)
      }
    }

    return c.json({ credentialSet: result })
  } catch (error) {
    logger.error(`Error getting credential set ${id}`, error)
    return c.json({ error: 'Failed to get credential set' }, 500)
  }
})

/**
 * PUT /:id
 * Updates a credential set (name, description).
 * Only the owner (creator) can update.
 */
app.put('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    const body = await c.req.json()
    const { name, description } = body

    // Verify ownership
    const [existing] = await db
      .select()
      .from(credentialSet)
      .where(and(eq(credentialSet.id, id), eq(credentialSet.createdBy, userId)))
      .limit(1)

    if (!existing) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    }
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description

    const [updated] = await db
      .update(credentialSet)
      .set(updates)
      .where(eq(credentialSet.id, id))
      .returning()

    logger.info(`Updated credential set ${id} for user ${userId}`)
    return c.json({ credentialSet: updated })
  } catch (error: unknown) {
    const dbError = error as { code?: string }
    if (dbError.code === '23505') {
      return c.json(
        { error: 'A credential set with this name already exists in the organization' },
        409
      )
    }
    logger.error(`Error updating credential set ${id}`, error)
    return c.json({ error: 'Failed to update credential set' }, 500)
  }
})

/**
 * PATCH /:id
 * Partial update of a credential set (name, description, providerId).
 * Only the owner (creator) can update.
 */
app.patch('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    const body = await c.req.json()
    const { name, description, providerId } = body

    // Verify ownership
    const [existing] = await db
      .select()
      .from(credentialSet)
      .where(and(eq(credentialSet.id, id), eq(credentialSet.createdBy, userId)))
      .limit(1)

    if (!existing) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    }
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (providerId !== undefined) updates.providerId = providerId

    const [updated] = await db
      .update(credentialSet)
      .set(updates)
      .where(eq(credentialSet.id, id))
      .returning()

    logger.info(`Updated credential set ${id} for user ${userId}`)
    return c.json({ credentialSet: updated })
  } catch (error: unknown) {
    const dbError = error as { code?: string }
    if (dbError.code === '23505') {
      return c.json(
        { error: 'A credential set with this name already exists in the organization' },
        409
      )
    }
    logger.error(`Error updating credential set ${id}`, error)
    return c.json({ error: 'Failed to update credential set' }, 500)
  }
})

/**
 * DELETE /:id
 * Deletes a credential set and all associated members/invitations (via cascade).
 * Only the owner (creator) can delete.
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    // Verify ownership
    const [existing] = await db
      .select()
      .from(credentialSet)
      .where(and(eq(credentialSet.id, id), eq(credentialSet.createdBy, userId)))
      .limit(1)

    if (!existing) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    // Members and invitations are cascade-deleted by the DB
    await db.delete(credentialSet).where(eq(credentialSet.id, id))

    logger.info(`Deleted credential set ${id} for user ${userId}`)
    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting credential set ${id}`, error)
    return c.json({ error: 'Failed to delete credential set' }, 500)
  }
})

/**
 * GET /:id/members
 * Lists active members of a credential set.
 * Returns user info (name, email, image) for each member.
 * Only the owner or an active member can view.
 */
app.get('/:id/members', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    // Verify access: must be owner or active member
    const [set] = await db
      .select({ createdBy: credentialSet.createdBy })
      .from(credentialSet)
      .where(eq(credentialSet.id, id))
      .limit(1)

    if (!set) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    if (set.createdBy !== userId) {
      const [membership] = await db
        .select()
        .from(credentialSetMember)
        .where(
          and(
            eq(credentialSetMember.credentialSetId, id),
            eq(credentialSetMember.userId, userId),
            eq(credentialSetMember.status, 'active')
          )
        )
        .limit(1)

      if (!membership) {
        return c.json({ error: 'Credential set not found' }, 404)
      }
    }

    const memberUser = db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(user)
      .as('member_user')

    const members = await db
      .select({
        id: credentialSetMember.id,
        userId: credentialSetMember.userId,
        status: credentialSetMember.status,
        joinedAt: credentialSetMember.joinedAt,
        createdAt: credentialSetMember.createdAt,
        userName: memberUser.name,
        userEmail: memberUser.email,
        userImage: memberUser.image,
      })
      .from(credentialSetMember)
      .innerJoin(memberUser, eq(credentialSetMember.userId, memberUser.id))
      .where(
        and(
          eq(credentialSetMember.credentialSetId, id),
          eq(credentialSetMember.status, 'active')
        )
      )
      .orderBy(credentialSetMember.createdAt)

    // The frontend expects a `credentials` array per member.
    // Since there is no per-member credential table in the current schema,
    // return an empty array for now.
    const membersWithCredentials = members.map((m) => ({
      ...m,
      credentials: [] as { providerId: string; accountId: string }[],
    }))

    return c.json({ members: membersWithCredentials })
  } catch (error) {
    logger.error(`Error listing members for credential set ${id}`, error)
    return c.json({ error: 'Failed to list members' }, 500)
  }
})

/**
 * DELETE /:id/members
 * Removes a member from a credential set.
 * Only the owner (creator) can remove members.
 *
 * Query: memberId
 */
app.delete('/:id/members', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.query('memberId')

  if (!memberId) {
    return c.json({ error: 'memberId query parameter is required' }, 400)
  }

  try {
    // Verify ownership
    const [set] = await db
      .select({ createdBy: credentialSet.createdBy })
      .from(credentialSet)
      .where(eq(credentialSet.id, id))
      .limit(1)

    if (!set) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    if (set.createdBy !== userId) {
      return c.json({ error: 'Only the credential set owner can remove members' }, 403)
    }

    // Prevent removing yourself (the owner)
    const [member] = await db
      .select()
      .from(credentialSetMember)
      .where(eq(credentialSetMember.id, memberId))
      .limit(1)

    if (!member) {
      return c.json({ error: 'Member not found' }, 404)
    }

    if (member.userId === userId) {
      return c.json({ error: 'Cannot remove yourself. Delete the credential set instead.' }, 400)
    }

    await db.delete(credentialSetMember).where(eq(credentialSetMember.id, memberId))

    logger.info(`Removed member ${memberId} from credential set ${id}`)
    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error removing member from credential set ${id}`, error)
    return c.json({ error: 'Failed to remove member' }, 500)
  }
})

/**
 * POST /:id/invite
 * Creates an invitation to join a credential set.
 * Only the owner (creator) can invite.
 *
 * Body: { email? }
 */
app.post('/:id/invite', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    // Verify ownership
    const [set] = await db
      .select({ createdBy: credentialSet.createdBy })
      .from(credentialSet)
      .where(eq(credentialSet.id, id))
      .limit(1)

    if (!set) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    if (set.createdBy !== userId) {
      return c.json({ error: 'Only the credential set owner can create invitations' }, 403)
    }

    const body = await c.req.json().catch(() => ({}))
    const { email } = body as { email?: string }

    // If email provided, check if user is already a member
    if (email) {
      const [existingUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1)

      if (existingUser) {
        const [existingMember] = await db
          .select()
          .from(credentialSetMember)
          .where(
            and(
              eq(credentialSetMember.credentialSetId, id),
              eq(credentialSetMember.userId, existingUser.id),
              eq(credentialSetMember.status, 'active')
            )
          )
          .limit(1)

        if (existingMember) {
          return c.json({ error: 'User is already a member of this credential set' }, 409)
        }
      }

      // Check for existing pending invitation to the same email
      const [existingInvitation] = await db
        .select()
        .from(credentialSetInvitation)
        .where(
          and(
            eq(credentialSetInvitation.credentialSetId, id),
            eq(credentialSetInvitation.email, email),
            eq(credentialSetInvitation.status, 'pending'),
            sql`${credentialSetInvitation.expiresAt} > now()`
          )
        )
        .limit(1)

      if (existingInvitation) {
        return c.json(
          { error: 'A pending invitation already exists for this email' },
          409
        )
      }
    }

    const token = crypto.randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const [invitation] = await db
      .insert(credentialSetInvitation)
      .values({
        id: crypto.randomUUID(),
        credentialSetId: id,
        email: email ?? null,
        token,
        invitedBy: userId,
        status: 'pending',
        expiresAt,
        createdAt: now,
      })
      .returning()

    logger.info(`Created invitation for credential set ${id} by user ${userId}`)
    return c.json({ invitation }, 201)
  } catch (error) {
    logger.error(`Error creating invitation for credential set ${id}`, error)
    return c.json({ error: 'Failed to create invitation' }, 500)
  }
})

/**
 * GET /:id/invite
 * Lists invitations for a credential set.
 * Only the owner (creator) can view.
 */
app.get('/:id/invite', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    // Verify ownership
    const [set] = await db
      .select({ createdBy: credentialSet.createdBy })
      .from(credentialSet)
      .where(eq(credentialSet.id, id))
      .limit(1)

    if (!set) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    if (set.createdBy !== userId) {
      return c.json({ error: 'Only the credential set owner can view invitations' }, 403)
    }

    const invitations = await db
      .select()
      .from(credentialSetInvitation)
      .where(eq(credentialSetInvitation.credentialSetId, id))
      .orderBy(desc(credentialSetInvitation.createdAt))

    return c.json({ invitations })
  } catch (error) {
    logger.error(`Error listing invitations for credential set ${id}`, error)
    return c.json({ error: 'Failed to list invitations' }, 500)
  }
})

/**
 * POST /:id/invite/:invitationId
 * Resend an invitation (resets expiry).
 * Only the owner (creator) can resend.
 */
app.post('/:id/invite/:invitationId', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const invitationId = c.req.param('invitationId')

  try {
    // Verify ownership
    const [set] = await db
      .select({ createdBy: credentialSet.createdBy })
      .from(credentialSet)
      .where(eq(credentialSet.id, id))
      .limit(1)

    if (!set) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    if (set.createdBy !== userId) {
      return c.json({ error: 'Only the credential set owner can resend invitations' }, 403)
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const [updated] = await db
      .update(credentialSetInvitation)
      .set({
        status: 'pending',
        expiresAt,
      })
      .where(
        and(
          eq(credentialSetInvitation.id, invitationId),
          eq(credentialSetInvitation.credentialSetId, id)
        )
      )
      .returning()

    if (!updated) {
      return c.json({ error: 'Invitation not found' }, 404)
    }

    logger.info(`Resent invitation ${invitationId} for credential set ${id}`)
    return c.json({ invitation: updated })
  } catch (error) {
    logger.error(`Error resending invitation ${invitationId}`, error)
    return c.json({ error: 'Failed to resend invitation' }, 500)
  }
})

/**
 * DELETE /:id/invite
 * Cancels an invitation for a credential set.
 * Only the owner (creator) can cancel.
 *
 * Query: invitationId
 */
app.delete('/:id/invite', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const invitationId = c.req.query('invitationId')

  if (!invitationId) {
    return c.json({ error: 'invitationId query parameter is required' }, 400)
  }

  try {
    // Verify ownership
    const [set] = await db
      .select({ createdBy: credentialSet.createdBy })
      .from(credentialSet)
      .where(eq(credentialSet.id, id))
      .limit(1)

    if (!set) {
      return c.json({ error: 'Credential set not found' }, 404)
    }

    if (set.createdBy !== userId) {
      return c.json({ error: 'Only the credential set owner can cancel invitations' }, 403)
    }

    const [updated] = await db
      .update(credentialSetInvitation)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(credentialSetInvitation.id, invitationId),
          eq(credentialSetInvitation.credentialSetId, id),
          eq(credentialSetInvitation.status, 'pending')
        )
      )
      .returning()

    if (!updated) {
      return c.json({ error: 'Invitation not found or already cancelled' }, 404)
    }

    logger.info(`Cancelled invitation ${invitationId} for credential set ${id}`)
    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error cancelling invitation ${invitationId}`, error)
    return c.json({ error: 'Failed to cancel invitation' }, 500)
  }
})

export { app as credentialSetRoutes }
