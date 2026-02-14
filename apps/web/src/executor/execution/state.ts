/**
 * Execution state types for client-side compilation.
 */
import type { BlockState, NormalizedBlockOutput } from '@/executor/types'

export interface LoopScope {
  iteration: number
  currentIterationOutputs: Map<string, NormalizedBlockOutput>
  allIterationOutputs: NormalizedBlockOutput[][]
  maxIterations?: number
  item?: any
  items?: any[]
  condition?: string
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
  skipFirstConditionCheck?: boolean
  validationError?: string
}

export class ExecutionState {
  constructor() {}
}
