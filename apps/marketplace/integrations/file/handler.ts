import type { ToolHandler } from '../../sdk/types'

/**
 * File parser operations rely on server-side file parsing infrastructure
 * (PDF parsing, CSV parsing, image OCR, etc.). These handlers validate
 * parameters and delegate to the runtime file parsing implementation.
 */

const handler: ToolHandler = {
  operations: {
    file_parser: async (params) => {
      if (!params.filePath && !params.file) {
        return { success: false, output: {}, error: 'Missing required parameter: filePath or file' }
      }

      throw new Error(
        'File parser operations require server-side file parsing infrastructure. ' +
        'This handler must be executed in an environment with file parsing support.'
      )
    },

    file_parser_v2: async (params) => {
      if (!params.filePath && !params.file) {
        return { success: false, output: {}, error: 'Missing required parameter: filePath or file' }
      }

      throw new Error(
        'File parser operations require server-side file parsing infrastructure. ' +
        'This handler must be executed in an environment with file parsing support.'
      )
    },

    file_parser_v3: async (params) => {
      if (!params.filePath && !params.file) {
        return { success: false, output: {}, error: 'Missing required parameter: filePath or file' }
      }

      throw new Error(
        'File parser operations require server-side file parsing infrastructure. ' +
        'This handler must be executed in an environment with file parsing support.'
      )
    },
  },
}

export default handler
