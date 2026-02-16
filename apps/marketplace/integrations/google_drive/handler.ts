import type { ToolHandler } from '../../sdk/types'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const ALL_FILE_FIELDS =
  'id,kind,name,mimeType,description,originalFilename,fullFileExtension,fileExtension,owners,permissions,permissionIds,shared,ownedByMe,writersCanShare,viewersCanCopyContent,copyRequiresWriterPermission,sharingUser,starred,trashed,explicitlyTrashed,properties,appProperties,createdTime,modifiedTime,modifiedByMeTime,viewedByMeTime,sharedWithMeTime,lastModifyingUser,viewedByMe,modifiedByMe,webViewLink,webContentLink,iconLink,thumbnailLink,exportLinks,size,quotaBytesUsed,md5Checksum,sha1Checksum,sha256Checksum,parents,spaces,driveId,capabilities,version,headRevisionId,hasThumbnail,thumbnailVersion,imageMediaMetadata,videoMediaMetadata,isAppAuthorized,contentRestrictions,linkShareMetadata'

const handler: ToolHandler = {
  operations: {
    google_drive_list: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const url = new URL(`${DRIVE_API}/files`)
      url.searchParams.append('fields', `files(${ALL_FILE_FIELDS}),nextPageToken`)
      url.searchParams.append('corpora', 'allDrives')
      url.searchParams.append('supportsAllDrives', 'true')
      url.searchParams.append('includeItemsFromAllDrives', 'true')

      const conditions = ['trashed = false']
      const folderId = (params.folderId as string) || (params.folderSelector as string)
      if (folderId) conditions.push(`'${folderId.replace(/'/g, "\\'")}' in parents`)

      let q = conditions.join(' and ')
      if (params.query) {
        q += ` and name contains '${(params.query as string).replace(/'/g, "\\'")}'`
      }
      url.searchParams.append('q', q)
      if (params.pageSize) url.searchParams.append('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.append('pageToken', params.pageToken as string)

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return { success: true, output: { files: data.files, nextPageToken: data.nextPageToken } }
    },

    google_drive_get_file: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const url = `${DRIVE_API}/files/${fileId}?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return { success: true, output: { file: data } }
    },

    google_drive_create_folder: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const metadata: Record<string, unknown> = {
        name: params.fileName as string,
        mimeType: 'application/vnd.google-apps.folder',
      }
      const parentId = (params.folderSelector as string) || (params.folderId as string)
      if (parentId) metadata.parents = [parentId]

      const response = await fetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      const metaResp = await fetch(`${DRIVE_API}/files/${data.id}?supportsAllDrives=true&fields=${ALL_FILE_FIELDS}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const fullMeta = metaResp.ok ? await metaResp.json() : data
      return { success: true, output: { file: fullMeta } }
    },

    google_drive_delete: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const response = await fetch(`${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      return { success: true, output: { deleted: true, fileId } }
    },

    google_drive_trash: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const response = await fetch(`${DRIVE_API}/files/${fileId}?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      return { success: true, output: { file: await response.json() } }
    },

    google_drive_untrash: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const response = await fetch(`${DRIVE_API}/files/${fileId}?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: false }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      return { success: true, output: { file: await response.json() } }
    },

    google_drive_copy: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const body: Record<string, unknown> = {}
      if (params.newName) body.name = params.newName
      if (params.destinationFolderId) body.parents = [(params.destinationFolderId as string).trim()]

      const response = await fetch(`${DRIVE_API}/files/${fileId}/copy?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      return { success: true, output: { file: await response.json() } }
    },

    google_drive_share: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const url = new URL(`${DRIVE_API}/files/${fileId}/permissions`)
      url.searchParams.append('supportsAllDrives', 'true')
      if (params.transferOwnership) url.searchParams.append('transferOwnership', 'true')
      if (params.moveToNewOwnersRoot) url.searchParams.append('moveToNewOwnersRoot', 'true')
      if (params.sendNotification !== undefined) url.searchParams.append('sendNotificationEmail', String(params.sendNotification))
      if (params.emailMessage) url.searchParams.append('emailMessage', params.emailMessage as string)

      const body: Record<string, unknown> = { type: params.type, role: params.role }
      if (params.email) body.emailAddress = (params.email as string).trim()
      if (params.domain) body.domain = (params.domain as string).trim()

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          permission: {
            id: data.id ?? null, type: data.type ?? null, role: data.role ?? null,
            emailAddress: data.emailAddress ?? null, displayName: data.displayName ?? null,
            domain: data.domain ?? null, expirationTime: data.expirationTime ?? null,
            deleted: data.deleted ?? false,
          },
        },
      }
    },

    google_drive_unshare: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      const permissionId = (params.permissionId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }
      if (!permissionId) return { success: false, output: {}, error: 'Missing permissionId' }

      const response = await fetch(`${DRIVE_API}/files/${fileId}/permissions/${permissionId}?supportsAllDrives=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      return { success: true, output: { removed: true, fileId, permissionId } }
    },

    google_drive_update: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const url = new URL(`${DRIVE_API}/files/${fileId}`)
      url.searchParams.append('fields', ALL_FILE_FIELDS)
      url.searchParams.append('supportsAllDrives', 'true')
      if (params.addParents) url.searchParams.append('addParents', (params.addParents as string).trim())
      if (params.removeParents) url.searchParams.append('removeParents', (params.removeParents as string).trim())

      const body: Record<string, unknown> = {}
      if (params.name !== undefined) body.name = params.name
      if (params.description !== undefined) body.description = params.description
      if (params.starred !== undefined) body.starred = params.starred

      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      return { success: true, output: { file: await response.json() } }
    },

    google_drive_get_about: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const url = `${DRIVE_API}/about?fields=user,storageQuota,canCreateDrives,importFormats,exportFormats,maxUploadSize`
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (err as Record<string, unknown>)?.error?.toString() || `API error: ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          user: {
            displayName: data.user?.displayName ?? null,
            emailAddress: data.user?.emailAddress ?? '',
            photoLink: data.user?.photoLink ?? null,
            permissionId: data.user?.permissionId ?? null,
            me: data.user?.me ?? true,
          },
          storageQuota: {
            limit: data.storageQuota?.limit ?? null,
            usage: data.storageQuota?.usage ?? '0',
            usageInDrive: data.storageQuota?.usageInDrive ?? '0',
            usageInDriveTrash: data.storageQuota?.usageInDriveTrash ?? '0',
          },
          canCreateDrives: data.canCreateDrives ?? false,
          importFormats: data.importFormats ?? {},
          exportFormats: data.exportFormats ?? {},
          maxUploadSize: data.maxUploadSize ?? '0',
        },
      }
    },
  },
}

export default handler
