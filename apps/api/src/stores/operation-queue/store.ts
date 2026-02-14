/**
 * Operation queue store stub.
 * Simplified to avoid zustand dependency in the API server.
 */

interface QueueEntry {
  id: string
  operation: {
    operation: string
    target: string
    payload: unknown
  }
  workflowId: string
  userId: string
}

interface OperationQueueState {
  queue: QueueEntry[]
  addToQueue: (entry: QueueEntry) => void
}

const state: OperationQueueState = {
  queue: [],
  addToQueue: (entry: QueueEntry) => {
    state.queue = [...state.queue, entry]
  },
}

export const useOperationQueueStore = {
  getState: (): OperationQueueState => state,
}
