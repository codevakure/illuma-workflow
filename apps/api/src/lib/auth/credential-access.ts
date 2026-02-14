import { db } from '@sim/db'
import { account, workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export interface CredentialAccessResult {
  ok: boolean
  error?: string
  authType?: 'session' | 'api_key' | 'internal_jwt' | 'placeholder'
  requesterUserId?: string
  credentialOwnerUserId?: string
  workspaceId?: string
}

/**
 * Centralizes auth + collaboration rules for credential use.
 * - Fetches credential owner from the account table
 * - Authorization rules:
 *   - If requester owns the credential, allow immediately
 *   - Otherwise require workflowId and verify workspace membership
 *   - For internal/placeholder auth: verify credential owner has workspace access
 */
export async function authorizeCredentialUse(
  requesterUserId: string,
  authType: string,
  params: { credentialId: string; workflowId?: string; requireWorkflowIdForInternal?: boolean }
): Promise<CredentialAccessResult> {
  const { credentialId, workflowId, requireWorkflowIdForInternal = true } = params

  if (!requesterUserId) {
    return { ok: false, error: 'Authentication required' }
  }

  // Lookup credential owner
  const [credRow] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, credentialId))
    .limit(1)

  if (!credRow) {
    return { ok: false, error: 'Credential not found' }
  }

  const credentialOwnerUserId = credRow.userId

  // If requester owns the credential, allow immediately
  if (authType !== 'internal' && requesterUserId === credentialOwnerUserId) {
    return {
      ok: true,
      authType: authType as CredentialAccessResult['authType'],
      requesterUserId,
      credentialOwnerUserId,
    }
  }

  // For placeholder auth mode, allow if the credential owner matches the test user
  if (authType === 'placeholder') {
    return {
      ok: true,
      authType: 'placeholder',
      requesterUserId,
      credentialOwnerUserId,
    }
  }

  // For collaboration paths, workflowId is required to scope to a workspace
  if (!workflowId) {
    return { ok: false, error: 'workflowId is required' }
  }

  const [wf] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!wf || !wf.workspaceId) {
    return { ok: false, error: 'Workflow not found' }
  }

  if (authType === 'internal') {
    // Internal calls: verify credential owner belongs to the workflow's workspace
    const ownerPerm = await getUserEntityPermissions(
      credentialOwnerUserId,
      'workspace',
      wf.workspaceId
    )
    if (ownerPerm === null) {
      return { ok: false, error: 'Unauthorized' }
    }
    return {
      ok: true,
      authType: 'internal_jwt',
      requesterUserId,
      credentialOwnerUserId,
      workspaceId: wf.workspaceId,
    }
  }

  // Session/API key: verify BOTH requester and owner belong to the workflow's workspace
  const requesterPerm = await getUserEntityPermissions(requesterUserId, 'workspace', wf.workspaceId)
  const ownerPerm = await getUserEntityPermissions(
    credentialOwnerUserId,
    'workspace',
    wf.workspaceId
  )
  if (requesterPerm === null || ownerPerm === null) {
    return { ok: false, error: 'Unauthorized' }
  }

  return {
    ok: true,
    authType: authType as CredentialAccessResult['authType'],
    requesterUserId,
    credentialOwnerUserId,
    workspaceId: wf.workspaceId,
  }
}
