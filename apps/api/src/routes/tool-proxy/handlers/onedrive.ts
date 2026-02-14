import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('OneDriveProxyHandler')

const ONEDRIVE_BASE = 'https://graph.microsoft.com/v1.0/me/drive'

/**
 * Uploads a file to OneDrive.
 */
const handleUpload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    fileName: z.string().min(1, 'File name is required'),
    file: z.any(),
    path: z.string().optional().nullable(),
    folderId: z.string().optional().nullable(),
    conflictBehavior: z.enum(['fail', 'replace', 'rename']).optional().nullable(),
  })

  const validated = schema.parse(body)

  if (!validated.file) {
    return { success: false, output: {}, error: 'File is required' }
  }

  let userFile
  try {
    userFile = processSingleFileToUserFile(validated.file, requestId, logger)
  } catch (error) {
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to process file',
    }
  }

  let fileBuffer: Buffer
  try {
    fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
  } catch (error) {
    logger.error(`[${requestId}] Failed to download file from storage:`, error)
    return {
      success: false,
      output: {},
      error: `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }

  const mimeType = userFile.type || 'application/octet-stream'
  const fileName = validated.fileName
  const uploadPath = validated.path || fileName

  let uploadUrl: string
  const folderId = validated.folderId?.trim()

  if (folderId && folderId !== '') {
    uploadUrl = `${ONEDRIVE_BASE}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(uploadPath)}:/content`
  } else {
    uploadUrl = `${ONEDRIVE_BASE}/root:/${encodeURIComponent(uploadPath)}:/content`
  }

  if (validated.conflictBehavior) {
    uploadUrl += `?@microsoft.graph.conflictBehavior=${validated.conflictBehavior}`
  }

  logger.info(`[${requestId}] Uploading to OneDrive`, {
    fileName,
    size: fileBuffer.length,
    mimeType,
  })

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${validated.accessToken}`,
      'Content-Type': mimeType,
    },
    body: new Uint8Array(fileBuffer),
  })

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text()
    logger.error(`[${requestId}] OneDrive upload error:`, {
      status: uploadResponse.status,
      error: errorText,
    })
    return {
      success: false,
      output: {},
      error: `OneDrive upload failed: ${uploadResponse.statusText}`,
    }
  }

  const fileData = await uploadResponse.json()

  logger.info(`[${requestId}] File uploaded successfully`, { fileId: fileData.id })

  return {
    success: true,
    output: {
      file: {
        id: fileData.id,
        name: fileData.name,
        mimeType: fileData.file?.mimeType || mimeType,
        webViewLink: fileData.webUrl,
        webContentLink: fileData['@microsoft.graph.downloadUrl'],
        size: fileData.size,
        createdTime: fileData.createdDateTime,
        modifiedTime: fileData.lastModifiedDateTime,
        parentReference: fileData.parentReference,
      },
    },
  }
}

/**
 * Downloads a file from OneDrive and returns its content as base64.
 */
const handleDownload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    itemId: z.string().min(1, 'Item ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Downloading file from OneDrive`, { itemId: validated.itemId })

  const downloadResponse = await fetch(
    `${ONEDRIVE_BASE}/items/${validated.itemId}/content`,
    {
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  if (!downloadResponse.ok) {
    const errorData = await downloadResponse.json().catch(() => ({})) as { error?: { message?: string } }
    logger.error(`[${requestId}] OneDrive download error:`, {
      status: downloadResponse.status,
      error: errorData,
    })
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to download file',
    }
  }

  const arrayBuffer = await downloadResponse.arrayBuffer()
  const content = Buffer.from(arrayBuffer).toString('base64')

  const contentDisposition = downloadResponse.headers.get('content-disposition') || ''
  const nameMatch = contentDisposition.match(/filename="?([^";\s]+)"?/)
  const name = nameMatch?.[1] || 'download'

  logger.info(`[${requestId}] File downloaded successfully`, {
    itemId: validated.itemId,
    size: arrayBuffer.byteLength,
    name,
  })

  return {
    success: true,
    output: {
      content,
      name,
    },
  }
}

/**
 * Lists files in a OneDrive folder.
 */
const handleFiles: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    folderId: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)
  const folderId = validated.folderId || 'root'

  logger.info(`[${requestId}] Listing files from OneDrive`, { folderId })

  const response = await fetch(
    `${ONEDRIVE_BASE}/items/${folderId}/children`,
    {
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } }
    logger.error(`[${requestId}] OneDrive files error:`, {
      status: response.status,
      error: errorData,
    })
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to list files',
    }
  }

  const data = await response.json()
  const files = data.value || []

  logger.info(`[${requestId}] Successfully listed ${files.length} items`)

  return {
    success: true,
    output: { files },
  }
}

/**
 * Creates a folder in OneDrive.
 */
const handleFolder: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    name: z.string().min(1, 'Folder name is required'),
    parentId: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)
  const parentId = validated.parentId || 'root'

  logger.info(`[${requestId}] Creating folder in OneDrive`, {
    name: validated.name,
    parentId,
  })

  const response = await fetch(
    `${ONEDRIVE_BASE}/items/${parentId}/children`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: validated.name,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      }),
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } }
    logger.error(`[${requestId}] OneDrive folder creation error:`, {
      status: response.status,
      error: errorData,
    })
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to create folder',
    }
  }

  const folderData = await response.json()

  logger.info(`[${requestId}] Folder created successfully`, { folderId: folderData.id })

  return {
    success: true,
    output: folderData,
  }
}

/**
 * Lists folders in a OneDrive folder.
 */
const handleFolders: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    folderId: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)
  const folderId = validated.folderId || 'root'

  logger.info(`[${requestId}] Listing folders from OneDrive`, { folderId })

  const response = await fetch(
    `${ONEDRIVE_BASE}/items/${folderId}/children?$filter=folder ne null`,
    {
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } }
    logger.error(`[${requestId}] OneDrive folders error:`, {
      status: response.status,
      error: errorData,
    })
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to list folders',
    }
  }

  const data = await response.json()
  const folders = data.value || []

  logger.info(`[${requestId}] Successfully listed ${folders.length} folders`)

  return {
    success: true,
    output: { folders },
  }
}

export const onedriveHandlers: Record<string, ToolProxyHandler> = {
  'upload': handleUpload,
  'download': handleDownload,
  'files': handleFiles,
  'folder': handleFolder,
  'folders': handleFolders,
}
