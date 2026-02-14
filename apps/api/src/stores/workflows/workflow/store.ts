/**
 * Server-side stub for useWorkflowStore.
 * The API does not maintain a live Zustand workflow store.
 * Provides getState() with empty/no-op values so that code importing
 * useWorkflowStore.getState() compiles and returns safe defaults.
 */

import type { WorkflowState, WorkflowStore } from '@/stores/workflows/workflow/types'

const emptyWorkflowState: WorkflowState = {
  blocks: {},
  edges: [],
  loops: {},
  parallels: {},
}

export const useWorkflowStore = {
  getState: (): WorkflowStore => ({
    ...emptyWorkflowState,
    updateNodeDimensions: () => {},
    batchUpdateBlocksWithParent: () => {},
    batchUpdatePositions: () => {},
    batchAddBlocks: () => {},
    batchRemoveBlocks: () => {},
    batchToggleEnabled: () => {},
    batchToggleHandles: () => {},
    batchAddEdges: () => {},
    batchRemoveEdges: () => {},
    clear: () => emptyWorkflowState,
    updateLastSaved: () => {},
    setBlockEnabled: () => {},
    duplicateBlock: () => {},
    setBlockHandles: () => {},
    updateBlockName: () => ({ success: false, changedSubblocks: [] }),
    setBlockAdvancedMode: () => {},
    setBlockCanonicalMode: () => {},
    setBlockTriggerMode: () => {},
    updateBlockLayoutMetrics: () => {},
    triggerUpdate: () => {},
    updateLoopCount: () => {},
    updateLoopType: () => {},
    updateLoopCollection: () => {},
    setLoopForEachItems: () => {},
    setLoopWhileCondition: () => {},
    setLoopDoWhileCondition: () => {},
    updateParallelCount: () => {},
    updateParallelCollection: () => {},
    updateParallelType: () => {},
    generateLoopBlocks: () => ({}),
    generateParallelBlocks: () => ({}),
    setNeedsRedeploymentFlag: () => {},
    revertToDeployedState: () => {},
    toggleBlockAdvancedMode: () => {},
    setDragStartPosition: () => {},
    getDragStartPosition: () => null,
    getWorkflowState: () => emptyWorkflowState,
    replaceWorkflowState: () => {},
    setBlockLocked: () => {},
    batchToggleLocked: () => {},
  }),
}
