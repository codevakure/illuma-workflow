import type { ToolHandler } from '../../sdk/types'

/**
 * Circleback is a trigger-only integration (webhook-based).
 * It receives meeting data via webhooks and does not expose any callable tool operations.
 * The execute operation is a no-op placeholder required by the manifest.
 */
const handler: ToolHandler = {
  operations: {
    circleback_execute: async (_params, _ctx) => {
      return {
        success: true,
        output: {
          message:
            'Circleback is a trigger-only integration. Meeting data is received via webhooks when meetings are processed.',
        },
      }
    },
  },
}

export default handler
