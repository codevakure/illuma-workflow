/**
 * Type definitions for run-from-block execution mode.
 * Implementation is server-side only.
 */

export interface RunFromBlockContext {
  startBlockId: string
  dirtySet: Set<string>
}

export interface ExecutionSets {
  dirtySet: Set<string>
  upstreamSet: Set<string>
  reachableUpstreamSet: Set<string>
}
