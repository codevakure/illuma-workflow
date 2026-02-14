import path from 'path'
import { createLogger } from '@sim/logger'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('SFTPHandler')

/** POSIX file type constants */
const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000

/**
 * Format SFTP error with helpful troubleshooting context
 */
function formatSFTPError(err: Error, config: { host: string; port: number }): Error {
  const errorMessage = err.message.toLowerCase()
  const { host, port } = config

  if (errorMessage.includes('econnrefused') || errorMessage.includes('connection refused')) {
    return new Error(
      `Connection refused to ${host}:${port}. ` +
        `Please verify: (1) SSH/SFTP server is running, ` +
        `(2) Port ${port} is correct, ` +
        `(3) Firewall allows connections.`
    )
  }

  if (errorMessage.includes('econnreset') || errorMessage.includes('connection reset')) {
    return new Error(
      `Connection reset by ${host}:${port}. ` +
        `This usually means: (1) Wrong port number, ` +
        `(2) Server rejected the connection, ` +
        `(3) Network/firewall interrupted the connection.`
    )
  }

  if (errorMessage.includes('etimedout') || errorMessage.includes('timeout')) {
    return new Error(
      `Connection timed out to ${host}:${port}. ` +
        `Please verify: (1) Host is reachable, ` +
        `(2) No firewall is blocking the connection, ` +
        `(3) The SFTP server is responding.`
    )
  }

  if (errorMessage.includes('enotfound') || errorMessage.includes('getaddrinfo')) {
    return new Error(
      `Could not resolve hostname "${host}". Please verify the hostname or IP address is correct.`
    )
  }

  if (errorMessage.includes('authentication') || errorMessage.includes('auth')) {
    return new Error(
      `Authentication failed on ${host}:${port}. ` +
        `Please verify: (1) Username is correct, ` +
        `(2) Password or private key is valid, ` +
        `(3) User has SFTP access on the server.`
    )
  }

  if (
    errorMessage.includes('key') &&
    (errorMessage.includes('parse') || errorMessage.includes('invalid'))
  ) {
    return new Error(
      `Invalid private key format. ` +
        `Please ensure you're using a valid OpenSSH private key ` +
        `(starts with "-----BEGIN" and ends with "-----END").`
    )
  }

  return new Error(`SFTP connection to ${host}:${port} failed: ${err.message}`)
}

/**
 * Create an SSH connection for SFTP operations
 */
function createSFTPConnection(params: {
  host: string
  port?: number
  username: string
  password?: string | null
  privateKey?: string | null
}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const port = params.port || 22
    const host = params.host

    if (!host || host.trim() === '') {
      reject(new Error('Host is required. Please provide a valid hostname or IP address.'))
      return
    }

    const hasPassword = params.password && params.password.trim() !== ''
    const hasPrivateKey = params.privateKey && params.privateKey.trim() !== ''

    if (!hasPassword && !hasPrivateKey) {
      reject(new Error('Authentication required. Please provide either a password or private key.'))
      return
    }

    const connectConfig: ConnectConfig = {
      host: host.trim(),
      port,
      username: params.username,
      readyTimeout: 10000,
    }

    if (hasPrivateKey) {
      connectConfig.privateKey = params.privateKey!
    } else if (hasPassword) {
      connectConfig.password = params.password!
    }

    client.on('ready', () => {
      resolve(client)
    })

    client.on('error', (err) => {
      reject(formatSFTPError(err, { host, port }))
    })

    try {
      client.connect(connectConfig)
    } catch (err) {
      reject(formatSFTPError(err instanceof Error ? err : new Error(String(err)), { host, port }))
    }
  })
}

/**
 * Get SFTP subsystem from SSH client
 */
function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`Failed to start SFTP session: ${err.message}`))
      } else {
        resolve(sftp)
      }
    })
  })
}

/**
 * Sanitize a remote path to prevent path traversal attacks
 */
function sanitizePath(remotePath: string): string {
  let sanitized = remotePath.replace(/\0/g, '')
  sanitized = sanitized.replace(/\\/g, '/')
  sanitized = sanitized.replace(/\/+/g, '/')
  sanitized = sanitized.trim()
  return sanitized
}

/**
 * Get file type from SFTP attributes mode bits
 */
function getFileType(mode: number): 'file' | 'directory' | 'symlink' | 'other' {
  const fileType = mode & S_IFMT
  if (fileType === S_IFDIR) return 'directory'
  if (fileType === S_IFREG) return 'file'
  if (fileType === S_IFLNK) return 'symlink'
  return 'other'
}

/**
 * Check if a path exists on the SFTP server
 */
function sftpExists(sftp: SFTPWrapper, remotePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.stat(remotePath, (err) => {
      resolve(!err)
    })
  })
}

/** Common SFTP connection schema fields */
const sftpConnectionSchema = {
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
}

/** Validate authentication credentials */
function validateAuth(params: { password?: string | null; privateKey?: string | null }): string | null {
  if (!params.password && !params.privateKey) {
    return 'Either password or privateKey must be provided for authentication'
  }
  return null
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

const handleList: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sftpConnectionSchema,
    path: z.string().default('.'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Listing directory ${params.path} on ${params.host}:${params.port}`)

  const client = await createSFTPConnection(params)
  try {
    const sftp = await getSftp(client)
    const remotePath = sanitizePath(params.path)

    const fileList = await new Promise<
      Array<{ filename: string; attrs: { size: number; mtime: number; mode: number } }>
    >((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          if (err.message.includes('No such file')) {
            reject(new Error(`Directory not found: ${remotePath}`))
          } else {
            reject(err)
          }
        } else {
          resolve(list)
        }
      })
    })

    const files = fileList
      .filter((item) => item.filename !== '.' && item.filename !== '..')
      .map((item) => ({
        name: item.filename,
        type: getFileType(item.attrs.mode),
        size: item.attrs.size,
        modifyTime: new Date((item.attrs.mtime || 0) * 1000).toISOString(),
      }))

    logger.info(`[${requestId}] Listed ${files.length} entries in ${remotePath}`)

    return {
      success: true,
      output: { files },
    }
  } finally {
    client.end()
  }
}

const handleUpload: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sftpConnectionSchema,
    remotePath: z.string().min(1, 'Remote path is required'),
    file: RawFileInputSchema,
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(
    `[${requestId}] Uploading file to ${params.host}:${params.port}${params.remotePath}`
  )

  const userFiles = processFilesToUserFiles(params.file, requestId, logger)
  if (userFiles.length === 0) {
    return { success: false, output: {}, error: 'No valid file provided' }
  }

  const userFile = userFiles[0]
  const buffer = await downloadFileFromStorage(userFile, requestId, logger)

  const client = await createSFTPConnection(params)
  try {
    const sftp = await getSftp(client)
    const remotePath = sanitizePath(params.remotePath)

    await new Promise<void>((resolve, reject) => {
      const writeStream = sftp.createWriteStream(remotePath, { mode: 0o644 })
      writeStream.on('error', reject)
      writeStream.on('close', () => resolve())
      writeStream.end(buffer)
    })

    logger.info(`[${requestId}] File uploaded successfully to ${remotePath}`)

    return {
      success: true,
      output: {
        uploaded: true,
        remotePath,
        size: buffer.length,
        message: `File uploaded successfully to ${remotePath}`,
      },
    }
  } finally {
    client.end()
  }
}

const handleDownload: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sftpConnectionSchema,
    remotePath: z.string().min(1, 'Remote path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(
    `[${requestId}] Downloading file from ${params.host}:${params.port}${params.remotePath}`
  )

  const client = await createSFTPConnection(params)
  try {
    const sftp = await getSftp(client)
    const remotePath = sanitizePath(params.remotePath)

    const stats = await new Promise<{ size: number }>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          if (err.message.includes('No such file')) {
            reject(new Error(`File not found: ${remotePath}`))
          } else {
            reject(err)
          }
        } else {
          resolve(stats)
        }
      })
    })

    const maxSize = 50 * 1024 * 1024
    if (stats.size > maxSize) {
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
      return {
        success: false,
        output: {},
        error: `File size (${sizeMB}MB) exceeds download limit of 50MB`,
      }
    }

    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const readStream = sftp.createReadStream(remotePath)
      readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      readStream.on('end', () => resolve())
      readStream.on('error', reject)
    })

    const buffer = Buffer.concat(chunks)
    const filename = path.basename(remotePath)

    logger.info(`[${requestId}] Downloaded ${filename} (${buffer.length} bytes)`)

    return {
      success: true,
      output: {
        content: buffer.toString('base64'),
        filename,
        size: buffer.length,
      },
    }
  } finally {
    client.end()
  }
}

const handleDelete: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sftpConnectionSchema,
    remotePath: z.string().min(1, 'Remote path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Deleting ${params.remotePath} on ${params.host}:${params.port}`)

  const client = await createSFTPConnection(params)
  try {
    const sftp = await getSftp(client)
    const remotePath = sanitizePath(params.remotePath)

    await new Promise<void>((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (err) {
          if (err.message.includes('No such file')) {
            reject(new Error(`File not found: ${remotePath}`))
          } else {
            reject(err)
          }
        } else {
          resolve()
        }
      })
    })

    logger.info(`[${requestId}] Successfully deleted ${remotePath}`)

    return {
      success: true,
      output: {
        deleted: true,
        remotePath,
        message: `Successfully deleted ${remotePath}`,
      },
    }
  } finally {
    client.end()
  }
}

const handleMkdir: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sftpConnectionSchema,
    path: z.string().min(1, 'Path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Creating directory ${params.path} on ${params.host}:${params.port}`)

  const client = await createSFTPConnection(params)
  try {
    const sftp = await getSftp(client)
    const remotePath = sanitizePath(params.path)

    const parts = remotePath.split('/').filter(Boolean)
    let currentPath = remotePath.startsWith('/') ? '' : ''

    for (const part of parts) {
      currentPath = currentPath
        ? `${currentPath}/${part}`
        : remotePath.startsWith('/')
          ? `/${part}`
          : part

      const exists = await sftpExists(sftp, currentPath)
      if (!exists) {
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(currentPath, (err) => {
            if (err && !err.message.includes('already exists')) reject(err)
            else resolve()
          })
        })
      }
    }

    logger.info(`[${requestId}] Successfully created directory ${remotePath}`)

    return {
      success: true,
      output: {
        created: true,
        path: remotePath,
        message: `Successfully created directory ${remotePath}`,
      },
    }
  } finally {
    client.end()
  }
}

// ---------------------------------------------------------------------------
// Export handler map
// ---------------------------------------------------------------------------

export const sftpHandlers: Record<string, ToolProxyHandler> = {
  list: handleList,
  upload: handleUpload,
  download: handleDownload,
  delete: handleDelete,
  mkdir: handleMkdir,
}
