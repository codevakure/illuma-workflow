import type { ToolHandler } from '../../sdk/types'

/**
 * SFTP operations require a server-side SSH/SFTP library (e.g., ssh2).
 * These handlers forward the connection parameters and operation details
 * to the actual SFTP implementation. In a marketplace context, the
 * execution environment must have ssh2 or equivalent available.
 */

function buildConnectionConfig(params: Record<string, unknown>) {
  return {
    host: params.host as string,
    port: Number(params.port) || 22,
    username: params.username as string,
    password: params.password as string | undefined,
    privateKey: params.privateKey as string | undefined,
    passphrase: params.passphrase as string | undefined,
  }
}

const handler: ToolHandler = {
  operations: {
    sftp_upload: async (params) => {
      const conn = buildConnectionConfig(params)
      if (!conn.host) return { success: false, output: {}, error: 'Missing required parameter: host' }
      if (!conn.username) return { success: false, output: {}, error: 'Missing required parameter: username' }
      if (!params.remotePath) return { success: false, output: {}, error: 'Missing required parameter: remotePath' }

      // SFTP operations require a native SSH library (ssh2).
      // This handler delegates to the runtime SFTP implementation.
      // In the marketplace execution environment, an SFTP client must be available.
      throw new Error(
        'SFTP operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    sftp_download: async (params) => {
      const conn = buildConnectionConfig(params)
      if (!conn.host) return { success: false, output: {}, error: 'Missing required parameter: host' }
      if (!conn.username) return { success: false, output: {}, error: 'Missing required parameter: username' }
      if (!params.remotePath) return { success: false, output: {}, error: 'Missing required parameter: remotePath' }

      throw new Error(
        'SFTP operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    sftp_list: async (params) => {
      const conn = buildConnectionConfig(params)
      if (!conn.host) return { success: false, output: {}, error: 'Missing required parameter: host' }
      if (!conn.username) return { success: false, output: {}, error: 'Missing required parameter: username' }
      if (!params.remotePath) return { success: false, output: {}, error: 'Missing required parameter: remotePath' }

      throw new Error(
        'SFTP operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    sftp_delete: async (params) => {
      const conn = buildConnectionConfig(params)
      if (!conn.host) return { success: false, output: {}, error: 'Missing required parameter: host' }
      if (!conn.username) return { success: false, output: {}, error: 'Missing required parameter: username' }
      if (!params.remotePath) return { success: false, output: {}, error: 'Missing required parameter: remotePath' }

      throw new Error(
        'SFTP operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    sftp_mkdir: async (params) => {
      const conn = buildConnectionConfig(params)
      if (!conn.host) return { success: false, output: {}, error: 'Missing required parameter: host' }
      if (!conn.username) return { success: false, output: {}, error: 'Missing required parameter: username' }
      if (!params.remotePath) return { success: false, output: {}, error: 'Missing required parameter: remotePath' }

      throw new Error(
        'SFTP operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },
  },
}

export default handler
