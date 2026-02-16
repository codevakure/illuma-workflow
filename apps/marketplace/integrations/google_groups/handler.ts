import type { ToolHandler } from '../../sdk/types'

const ADMIN_API_BASE = 'https://admin.googleapis.com/admin/directory/v1'
const GROUPS_SETTINGS_API_BASE = 'https://www.googleapis.com/groups/v1/groups'

const SETTINGS_FIELDS = [
  'email', 'name', 'description', 'whoCanJoin', 'whoCanViewMembership', 'whoCanViewGroup',
  'whoCanPostMessage', 'allowExternalMembers', 'allowWebPosting', 'primaryLanguage',
  'isArchived', 'archiveOnly', 'messageModerationLevel', 'spamModerationLevel',
  'replyTo', 'customReplyTo', 'includeCustomFooter', 'customFooterText',
  'sendMessageDenyNotification', 'defaultMessageDenyNotificationText',
  'membersCanPostAsTheGroup', 'includeInGlobalAddressList', 'whoCanLeaveGroup',
  'whoCanContactOwner', 'favoriteRepliesOnTop', 'whoCanApproveMembers', 'whoCanBanUsers',
  'whoCanModerateMembers', 'whoCanModerateContent', 'whoCanAssistContent',
  'enableCollaborativeInbox', 'whoCanDiscoverGroup', 'defaultSender',
] as const

function extractSettingsOutput(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of SETTINGS_FIELDS) {
    out[field] = data[field] ?? null
  }
  return out
}

const handler: ToolHandler = {
  operations: {
    google_groups_create_group: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const email = params.email as string
      const name = params.name as string
      if (!accessToken || !email || !name) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, email, name' }
      }

      const body: Record<string, string> = { email, name }
      if (params.description) body.description = params.description as string

      const response = await fetch(`${ADMIN_API_BASE}/groups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to create group' }
      }

      return { success: true, output: { group: data } }
    },

    google_groups_get_group: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      if (!accessToken || !groupKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey' }
      }

      const response = await fetch(`${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to get group' }
      }

      return { success: true, output: { group: data } }
    },

    google_groups_update_group: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      if (!accessToken || !groupKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey' }
      }

      const body: Record<string, string> = {}
      if (params.name) body.name = params.name as string
      if (params.description) body.description = params.description as string
      if (params.email) body.email = params.email as string

      const response = await fetch(`${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to update group' }
      }

      return { success: true, output: { group: data } }
    },

    google_groups_delete_group: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      if (!accessToken || !groupKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey' }
      }

      const response = await fetch(`${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to delete group' }
      }

      return { success: true, output: { message: 'Group deleted successfully' } }
    },

    google_groups_list_groups: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const url = new URL(`${ADMIN_API_BASE}/groups`)
      if (params.customer) {
        url.searchParams.set('customer', params.customer as string)
      } else if (!params.domain) {
        url.searchParams.set('customer', 'my_customer')
      }
      if (params.domain) url.searchParams.set('domain', params.domain as string)
      if (params.maxResults) url.searchParams.set('maxResults', String(params.maxResults))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken as string)
      if (params.query) url.searchParams.set('query', params.query as string)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list groups' }
      }

      return { success: true, output: { groups: data.groups ?? [], nextPageToken: data.nextPageToken ?? null } }
    },

    google_groups_add_member: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      const email = params.email as string
      if (!accessToken || !groupKey || !email) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey, email' }
      }

      const response = await fetch(`${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/members`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: (params.role as string) || 'MEMBER' }),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to add member to group' }
      }

      return { success: true, output: { member: data } }
    },

    google_groups_get_member: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      const memberKey = params.memberKey as string
      if (!accessToken || !groupKey || !memberKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey, memberKey' }
      }

      const response = await fetch(
        `${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/members/${encodeURIComponent(memberKey)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      )

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to get group member' }
      }

      return { success: true, output: { member: data } }
    },

    google_groups_remove_member: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      const memberKey = params.memberKey as string
      if (!accessToken || !groupKey || !memberKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey, memberKey' }
      }

      const response = await fetch(
        `${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/members/${encodeURIComponent(memberKey)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to remove member from group' }
      }

      return { success: true, output: { message: 'Member removed successfully' } }
    },

    google_groups_update_member: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      const memberKey = params.memberKey as string
      const role = params.role as string
      if (!accessToken || !groupKey || !memberKey || !role) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey, memberKey, role' }
      }

      const response = await fetch(
        `${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/members/${encodeURIComponent(memberKey)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        }
      )

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to update member role' }
      }

      return { success: true, output: { member: data } }
    },

    google_groups_list_members: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      if (!accessToken || !groupKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey' }
      }

      const url = new URL(`${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/members`)
      if (params.maxResults) url.searchParams.set('maxResults', String(params.maxResults))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken as string)
      if (params.roles) url.searchParams.set('roles', params.roles as string)

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list group members' }
      }

      return { success: true, output: { members: data.members ?? [], nextPageToken: data.nextPageToken ?? null } }
    },

    google_groups_has_member: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = params.groupKey as string
      const memberKey = params.memberKey as string
      if (!accessToken || !groupKey || !memberKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey, memberKey' }
      }

      const response = await fetch(
        `${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/hasMember/${encodeURIComponent(memberKey)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      )

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to check membership' }
      }

      return { success: true, output: { isMember: data.isMember } }
    },

    google_groups_add_alias: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = (params.groupKey as string || '').trim()
      const alias = (params.alias as string || '').trim()
      if (!accessToken || !groupKey || !alias) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey, alias' }
      }

      const response = await fetch(`${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/aliases`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to add group alias' }
      }

      return {
        success: true,
        output: {
          id: data.id ?? null,
          primaryEmail: data.primaryEmail ?? null,
          alias: data.alias ?? null,
          kind: data.kind ?? null,
          etag: data.etag ?? null,
        },
      }
    },

    google_groups_remove_alias: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = (params.groupKey as string || '').trim()
      const alias = (params.alias as string || '').trim()
      if (!accessToken || !groupKey || !alias) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey, alias' }
      }

      const response = await fetch(
        `${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/aliases/${encodeURIComponent(alias)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>).error?.toString() ?? 'Failed to remove group alias' }
      }

      return { success: true, output: { deleted: true } }
    },

    google_groups_list_aliases: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupKey = (params.groupKey as string || '').trim()
      if (!accessToken || !groupKey) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupKey' }
      }

      const response = await fetch(`${ADMIN_API_BASE}/groups/${encodeURIComponent(groupKey)}/aliases`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list group aliases' }
      }

      return { success: true, output: { aliases: data.aliases ?? [] } }
    },

    google_groups_get_settings: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupEmail = (params.groupEmail as string || '').trim()
      if (!accessToken || !groupEmail) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupEmail' }
      }

      const response = await fetch(`${GROUPS_SETTINGS_API_BASE}/${encodeURIComponent(groupEmail)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to get group settings' }
      }

      return { success: true, output: extractSettingsOutput(data) }
    },

    google_groups_update_settings: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const groupEmail = (params.groupEmail as string || '').trim()
      if (!accessToken || !groupEmail) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, groupEmail' }
      }

      const body: Record<string, string> = {}
      for (const field of SETTINGS_FIELDS) {
        if (field === 'email') continue
        if (params[field] !== undefined) body[field] = params[field] as string
      }

      const response = await fetch(`${GROUPS_SETTINGS_API_BASE}/${encodeURIComponent(groupEmail)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to update group settings' }
      }

      return { success: true, output: extractSettingsOutput(data) }
    },
  },
}

export default handler
