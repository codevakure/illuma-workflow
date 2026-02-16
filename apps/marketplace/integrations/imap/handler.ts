import type { ToolHandler } from '../../sdk/types'

function parseMailboxes(data: string): string[] {
  const mailboxes: string[] = []
  const lines = data.split('\r\n')

  for (const line of lines) {
    const match = line.match(/^\* LIST \([^)]*\) "[^"]*" "?([^"\r\n]+)"?$/)
    if (match) {
      mailboxes.push(match[1])
    }
  }

  return mailboxes
}

async function imapConnect(params: {
  host: string
  port: number
  username: string
  password: string
  useTLS: boolean
}): Promise<string[]> {
  const net = await import('net')
  const tls = await import('tls')

  return new Promise((resolve, reject) => {
    const timeout = 15000
    let buffer = ''
    let state: 'greeting' | 'login' | 'list' | 'logout' = 'greeting'
    let socket: ReturnType<typeof net.connect> | ReturnType<typeof tls.connect>

    const timer = setTimeout(() => {
      socket?.destroy()
      reject(new Error('IMAP connection timeout'))
    }, timeout)

    function handleData(chunk: Buffer) {
      buffer += chunk.toString()

      if (state === 'greeting' && buffer.includes('\r\n')) {
        state = 'login'
        buffer = ''
        const escapedUser = params.username.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const escapedPass = params.password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        socket.write(`a1 LOGIN "${escapedUser}" "${escapedPass}"\r\n`)
      } else if (state === 'login' && buffer.includes('a1 ')) {
        if (buffer.includes('a1 OK')) {
          state = 'list'
          buffer = ''
          socket.write('a2 LIST "" "*"\r\n')
        } else {
          clearTimeout(timer)
          socket.destroy()
          reject(new Error('IMAP login failed: Invalid credentials'))
        }
      } else if (state === 'list' && buffer.includes('a2 ')) {
        if (buffer.includes('a2 OK')) {
          const mailboxes = parseMailboxes(buffer)
          state = 'logout'
          socket.write('a3 LOGOUT\r\n')
          clearTimeout(timer)
          socket.destroy()
          resolve(mailboxes)
        } else {
          clearTimeout(timer)
          socket.destroy()
          reject(new Error('IMAP LIST command failed'))
        }
      }
    }

    function handleError(err: Error) {
      clearTimeout(timer)
      reject(new Error(`IMAP connection error: ${err.message}`))
    }

    if (params.useTLS) {
      socket = tls.connect(
        { host: params.host, port: params.port, rejectUnauthorized: false },
        () => {}
      )
    } else {
      socket = net.connect({ host: params.host, port: params.port })
    }

    socket.on('data', handleData)
    socket.on('error', handleError)
  })
}

const handler: ToolHandler = {
  operations: {
    imap_mailboxes: async (params) => {
      const host = params.host as string
      const port = Number(params.port) || 993
      const username = params.username as string
      const password = params.password as string
      const useTLS = params.useTLS !== false

      if (!host || !username || !password) {
        return {
          success: false,
          output: {},
          error: 'Missing required parameters: host, username, password',
        }
      }

      try {
        const mailboxes = await imapConnect({ host, port, username, password, useTLS })

        return {
          success: true,
          output: {
            mailboxes,
            count: mailboxes.length,
          },
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to list mailboxes'
        return { success: false, output: {}, error: errorMessage }
      }
    },
  },
}

export default handler
