/**
 * Workflow store utilities.
 * Provides block state merging and ID regeneration functions.
 */

import type { Edge } from '@/types/reactflow'
import { v4 as uuidv4 } from 'uuid'
import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'
import { mergeSubblockStateWithValues } from '@/lib/workflows/subblocks'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { getBlock } from '@/blocks'
import { isAnnotationOnlyBlock, normalizeName } from '@/executor/constants'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type {
  BlockState,
  Loop,
  Parallel,
  Position,
  SubBlockState,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

/**
 * Merges workflow block states with subblock values while maintaining block structure
 */
export function mergeSubblockState(
  blocks: Record<string, BlockState>,
  workflowId?: string,
  blockId?: string
): Record<string, BlockState> {
  const subBlockStore = useSubBlockStore.getState()

  const workflowSubblockValues = workflowId ? subBlockStore.workflowValues[workflowId] || {} : {}

  if (workflowId) {
    return mergeSubblockStateWithValues(blocks, workflowSubblockValues, blockId)
  }

  const blocksToProcess = blockId ? { [blockId]: blocks[blockId] } : blocks

  return Object.entries(blocksToProcess).reduce(
    (acc, [id, block]) => {
      if (!block) {
        return acc
      }

      const blockSubBlocks = block.subBlocks || {}
      const blockValues = workflowSubblockValues[id] || {}

      const mergedSubBlocks = Object.entries(blockSubBlocks).reduce(
        (subAcc, [subBlockId, subBlock]) => {
          if (!subBlock) {
            return subAcc
          }

          let storedValue = null

          if (workflowId) {
            if (blockValues[subBlockId] !== undefined) {
              storedValue = blockValues[subBlockId]
            }
          } else {
            storedValue = subBlockStore.getValue(id, subBlockId)
          }

          subAcc[subBlockId] = {
            ...subBlock,
            value: (storedValue !== undefined && storedValue !== null
              ? storedValue
              : subBlock.value) as SubBlockState['value'],
          }

          return subAcc
        },
        {} as Record<string, SubBlockState>
      )

      Object.entries(blockValues).forEach(([subBlockId, value]) => {
        if (!mergedSubBlocks[subBlockId] && value !== null && value !== undefined) {
          mergedSubBlocks[subBlockId] = {
            id: subBlockId,
            type: 'short-input',
            value: value as SubBlockState['value'],
          }
        }
      })

      acc[id] = {
        ...block,
        subBlocks: mergedSubBlocks,
      }

      return acc
    },
    {} as Record<string, BlockState>
  )
}

function updateValueReferences(value: unknown, nameMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    let updatedValue = value
    nameMap.forEach((newName, oldName) => {
      const regex = new RegExp(`<${oldName}\\.`, 'g')
      updatedValue = updatedValue.replace(regex, `<${newName}.`)
    })
    return updatedValue
  }
  if (Array.isArray(value)) {
    return value.map((item) => updateValueReferences(item, nameMap))
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = updateValueReferences(val, nameMap)
    }
    return result
  }
  return value
}

function updateBlockReferences(
  blocks: Record<string, BlockState>,
  nameMap: Map<string, string>,
  clearTriggerRuntimeValues = false
): void {
  Object.entries(blocks).forEach(([_, block]) => {
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
        if (clearTriggerRuntimeValues && TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(subBlockId)) {
          block.subBlocks[subBlockId] = { ...subBlock, value: null }
          return
        }

        if (subBlock.value !== undefined && subBlock.value !== null) {
          const updatedValue = updateValueReferences(
            subBlock.value,
            nameMap
          ) as SubBlockState['value']
          block.subBlocks[subBlockId] = { ...subBlock, value: updatedValue }
        }
      })
    }
  })
}

/**
 * Regenerates all IDs in a workflow state for duplication/import purposes.
 */
export function regenerateWorkflowIds(
  workflowState: WorkflowState,
  options: { clearTriggerRuntimeValues?: boolean } = {}
): WorkflowState & { idMap: Map<string, string> } {
  const { clearTriggerRuntimeValues = true } = options
  const blockIdMap = new Map<string, string>()
  const nameMap = new Map<string, string>()
  const newBlocks: Record<string, BlockState> = {}

  Object.entries(workflowState.blocks).forEach(([oldId, block]) => {
    const newId = uuidv4()
    blockIdMap.set(oldId, newId)
    const oldNormalizedName = normalizeName(block.name)
    nameMap.set(oldNormalizedName, oldNormalizedName)
    newBlocks[newId] = { ...block, id: newId }
  })

  Object.values(newBlocks).forEach((block) => {
    if (block.data?.parentId) {
      const newParentId = blockIdMap.get(block.data.parentId)
      if (newParentId) {
        block.data = { ...block.data, parentId: newParentId }
      } else {
        block.data = { ...block.data, parentId: undefined, extent: undefined }
      }
    }
  })

  const newEdges = workflowState.edges.map((edge) => ({
    ...edge,
    id: uuidv4(),
    source: blockIdMap.get(edge.source) || edge.source,
    target: blockIdMap.get(edge.target) || edge.target,
  }))

  const newLoops: Record<string, Loop> = {}
  if (workflowState.loops) {
    Object.entries(workflowState.loops).forEach(([oldLoopId, loop]) => {
      const newLoopId = blockIdMap.get(oldLoopId) || oldLoopId
      newLoops[newLoopId] = {
        ...loop,
        id: newLoopId,
        nodes: loop.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }

  const newParallels: Record<string, Parallel> = {}
  if (workflowState.parallels) {
    Object.entries(workflowState.parallels).forEach(([oldParallelId, parallel]) => {
      const newParallelId = blockIdMap.get(oldParallelId) || oldParallelId
      newParallels[newParallelId] = {
        ...parallel,
        id: newParallelId,
        nodes: parallel.nodes.map((nodeId) => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }

  updateBlockReferences(newBlocks, nameMap, clearTriggerRuntimeValues)

  return {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
    metadata: workflowState.metadata,
    variables: workflowState.variables,
    idMap: blockIdMap,
  }
}

/**
 * Generates a unique block name by finding the highest number suffix
 */
export function getUniqueBlockName(baseName: string, existingBlocks: Record<string, { name?: string }>): string {
  const normalizedBaseName = normalizeName(baseName)
  if (normalizedBaseName === 'start' || normalizedBaseName === 'starter') {
    return 'Start'
  }
  if (normalizedBaseName === 'response') {
    return 'Response'
  }

  const baseNameMatch = baseName.match(/^(.*?)(\s+\d+)?$/)
  const namePrefix = baseNameMatch ? baseNameMatch[1].trim() : baseName
  const normalizedBase = normalizeName(namePrefix)

  const existingNumbers = Object.values(existingBlocks)
    .filter((block) => {
      const blockNameMatch = block.name?.match(/^(.*?)(\s+\d+)?$/)
      const blockPrefix = blockNameMatch ? blockNameMatch[1].trim() : block.name
      return blockPrefix && normalizeName(blockPrefix) === normalizedBase
    })
    .map((block) => {
      const match = block.name?.match(/(\d+)$/)
      return match ? Number.parseInt(match[1], 10) : 0
    })

  const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0

  if (maxNumber === 0 && existingNumbers.length === 0) {
    return `${namePrefix} 1`
  }

  return `${namePrefix} ${maxNumber + 1}`
}
