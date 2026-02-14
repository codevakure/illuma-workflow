import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('DriveHandler')

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'

const FilesSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  query: z.string().optional(),
  mimeType: z.string().optional(),
  folderId: z.string().optional(),
  pageSize: z.number().optional().default(100),
})

const FileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
})

/** Export format mapping for Google Workspace documents. */
const EXPORT_FORMATS: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'application/pdf',
} as const

/**
 * Escape special characters for Drive query strings.
 */
function escapeForDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Fetch shared drives the user has access to.
 */
async function fetchSharedDrives(
  accessToken: string,
  requestId: string
): Promise<Array<{ id: string; name: string; mimeType: string; iconLink: string }>> {
  try {
    const response = await fetch(
      `${DRIVE_API_BASE.replace('/drive/v3', '/drive/v3')}/drives?pageSize=100&fields=drives(id,name)`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (!response.ok) {
      logger.warn(`[${requestId}] Failed to fetch shared drives`, { status: response.status })
      return []
    }

    const data = await response.json()
    const drives: Array<{ id: string; name: string }> = data.drives || []

    return drives.map((drive) => ({
      id: drive.id,
      name: drive.name,
      mimeType: 'application/vnd.google-apps.folder',
      iconLink: 'https://ssl.gstatic.com/docs/doclist/images/icon_11_shared_collection_list_1.png',
    }))
  } catch (error) {
    logger.error(`[${requestId}] Error fetching shared drives`, error)
    return []
  }
}

/**
 * List files from Google Drive with optional query, mimeType, and folder filters.
 * Includes shared drives when listing root-level folders.
 */
const handleFiles: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = FilesSchema.parse(body)

    const qParts: string[] = ['trashed = false']
    if (validated.folderId) {
      qParts.push(`'${escapeForDriveQuery(validated.folderId)}' in parents`)
    }
    if (validated.mimeType) {
      qParts.push(`mimeType = '${escapeForDriveQuery(validated.mimeType)}'`)
    }
    if (validated.query) {
      qParts.push(`name contains '${escapeForDriveQuery(validated.query)}'`)
    }

    const q = encodeURIComponent(qParts.join(' and '))
    const fields =
      'files(id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners,parents)'
    const url = `${DRIVE_API_BASE}/files?q=${q}&corpora=allDrives&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${fields}`

    logger.info(`[${requestId}] Listing Google Drive files`, {
      hasQuery: !!validated.query,
      hasMimeType: !!validated.mimeType,
      hasFolderId: !!validated.folderId,
      pageSize: validated.pageSize,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      const errorMessage =
        (errorData as Record<string, Record<string, string>>).error?.message ||
        `Google Drive API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const data = await response.json()
    let files: Array<Record<string, unknown>> = data.files || []

    if (validated.mimeType) {
      files = files.filter((file) => file.mimeType === validated.mimeType)
    }

    const isRootFolderListing =
      !validated.folderId &&
      validated.mimeType === 'application/vnd.google-apps.folder' &&
      !validated.query
    if (isRootFolderListing) {
      const sharedDrives = await fetchSharedDrives(validated.accessToken, requestId)
      if (sharedDrives.length > 0) {
        logger.info(`[${requestId}] Found ${sharedDrives.length} shared drives`)
        files = [...sharedDrives, ...files]
      }
    }

    logger.info(`[${requestId}] Successfully listed ${files.length} Drive files`)

    return {
      success: true,
      output: { files },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error listing Google Drive files:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to list Drive files',
    }
  }
}

/**
 * Get metadata for a single Google Drive file, resolving shortcuts
 * and computing download/export URLs.
 */
const handleFile: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = FileSchema.parse(body)
    const fileFields =
      'id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners,exportLinks,shortcutDetails'

    const url = `${DRIVE_API_BASE}/files/${validated.fileId}?fields=${fileFields}&supportsAllDrives=true`

    logger.info(`[${requestId}] Fetching Google Drive file metadata`, {
      fileId: validated.fileId,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok && response.status === 404) {
      logger.info(`[${requestId}] File not found, checking if it's a shared drive`)
      const driveResponse = await fetch(
        `${DRIVE_API_BASE.replace('/drive/v3', '/drive/v3')}/drives/${validated.fileId}?fields=id,name`,
        {
          headers: { Authorization: `Bearer ${validated.accessToken}` },
        }
      )

      if (driveResponse.ok) {
        const driveData = await driveResponse.json()
        logger.info(`[${requestId}] Found shared drive: ${driveData.name}`)
        return {
          success: true,
          output: {
            file: {
              id: driveData.id,
              name: driveData.name,
              mimeType: 'application/vnd.google-apps.folder',
              iconLink:
                'https://ssl.gstatic.com/docs/doclist/images/icon_11_shared_collection_list_1.png',
            },
          },
        }
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      const errorMessage =
        (errorData as Record<string, Record<string, string>>).error?.message ||
        `Google Drive API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const file = await response.json()

    if (
      file.mimeType === 'application/vnd.google-apps.shortcut' &&
      file.shortcutDetails?.targetId
    ) {
      const targetId = file.shortcutDetails.targetId
      const shortcutResp = await fetch(
        `${DRIVE_API_BASE}/files/${targetId}?fields=${fileFields}&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${validated.accessToken}` },
        }
      )
      if (shortcutResp.ok) {
        const targetFile = await shortcutResp.json()
        Object.assign(file, {
          id: targetFile.id,
          name: targetFile.name,
          mimeType: targetFile.mimeType,
          iconLink: targetFile.iconLink,
          webViewLink: targetFile.webViewLink,
          thumbnailLink: targetFile.thumbnailLink,
          createdTime: targetFile.createdTime,
          modifiedTime: targetFile.modifiedTime,
          size: targetFile.size,
          owners: targetFile.owners,
          exportLinks: targetFile.exportLinks,
        })
      }
    }

    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      const format = EXPORT_FORMATS[file.mimeType] || 'application/pdf'
      if (!file.exportLinks) {
        file.downloadUrl = `${DRIVE_API_BASE}/files/${file.id}/export?mimeType=${encodeURIComponent(format)}&supportsAllDrives=true`
      } else {
        file.downloadUrl = file.exportLinks[format]
      }
    } else {
      file.downloadUrl = `${DRIVE_API_BASE}/files/${file.id}?alt=media&supportsAllDrives=true`
    }

    logger.info(`[${requestId}] Successfully fetched Drive file metadata`, {
      fileId: validated.fileId,
    })

    return {
      success: true,
      output: { file },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Drive file metadata:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch file metadata',
    }
  }
}

export const driveHandlers: Record<string, ToolProxyHandler> = {
  files: handleFiles,
  file: handleFile,
}
