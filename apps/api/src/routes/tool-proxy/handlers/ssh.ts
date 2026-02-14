import path from 'path'
import { createLogger } from '@sim/logger'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('SSHHandler')

/** POSIX file type constants */
const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000

/**
 * Format SSH error with helpful troubleshooting context
 */
function formatSSHError(err: Error, config: { host: string; port: number }): Error {
  const errorMessage = err.message.toLowerCase()
  const { host, port } = config

  if (errorMessage.includes('econnrefused') || errorMessage.includes('connection refused')) {
    return new Error(
      `Connection refused to ${host}:${port}. ` +
        `Please verify: (1) SSH server is running, ` +
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
        `(3) The SSH server is responding.`
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
        `(3) User has SSH access on the server.`
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

  return new Error(`SSH connection to ${host}:${port} failed: ${err.message}`)
}

/**
 * Create an SSH connection using the provided parameters
 */
function createSSHConnection(params: {
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
      reject(formatSSHError(err, { host, port }))
    })

    try {
      client.connect(connectConfig)
    } catch (err) {
      reject(formatSSHError(err instanceof Error ? err : new Error(String(err)), { host, port }))
    }
  })
}

/**
 * Execute a command on the SSH connection and collect output
 */
function executeCommand(
  client: Client,
  command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err)
        return
      }

      let stdout = ''
      let stderr = ''

      stream.on('close', (code: number) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: code ?? 0,
        })
      })

      stream.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
    })
  })
}

/**
 * Execute an SFTP operation using the SSH client
 */
function executeSFTPOperation<T>(
  client: Client,
  fn: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`Failed to start SFTP session: ${err.message}`))
        return
      }
      fn(sftp).then(resolve).catch(reject)
    })
  })
}

/**
 * Escape a string for safe use in single-quoted shell arguments
 */
function escapeShellArg(arg: string): string {
  return arg.replace(/'/g, "'\\''")
}

/**
 * Sanitize a file path to prevent path traversal attacks
 */
function sanitizePath(filePath: string): string {
  let sanitized = filePath.replace(/\0/g, '')
  sanitized = sanitized.trim()

  const pathTraversalPatterns = ['../', '..\\', '%2e%2e%2f', '%2e%2e/', '%2e%2e%5c', '%2e%2e\\']
  const lowerPath = sanitized.toLowerCase()
  for (const pattern of pathTraversalPatterns) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      throw new Error('Path contains invalid path traversal sequences')
    }
  }

  const segments = sanitized.split(/[/\\]/)
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error('Path contains invalid path traversal sequences')
    }
  }

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
 * Parse file permissions from mode bits to octal string
 */
function parsePermissions(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`
}

/** Common SSH connection schema fields */
const sshConnectionSchema = {
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
}

/** Validate authentication credentials and return error response if invalid */
function validateAuth(params: { password?: string | null; privateKey?: string | null }): string | null {
  if (!params.password && !params.privateKey) {
    return 'Either password or privateKey must be provided for authentication'
  }
  return null
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

const handleExecuteCommand: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    command: z.string().min(1, 'Command is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Executing SSH command on ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const result = await executeCommand(client, params.command)
    logger.info(`[${requestId}] Command executed with exit code ${result.code}`)

    return {
      success: true,
      output: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
      },
    }
  } finally {
    client.end()
  }
}

const handleExecuteScript: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    script: z.string().min(1, 'Script content is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Executing SSH script on ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const scriptPath = `/tmp/sim_script_${requestId}.sh`
    const escapedScriptPath = escapeShellArg(scriptPath)

    const command = `cat > '${escapedScriptPath}' << 'SIMEOF'
${params.script}
SIMEOF
chmod +x '${escapedScriptPath}'
/bin/bash '${escapedScriptPath}'
exit_code=$?
rm -f '${escapedScriptPath}'
exit $exit_code`

    const result = await executeCommand(client, command)
    logger.info(`[${requestId}] Script executed with exit code ${result.code}`)

    return {
      success: true,
      output: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
      },
    }
  } finally {
    client.end()
  }
}

const handleReadFileContent: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    path: z.string().min(1, 'Path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Reading file ${params.path} on ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const filePath = sanitizePath(params.path)
    const result = await executeSFTPOperation(client, async (sftp) => {
      const stats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(filePath, (err, stats) => {
          if (err) reject(new Error(`File not found: ${filePath}`))
          else resolve(stats)
        })
      })

      const content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(filePath)
        readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
        readStream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        readStream.on('error', reject)
      })

      return { content, size: stats.size }
    })

    logger.info(`[${requestId}] File read successfully: ${result.size} bytes`)

    return {
      success: true,
      output: {
        content: result.content,
        size: result.size,
      },
    }
  } finally {
    client.end()
  }
}

const handleWriteFileContent: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    path: z.string().min(1, 'Path is required'),
    content: z.string(),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Writing file ${params.path} on ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const filePath = sanitizePath(params.path)
    await executeSFTPOperation(client, async (sftp) => {
      await new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(filePath, { mode: 0o644 })
        writeStream.on('error', reject)
        writeStream.on('close', () => resolve())
        writeStream.end(Buffer.from(params.content, 'utf-8'))
      })
    })

    logger.info(`[${requestId}] File written successfully`)

    return {
      success: true,
      output: {
        written: true,
        path: filePath,
        message: `File written successfully to ${filePath}`,
      },
    }
  } finally {
    client.end()
  }
}

const handleUploadFile: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    remotePath: z.string().min(1, 'Remote path is required'),
    file: RawFileInputSchema,
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Uploading file to ${params.host}:${params.port}${params.remotePath}`)

  const userFiles = processFilesToUserFiles(params.file, requestId, logger)
  if (userFiles.length === 0) {
    return { success: false, output: {}, error: 'No valid file provided' }
  }

  const userFile = userFiles[0]
  const buffer = await downloadFileFromStorage(userFile, requestId, logger)

  const client = await createSSHConnection(params)
  try {
    const remotePath = sanitizePath(params.remotePath)
    await executeSFTPOperation(client, async (sftp) => {
      await new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(remotePath, { mode: 0o644 })
        writeStream.on('error', reject)
        writeStream.on('close', () => resolve())
        writeStream.end(buffer)
      })
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

const handleDownloadFile: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
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

  const client = await createSSHConnection(params)
  try {
    const remotePath = sanitizePath(params.remotePath)
    const result = await executeSFTPOperation(client, async (sftp) => {
      const stats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => {
          if (err) reject(new Error(`File not found: ${remotePath}`))
          else resolve(stats)
        })
      })

      const maxSize = 50 * 1024 * 1024
      if (stats.size > maxSize) {
        throw new Error(
          `File size (${(stats.size / (1024 * 1024)).toFixed(2)}MB) exceeds download limit of 50MB`
        )
      }

      const content = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(remotePath)
        readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
        readStream.on('end', () => resolve(Buffer.concat(chunks)))
        readStream.on('error', reject)
      })

      return { content, size: stats.size }
    })

    const filename = path.basename(remotePath)
    logger.info(`[${requestId}] File downloaded successfully: ${filename}`)

    return {
      success: true,
      output: {
        content: result.content.toString('base64'),
        filename,
        size: result.size,
      },
    }
  } finally {
    client.end()
  }
}

const handleListDirectory: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    path: z.string().default('.'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Listing directory ${params.path} on ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const dirPath = sanitizePath(params.path)
    const files = await executeSFTPOperation(client, async (sftp) => {
      const list = await new Promise<
        Array<{ filename: string; attrs: { size: number; mtime: number; mode: number } }>
      >((resolve, reject) => {
        sftp.readdir(dirPath, (err, list) => {
          if (err) reject(new Error(`Directory not found: ${dirPath}`))
          else resolve(list)
        })
      })

      return list
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map((item) => ({
          name: item.filename,
          type: getFileType(item.attrs.mode),
          size: item.attrs.size,
          modifyTime: new Date((item.attrs.mtime || 0) * 1000).toISOString(),
          permissions: parsePermissions(item.attrs.mode),
        }))
    })

    logger.info(`[${requestId}] Listed ${files.length} entries`)

    return {
      success: true,
      output: { files },
    }
  } finally {
    client.end()
  }
}

const handleCreateDirectory: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    path: z.string().min(1, 'Path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Creating directory ${params.path} on ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const dirPath = sanitizePath(params.path)
    await executeSFTPOperation(client, async (sftp) => {
      const parts = dirPath.split('/').filter(Boolean)
      let currentPath = dirPath.startsWith('/') ? '' : ''

      for (const part of parts) {
        currentPath = currentPath
          ? `${currentPath}/${part}`
          : dirPath.startsWith('/')
            ? `/${part}`
            : part

        const exists = await new Promise<boolean>((resolve) => {
          sftp.stat(currentPath, (err) => resolve(!err))
        })

        if (!exists) {
          await new Promise<void>((resolve, reject) => {
            sftp.mkdir(currentPath, (err) => {
              if (err && !err.message.includes('already exists')) reject(err)
              else resolve()
            })
          })
        }
      }
    })

    logger.info(`[${requestId}] Directory created successfully: ${dirPath}`)

    return {
      success: true,
      output: {
        created: true,
        path: dirPath,
        message: `Directory created successfully: ${dirPath}`,
      },
    }
  } finally {
    client.end()
  }
}

const handleDeleteFile: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    path: z.string().min(1, 'Path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Deleting file ${params.path} on ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const filePath = sanitizePath(params.path)
    await executeSFTPOperation(client, async (sftp) => {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(filePath, (err) => {
          if (err) reject(new Error(`Failed to delete file: ${filePath} - ${err.message}`))
          else resolve()
        })
      })
    })

    logger.info(`[${requestId}] File deleted successfully: ${filePath}`)

    return {
      success: true,
      output: {
        deleted: true,
        path: filePath,
        message: `Successfully deleted: ${filePath}`,
      },
    }
  } finally {
    client.end()
  }
}

const handleCheckFileExists: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    path: z.string().min(1, 'Path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(
    `[${requestId}] Checking if ${params.path} exists on ${params.host}:${params.port}`
  )

  const client = await createSSHConnection(params)
  try {
    const filePath = sanitizePath(params.path)
    const result = await executeSFTPOperation(client, async (sftp) => {
      return new Promise<{ exists: boolean; type?: string; size?: number }>((resolve) => {
        sftp.stat(filePath, (err, stats) => {
          if (err) {
            resolve({ exists: false })
          } else {
            resolve({
              exists: true,
              type: getFileType(stats.mode),
              size: stats.size,
            })
          }
        })
      })
    })

    logger.info(`[${requestId}] Path ${filePath} ${result.exists ? 'exists' : 'does not exist'}`)

    return {
      success: true,
      output: result,
    }
  } finally {
    client.end()
  }
}

const handleCheckCommandExists: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    command: z.string().min(1, 'Command name is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(
    `[${requestId}] Checking if command '${params.command}' exists on ${params.host}:${params.port}`
  )

  const client = await createSSHConnection(params)
  try {
    const escapedCommand = escapeShellArg(params.command)
    const result = await executeCommand(
      client,
      `command -v '${escapedCommand}' 2>/dev/null || which '${escapedCommand}' 2>/dev/null`
    )

    const exists = result.code === 0 && result.stdout.trim().length > 0
    const commandPath = exists ? result.stdout.trim() : undefined

    logger.info(
      `[${requestId}] Command '${params.command}' ${exists ? 'exists' : 'does not exist'}`
    )

    return {
      success: true,
      output: {
        exists,
        path: commandPath,
      },
    }
  } finally {
    client.end()
  }
}

const handleGetSystemInfo: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(`[${requestId}] Getting system info from ${params.host}:${params.port}`)

  const client = await createSSHConnection(params)
  try {
    const infoCommand = `uname -a && echo "---SEPARATOR---" && df -h && echo "---SEPARATOR---" && (free -h 2>/dev/null || echo "N/A") && echo "---SEPARATOR---" && uptime`
    const result = await executeCommand(client, infoCommand)

    const sections = result.stdout.split('---SEPARATOR---').map((s) => s.trim())
    const [uname, diskUsage, memoryInfo, uptimeInfo] = sections

    logger.info(`[${requestId}] System info retrieved successfully`)

    return {
      success: true,
      output: {
        uname: uname || '',
        diskUsage: diskUsage || '',
        memoryInfo: memoryInfo || '',
        uptime: uptimeInfo || '',
      },
    }
  } finally {
    client.end()
  }
}

const handleMoveRename: ToolProxyHandler = async (body): Promise<ToolResponse> => {
  const requestId = generateRequestId()
  const schema = z.object({
    ...sshConnectionSchema,
    sourcePath: z.string().min(1, 'Source path is required'),
    destPath: z.string().min(1, 'Destination path is required'),
  })

  const params = schema.parse(body)
  const authError = validateAuth(params)
  if (authError) {
    return { success: false, output: {}, error: authError }
  }

  logger.info(
    `[${requestId}] Moving ${params.sourcePath} to ${params.destPath} on ${params.host}:${params.port}`
  )

  const client = await createSSHConnection(params)
  try {
    const sourcePath = sanitizePath(params.sourcePath)
    const destPath = sanitizePath(params.destPath)
    const escapedSource = escapeShellArg(sourcePath)
    const escapedDest = escapeShellArg(destPath)

    const result = await executeCommand(client, `mv '${escapedSource}' '${escapedDest}'`)

    if (result.code !== 0) {
      throw new Error(result.stderr || 'Failed to move/rename')
    }

    logger.info(`[${requestId}] Successfully moved ${sourcePath} to ${destPath}`)

    return {
      success: true,
      output: {
        moved: true,
        sourcePath,
        destPath,
        message: `Successfully moved ${sourcePath} to ${destPath}`,
      },
    }
  } finally {
    client.end()
  }
}

// ---------------------------------------------------------------------------
// Export handler map
// ---------------------------------------------------------------------------

export const sshHandlers: Record<string, ToolProxyHandler> = {
  'execute-command': handleExecuteCommand,
  'execute-script': handleExecuteScript,
  'read-file-content': handleReadFileContent,
  'write-file-content': handleWriteFileContent,
  'upload-file': handleUploadFile,
  'download-file': handleDownloadFile,
  'list-directory': handleListDirectory,
  'create-directory': handleCreateDirectory,
  'delete-file': handleDeleteFile,
  'check-file-exists': handleCheckFileExists,
  'check-command-exists': handleCheckCommandExists,
  'get-system-info': handleGetSystemInfo,
  'move-rename': handleMoveRename,
}
