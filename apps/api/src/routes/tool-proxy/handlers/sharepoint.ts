import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('SharePointProxyHandler')

const SP_BASE = 'https://graph.microsoft.com/v1.0'

/**
 * Searches for or lists SharePoint sites.
 */
const handleSites: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    search: z.string().optional().nullable(),
  })

  const validated = schema.parse(body)
  const searchQuery = validated.search || '*'

  logger.info(`[${requestId}] Fetching SharePoint sites`, { search: searchQuery })

  const response = await fetch(
    `${SP_BASE}/sites?search=${encodeURIComponent(searchQuery)}&$select=id,name,displayName,webUrl,createdDateTime,lastModifiedDateTime&$top=50`,
    {
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } }
    logger.error(`[${requestId}] SharePoint sites error:`, {
      status: response.status,
      error: errorData,
    })
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to fetch sites',
    }
  }

  const data = await response.json()
  const sites = (data.value || []).map((site: Record<string, unknown>) => ({
    id: site.id,
    name: site.displayName || site.name,
    webUrl: site.webUrl,
    createdDateTime: site.createdDateTime,
    lastModifiedDateTime: site.lastModifiedDateTime,
  }))

  logger.info(`[${requestId}] Successfully fetched ${sites.length} SharePoint sites`)

  return {
    success: true,
    output: { sites },
  }
}

/**
 * Gets details of a specific SharePoint site.
 */
const handleSite: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    siteId: z.string().min(1, 'Site ID is required'),
  })

  const validated = schema.parse(body)

  logger.info(`[${requestId}] Fetching SharePoint site`, { siteId: validated.siteId })

  const response = await fetch(
    `${SP_BASE}/sites/${validated.siteId}?$select=id,name,displayName,webUrl,createdDateTime,lastModifiedDateTime`,
    {
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } }
    logger.error(`[${requestId}] SharePoint site error:`, {
      status: response.status,
      error: errorData,
    })
    return {
      success: false,
      output: {},
      error: errorData.error?.message || 'Failed to fetch site',
    }
  }

  const site = await response.json()

  logger.info(`[${requestId}] Successfully fetched site: ${site.displayName || site.name}`)

  return {
    success: true,
    output: {
      site: {
        id: site.id,
        name: site.displayName || site.name,
        webUrl: site.webUrl,
        createdDateTime: site.createdDateTime,
        lastModifiedDateTime: site.lastModifiedDateTime,
      },
    },
  }
}

/**
 * Uploads a file to a SharePoint document library.
 */
const handleUpload: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  const schema = z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    siteId: z.string().min(1, 'Site ID is required'),
    driveId: z.string().optional().nullable(),
    path: z.string().optional().nullable(),
    fileName: z.string().optional().nullable(),
    file: z.any().optional().nullable(),
    files: z.array(z.any()).optional().nullable(),
  })

  const validated = schema.parse(body)

  const rawFiles = validated.files || (validated.file ? [validated.file] : [])

  if (rawFiles.length === 0) {
    return { success: false, output: {}, error: 'At least one file is required for upload' }
  }

  const userFiles = processFilesToUserFiles(rawFiles, requestId, logger)

  if (userFiles.length === 0) {
    return { success: false, output: {}, error: 'No valid files to upload' }
  }

  let effectiveDriveId = validated.driveId
  if (!effectiveDriveId) {
    logger.info(`[${requestId}] No driveId provided, fetching default drive for site`)

    const driveResponse = await fetch(
      `${SP_BASE}/sites/${validated.siteId}/drive`,
      {
        headers: {
          Authorization: `Bearer ${validated.accessToken}`,
          Accept: 'application/json',
        },
      }
    )

    if (!driveResponse.ok) {
      const errorData = await driveResponse.json().catch(() => ({})) as { error?: { message?: string } }
      logger.error(`[${requestId}] Failed to get default drive:`, errorData)
      return {
        success: false,
        output: {},
        error: errorData.error?.message || 'Failed to get default document library',
      }
    }

    const driveData = await driveResponse.json()
    effectiveDriveId = driveData.id
    logger.info(`[${requestId}] Using default drive: ${effectiveDriveId}`)
  }

  const uploadedFiles: Record<string, unknown>[] = []

  for (const userFile of userFiles) {
    logger.info(`[${requestId}] Uploading file: ${userFile.name}`)

    const buffer = await downloadFileFromStorage(userFile, requestId, logger)

    const fileName = validated.fileName || userFile.name
    const folderPath = validated.path?.trim() || ''

    let uploadPath = ''
    if (folderPath) {
      const normalizedPath = folderPath.startsWith('/') ? folderPath : `/${folderPath}`
      const cleanPath = normalizedPath.endsWith('/')
        ? normalizedPath.slice(0, -1)
        : normalizedPath
      uploadPath = `${cleanPath}/${fileName}`
    } else {
      uploadPath = `/${fileName}`
    }

    const encodedPath = uploadPath
      .split('/')
      .map((segment) => (segment ? encodeURIComponent(segment) : ''))
      .join('/')

    const uploadUrl = `${SP_BASE}/sites/${validated.siteId}/drives/${effectiveDriveId}/root:${encodedPath}:/content`

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${validated.accessToken}`,
        'Content-Type': userFile.type || 'application/octet-stream',
      },
      body: new Uint8Array(buffer),
    })

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({})) as { error?: { message?: string } }
      logger.error(`[${requestId}] Failed to upload file ${fileName}:`, errorData)
      return {
        success: false,
        output: {},
        error: errorData.error?.message || `Failed to upload file: ${fileName}`,
      }
    }

    const uploadData = await uploadResponse.json()
    logger.info(`[${requestId}] File uploaded successfully: ${fileName}`)

    uploadedFiles.push({
      id: uploadData.id,
      name: uploadData.name,
      webUrl: uploadData.webUrl,
      size: uploadData.size,
      createdDateTime: uploadData.createdDateTime,
      lastModifiedDateTime: uploadData.lastModifiedDateTime,
    })
  }

  logger.info(`[${requestId}] Successfully uploaded ${uploadedFiles.length} file(s)`)

  return {
    success: true,
    output: {
      uploadedFiles,
      fileCount: uploadedFiles.length,
    },
  }
}

export const sharepointHandlers: Record<string, ToolProxyHandler> = {
  'sites': handleSites,
  'site': handleSite,
  'upload': handleUpload,
}
