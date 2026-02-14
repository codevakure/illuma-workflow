/**
 * Server-side stub for useSubBlockStore.
 * The API does not maintain a live Zustand subblock store.
 * Provides getState() with empty/no-op values so that code importing
 * useSubBlockStore.getState() compiles and returns safe defaults.
 */

import type { SubBlockStore } from '@/stores/workflows/subblock/types'

export const useSubBlockStore = {
  getState: (): SubBlockStore => ({
    workflowValues: {},
    loadingWebhooks: new Set<string>(),
    checkedWebhooks: new Set<string>(),
    setValue: () => {},
    getValue: () => null,
    clear: () => {},
    initializeFromWorkflow: () => {},
    setWorkflowValues: () => {},
  }),
}
