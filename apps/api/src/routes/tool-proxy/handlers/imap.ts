import * as net from 'node:net'
import * as tls from 'node:tls'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('ImapHandler')

const MailboxesSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().min(1, 'Port is required').default(993),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  tls: z.boolean().optional().default(true),
  rejectUnauthorized: z.boolean().optional().default(true),
})

/**
 * Send an IMAP command and wait for the tagged response.
 */
function sendImapCommand(
  socket: net.Socket | tls.TLSSocket,
  tag: string,
  command: string
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    let buffer = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`IMAP command timed out: ${command}`))
    }, 15000)

    const onData = (data: Buffer) => {
      buffer += data.toString()
      const parts = buffer.split('\r\n')
      buffer = parts.pop() || ''

      for (const line of parts) {
        lines.push(line)
        if (
          line.startsWith(`${tag} OK`) ||
          line.startsWith(`${tag} NO`) ||
          line.startsWith(`${tag} BAD`)
        ) {
          cleanup()
          if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
            reject(new Error(`IMAP error: ${line}`))
          } else {
            resolve(lines)
          }
        }
      }
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const cleanup = () => {
      clearTimeout(timeout)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
    }

    socket.on('data', onData)
    socket.on('error', onError)
    socket.write(`${tag} ${command}\r\n`)
  })
}

/**
 * Wait for the IMAP server greeting.
 */
function waitForGreeting(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('IMAP greeting timed out'))
    }, 10000)

    const onData = (data: Buffer) => {
      buffer += data.toString()
      if (buffer.includes('\r\n')) {
        cleanup()
        resolve(buffer.trim())
      }
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const cleanup = () => {
      clearTimeout(timeout)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
    }

    socket.on('data', onData)
    socket.on('error', onError)
  })
}

/**
 * Parse IMAP LIST response lines to extract mailbox information.
 */
function parseMailboxes(lines: string[]): Array<{ path: string; name: string; delimiter: string }> {
  const mailboxes: Array<{ path: string; name: string; delimiter: string }> = []
  for (const line of lines) {
    const match = line.match(/^\* LIST \([^)]*\) "([^"]*)" (.+)$/)
    if (match) {
      const delimiter = match[1]
      let path = match[2].trim()
      if (path.startsWith('"') && path.endsWith('"')) {
        path = path.slice(1, -1)
      }
      const parts = path.split(delimiter)
      const name = parts[parts.length - 1] || path
      mailboxes.push({ path, name, delimiter })
    }
  }
  return mailboxes
}

/**
 * Enhance IMAP error messages with user-friendly descriptions.
 */
function enhanceImapError(errorMessage: string): string {
  if (
    errorMessage.includes('AUTHENTICATIONFAILED') ||
    errorMessage.includes('Invalid credentials')
  ) {
    return 'Invalid username or password. For Gmail, use an App Password.'
  }
  if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
    return 'Could not find IMAP server. Please check the hostname.'
  }
  if (errorMessage.includes('ECONNREFUSED')) {
    return 'Connection refused. Please check the port and SSL settings.'
  }
  if (errorMessage.includes('certificate') || errorMessage.includes('SSL')) {
    return 'TLS/SSL error. Try disabling "Verify TLS Certificate" for self-signed certificates.'
  }
  if (errorMessage.includes('timeout')) {
    return 'Connection timed out. Please check your network and server settings.'
  }
  return `Failed to connect to IMAP server: ${errorMessage}`
}

/**
 * List mailboxes from an IMAP server.
 */
const handleMailboxes: ToolProxyHandler = async (body, _c) => {
  const requestId = generateRequestId()

  try {
    const validated = MailboxesSchema.parse(body)

    logger.info(`[${requestId}] Connecting to IMAP server`, {
      host: validated.host,
      port: validated.port,
      tls: validated.tls,
    })

    const socket: net.Socket | tls.TLSSocket = validated.tls
      ? tls.connect({
          host: validated.host,
          port: validated.port,
          rejectUnauthorized: validated.rejectUnauthorized,
        })
      : net.connect({ host: validated.host, port: validated.port })

    try {
      await waitForGreeting(socket)

      await sendImapCommand(
        socket,
        'A001',
        `LOGIN "${validated.username}" "${validated.password}"`
      )

      const listLines = await sendImapCommand(socket, 'A002', 'LIST "" "*"')
      const mailboxes = parseMailboxes(listLines)

      await sendImapCommand(socket, 'A003', 'LOGOUT').catch(() => {
        /* ignore logout errors */
      })

      mailboxes.sort((a, b) => {
        if (a.path === 'INBOX') return -1
        if (b.path === 'INBOX') return 1
        return a.path.localeCompare(b.path)
      })

      logger.info(`[${requestId}] Successfully listed ${mailboxes.length} mailboxes`)

      return {
        success: true,
        output: { mailboxes },
      }
    } finally {
      socket.destroy()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error listing IMAP mailboxes:`, error)
    return {
      success: false,
      output: {},
      error: enhanceImapError(errorMessage),
    }
  }
}

export const imapHandlers: Record<string, ToolProxyHandler> = {
  mailboxes: handleMailboxes,
}
