import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path, { join, resolve, sep } from 'path'
import { Hono } from 'hono'
/** Common binary file extensions used to detect non-text content */
const BINARY_EXTENSIONS = new Set([
  '3dm', '3ds', '3g2', '3gp', '7z', 'a', 'aac', 'adp', 'afdesign', 'afphoto', 'afpub', 'ai',
  'aif', 'aiff', 'alz', 'ape', 'apk', 'appimage', 'ar', 'arj', 'asf', 'au', 'avi', 'bak',
  'baml', 'bh', 'bin', 'bk', 'bmp', 'btif', 'bz2', 'bzip2', 'cab', 'caf', 'cgm', 'class',
  'cmx', 'cpio', 'cr2', 'cur', 'dat', 'dcm', 'deb', 'dex', 'djvu', 'dll', 'dmg', 'dng',
  'doc', 'docm', 'docx', 'dot', 'dotm', 'dra', 'DS_Store', 'dsk', 'dts', 'dtshd', 'dvb',
  'dwg', 'dxf', 'ecelp4800', 'ecelp7470', 'ecelp9600', 'egg', 'eol', 'eot', 'epub', 'exe',
  'f4v', 'fbs', 'fh', 'fla', 'flac', 'flatpak', 'fli', 'flv', 'fpx', 'fst', 'fvt', 'g3',
  'gh', 'gif', 'graffle', 'gz', 'gzip', 'h261', 'h263', 'h264', 'icns', 'ico', 'ief', 'img',
  'ipa', 'iso', 'jar', 'jpeg', 'jpg', 'jpgv', 'jpm', 'jxr', 'key', 'ktx', 'lha', 'lib',
  'lvp', 'lz', 'lzh', 'lzma', 'lzo', 'm3u', 'm4a', 'm4v', 'mar', 'mdi', 'mht', 'mid',
  'midi', 'mj2', 'mka', 'mkv', 'mmr', 'mng', 'mobi', 'mov', 'movie', 'mp3', 'mp4', 'mp4a',
  'mpeg', 'mpg', 'mpga', 'mxu', 'nef', 'npx', 'numbers', 'nupkg', 'o', 'odp', 'ods', 'odt',
  'oga', 'ogg', 'ogv', 'otf', 'ott', 'pages', 'pbm', 'pcx', 'pdb', 'pdf', 'pea', 'pgm',
  'pic', 'png', 'pnm', 'pot', 'potm', 'potx', 'ppa', 'ppam', 'ppm', 'pps', 'ppsm', 'ppsx',
  'ppt', 'pptm', 'pptx', 'psd', 'pya', 'pyc', 'pyo', 'pyv', 'qt', 'rar', 'ras', 'raw',
  'resources', 'rgb', 'rip', 'rlc', 'rmf', 'rmvb', 'rpm', 'rtf', 'rz', 's3m', 's7z', 'scpt',
  'sgi', 'shar', 'snap', 'sil', 'sketch', 'slk', 'smv', 'snk', 'so', 'stl', 'suo', 'sub',
  'swf', 'tar', 'tbz', 'tbz2', 'tga', 'tgz', 'thmx', 'tif', 'tiff', 'tlz', 'ttc', 'ttf',
  'txz', 'udf', 'uvh', 'uvi', 'uvm', 'uvp', 'uvs', 'uvu', 'viv', 'vob', 'war', 'wav',
  'wax', 'wbmp', 'wdp', 'weba', 'webm', 'webp', 'whl', 'wim', 'wm', 'wma', 'wmv', 'wmx',
  'woff', 'woff2', 'wrm', 'wvx', 'xbm', 'xif', 'xla', 'xlam', 'xls', 'xlsb', 'xlsm',
  'xlsx', 'xlt', 'xltm', 'xltx', 'xm', 'xmind', 'xpi', 'xpm', 'xwd', 'xz', 'z', 'zip',
  'zipx',
])
import { createLogger } from '@sim/logger'
import { getUserId, type AuthContext } from '@/middleware/auth'
import type { StorageContext } from '@/lib/uploads/config'
import {
  isUsingCloudStorage,
  USE_BLOB_STORAGE,
} from '@/lib/uploads/config'
import {
  deleteFile,
  downloadFile,
  generateBatchPresignedUploadUrls,
  generatePresignedUploadUrl,
  hasCloudStorage,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import {
  extractCleanFilename,
  extractStorageKey,
  extractWorkspaceIdFromExecutionKey,
  getViewerUrl,
  inferContextFromKey,
  isImageFileType,
  isInternalFileUrl,
  getMimeTypeFromExtension,
  sanitizeFileKey,
} from '@/lib/uploads/utils/file-utils'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'

const logger = createLogger('FileRoutes')

const app = new Hono<{ Variables: AuthContext }>()

// ---------------------------------------------------------------------------
// Shared constants and helpers
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([
  // Documents
  'pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xlsx', 'xls', 'json', 'yaml', 'yml',
  // Images
  'png', 'jpg', 'jpeg', 'gif',
  // Audio
  'mp3', 'm4a', 'wav', 'webm', 'ogg', 'flac', 'aac', 'opus',
  // Video
  'mp4', 'mov', 'avi', 'mkv',
])

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB
const MAX_DOWNLOAD_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
const DOWNLOAD_TIMEOUT_MS = 30000 // 30 seconds

const SAFE_INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
])

const FORCE_ATTACHMENT_EXTENSIONS = new Set(['html', 'htm', 'svg', 'js', 'css', 'xml'])

const contentTypeMap: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  md: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/typescript',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  zip: 'application/zip',
}

function validateFileExtension(filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) return false
  return ALLOWED_EXTENSIONS.has(extension)
}

function getContentTypeFromFilename(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  return contentTypeMap[extension] || 'application/octet-stream'
}

function getSecureFileHeaders(filename: string, originalContentType: string) {
  const extension = filename.split('.').pop()?.toLowerCase() || ''

  if (FORCE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { contentType: 'application/octet-stream', disposition: 'attachment' }
  }

  let safeContentType = originalContentType
  if (originalContentType === 'text/html' || originalContentType === 'image/svg+xml') {
    safeContentType = 'text/plain'
  }

  const disposition = SAFE_INLINE_TYPES.has(safeContentType) ? 'inline' : 'attachment'
  return { contentType: safeContentType, disposition }
}

function encodeFilenameForHeader(storageKey: string): string {
  const filename = storageKey.split('/').pop() || storageKey
  const hasNonAscii = /[^\x00-\x7F]/.test(filename)

  if (!hasNonAscii) {
    return `filename="${filename}"`
  }

  const encodedFilename = encodeURIComponent(filename)
  const asciiSafe = filename.replace(/[^\x00-\x7F]/g, '_')
  return `filename="${asciiSafe}"; filename*=UTF-8''${encodedFilename}`
}

function extractFilename(filePath: string): string {
  let filename: string

  if (filePath.startsWith('/api/files/serve/')) {
    filename = filePath.substring('/api/files/serve/'.length)
  } else {
    filename = filePath.split('/').pop() || filePath
  }

  filename = filename.replace(/\.\./g, '').replace(/\/\.\./g, '').replace(/\.\.\//g, '')

  if (filename.startsWith('s3/') || filename.startsWith('blob/')) {
    const parts = filename.split('/')
    const prefix = parts[0]
    const keyParts = parts.slice(1)

    const sanitizedKeyParts = keyParts
      .map((part) => part.replace(/\.\./g, '').replace(/^\./g, '').trim())
      .filter((part) => part.length > 0)

    filename = `${prefix}/${sanitizedKeyParts.join('/')}`
  } else {
    filename = filename.replace(/[/\\]/g, '')
  }

  if (!filename || filename.trim().length === 0) {
    throw new Error('Invalid or empty filename after sanitization')
  }

  return filename
}

function findLocalFile(filename: string): string | null {
  try {
    const sanitizedFilename = sanitizeFileKey(filename)

    if (!sanitizedFilename || !sanitizedFilename.trim() || /^[/\\.\s]+$/.test(sanitizedFilename)) {
      return null
    }

    const possiblePaths = [
      join(UPLOAD_DIR_SERVER, sanitizedFilename),
      join(process.cwd(), 'uploads', sanitizedFilename),
    ]

    for (const p of possiblePaths) {
      const resolvedPath = resolve(p)
      const allowedDirs = [resolve(UPLOAD_DIR_SERVER), resolve(process.cwd(), 'uploads')]

      const isWithinAllowedDir = allowedDirs.some(
        (allowedDir) => resolvedPath.startsWith(allowedDir + sep) && resolvedPath !== allowedDir
      )

      if (!isWithinAllowedDir) {
        continue
      }

      if (existsSync(resolvedPath)) {
        return resolvedPath
      }
    }

    return null
  } catch (error) {
    logger.error('Error in findLocalFile:', error)
    return null
  }
}

function extractStorageKeyFromPath(filePath: string): string {
  if (filePath.startsWith('/api/files/serve/')) {
    return extractStorageKey(filePath)
  }
  return extractFilename(filePath)
}

function prettySize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Number.parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

interface ParseResult {
  success: boolean
  content?: string
  error?: string
  filePath: string
  originalName?: string
  viewerUrl?: string | null
  userFile?: UserFile
  metadata?: {
    fileType: string
    size: number
    hash: string
    processingTime: number
  }
}

interface ExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

function validateFilePath(filePath: string): { isValid: boolean; error?: string } {
  if (filePath.includes('\0')) {
    return { isValid: false, error: 'Invalid path: null byte detected' }
  }
  if (filePath.includes('..')) {
    return { isValid: false, error: 'Access denied: path traversal detected' }
  }
  if (filePath.includes('~')) {
    return { isValid: false, error: 'Invalid path: tilde character not allowed' }
  }
  if (filePath.startsWith('/') && !isInternalFileUrl(filePath)) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }
  if (/^[A-Za-z]:\\/.test(filePath)) {
    return { isValid: false, error: 'Path outside allowed directory' }
  }
  return { isValid: true }
}

async function handlePdfBuffer(
  fileBuffer: Buffer,
  filename: string,
  fileType?: string,
  originalPath?: string
): Promise<ParseResult> {
  try {
    logger.info(`Parsing PDF in memory: ${filename}`)

    let content: string
    try {
      const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')
      const parser = new PdfParser()
      const result = await parser.parseBuffer(fileBuffer)
      content = result.content || `PDF document - ${result.metadata?.pageCount || 0} page(s), ${prettySize(fileBuffer.length)}\nPath: ${originalPath || filename}\n\nThis file appears to be a PDF document that could not be fully processed as text.\nPlease use a PDF viewer for best results.`
    } catch (parseError) {
      content = `PDF document - Processing failed, ${prettySize(fileBuffer.length)}\nPath: ${originalPath || filename}\nError: ${(parseError as Error).message}\n\nThis file appears to be a PDF document that could not be processed.\nPlease use a PDF viewer for best results.`
    }

    return {
      success: true,
      content,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || 'application/pdf',
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
    logger.error('Failed to parse PDF in memory:', error)
    return {
      success: true,
      content: `PDF document - Processing failed, ${prettySize(fileBuffer.length)}\nPath: ${originalPath || filename}\nError: ${(error as Error).message}\n\nThis file appears to be a PDF document that could not be processed.\nPlease use a PDF viewer for best results.`,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || 'application/pdf',
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  }
}

async function handleCsvBuffer(
  fileBuffer: Buffer,
  filename: string,
  fileType?: string,
  originalPath?: string
): Promise<ParseResult> {
  try {
    logger.info(`Parsing CSV in memory: ${filename}`)
    const { parseBuffer } = await import('@/lib/file-parsers')
    const result = await parseBuffer(fileBuffer, 'csv')

    return {
      success: true,
      content: result.content,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || 'text/csv',
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
    logger.error('Failed to parse CSV in memory:', error)
    return {
      success: false,
      error: `Failed to parse CSV: ${(error as Error).message}`,
      filePath: originalPath || filename,
      metadata: { fileType: 'text/csv', size: 0, hash: '', processingTime: 0 },
    }
  }
}

async function handleGenericTextBuffer(
  fileBuffer: Buffer,
  filename: string,
  extension: string,
  fileType?: string,
  originalPath?: string
): Promise<ParseResult> {
  try {
    logger.info(`Parsing text file in memory: ${filename}`)

    try {
      const { parseBuffer, isSupportedFileType: isSupported } = await import('@/lib/file-parsers')

      if (isSupported(extension)) {
        const result = await parseBuffer(fileBuffer, extension)
        return {
          success: true,
          content: result.content,
          filePath: originalPath || filename,
          metadata: {
            fileType: fileType || getMimeTypeFromExtension(extension),
            size: fileBuffer.length,
            hash: createHash('md5').update(fileBuffer).digest('hex'),
            processingTime: 0,
          },
        }
      }
    } catch (parserError) {
      logger.warn('Specialized parser failed, falling back to generic parsing:', parserError)
    }

    const content = fileBuffer.toString('utf-8')
    return {
      success: true,
      content,
      filePath: originalPath || filename,
      metadata: {
        fileType: fileType || getMimeTypeFromExtension(extension),
        size: fileBuffer.length,
        hash: createHash('md5').update(fileBuffer).digest('hex'),
        processingTime: 0,
      },
    }
  } catch (error) {
    logger.error('Failed to parse text file in memory:', error)
    return {
      success: false,
      error: `Failed to parse file: ${(error as Error).message}`,
      filePath: originalPath || filename,
      metadata: { fileType: 'text/plain', size: 0, hash: '', processingTime: 0 },
    }
  }
}

function handleGenericBuffer(
  fileBuffer: Buffer,
  filename: string,
  extension: string,
  fileType?: string
): ParseResult {
  const isBinary = BINARY_EXTENSIONS.has(extension)
  const content = isBinary
    ? `[Binary ${extension.toUpperCase()} file - ${fileBuffer.length} bytes]`
    : fileBuffer.toString('utf-8')

  return {
    success: true,
    content,
    filePath: filename,
    metadata: {
      fileType: fileType || getMimeTypeFromExtension(extension),
      size: fileBuffer.length,
      hash: createHash('md5').update(fileBuffer).digest('hex'),
      processingTime: 0,
    },
  }
}

async function handleExternalUrl(
  url: string,
  fileType: string,
  workspaceId: string,
  userId: string,
  executionContext?: ExecutionContext
): Promise<ParseResult> {
  try {
    logger.info('Fetching external URL:', url)
    logger.info('WorkspaceId for URL save:', workspaceId)

    const {
      secureFetchWithPinnedIP,
      validateUrlWithDNS,
    } = await import('@/lib/core/security/input-validation.server')

    const urlValidation = await validateUrlWithDNS(url, 'fileUrl')
    if (!urlValidation.isValid) {
      logger.warn(`Blocked external URL request: ${urlValidation.error}`)
      return { success: false, error: urlValidation.error || 'Invalid external URL', filePath: url }
    }

    const urlPath = new URL(url).pathname
    const filename = urlPath.split('/').pop() || 'download'
    const extension = path.extname(filename).toLowerCase().substring(1)

    logger.info(`Extracted filename: ${filename}, workspaceId: ${workspaceId}`)

    const {
      S3_EXECUTION_FILES_CONFIG,
      BLOB_EXECUTION_FILES_CONFIG,
      USE_S3_STORAGE,
      USE_BLOB_STORAGE: useBlobStorage,
    } = await import('@/lib/uploads/config')

    let isExecFile = false
    try {
      const parsedUrl = new URL(url)
      if (USE_S3_STORAGE && S3_EXECUTION_FILES_CONFIG.bucket) {
        const bucketInHost = parsedUrl.hostname.startsWith(S3_EXECUTION_FILES_CONFIG.bucket)
        const bucketInPath = parsedUrl.pathname.startsWith(`/${S3_EXECUTION_FILES_CONFIG.bucket}/`)
        isExecFile = bucketInHost || bucketInPath
      } else if (useBlobStorage && BLOB_EXECUTION_FILES_CONFIG.containerName) {
        isExecFile = url.includes(`/${BLOB_EXECUTION_FILES_CONFIG.containerName}/`)
      }
    } catch {
      isExecFile = false
    }

    const shouldCheckWorkspace = workspaceId && !isExecFile

    if (shouldCheckWorkspace) {
      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (permission === null) {
        logger.warn('User does not have workspace access for file parse', {
          userId,
          workspaceId,
          filename,
        })
        return { success: false, error: 'File not found', filePath: url }
      }

      const { fileExistsInWorkspace, listWorkspaceFiles } = await import(
        '@/lib/uploads/contexts/workspace'
      )
      const exists = await fileExistsInWorkspace(workspaceId, filename)

      if (exists) {
        logger.info(`File ${filename} already exists in workspace, using existing file`)
        const workspaceFiles = await listWorkspaceFiles(workspaceId)
        const existingFile = workspaceFiles.find((f) => f.name === filename)

        if (existingFile) {
          const storageFilePath = `/api/files/serve/${existingFile.key}`
          return handleCloudFile(storageFilePath, fileType, 'workspace', userId, executionContext)
        }
      }
    }

    const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, {
      timeout: DOWNLOAD_TIMEOUT_MS,
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength) > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`File too large: ${contentLength} bytes (max: ${MAX_DOWNLOAD_SIZE_BYTES})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    if (buffer.length > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`File too large: ${buffer.length} bytes (max: ${MAX_DOWNLOAD_SIZE_BYTES})`)
    }

    logger.info(`Downloaded file from URL: ${url}, size: ${buffer.length} bytes`)

    let userFile: UserFile | undefined
    const mimeType = response.headers.get('content-type') || getMimeTypeFromExtension(extension)

    if (executionContext) {
      try {
        const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
        userFile = await uploadExecutionFile(executionContext, buffer, filename, mimeType, userId)
        logger.info(`Stored file in execution storage: ${filename}`, { key: userFile.key })
      } catch (uploadError) {
        logger.warn('Failed to store file in execution storage:', uploadError)
      }
    }

    if (shouldCheckWorkspace) {
      try {
        const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
        const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
        if (permission !== 'admin' && permission !== 'write') {
          logger.warn('User does not have write permission for workspace file save', {
            userId,
            workspaceId,
            filename,
            permission,
          })
        } else {
          const { uploadWorkspaceFile } = await import('@/lib/uploads/contexts/workspace')
          await uploadWorkspaceFile(workspaceId, userId, buffer, filename, mimeType)
          logger.info(`Saved URL file to workspace storage: ${filename}`)
        }
      } catch (saveError) {
        logger.warn('Failed to save URL file to workspace:', saveError)
      }
    }

    let parseResult: ParseResult
    if (extension === 'pdf') {
      parseResult = await handlePdfBuffer(buffer, filename, fileType, url)
    } else if (extension === 'csv') {
      parseResult = await handleCsvBuffer(buffer, filename, fileType, url)
    } else {
      try {
        const { isSupportedFileType: isSupported } = await import('@/lib/file-parsers')
        if (isSupported(extension)) {
          parseResult = await handleGenericTextBuffer(buffer, filename, extension, fileType, url)
        } else {
          parseResult = handleGenericBuffer(buffer, filename, extension, fileType)
        }
      } catch {
        parseResult = handleGenericBuffer(buffer, filename, extension, fileType)
      }
    }

    if (userFile) {
      parseResult.userFile = userFile
    }

    return parseResult
  } catch (error) {
    const { sanitizeUrlForLog } = await import('@/lib/core/utils/logging')
    logger.error(`Error handling external URL ${sanitizeUrlForLog(url)}:`, error)
    return {
      success: false,
      error: `Error fetching URL: ${(error as Error).message}`,
      filePath: url,
    }
  }
}

async function handleCloudFile(
  filePath: string,
  fileType: string,
  explicitContext: string | undefined,
  userId: string,
  executionContext?: ExecutionContext
): Promise<ParseResult> {
  try {
    const cloudKey = extractStorageKey(filePath)
    logger.info('Extracted cloud key:', cloudKey)

    const context = (explicitContext as StorageContext) || inferContextFromKey(cloudKey)

    const hasAccess = await verifyFileAccess(cloudKey, userId, undefined, context, false)

    if (!hasAccess) {
      logger.warn('Unauthorized cloud file parse attempt', { userId, key: cloudKey, context })
      return { success: false, error: 'File not found', filePath }
    }

    let originalFilename: string | undefined
    if (context === 'workspace') {
      try {
        const fileRecord = await getFileMetadataByKey(cloudKey, 'workspace')
        if (fileRecord) {
          originalFilename = fileRecord.originalName
        }
      } catch (dbError) {
        logger.warn(`Failed to lookup original filename for ${cloudKey}:`, dbError)
      }
    }

    const { StorageService } = await import('@/lib/uploads')
    const fileBuffer = await StorageService.downloadFile({ key: cloudKey, context })
    logger.info(
      `Downloaded file from ${context} storage (${explicitContext ? 'explicit' : 'inferred'}): ${cloudKey}, size: ${fileBuffer.length} bytes`
    )

    const filename = originalFilename || cloudKey.split('/').pop() || cloudKey
    const extension = path.extname(filename).toLowerCase().substring(1)
    const mimeType = getMimeTypeFromExtension(extension)

    const normalizedFilePath = `/api/files/serve/${encodeURIComponent(cloudKey)}?context=${context}`
    let workspaceIdFromKey: string | undefined

    if (context === 'execution') {
      workspaceIdFromKey = extractWorkspaceIdFromExecutionKey(cloudKey) || undefined
    } else if (context === 'workspace') {
      const segments = cloudKey.split('/')
      if (segments.length >= 2 && /^[a-f0-9-]{36}$/.test(segments[0])) {
        workspaceIdFromKey = segments[0]
      }
    }

    const viewerUrl = getViewerUrl(cloudKey, workspaceIdFromKey)

    let userFile: UserFile | undefined

    if (executionContext) {
      if (context === 'execution') {
        userFile = {
          id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          name: filename,
          url: normalizedFilePath,
          size: fileBuffer.length,
          type: mimeType,
          key: cloudKey,
          context: 'execution',
        }
        logger.info(`Created UserFile reference for existing execution file: ${filename}`)
      } else {
        try {
          const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
          userFile = await uploadExecutionFile(executionContext, fileBuffer, filename, mimeType, userId)
          logger.info(`Copied file to execution storage: ${filename}`, { key: userFile.key })
        } catch (uploadError) {
          logger.warn('Failed to copy file to execution storage:', uploadError)
        }
      }
    }

    let parseResult: ParseResult
    if (extension === 'pdf') {
      parseResult = await handlePdfBuffer(fileBuffer, filename, fileType, normalizedFilePath)
    } else if (extension === 'csv') {
      parseResult = await handleCsvBuffer(fileBuffer, filename, fileType, normalizedFilePath)
    } else {
      try {
        const { isSupportedFileType: isSupported } = await import('@/lib/file-parsers')
        if (isSupported(extension)) {
          parseResult = await handleGenericTextBuffer(
            fileBuffer,
            filename,
            extension,
            fileType,
            normalizedFilePath
          )
        } else {
          parseResult = handleGenericBuffer(fileBuffer, filename, extension, fileType)
          parseResult.filePath = normalizedFilePath
        }
      } catch {
        parseResult = handleGenericBuffer(fileBuffer, filename, extension, fileType)
        parseResult.filePath = normalizedFilePath
      }
    }

    if (originalFilename) {
      parseResult.originalName = originalFilename
    }

    parseResult.viewerUrl = viewerUrl

    if (userFile) {
      parseResult.userFile = userFile
    }

    return parseResult
  } catch (error) {
    logger.error(`Error handling cloud file ${filePath}:`, error)

    const errorMessage = (error as Error).message
    if (errorMessage.includes('Access denied') || errorMessage.includes('Forbidden')) {
      throw new Error(`Error accessing file from cloud storage: ${errorMessage}`)
    }

    return {
      success: false,
      error: `Error accessing file from cloud storage: ${errorMessage}`,
      filePath,
    }
  }
}

async function handleLocalFileParse(
  filePath: string,
  fileType: string,
  userId: string,
  executionContext?: ExecutionContext
): Promise<ParseResult> {
  try {
    const filename = filePath.split('/').pop() || filePath

    const context = inferContextFromKey(filename)
    const hasAccess = await verifyFileAccess(filename, userId, undefined, context, true)

    if (!hasAccess) {
      logger.warn('Unauthorized local file parse attempt', { userId, filename })
      return { success: false, error: 'File not found', filePath }
    }

    const fullPath = join(UPLOAD_DIR_SERVER, filename)

    logger.info('Processing local file:', fullPath)

    const fsPromises = await import('fs/promises')
    try {
      await fsPromises.access(fullPath)
    } catch {
      throw new Error(`File not found: ${filename}`)
    }

    const { parseFile } = await import('@/lib/file-parsers')
    const result = await parseFile(fullPath)

    const stats = await fsPromises.stat(fullPath)
    const fileBuffer = await readFile(fullPath)
    const hash = createHash('md5').update(fileBuffer).digest('hex')

    const extension = path.extname(filename).toLowerCase().substring(1)
    const mimeType = fileType || getMimeTypeFromExtension(extension)

    let userFile: UserFile | undefined
    if (executionContext) {
      try {
        const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
        userFile = await uploadExecutionFile(executionContext, fileBuffer, filename, mimeType, userId)
        logger.info(`Stored local file in execution storage: ${filename}`, { key: userFile.key })
      } catch (uploadError) {
        logger.warn('Failed to store local file in execution storage:', uploadError)
      }
    }

    return {
      success: true,
      content: result.content,
      filePath,
      userFile,
      metadata: { fileType: mimeType, size: stats.size, hash, processingTime: 0 },
    }
  } catch (error) {
    logger.error(`Error handling local file ${filePath}:`, error)
    return {
      success: false,
      error: `Error processing local file: ${(error as Error).message}`,
      filePath,
    }
  }
}

async function parseFileSingle(
  filePath: string,
  fileType: string,
  workspaceId: string,
  userId: string,
  executionContext?: ExecutionContext
): Promise<ParseResult> {
  logger.info('Parsing file:', filePath)

  if (!filePath || filePath.trim() === '') {
    return { success: false, error: 'Empty file path provided', filePath: filePath || '' }
  }

  const pathValidation = validateFilePath(filePath)
  if (!pathValidation.isValid) {
    return { success: false, error: pathValidation.error || 'Invalid path', filePath }
  }

  if (isInternalFileUrl(filePath)) {
    return handleCloudFile(filePath, fileType, undefined, userId, executionContext)
  }

  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return handleExternalUrl(filePath, fileType, workspaceId, userId, executionContext)
  }

  if (isUsingCloudStorage()) {
    return handleCloudFile(filePath, fileType, undefined, userId, executionContext)
  }

  return handleLocalFileParse(filePath, fileType, userId, executionContext)
}

// ---------------------------------------------------------------------------
// POST /upload - Multi-context file uploads
// ---------------------------------------------------------------------------

app.post('/upload', async (c) => {
  try {
    const userId = getUserId(c)

    const formData = await c.req.formData()
    const files = formData.getAll('file') as File[]

    if (!files || files.length === 0) {
      return c.json({ error: 'InvalidRequestError', message: 'No files provided' }, 400)
    }

    const workflowId = formData.get('workflowId') as string | null
    const executionId = formData.get('executionId') as string | null
    const workspaceId = formData.get('workspaceId') as string | null
    const contextParam = formData.get('context') as string | null

    if (!contextParam) {
      return c.json(
        {
          error: 'InvalidRequestError',
          message:
            'Upload requires explicit context parameter (knowledge-base, workspace, execution, copilot, chat, or profile-pictures)',
        },
        400
      )
    }

    const context = contextParam as StorageContext

    const usingCloudStorage = hasCloudStorage()
    logger.info(`Using storage mode: ${usingCloudStorage ? 'Cloud' : 'Local'} for file upload`)

    const uploadResults = []

    for (const file of files) {
      const originalName = file.name

      if (!validateFileExtension(originalName)) {
        const extension = originalName.split('.').pop()?.toLowerCase() || 'unknown'
        return c.json(
          {
            error: 'InvalidRequestError',
            message: `File type '${extension}' is not allowed. Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
          },
          400
        )
      }

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      // Handle execution context
      if (context === 'execution') {
        if (!workflowId || !executionId) {
          return c.json(
            {
              error: 'InvalidRequestError',
              message: 'Execution context requires workflowId and executionId parameters',
            },
            400
          )
        }

        const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
        const userFile = await uploadExecutionFile(
          { workspaceId: workspaceId || '', workflowId, executionId },
          buffer,
          originalName,
          file.type,
          userId
        )

        uploadResults.push(userFile)
        continue
      }

      // Handle knowledge-base context
      if (context === 'knowledge-base') {
        const validationError = validateFileType(originalName, file.type)
        if (validationError) {
          return c.json(
            { error: 'InvalidRequestError', message: validationError.message },
            400
          )
        }

        if (workspaceId) {
          const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
          const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
          if (permission === null) {
            return c.json({ error: 'Insufficient permissions for workspace' }, 403)
          }
        }

        logger.info(`Uploading knowledge-base file: ${originalName}`)

        const timestamp = Date.now()
        const safeFileName = sanitizeFileName(originalName)
        const storageKey = `kb/${timestamp}-${safeFileName}`

        const metadata: Record<string, string> = {
          originalName,
          uploadedAt: new Date().toISOString(),
          purpose: 'knowledge-base',
          userId,
        }

        if (workspaceId) {
          metadata.workspaceId = workspaceId
        }

        const fileInfo = await uploadFile({
          file: buffer,
          fileName: storageKey,
          contentType: file.type,
          context: 'knowledge-base',
          preserveKey: true,
          customKey: storageKey,
          metadata,
        })

        const finalPath = usingCloudStorage
          ? `${fileInfo.path}?context=knowledge-base`
          : fileInfo.path

        const uploadResult = {
          fileName: originalName,
          presignedUrl: '',
          fileInfo: {
            path: finalPath,
            key: fileInfo.key,
            name: originalName,
            size: buffer.length,
            type: file.type,
          },
          directUploadSupported: false,
        }

        logger.info(`Successfully uploaded knowledge-base file: ${fileInfo.key}`)
        uploadResults.push(uploadResult)
        continue
      }

      // Handle workspace context
      if (context === 'workspace') {
        if (!workspaceId) {
          return c.json(
            { error: 'InvalidRequestError', message: 'Workspace context requires workspaceId parameter' },
            400
          )
        }

        try {
          const { uploadWorkspaceFile } = await import('@/lib/uploads/contexts/workspace')
          const userFile = await uploadWorkspaceFile(
            workspaceId,
            userId,
            buffer,
            originalName,
            file.type || 'application/octet-stream'
          )

          uploadResults.push(userFile)
          continue
        } catch (workspaceError) {
          const errorMessage =
            workspaceError instanceof Error ? workspaceError.message : 'Upload failed'
          const isDuplicate = errorMessage.includes('already exists')
          const isStorageLimitError =
            errorMessage.includes('Storage limit exceeded') ||
            errorMessage.includes('storage limit')

          logger.warn(`Workspace file upload failed: ${errorMessage}`)

          let statusCode = 500
          if (isDuplicate) statusCode = 409
          else if (isStorageLimitError) statusCode = 413

          return c.json({ success: false, error: errorMessage, isDuplicate }, statusCode as 409 | 413 | 500)
        }
      }

      // Handle image-only contexts (copilot, chat, profile-pictures)
      if (context === 'copilot' || context === 'chat' || context === 'profile-pictures') {
        if (!isImageFileType(file.type)) {
          return c.json(
            {
              error: 'InvalidRequestError',
              message: `Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for ${context} uploads`,
            },
            400
          )
        }

        if (context === 'chat' && workspaceId) {
          const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
          const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
          if (permission === null) {
            return c.json({ error: 'Insufficient permissions for workspace' }, 403)
          }
        }

        logger.info(`Uploading ${context} file: ${originalName}`)

        const timestamp = Date.now()
        const safeFileName = sanitizeFileName(originalName)
        const storageKey = `${context}/${timestamp}-${safeFileName}`

        const metadata: Record<string, string> = {
          originalName,
          uploadedAt: new Date().toISOString(),
          purpose: context,
          userId,
        }

        if (workspaceId && context === 'chat') {
          metadata.workspaceId = workspaceId
        }

        const fileInfo = await uploadFile({
          file: buffer,
          fileName: storageKey,
          contentType: file.type,
          context,
          preserveKey: true,
          customKey: storageKey,
          metadata,
        })

        const finalPath = usingCloudStorage ? `${fileInfo.path}?context=${context}` : fileInfo.path

        const uploadResult = {
          fileName: originalName,
          presignedUrl: '',
          fileInfo: {
            path: finalPath,
            key: fileInfo.key,
            name: originalName,
            size: buffer.length,
            type: file.type,
          },
          directUploadSupported: false,
        }

        logger.info(`Successfully uploaded ${context} file: ${fileInfo.key}`)
        uploadResults.push(uploadResult)
        continue
      }

      // Unknown context
      return c.json(
        {
          error: 'InvalidRequestError',
          message: `Unsupported context: ${context}. Use knowledge-base, workspace, execution, copilot, chat, or profile-pictures`,
        },
        400
      )
    }

    if (uploadResults.length === 1) {
      return c.json(uploadResults[0])
    }
    return c.json({ files: uploadResults })
  } catch (error) {
    logger.error('Error in file upload:', error)
    return c.json(
      { error: 'FileUploadError', message: error instanceof Error ? error.message : 'File upload failed' },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// POST /download - Download URL generation
// ---------------------------------------------------------------------------

app.post('/download', async (c) => {
  try {
    const userId = getUserId(c)

    const body = await c.req.json()
    const { key, name, isExecutionFile, context, url } = body

    if (!key) {
      return c.json({ error: 'Error', message: 'File key is required' }, 400)
    }

    if (key.startsWith('url/')) {
      if (!url) {
        return c.json({ error: 'Error', message: 'URL is required for URL-type files' }, 400)
      }

      return c.json({
        downloadUrl: url,
        expiresIn: null,
        fileName: name || key.split('/').pop() || 'download',
      })
    }

    let storageContext: StorageContext = context || 'general'

    if (isExecutionFile && !context) {
      storageContext = 'execution'
      logger.info(`Using execution context for file: ${key}`)
    }

    const hasAccess = await verifyFileAccess(
      key,
      userId,
      undefined,
      storageContext,
      !hasCloudStorage()
    )

    if (!hasAccess) {
      logger.warn('Unauthorized download URL request', { userId, key, context: storageContext })
      return c.json({ error: 'FileNotFoundError', message: `File not found: ${key}` }, 404)
    }

    const { getBaseUrl } = await import('@/lib/core/utils/urls')
    const downloadUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(key)}?context=${storageContext}`

    logger.info(`Generated download URL for ${storageContext} file: ${key}`)

    return c.json({
      downloadUrl,
      expiresIn: null,
      fileName: name || key.split('/').pop() || 'download',
    })
  } catch (error) {
    logger.error('Error in file download endpoint:', error)
    return c.json(
      { error: 'Error', message: error instanceof Error ? error.message : 'Internal server error' },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// POST /delete - File deletion
// ---------------------------------------------------------------------------

app.post('/delete', async (c) => {
  try {
    const userId = getUserId(c)

    const requestData = await c.req.json()
    const { filePath, context } = requestData

    logger.info('File delete request received:', { filePath, context, userId })

    if (!filePath) {
      return c.json({ error: 'InvalidRequestError', message: 'No file path provided' }, 400)
    }

    try {
      const key = extractStorageKeyFromPath(filePath)

      const storageContext: StorageContext = context || inferContextFromKey(key)

      const hasAccess = await verifyFileAccess(
        key,
        userId,
        undefined,
        storageContext,
        !hasCloudStorage()
      )

      if (!hasAccess) {
        logger.warn('Unauthorized file delete attempt', { userId, key, context: storageContext })
        return c.json({ error: 'FileNotFoundError', message: `File not found: ${key}` }, 404)
      }

      logger.info(`Deleting file with key: ${key}, context: ${storageContext}`)

      await deleteFile({ key, context: storageContext })

      logger.info(`File successfully deleted: ${key}`)

      return c.json({ success: true, message: 'File deleted successfully' })
    } catch (deleteError) {
      logger.error('Error deleting file:', deleteError)
      return c.json(
        {
          error: 'Error',
          message: deleteError instanceof Error ? deleteError.message : 'Failed to delete file',
        },
        500
      )
    }
  } catch (error) {
    logger.error('Error parsing request:', error)
    return c.json(
      { error: 'Error', message: error instanceof Error ? error.message : 'Invalid request' },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// POST /presigned - Presigned URL generation
// ---------------------------------------------------------------------------

app.post('/presigned', async (c) => {
  try {
    const userId = getUserId(c)

    let data: { fileName: string; contentType: string; fileSize: number }
    try {
      data = await c.req.json()
    } catch {
      return c.json(
        { error: 'Invalid JSON in request body', code: 'VALIDATION_ERROR', directUploadSupported: false },
        400
      )
    }

    const { fileName, contentType, fileSize } = data

    if (!fileName?.trim()) {
      return c.json(
        { error: 'fileName is required and cannot be empty', code: 'VALIDATION_ERROR', directUploadSupported: false },
        400
      )
    }
    if (!contentType?.trim()) {
      return c.json(
        { error: 'contentType is required and cannot be empty', code: 'VALIDATION_ERROR', directUploadSupported: false },
        400
      )
    }
    if (!fileSize || fileSize <= 0) {
      return c.json(
        { error: 'fileSize must be a positive number', code: 'VALIDATION_ERROR', directUploadSupported: false },
        400
      )
    }
    if (fileSize > MAX_FILE_SIZE) {
      return c.json(
        {
          error: `File size (${fileSize} bytes) exceeds maximum allowed size (${MAX_FILE_SIZE} bytes)`,
          code: 'VALIDATION_ERROR',
          directUploadSupported: false,
        },
        400
      )
    }

    const uploadTypeParam = c.req.query('type')
    if (!uploadTypeParam) {
      return c.json(
        { error: 'type query parameter is required', code: 'VALIDATION_ERROR', directUploadSupported: false },
        400
      )
    }

    const validTypes: StorageContext[] = ['knowledge-base', 'chat', 'copilot', 'profile-pictures']
    if (!validTypes.includes(uploadTypeParam as StorageContext)) {
      return c.json(
        {
          error: `Invalid type parameter. Must be one of: ${validTypes.join(', ')}`,
          code: 'VALIDATION_ERROR',
          directUploadSupported: false,
        },
        400
      )
    }

    const uploadType = uploadTypeParam as StorageContext

    if (uploadType === 'knowledge-base') {
      const fileValidationError = validateFileType(fileName, contentType)
      if (fileValidationError) {
        return c.json(
          { error: fileValidationError.message, code: 'VALIDATION_ERROR', directUploadSupported: false },
          400
        )
      }
    }

    if (!hasCloudStorage()) {
      logger.info(
        `Local storage detected - presigned URL not available for ${fileName}, client will use API fallback`
      )
      return c.json({
        fileName,
        presignedUrl: '',
        fileInfo: { path: '', key: '', name: fileName, size: fileSize, type: contentType },
        directUploadSupported: false,
      })
    }

    logger.info(`Generating ${uploadType} presigned URL for ${fileName}`)

    let presignedUrlResponse

    if (uploadType === 'copilot') {
      try {
        const { CopilotFiles } = await import('@/lib/uploads')
        presignedUrlResponse = await CopilotFiles.generateCopilotUploadUrl({
          fileName,
          contentType,
          fileSize,
          userId,
          expirationSeconds: 3600,
        })
      } catch (error) {
        return c.json(
          {
            error: error instanceof Error ? error.message : 'Copilot validation failed',
            code: 'VALIDATION_ERROR',
            directUploadSupported: false,
          },
          400
        )
      }
    } else {
      if (uploadType === 'profile-pictures') {
        if (!userId?.trim()) {
          return c.json(
            {
              error: 'Authenticated user session is required for profile picture uploads',
              code: 'VALIDATION_ERROR',
              directUploadSupported: false,
            },
            400
          )
        }
        const { CopilotFiles } = await import('@/lib/uploads')
        if (!CopilotFiles.isImageFileType(contentType)) {
          return c.json(
            {
              error: 'Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for profile picture uploads',
              code: 'VALIDATION_ERROR',
              directUploadSupported: false,
            },
            400
          )
        }
      }

      presignedUrlResponse = await generatePresignedUploadUrl({
        fileName,
        contentType,
        fileSize,
        context: uploadType,
        userId,
        expirationSeconds: 3600,
      })
    }

    const finalPath = `/api/files/serve/${USE_BLOB_STORAGE ? 'blob' : 's3'}/${encodeURIComponent(presignedUrlResponse.key)}?context=${uploadType}`

    return c.json({
      fileName,
      presignedUrl: presignedUrlResponse.url,
      fileInfo: {
        path: finalPath,
        key: presignedUrlResponse.key,
        name: fileName,
        size: fileSize,
        type: contentType,
      },
      uploadHeaders: presignedUrlResponse.uploadHeaders,
      directUploadSupported: true,
    })
  } catch (error) {
    logger.error('Error generating presigned URL:', error)
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate presigned URL',
        directUploadSupported: false,
      },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// POST /presigned/batch - Batch presigned URL generation
// ---------------------------------------------------------------------------

app.post('/presigned/batch', async (c) => {
  try {
    const userId = getUserId(c)

    let data: { files: Array<{ fileName: string; contentType: string; fileSize: number }> }
    try {
      data = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON in request body' }, 400)
    }

    const { files } = data

    if (!files || !Array.isArray(files) || files.length === 0) {
      return c.json({ error: 'files array is required and cannot be empty' }, 400)
    }

    if (files.length > 100) {
      return c.json({ error: 'Cannot process more than 100 files at once' }, 400)
    }

    const uploadTypeParam = c.req.query('type')
    if (!uploadTypeParam) {
      return c.json({ error: 'type query parameter is required' }, 400)
    }

    const validTypes: StorageContext[] = ['knowledge-base', 'chat', 'copilot', 'profile-pictures']
    if (!validTypes.includes(uploadTypeParam as StorageContext)) {
      return c.json(
        { error: `Invalid type parameter. Must be one of: ${validTypes.join(', ')}` },
        400
      )
    }

    const uploadType = uploadTypeParam as StorageContext

    for (const file of files) {
      if (!file.fileName?.trim()) {
        return c.json({ error: 'fileName is required for all files' }, 400)
      }
      if (!file.contentType?.trim()) {
        return c.json({ error: 'contentType is required for all files' }, 400)
      }
      if (!file.fileSize || file.fileSize <= 0) {
        return c.json({ error: 'fileSize must be positive for all files' }, 400)
      }
      if (file.fileSize > MAX_FILE_SIZE) {
        return c.json(
          { error: `File ${file.fileName} exceeds maximum size of ${MAX_FILE_SIZE} bytes` },
          400
        )
      }

      if (uploadType === 'knowledge-base') {
        const fileValidationError = validateFileType(file.fileName, file.contentType)
        if (fileValidationError) {
          return c.json(
            {
              error: fileValidationError.message,
              code: fileValidationError.code,
              supportedTypes: fileValidationError.supportedTypes,
            },
            400
          )
        }
      }
    }

    if (uploadType === 'copilot' && !userId?.trim()) {
      return c.json(
        { error: 'Authenticated user session is required for copilot uploads' },
        400
      )
    }

    if (!hasCloudStorage()) {
      logger.info(
        'Local storage detected - batch presigned URLs not available, client will use API fallback'
      )
      return c.json({
        files: files.map((file) => ({
          fileName: file.fileName,
          presignedUrl: '',
          fileInfo: { path: '', key: '', name: file.fileName, size: file.fileSize, type: file.contentType },
          directUploadSupported: false,
        })),
        directUploadSupported: false,
      })
    }

    logger.info(`Generating batch ${uploadType} presigned URLs for ${files.length} files`)

    const startTime = Date.now()

    const presignedUrls = await generateBatchPresignedUploadUrls(
      files.map((file) => ({
        fileName: file.fileName,
        contentType: file.contentType,
        fileSize: file.fileSize,
      })),
      uploadType,
      userId,
      3600
    )

    const duration = Date.now() - startTime
    logger.info(
      `Generated ${files.length} presigned URLs in ${duration}ms (avg ${Math.round(duration / files.length)}ms per file)`
    )

    const storagePrefix = USE_BLOB_STORAGE ? 'blob' : 's3'

    return c.json({
      files: presignedUrls.map((urlResponse, index) => {
        const finalPath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(urlResponse.key)}?context=${uploadType}`

        return {
          fileName: files[index].fileName,
          presignedUrl: urlResponse.url,
          fileInfo: {
            path: finalPath,
            key: urlResponse.key,
            name: files[index].fileName,
            size: files[index].fileSize,
            type: files[index].contentType,
          },
          uploadHeaders: urlResponse.uploadHeaders,
          directUploadSupported: true,
        }
      }),
      directUploadSupported: true,
    })
  } catch (error) {
    logger.error('Error generating batch presigned URLs:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to generate batch presigned URLs' },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// POST /parse - Document parsing
// ---------------------------------------------------------------------------

app.post('/parse', async (c) => {
  const startTime = Date.now()

  try {
    const userId = getUserId(c)

    const requestData = await c.req.json()
    const { filePath, fileType, workspaceId, workflowId, executionId } = requestData

    if (!filePath || (typeof filePath === 'string' && filePath.trim() === '')) {
      return c.json({ success: false, error: 'No file path provided' }, 400)
    }

    const executionContext: ExecutionContext | undefined =
      workspaceId && workflowId && executionId
        ? { workspaceId, workflowId, executionId }
        : undefined

    logger.info('File parse request received:', {
      filePath,
      fileType,
      workspaceId,
      userId,
      hasExecutionContext: !!executionContext,
    })

    if (Array.isArray(filePath)) {
      const results = []
      for (const singlePath of filePath) {
        if (!singlePath || (typeof singlePath === 'string' && singlePath.trim() === '')) {
          results.push({
            success: false,
            error: 'Empty file path in array',
            filePath: singlePath || '',
          })
          continue
        }

        const result = await parseFileSingle(
          singlePath,
          fileType,
          workspaceId,
          userId,
          executionContext
        )
        if (result.metadata) {
          result.metadata.processingTime = Date.now() - startTime
        }

        if (result.success) {
          const displayName =
            result.originalName || extractCleanFilename(result.filePath) || 'unknown'
          results.push({
            success: true,
            output: {
              content: result.content,
              name: displayName,
              fileType: result.metadata?.fileType || 'application/octet-stream',
              size: result.metadata?.size || 0,
              binary: false,
              file: result.userFile,
            },
            filePath: result.filePath,
            viewerUrl: result.viewerUrl,
          })
        } else {
          results.push(result)
        }
      }

      return c.json({ success: true, results })
    }

    const result = await parseFileSingle(filePath, fileType, workspaceId, userId, executionContext)

    if (result.metadata) {
      result.metadata.processingTime = Date.now() - startTime
    }

    if (result.success) {
      const displayName = result.originalName || extractCleanFilename(result.filePath) || 'unknown'
      return c.json({
        success: true,
        output: {
          content: result.content,
          name: displayName,
          fileType: result.metadata?.fileType || 'application/octet-stream',
          size: result.metadata?.size || 0,
          binary: false,
          file: result.userFile,
        },
        filePath: result.filePath,
        viewerUrl: result.viewerUrl,
      })
    }

    return c.json(result)
  } catch (error) {
    logger.error('Error in file parse API:', error)
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        filePath: '',
      },
      500
    )
  }
})

// ---------------------------------------------------------------------------
// GET /serve/* - File serving (wildcard catch-all)
// ---------------------------------------------------------------------------

app.get('/serve/*', async (c) => {
  try {
    const rawPath = c.req.path

    // Extract everything after /serve/
    // The route is mounted under /files so the full path is /files/serve/...
    // We need the part after /serve/
    const serveIndex = rawPath.indexOf('/serve/')
    if (serveIndex === -1) {
      return c.json({ error: 'FileNotFoundError', message: 'No file path provided' }, 404)
    }

    const fullPath = decodeURIComponent(rawPath.substring(serveIndex + '/serve/'.length))

    if (!fullPath) {
      return c.json({ error: 'FileNotFoundError', message: 'No file path provided' }, 404)
    }

    logger.info('File serve request:', { path: fullPath })

    const pathSegments = fullPath.split('/')
    const isS3Path = pathSegments[0] === 's3'
    const isBlobPath = pathSegments[0] === 'blob'
    const isCloudPath = isS3Path || isBlobPath
    const cloudKey = isCloudPath ? pathSegments.slice(1).join('/') : fullPath

    const contextParam = c.req.query('context')
    const context = contextParam || (isCloudPath ? inferContextFromKey(cloudKey) : undefined)

    // Public contexts - no auth required
    if (context === 'profile-pictures' || context === 'og-images') {
      logger.info(`Serving public ${context}:`, { cloudKey })
      if (isUsingCloudStorage() || isCloudPath) {
        return await serveCloudFilePublic(c, cloudKey, context as StorageContext)
      }
      return await serveLocalFilePublic(c, fullPath)
    }

    // Authenticated access
    const userId = getUserId(c)

    if (isUsingCloudStorage()) {
      return await serveCloudFile(c, cloudKey, userId, contextParam)
    }

    return await serveLocalFile(c, cloudKey, userId)
  } catch (error) {
    logger.error('Error serving file:', error)
    return c.json(
      { error: 'Error', message: error instanceof Error ? error.message : 'Failed to serve file' },
      500
    )
  }
})

async function serveLocalFile(c: any, filename: string, userId: string) {
  const contextParam: StorageContext | undefined = inferContextFromKey(filename) as
    | StorageContext
    | undefined

  const hasAccess = await verifyFileAccess(filename, userId, undefined, contextParam, true)

  if (!hasAccess) {
    logger.warn('Unauthorized local file access attempt', { userId, filename })
    return c.json({ error: 'FileNotFoundError', message: `File not found: ${filename}` }, 404)
  }

  const filePath = findLocalFile(filename)

  if (!filePath) {
    return c.json({ error: 'FileNotFoundError', message: `File not found: ${filename}` }, 404)
  }

  const fileBuffer = await readFile(filePath)
  const contentType = getContentTypeFromFilename(filename)

  logger.info('Local file served', { userId, filename, size: fileBuffer.length })

  const { contentType: safeContentType, disposition } = getSecureFileHeaders(filename, contentType)

  return new Response(fileBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': safeContentType,
      'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(filename)}`,
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox;",
    },
  })
}

async function serveCloudFile(
  c: any,
  cloudKey: string,
  userId: string,
  contextParam?: string | null
) {
  let context: StorageContext

  if (contextParam) {
    context = contextParam as StorageContext
    logger.info(`Using explicit context: ${context} for key: ${cloudKey}`)
  } else {
    context = inferContextFromKey(cloudKey)
    logger.info(`Inferred context: ${context} from key pattern: ${cloudKey}`)
  }

  const hasAccess = await verifyFileAccess(cloudKey, userId, undefined, context, false)

  if (!hasAccess) {
    logger.warn('Unauthorized cloud file access attempt', { userId, key: cloudKey, context })
    return c.json({ error: 'FileNotFoundError', message: `File not found: ${cloudKey}` }, 404)
  }

  let fileBuffer: Buffer

  if (context === 'copilot') {
    const { CopilotFiles } = await import('@/lib/uploads')
    fileBuffer = await CopilotFiles.downloadCopilotFile(cloudKey)
  } else {
    fileBuffer = await downloadFile({ key: cloudKey, context })
  }

  const originalFilename = cloudKey.split('/').pop() || 'download'
  const contentType = getContentTypeFromFilename(originalFilename)

  logger.info('Cloud file served', { userId, key: cloudKey, size: fileBuffer.length, context })

  const { contentType: safeContentType, disposition } = getSecureFileHeaders(originalFilename, contentType)

  return new Response(fileBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': safeContentType,
      'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(originalFilename)}`,
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox;",
    },
  })
}

async function serveCloudFilePublic(c: any, cloudKey: string, context: StorageContext) {
  let fileBuffer: Buffer

  if (context === 'copilot') {
    const { CopilotFiles } = await import('@/lib/uploads')
    fileBuffer = await CopilotFiles.downloadCopilotFile(cloudKey)
  } else {
    fileBuffer = await downloadFile({ key: cloudKey, context })
  }

  const originalFilename = cloudKey.split('/').pop() || 'download'
  const contentType = getContentTypeFromFilename(originalFilename)

  logger.info('Public cloud file served', { key: cloudKey, size: fileBuffer.length, context })

  const { contentType: safeContentType, disposition } = getSecureFileHeaders(originalFilename, contentType)

  return new Response(fileBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': safeContentType,
      'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(originalFilename)}`,
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox;",
    },
  })
}

async function serveLocalFilePublic(c: any, filename: string) {
  const filePath = findLocalFile(filename)

  if (!filePath) {
    return c.json({ error: 'FileNotFoundError', message: `File not found: ${filename}` }, 404)
  }

  const fileBuffer = await readFile(filePath)
  const contentType = getContentTypeFromFilename(filename)

  logger.info('Public local file served', { filename, size: fileBuffer.length })

  const { contentType: safeContentType, disposition } = getSecureFileHeaders(filename, contentType)

  return new Response(fileBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': safeContentType,
      'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(filename)}`,
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox;",
    },
  })
}

export { app as fileRoutes }
