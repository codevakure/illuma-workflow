import type { ToolHandler } from '../../sdk/types'

/**
 * SSH operations require a server-side SSH library (e.g., ssh2).
 * These handlers validate parameters and delegate to the runtime SSH implementation.
 * In the marketplace execution environment, an SSH client must be available.
 */

function validateConnection(params: Record<string, unknown>): string | null {
  if (!params.host) return 'Missing required parameter: host'
  if (!params.username) return 'Missing required parameter: username'
  if (!params.password && !params.privateKey) return 'Either password or privateKey is required'
  return null
}

const handler: ToolHandler = {
  operations: {
    ssh_execute_command: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.command) return { success: false, output: {}, error: 'Missing required parameter: command' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_execute_script: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.script) return { success: false, output: {}, error: 'Missing required parameter: script' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_upload_file: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.fileContent) return { success: false, output: {}, error: 'Missing required parameter: fileContent' }
      if (!params.fileName) return { success: false, output: {}, error: 'Missing required parameter: fileName' }
      if (!params.remotePath) return { success: false, output: {}, error: 'Missing required parameter: remotePath' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_download_file: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.remotePath) return { success: false, output: {}, error: 'Missing required parameter: remotePath' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_list_directory: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_read_file_content: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_write_file_content: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.path) return { success: false, output: {}, error: 'Missing required parameter: path' }
      if (!params.content) return { success: false, output: {}, error: 'Missing required parameter: content' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_delete_file: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_create_directory: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_move_rename: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.sourcePath) return { success: false, output: {}, error: 'Missing required parameter: sourcePath' }
      if (!params.destinationPath) return { success: false, output: {}, error: 'Missing required parameter: destinationPath' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_check_file_exists: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_check_command_exists: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }
      if (!params.commandName) return { success: false, output: {}, error: 'Missing required parameter: commandName' }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },

    ssh_get_system_info: async (params) => {
      const err = validateConnection(params)
      if (err) return { success: false, output: {}, error: err }

      throw new Error(
        'SSH operations require a server-side SSH library. ' +
        'This handler must be executed in an environment with ssh2 support.'
      )
    },
  },
}

export default handler
