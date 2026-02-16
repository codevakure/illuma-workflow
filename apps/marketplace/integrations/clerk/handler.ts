import type { ToolHandler } from '../../sdk/types'

const CLERK_API_BASE = 'https://api.clerk.com/v1'

async function clerkRequest(
  secretKey: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; headers: Record<string, string> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  }

  const opts: RequestInit = { method, headers }
  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    opts.body = JSON.stringify(body)
  }

  const response = await fetch(`${CLERK_API_BASE}${path}`, opts)

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value
  })

  if (method === 'DELETE' && response.ok) {
    const data = await response.json().catch(() => ({}))
    return { ok: true, data, headers: responseHeaders }
  }

  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, data, headers: responseHeaders }
}

function getSecretKey(params: Record<string, unknown>): string {
  return (params.secretKey as string) || ''
}

function errMsg(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const firstError = obj.errors[0] as Record<string, unknown>
      if (firstError.message) return firstError.message as string
    }
    if (obj.message) return obj.message as string
  }
  return fallback
}

function transformUser(user: Record<string, unknown>): Record<string, unknown> {
  const emailAddresses = (user.email_addresses as Array<Record<string, unknown>> ?? []).map((email) => ({
    id: email.id,
    emailAddress: email.email_address,
    verified: (email.verification as Record<string, unknown>)?.status === 'verified',
  }))
  const phoneNumbers = (user.phone_numbers as Array<Record<string, unknown>> ?? []).map((phone) => ({
    id: phone.id,
    phoneNumber: phone.phone_number,
    verified: (phone.verification as Record<string, unknown>)?.status === 'verified',
  }))

  return {
    id: user.id,
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    imageUrl: user.image_url ?? null,
    hasImage: user.has_image ?? false,
    primaryEmailAddressId: user.primary_email_address_id ?? null,
    primaryPhoneNumberId: user.primary_phone_number_id ?? null,
    primaryWeb3WalletId: user.primary_web3_wallet_id ?? null,
    emailAddresses,
    phoneNumbers,
    externalId: user.external_id ?? null,
    passwordEnabled: user.password_enabled ?? false,
    twoFactorEnabled: user.two_factor_enabled ?? false,
    totpEnabled: user.totp_enabled ?? false,
    backupCodeEnabled: user.backup_code_enabled ?? false,
    banned: user.banned ?? false,
    locked: user.locked ?? false,
    deleteSelfEnabled: user.delete_self_enabled ?? false,
    createOrganizationEnabled: user.create_organization_enabled ?? false,
    lastSignInAt: user.last_sign_in_at ?? null,
    lastActiveAt: user.last_active_at ?? null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    publicMetadata: user.public_metadata ?? {},
    privateMetadata: user.private_metadata ?? {},
    unsafeMetadata: user.unsafe_metadata ?? {},
  }
}

function transformUserList(user: Record<string, unknown>): Record<string, unknown> {
  const emailAddresses = (user.email_addresses as Array<Record<string, unknown>> ?? []).map((email) => ({
    id: email.id,
    emailAddress: email.email_address,
  }))
  const phoneNumbers = (user.phone_numbers as Array<Record<string, unknown>> ?? []).map((phone) => ({
    id: phone.id,
    phoneNumber: phone.phone_number,
  }))

  return {
    id: user.id,
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    imageUrl: user.image_url ?? null,
    hasImage: user.has_image ?? false,
    primaryEmailAddressId: user.primary_email_address_id ?? null,
    primaryPhoneNumberId: user.primary_phone_number_id ?? null,
    emailAddresses,
    phoneNumbers,
    externalId: user.external_id ?? null,
    passwordEnabled: user.password_enabled ?? false,
    twoFactorEnabled: user.two_factor_enabled ?? false,
    banned: user.banned ?? false,
    locked: user.locked ?? false,
    lastSignInAt: user.last_sign_in_at ?? null,
    lastActiveAt: user.last_active_at ?? null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    publicMetadata: user.public_metadata ?? {},
  }
}

function transformOrganization(org: Record<string, unknown>): Record<string, unknown> {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug ?? null,
    imageUrl: org.image_url ?? null,
    hasImage: org.has_image ?? false,
    membersCount: org.members_count ?? null,
    pendingInvitationsCount: org.pending_invitations_count ?? null,
    maxAllowedMemberships: org.max_allowed_memberships ?? 0,
    adminDeleteEnabled: org.admin_delete_enabled ?? false,
    createdBy: org.created_by ?? null,
    createdAt: org.created_at,
    updatedAt: org.updated_at,
    publicMetadata: org.public_metadata ?? {},
  }
}

function transformSession(session: Record<string, unknown>): Record<string, unknown> {
  return {
    id: session.id,
    userId: session.user_id,
    clientId: session.client_id,
    status: session.status,
    lastActiveAt: session.last_active_at ?? null,
    lastActiveOrganizationId: session.last_active_organization_id ?? null,
    expireAt: session.expire_at ?? null,
    abandonAt: session.abandon_at ?? null,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  }
}

function appendCommaSeparatedParams(sp: URLSearchParams, key: string, value: string): void {
  value.split(',').forEach((v) => {
    const trimmed = v.trim()
    if (trimmed) sp.append(key, trimmed)
  })
}

const handler: ToolHandler = {
  operations: {
    clerk_list_users: async (params) => {
      const secretKey = getSecretKey(params)
      if (!secretKey) return { success: false, output: {}, error: 'Missing required parameter: secretKey' }

      const sp = new URLSearchParams()
      if (params.limit) sp.set('limit', String(params.limit))
      if (params.offset) sp.set('offset', String(params.offset))
      if (params.orderBy) sp.set('order_by', String(params.orderBy))
      if (params.query) sp.set('query', String(params.query))
      if (params.emailAddress) appendCommaSeparatedParams(sp, 'email_address', String(params.emailAddress))
      if (params.phoneNumber) appendCommaSeparatedParams(sp, 'phone_number', String(params.phoneNumber))
      if (params.externalId) appendCommaSeparatedParams(sp, 'external_id', String(params.externalId))
      if (params.username) appendCommaSeparatedParams(sp, 'username', String(params.username))
      if (params.userId) appendCommaSeparatedParams(sp, 'user_id', String(params.userId))

      const qs = sp.toString()
      const path = qs ? `/users?${qs}` : '/users'

      const { ok, data, headers } = await clerkRequest(secretKey, 'GET', path)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to list users') }

      const totalCount = parseInt(headers['x-total-count'] || '0', 10)
      const users = Array.isArray(data) ? data.map((u: Record<string, unknown>) => transformUserList(u)) : []

      return { success: true, output: { users, totalCount: totalCount || users.length } }
    },

    clerk_get_user: async (params) => {
      const secretKey = getSecretKey(params)
      const userId = (params.userId as string || '').trim()
      if (!secretKey || !userId) return { success: false, output: {}, error: 'Missing required parameters: secretKey, userId' }

      const { ok, data } = await clerkRequest(secretKey, 'GET', `/users/${encodeURIComponent(userId)}`)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to get user') }

      return { success: true, output: transformUser(data as Record<string, unknown>) }
    },

    clerk_create_user: async (params) => {
      const secretKey = getSecretKey(params)
      if (!secretKey) return { success: false, output: {}, error: 'Missing required parameter: secretKey' }

      const body: Record<string, unknown> = {}

      if (params.emailAddress) {
        const emailStr = String(params.emailAddress)
        body.email_address = emailStr.split(',').map((e) => e.trim())
      }
      if (params.phoneNumber) {
        const phoneStr = String(params.phoneNumber)
        body.phone_number = phoneStr.split(',').map((p) => p.trim())
      }
      if (params.username) body.username = String(params.username).trim()
      if (params.password) body.password = params.password
      if (params.firstName) body.first_name = String(params.firstName).trim()
      if (params.lastName) body.last_name = String(params.lastName).trim()
      if (params.externalId) body.external_id = String(params.externalId).trim()
      if (params.publicMetadata) body.public_metadata = params.publicMetadata
      if (params.privateMetadata) body.private_metadata = params.privateMetadata
      if (params.unsafeMetadata) body.unsafe_metadata = params.unsafeMetadata
      if (params.skipPasswordChecks !== undefined) body.skip_password_checks = params.skipPasswordChecks
      if (params.skipPasswordRequirement !== undefined) body.skip_password_requirement = params.skipPasswordRequirement

      const { ok, data } = await clerkRequest(secretKey, 'POST', '/users', body)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to create user') }

      const user = data as Record<string, unknown>
      const emailAddresses = (user.email_addresses as Array<Record<string, unknown>> ?? []).map((email) => ({
        id: email.id,
        emailAddress: email.email_address,
        verified: (email.verification as Record<string, unknown>)?.status === 'verified',
      }))
      const phoneNumbers = (user.phone_numbers as Array<Record<string, unknown>> ?? []).map((phone) => ({
        id: phone.id,
        phoneNumber: phone.phone_number,
        verified: (phone.verification as Record<string, unknown>)?.status === 'verified',
      }))

      return {
        success: true,
        output: {
          id: user.id,
          username: user.username ?? null,
          firstName: user.first_name ?? null,
          lastName: user.last_name ?? null,
          imageUrl: user.image_url ?? null,
          primaryEmailAddressId: user.primary_email_address_id ?? null,
          primaryPhoneNumberId: user.primary_phone_number_id ?? null,
          emailAddresses,
          phoneNumbers,
          externalId: user.external_id ?? null,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
          publicMetadata: user.public_metadata ?? {},
        },
      }
    },

    clerk_update_user: async (params) => {
      const secretKey = getSecretKey(params)
      const userId = (params.userId as string || '').trim()
      if (!secretKey || !userId) return { success: false, output: {}, error: 'Missing required parameters: secretKey, userId' }

      const body: Record<string, unknown> = {}
      if (params.firstName !== undefined) body.first_name = params.firstName ? String(params.firstName).trim() : params.firstName
      if (params.lastName !== undefined) body.last_name = params.lastName ? String(params.lastName).trim() : params.lastName
      if (params.username !== undefined) body.username = params.username ? String(params.username).trim() : params.username
      if (params.password !== undefined) body.password = params.password
      if (params.externalId !== undefined) body.external_id = params.externalId ? String(params.externalId).trim() : params.externalId
      if (params.primaryEmailAddressId !== undefined) body.primary_email_address_id = params.primaryEmailAddressId ? String(params.primaryEmailAddressId).trim() : params.primaryEmailAddressId
      if (params.primaryPhoneNumberId !== undefined) body.primary_phone_number_id = params.primaryPhoneNumberId ? String(params.primaryPhoneNumberId).trim() : params.primaryPhoneNumberId
      if (params.publicMetadata !== undefined) body.public_metadata = params.publicMetadata
      if (params.privateMetadata !== undefined) body.private_metadata = params.privateMetadata
      if (params.unsafeMetadata !== undefined) body.unsafe_metadata = params.unsafeMetadata
      if (params.skipPasswordChecks !== undefined) body.skip_password_checks = params.skipPasswordChecks

      const { ok, data } = await clerkRequest(secretKey, 'PATCH', `/users/${encodeURIComponent(userId)}`, body)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to update user') }

      const user = data as Record<string, unknown>
      const emailAddresses = (user.email_addresses as Array<Record<string, unknown>> ?? []).map((email) => ({
        id: email.id,
        emailAddress: email.email_address,
        verified: (email.verification as Record<string, unknown>)?.status === 'verified',
      }))
      const phoneNumbers = (user.phone_numbers as Array<Record<string, unknown>> ?? []).map((phone) => ({
        id: phone.id,
        phoneNumber: phone.phone_number,
        verified: (phone.verification as Record<string, unknown>)?.status === 'verified',
      }))

      return {
        success: true,
        output: {
          id: user.id,
          username: user.username ?? null,
          firstName: user.first_name ?? null,
          lastName: user.last_name ?? null,
          imageUrl: user.image_url ?? null,
          primaryEmailAddressId: user.primary_email_address_id ?? null,
          primaryPhoneNumberId: user.primary_phone_number_id ?? null,
          emailAddresses,
          phoneNumbers,
          externalId: user.external_id ?? null,
          banned: user.banned ?? false,
          locked: user.locked ?? false,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
          publicMetadata: user.public_metadata ?? {},
        },
      }
    },

    clerk_delete_user: async (params) => {
      const secretKey = getSecretKey(params)
      const userId = (params.userId as string || '').trim()
      if (!secretKey || !userId) return { success: false, output: {}, error: 'Missing required parameters: secretKey, userId' }

      const { ok, data } = await clerkRequest(secretKey, 'DELETE', `/users/${encodeURIComponent(userId)}`)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to delete user') }

      const deleteData = data as Record<string, unknown>
      return {
        success: true,
        output: {
          id: deleteData.id,
          object: deleteData.object ?? 'user',
          deleted: deleteData.deleted ?? true,
        },
      }
    },

    clerk_list_organizations: async (params) => {
      const secretKey = getSecretKey(params)
      if (!secretKey) return { success: false, output: {}, error: 'Missing required parameter: secretKey' }

      const sp = new URLSearchParams()
      if (params.limit) sp.set('limit', String(params.limit))
      if (params.offset) sp.set('offset', String(params.offset))
      if (params.includeMembersCount) sp.set('include_members_count', 'true')
      if (params.query) sp.set('query', String(params.query))
      if (params.orderBy) sp.set('order_by', String(params.orderBy))

      const qs = sp.toString()
      const path = qs ? `/organizations?${qs}` : '/organizations'

      const { ok, data } = await clerkRequest(secretKey, 'GET', path)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to list organizations') }

      const responseData = data as Record<string, unknown>
      const orgList = (responseData.data as Array<Record<string, unknown>>) ?? []
      const organizations = orgList.map((org) => transformOrganization(org))

      return {
        success: true,
        output: {
          organizations,
          totalCount: (responseData.total_count as number) ?? organizations.length,
        },
      }
    },

    clerk_get_organization: async (params) => {
      const secretKey = getSecretKey(params)
      const organizationId = (params.organizationId as string || '').trim()
      if (!secretKey || !organizationId) return { success: false, output: {}, error: 'Missing required parameters: secretKey, organizationId' }

      const { ok, data } = await clerkRequest(secretKey, 'GET', `/organizations/${encodeURIComponent(organizationId)}`)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to get organization') }

      return { success: true, output: transformOrganization(data as Record<string, unknown>) }
    },

    clerk_create_organization: async (params) => {
      const secretKey = getSecretKey(params)
      const name = (params.name as string || '').trim()
      const createdBy = (params.createdBy as string || '').trim()
      if (!secretKey || !name || !createdBy) return { success: false, output: {}, error: 'Missing required parameters: secretKey, name, createdBy' }

      const body: Record<string, unknown> = {
        name,
        created_by: createdBy,
      }
      if (params.slug) body.slug = params.slug
      if (params.maxAllowedMemberships !== undefined) body.max_allowed_memberships = params.maxAllowedMemberships
      if (params.publicMetadata) body.public_metadata = params.publicMetadata
      if (params.privateMetadata) body.private_metadata = params.privateMetadata

      const { ok, data } = await clerkRequest(secretKey, 'POST', '/organizations', body)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to create organization') }

      return { success: true, output: transformOrganization(data as Record<string, unknown>) }
    },

    clerk_list_sessions: async (params) => {
      const secretKey = getSecretKey(params)
      if (!secretKey) return { success: false, output: {}, error: 'Missing required parameter: secretKey' }

      const sp = new URLSearchParams()
      if (params.userId) sp.set('user_id', String(params.userId))
      if (params.clientId) sp.set('client_id', String(params.clientId))
      if (params.status) sp.set('status', String(params.status))
      if (params.limit) sp.set('limit', String(params.limit))
      if (params.offset) sp.set('offset', String(params.offset))

      const qs = sp.toString()
      const path = qs ? `/sessions?${qs}` : '/sessions'

      const { ok, data, headers } = await clerkRequest(secretKey, 'GET', path)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to list sessions') }

      const totalCount = parseInt(headers['x-total-count'] || '0', 10)
      const sessions = Array.isArray(data) ? data.map((s: Record<string, unknown>) => transformSession(s)) : []

      return { success: true, output: { sessions, totalCount: totalCount || sessions.length } }
    },

    clerk_get_session: async (params) => {
      const secretKey = getSecretKey(params)
      const sessionId = (params.sessionId as string || '').trim()
      if (!secretKey || !sessionId) return { success: false, output: {}, error: 'Missing required parameters: secretKey, sessionId' }

      const { ok, data } = await clerkRequest(secretKey, 'GET', `/sessions/${encodeURIComponent(sessionId)}`)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to get session') }

      return { success: true, output: transformSession(data as Record<string, unknown>) }
    },

    clerk_revoke_session: async (params) => {
      const secretKey = getSecretKey(params)
      const sessionId = (params.sessionId as string || '').trim()
      if (!secretKey || !sessionId) return { success: false, output: {}, error: 'Missing required parameters: secretKey, sessionId' }

      const { ok, data } = await clerkRequest(secretKey, 'POST', `/sessions/${encodeURIComponent(sessionId)}/revoke`)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to revoke session') }

      return { success: true, output: transformSession(data as Record<string, unknown>) }
    },
  },
}

export default handler
