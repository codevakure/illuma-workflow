/**
 * Executor stub for client-side compilation.
 * The actual executor runs server-side only.
 */
import type { ExecutionResult } from '@/executor/types'

export class DAGExecutor {
  constructor(_workflow: unknown, _context?: unknown) {}
  async execute(_input?: unknown): Promise<ExecutionResult> {
    throw new Error('DAGExecutor is only available on the server')
  }
  async continueExecution(_pendingBlocks: unknown, _context?: unknown): Promise<ExecutionResult> {
    throw new Error('continueExecution is only available on the server')
  }
}
