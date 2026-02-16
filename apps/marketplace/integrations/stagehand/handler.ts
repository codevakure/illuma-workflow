import type { ToolHandler } from '../../sdk/types'

/**
 * Stagehand operations require a server-side Browserbase/Stagehand instance.
 * These handlers validate parameters and delegate to the runtime Stagehand implementation.
 * In the marketplace execution environment, a Browserbase account and Stagehand library must be available.
 */

const handler: ToolHandler = {
  operations: {
    stagehand_agent: async (params) => {
      const startUrl = params.startUrl as string
      const task = params.task as string
      const apiKey = params.apiKey as string

      if (!startUrl) {
        return { success: false, output: {}, error: 'Missing required parameter: startUrl' }
      }
      if (!task) {
        return { success: false, output: {}, error: 'Missing required parameter: task' }
      }
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      throw new Error(
        'Stagehand agent operations require a server-side Browserbase/Stagehand instance. ' +
          'This handler must be executed in an environment with Browserbase and Stagehand support.'
      )
    },

    stagehand_extract: async (params) => {
      const url = params.url as string
      const instruction = params.instruction as string
      const apiKey = params.apiKey as string
      const schema = params.schema as Record<string, unknown>

      if (!url) {
        return { success: false, output: {}, error: 'Missing required parameter: url' }
      }
      if (!instruction) {
        return { success: false, output: {}, error: 'Missing required parameter: instruction' }
      }
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!schema) {
        return { success: false, output: {}, error: 'Missing required parameter: schema' }
      }

      throw new Error(
        'Stagehand extract operations require a server-side Browserbase/Stagehand instance. ' +
          'This handler must be executed in an environment with Browserbase and Stagehand support.'
      )
    },
  },
}

export default handler
