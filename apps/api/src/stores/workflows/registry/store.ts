/**
 * Server-side stub for useWorkflowRegistry.
 * The API does not maintain a live Zustand workflow registry.
 * Provides getState() with empty/no-op values so that code importing
 * useWorkflowRegistry.getState() compiles and returns safe defaults.
 */

import type { WorkflowRegistry } from '@/stores/workflows/registry/types'

export const useWorkflowRegistry = {
  getState: (): WorkflowRegistry => ({
    workflows: {},
    activeWorkflowId: null,
    error: null,
    deploymentStatuses: {},
    hydration: {
      phase: 'idle',
      workspaceId: null,
      workflowId: null,
      requestId: null,
      error: null,
    },
    clipboard: null,
    pendingSelection: null,
    beginMetadataLoad: () => {},
    completeMetadataLoad: () => {},
    failMetadataLoad: () => {},
    setActiveWorkflow: async () => {},
    loadWorkflowState: async () => {},
    switchToWorkspace: async () => {},
    removeWorkflow: async () => {},
    updateWorkflow: async () => {},
    duplicateWorkflow: async () => null,
    getWorkflowDeploymentStatus: () => null,
    setDeploymentStatus: () => {},
    setWorkflowNeedsRedeployment: () => {},
    copyBlocks: () => {},
    preparePasteData: () => null,
    hasClipboard: () => false,
    clearClipboard: () => {},
    setPendingSelection: () => {},
    clearPendingSelection: () => {},
    logout: () => {},
  }),
}
