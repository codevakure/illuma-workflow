/**
 * A2A utility stubs for client-side compilation.
 * The full implementation requires @a2a-js/sdk which is server-side.
 */

import { A2A_TERMINAL_STATES } from './constants'

/**
 * Check if a task state is terminal (completed, failed, or canceled)
 */
export function isTerminalState(state: string): boolean {
  return (A2A_TERMINAL_STATES as readonly string[]).includes(state)
}
