import { createLogger } from '@sim/logger'
import { manifestRegistry } from '@/integrations/manifest-loader'
import { isValidKey } from '@/lib/workflows/sanitization/key-validation'
import { normalizeName, RESERVED_BLOCK_NAMES } from '@/executor/constants'
import { TRIGGER_RUNTIME_SUBBLOCK_IDS } from '@/triggers/constants'

const logger = createLogger('EditWorkflowEngine')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ValidationError {
  blockId: string
  blockType: string
  field: string
  value: unknown
  error: string
}

export type SkippedItemType =
  | 'block_not_found'
  | 'invalid_block_type'
  | 'block_not_allowed'
  | 'block_locked'
  | 'tool_not_allowed'
  | 'invalid_edge_target'
  | 'invalid_edge_source'
  | 'invalid_source_handle'
  | 'invalid_target_handle'
  | 'invalid_subblock_field'
  | 'missing_required_params'
  | 'invalid_subflow_parent'
  | 'nested_subflow_not_allowed'
  | 'duplicate_block_name'
  | 'reserved_block_name'
  | 'duplicate_trigger'
  | 'duplicate_single_instance_block'

export interface SkippedItem {
  type: SkippedItemType
  operationType: string
  blockId: string
  reason: string
  details?: Record<string, unknown>
}

export interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete' | 'insert_into_subflow' | 'extract_from_subflow'
  block_id: string
  params?: Record<string, any>
}

export interface OperationContext {
  modifiedState: any
  skippedItems: SkippedItem[]
  validationErrors: ValidationError[]
  deferredConnections: Array<{
    blockId: string
    connections: Record<string, any>
  }>
}

export interface ApplyOperationsResult {
  state: any
  validationErrors: ValidationError[]
  skippedItems: SkippedItem[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logSkippedItem(skippedItems: SkippedItem[], item: SkippedItem): void {
  logger.warn(`Skipped ${item.operationType} operation: ${item.reason}`, {
    type: item.type,
    operationType: item.operationType,
    blockId: item.blockId,
    ...(item.details && { details: item.details }),
  })
  skippedItems.push(item)
}

/**
 * Looks up a block config from the manifest registry by type.
 */
function getBlockConfig(blockType: string): any | undefined {
  return manifestRegistry.getBlock(blockType)
}

/**
 * Finds an existing block with the same normalized name.
 */
function findBlockWithDuplicateNormalizedName(
  blocks: Record<string, any>,
  name: string,
  excludeBlockId: string
): [string, any] | undefined {
  const normalizedName = normalizeName(name)
  return Object.entries(blocks).find(
    ([blockId, block]: [string, any]) =>
      blockId !== excludeBlockId && normalizeName(block.name || '') === normalizedName
  )
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  validInputs: Record<string, any>
  errors: ValidationError[]
}

interface ValueValidationResult {
  valid: boolean
  value?: any
  error?: ValidationError
}

/**
 * Validates and filters inputs against a block's subBlock configuration.
 */
function validateInputsForBlock(
  blockType: string,
  inputs: Record<string, any>,
  blockId: string
): ValidationResult {
  const errors: ValidationError[] = []
  const blockConfig = getBlockConfig(blockType)

  if (!blockConfig) {
    logger.warn(`Unknown block type: ${blockType}, skipping validation`)
    return { validInputs: inputs, errors: [] }
  }

  const validatedInputs: Record<string, any> = {}
  const subBlockMap = new Map<string, any>()

  for (const subBlock of blockConfig.subBlocks || []) {
    subBlockMap.set(subBlock.id, subBlock)
  }

  for (const [key, value] of Object.entries(inputs)) {
    if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) continue

    const subBlockConfig = subBlockMap.get(key)

    if (!subBlockConfig) {
      if (blockType === 'loop' || blockType === 'parallel') {
        validatedInputs[key] = value
      } else {
        errors.push({
          blockId,
          blockType,
          field: key,
          value,
          error: `Unknown input field "${key}" for block type "${blockType}"`,
        })
      }
      continue
    }

    const validationResult = validateValueForSubBlockType(subBlockConfig, value, key, blockType, blockId)
    if (validationResult.valid) {
      validatedInputs[key] = validationResult.value
    } else if (validationResult.error) {
      errors.push(validationResult.error)
    }
  }

  return { validInputs: validatedInputs, errors }
}

/**
 * Validates a value against its expected subBlock type.
 */
function validateValueForSubBlockType(
  subBlockConfig: any,
  value: any,
  fieldName: string,
  blockType: string,
  blockId: string
): ValueValidationResult {
  const { type } = subBlockConfig

  if (value === null || value === undefined) {
    return { valid: true, value }
  }

  switch (type) {
    case 'dropdown': {
      const options = typeof subBlockConfig.options === 'function'
        ? subBlockConfig.options()
        : subBlockConfig.options
      if (options && Array.isArray(options)) {
        const validValues = options.map((opt: any) => opt.id ?? opt.value)
        if (!validValues.includes(value)) {
          return {
            valid: false,
            error: {
              blockId, blockType, field: fieldName, value,
              error: `Invalid dropdown value "${value}" for field "${fieldName}". Valid options: ${validValues.join(', ')}`,
            },
          }
        }
      }
      return { valid: true, value }
    }

    case 'slider': {
      const numValue = typeof value === 'number' ? value : Number(value)
      if (Number.isNaN(numValue)) {
        return {
          valid: false,
          error: {
            blockId, blockType, field: fieldName, value,
            error: `Invalid slider value "${value}" for field "${fieldName}" - must be a number`,
          },
        }
      }
      let clampedValue = numValue
      if (subBlockConfig.min !== undefined && numValue < subBlockConfig.min) {
        clampedValue = subBlockConfig.min
      }
      if (subBlockConfig.max !== undefined && numValue > subBlockConfig.max) {
        clampedValue = subBlockConfig.max
      }
      return {
        valid: true,
        value: subBlockConfig.integer ? Math.round(clampedValue) : clampedValue,
      }
    }

    case 'switch': {
      if (typeof value !== 'boolean') {
        return {
          valid: false,
          error: {
            blockId, blockType, field: fieldName, value,
            error: `Invalid switch value "${value}" for field "${fieldName}" - must be true or false`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'file-upload': {
      if (value === null) return { valid: true, value: null }
      if (typeof value !== 'object') {
        return {
          valid: false,
          error: {
            blockId, blockType, field: fieldName, value,
            error: `Invalid file-upload value for field "${fieldName}" - expected object with name and path properties, or null`,
          },
        }
      }
      if (value && (!value.name || !value.path)) {
        return {
          valid: false,
          error: {
            blockId, blockType, field: fieldName, value,
            error: `Invalid file-upload object for field "${fieldName}" - must have "name" and "path" properties`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'input-format':
    case 'table': {
      if (!Array.isArray(value)) {
        return {
          valid: false,
          error: {
            blockId, blockType, field: fieldName, value,
            error: `Invalid ${type} value for field "${fieldName}" - expected an array`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'tool-input': {
      if (!Array.isArray(value)) {
        return {
          valid: false,
          error: {
            blockId, blockType, field: fieldName, value,
            error: `Invalid tool-input value for field "${fieldName}" - expected an array of tool objects`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'code': {
      if (typeof value !== 'string') {
        return {
          valid: false,
          error: {
            blockId, blockType, field: fieldName, value,
            error: `Invalid code value for field "${fieldName}" - expected a string, got ${typeof value}`,
          },
        }
      }
      return { valid: true, value }
    }

    case 'response-format': {
      if (value === null || value === undefined || value === '') {
        return { valid: true, value }
      }
      if (typeof value === 'object') {
        return { valid: true, value }
      }
      if (typeof value === 'string') {
        try {
          JSON.parse(value)
          return { valid: true, value }
        } catch {
          return {
            valid: false,
            error: {
              blockId, blockType, field: fieldName, value,
              error: `Invalid response-format value for field "${fieldName}" - string must be valid JSON`,
            },
          }
        }
      }
      return {
        valid: false,
        error: {
          blockId, blockType, field: fieldName, value,
          error: `Invalid response-format value for field "${fieldName}" - expected a JSON string or object`,
        },
      }
    }

    case 'short-input':
    case 'long-input':
    case 'combobox': {
      if (typeof value !== 'string' && typeof value !== 'number') {
        return { valid: true, value: String(value) }
      }
      return { valid: true, value }
    }

    case 'oauth-input':
    case 'knowledge-base-selector':
    case 'document-selector':
    case 'file-selector':
    case 'project-selector':
    case 'channel-selector':
    case 'folder-selector':
    case 'mcp-server-selector':
    case 'mcp-tool-selector':
    case 'workflow-selector': {
      if (subBlockConfig.multiSelect && Array.isArray(value)) {
        return { valid: true, value }
      }
      if (typeof value === 'string') {
        return { valid: true, value }
      }
      return {
        valid: false,
        error: {
          blockId, blockType, field: fieldName, value,
          error: `Invalid selector value for field "${fieldName}" - expected a string${subBlockConfig.multiSelect ? ' or array of strings' : ''}`,
        },
      }
    }

    default:
      return { valid: true, value }
  }
}

/**
 * Validates source handle is valid for the block type.
 */
function validateSourceHandleForBlock(
  sourceHandle: string,
  sourceBlockType: string,
  _sourceBlock: any
): { valid: boolean; error?: string; normalizedHandle?: string } {
  if (sourceHandle === 'error') {
    return { valid: true }
  }

  switch (sourceBlockType) {
    case 'loop':
      if (sourceHandle === 'loop-start-source' || sourceHandle === 'loop-end-source') {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for loop block. Valid handles: loop-start-source, loop-end-source, error`,
      }

    case 'parallel':
      if (sourceHandle === 'parallel-start-source' || sourceHandle === 'parallel-end-source') {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for parallel block. Valid handles: parallel-start-source, parallel-end-source, error`,
      }

    case 'condition':
      // Accept condition handles in various formats
      if (sourceHandle.startsWith('condition-') || sourceHandle === 'if' || sourceHandle === 'else' || sourceHandle.startsWith('else-if')) {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for condition block.`,
      }

    case 'router':
    case 'router_v2':
      if (sourceHandle === 'source' || sourceHandle.startsWith('router-') || sourceHandle.startsWith('route-')) {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for router block.`,
      }

    default:
      if (sourceHandle === 'source') {
        return { valid: true }
      }
      return {
        valid: false,
        error: `Invalid source handle "${sourceHandle}" for ${sourceBlockType} block. Valid handles: source, error`,
      }
  }
}

/**
 * Validates target handle is valid (must be 'target').
 */
function validateTargetHandle(targetHandle: string): { valid: boolean; error?: string } {
  if (targetHandle === 'target') {
    return { valid: true }
  }
  return {
    valid: false,
    error: `Invalid target handle "${targetHandle}". Expected "target"`,
  }
}

// ---------------------------------------------------------------------------
// Array/Tool Normalization
// ---------------------------------------------------------------------------

const ARRAY_WITH_ID_SUBBLOCK_TYPES = new Set([
  'inputFormat', 'headers', 'params', 'variables',
  'tagFilters', 'documentTags', 'metrics',
])

function shouldNormalizeArrayIds(key: string): boolean {
  return ARRAY_WITH_ID_SUBBLOCK_TYPES.has(key)
}

function normalizeArrayWithIds(value: unknown): any[] {
  if (!Array.isArray(value)) return []
  return value.map((item: any) => {
    if (!item || typeof item !== 'object') return item
    const hasValidUUID = typeof item.id === 'string' && UUID_REGEX.test(item.id)
    if (!hasValidUUID) {
      return { ...item, id: crypto.randomUUID() }
    }
    return item
  })
}

function normalizeTools(tools: any[]): any[] {
  return tools.map((tool) => {
    if (tool.type === 'custom-tool') {
      if (tool.customToolId && !tool.schema && !tool.code) {
        return {
          type: tool.type,
          customToolId: tool.customToolId,
          usageControl: tool.usageControl || 'auto',
          isExpanded: tool.isExpanded ?? true,
        }
      }
      const normalized: any = {
        ...tool,
        params: tool.params || {},
        isExpanded: tool.isExpanded ?? true,
      }
      if (normalized.schema?.function) {
        normalized.schema = {
          type: 'function',
          function: {
            name: normalized.schema.function.name || tool.title,
            description: normalized.schema.function.description,
            parameters: normalized.schema.function.parameters,
          },
        }
      }
      return normalized
    }
    return { ...tool, isExpanded: tool.isExpanded ?? true }
  })
}

function normalizeResponseFormat(value: any): string {
  try {
    let obj = value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return ''
      obj = JSON.parse(trimmed)
    }
    if (obj && typeof obj === 'object') {
      const sortKeys = (item: any): any => {
        if (Array.isArray(item)) return item.map(sortKeys)
        if (item !== null && typeof item === 'object') {
          return Object.keys(item).sort().reduce((result: any, key: string) => {
            result[key] = sortKeys(item[key])
            return result
          }, {})
        }
        return item
      }
      return JSON.stringify(sortKeys(obj), null, 2)
    }
    return String(value)
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------------------
// Block Creation
// ---------------------------------------------------------------------------

/**
 * Creates a block state from manifest registry config and operation params.
 * Initializes all subBlocks from the manifest, then applies LLM-provided input values.
 */
function createBlockFromParams(
  blockId: string,
  params: any,
  parentId?: string,
  errorsCollector?: ValidationError[],
  skippedItems?: SkippedItem[]
): any {
  const blockConfig = getBlockConfig(params.type)

  let validatedInputs: Record<string, any> | undefined
  if (params.inputs) {
    const result = validateInputsForBlock(params.type, params.inputs, blockId)
    validatedInputs = result.validInputs
    if (errorsCollector && result.errors.length > 0) {
      errorsCollector.push(...result.errors)
    }
  }

  const triggerMode = params.triggerMode || false

  // Build outputs from block config
  let outputs: Record<string, any> = {}
  if (params.outputs) {
    outputs = params.outputs
  } else if (blockConfig?.outputs) {
    for (const [key, config] of Object.entries(blockConfig.outputs)) {
      outputs[key] = { type: (config as any).type || 'any' }
    }
  }

  const blockState: any = {
    id: blockId,
    type: params.type,
    name: params.name,
    position: { x: 0, y: 0 },
    enabled: params.enabled !== undefined ? params.enabled : true,
    horizontalHandles: true,
    advancedMode: params.advancedMode || false,
    height: 0,
    triggerMode,
    subBlocks: {},
    outputs,
    data: parentId ? { parentId, extent: 'parent' as const } : {},
    locked: false,
  }

  // Add validated inputs as subBlocks
  if (validatedInputs) {
    Object.entries(validatedInputs).forEach(([key, value]) => {
      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) return

      let sanitizedValue = value
      if (shouldNormalizeArrayIds(key)) {
        sanitizedValue = normalizeArrayWithIds(value)
      }
      if (key === 'tools' && Array.isArray(value)) {
        sanitizedValue = normalizeTools(value)
      }
      if (key === 'responseFormat' && value) {
        sanitizedValue = normalizeResponseFormat(value)
      }

      blockState.subBlocks[key] = {
        id: key,
        type: 'short-input',
        value: sanitizedValue,
      }
    })
  }

  // Initialize remaining subBlocks from manifest config
  if (blockConfig) {
    for (const subBlock of blockConfig.subBlocks || []) {
      if (!blockState.subBlocks[subBlock.id]) {
        blockState.subBlocks[subBlock.id] = {
          id: subBlock.id,
          type: subBlock.type || 'short-input',
          value: subBlock.default ?? null,
        }
      }
    }
  }

  return blockState
}

// ---------------------------------------------------------------------------
// Edge Creation
// ---------------------------------------------------------------------------

/**
 * Creates a validated edge between two blocks.
 */
function createValidatedEdge(
  modifiedState: any,
  sourceBlockId: string,
  targetBlockId: string,
  sourceHandle: string,
  targetHandle: string,
  operationType: string,
  skippedItems: SkippedItem[]
): boolean {
  if (!modifiedState.blocks[targetBlockId]) {
    skippedItems.push({
      type: 'invalid_edge_target',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - target block does not exist`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlock = modifiedState.blocks[sourceBlockId]
  if (!sourceBlock) {
    skippedItems.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block does not exist`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceBlockType = sourceBlock.type
  if (!sourceBlockType) {
    skippedItems.push({
      type: 'invalid_edge_source',
      operationType,
      blockId: sourceBlockId,
      reason: `Edge from "${sourceBlockId}" to "${targetBlockId}" skipped - source block has no type`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const sourceValidation = validateSourceHandleForBlock(sourceHandle, sourceBlockType, sourceBlock)
  if (!sourceValidation.valid) {
    skippedItems.push({
      type: 'invalid_source_handle',
      operationType,
      blockId: sourceBlockId,
      reason: sourceValidation.error || `Invalid source handle "${sourceHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const targetValidation = validateTargetHandle(targetHandle)
  if (!targetValidation.valid) {
    skippedItems.push({
      type: 'invalid_target_handle',
      operationType,
      blockId: sourceBlockId,
      reason: targetValidation.error || `Invalid target handle "${targetHandle}"`,
      details: { sourceHandle, targetHandle, targetId: targetBlockId },
    })
    return false
  }

  const finalSourceHandle = sourceValidation.normalizedHandle || sourceHandle

  modifiedState.edges.push({
    id: crypto.randomUUID(),
    source: sourceBlockId,
    sourceHandle: finalSourceHandle,
    target: targetBlockId,
    targetHandle,
    type: 'default',
  })
  return true
}

/**
 * Adds connections as edges for a block.
 */
function addConnectionsAsEdges(
  modifiedState: any,
  blockId: string,
  connections: Record<string, any>,
  skippedItems: SkippedItem[]
): void {
  Object.entries(connections).forEach(([sourceHandle, targets]) => {
    if (targets === null) return

    const addEdgeForTarget = (targetBlock: string, targetHandle?: string) => {
      createValidatedEdge(
        modifiedState,
        blockId,
        targetBlock,
        sourceHandle,
        targetHandle || 'target',
        'add_edge',
        skippedItems
      )
    }

    if (typeof targets === 'string') {
      addEdgeForTarget(targets)
    } else if (Array.isArray(targets)) {
      targets.forEach((target: any) => {
        if (typeof target === 'string') {
          addEdgeForTarget(target)
        } else if (target?.block) {
          addEdgeForTarget(target.block, target.handle)
        }
      })
    } else if (typeof targets === 'object' && targets?.block) {
      addEdgeForTarget(targets.block, targets.handle)
    }
  })
}

// ---------------------------------------------------------------------------
// Operation Handlers
// ---------------------------------------------------------------------------

function handleDeleteOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems } = ctx
  const { block_id } = op

  if (!modifiedState.blocks[block_id]) {
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'delete',
      blockId: block_id,
      reason: `Block "${block_id}" does not exist and cannot be deleted`,
    })
    return
  }

  const deleteBlock = modifiedState.blocks[block_id]
  const deleteParentId = deleteBlock.data?.parentId as string | undefined
  const deleteParentLocked = deleteParentId ? modifiedState.blocks[deleteParentId]?.locked : false
  if (deleteBlock.locked || deleteParentLocked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'delete',
      blockId: block_id,
      reason: deleteParentLocked
        ? `Block "${block_id}" is inside locked container "${deleteParentId}" and cannot be deleted`
        : `Block "${block_id}" is locked and cannot be deleted`,
    })
    return
  }

  // Find all child blocks to remove
  const blocksToRemove = new Set<string>([block_id])
  const findChildren = (parentId: string) => {
    Object.entries(modifiedState.blocks).forEach(([childId, child]: [string, any]) => {
      if (child.data?.parentId === parentId) {
        blocksToRemove.add(childId)
        findChildren(childId)
      }
    })
  }
  findChildren(block_id)

  blocksToRemove.forEach((id) => delete modifiedState.blocks[id])

  modifiedState.edges = modifiedState.edges.filter(
    (edge: any) => !blocksToRemove.has(edge.source) && !blocksToRemove.has(edge.target)
  )
}

function handleEditOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems, validationErrors } = ctx
  const { block_id, params } = op

  if (!modifiedState.blocks[block_id]) {
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'edit',
      blockId: block_id,
      reason: `Block "${block_id}" does not exist and cannot be edited`,
    })
    return
  }

  const block = modifiedState.blocks[block_id]

  const editParentId = block.data?.parentId as string | undefined
  const editParentLocked = editParentId ? modifiedState.blocks[editParentId]?.locked : false
  if (block.locked || editParentLocked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'edit',
      blockId: block_id,
      reason: editParentLocked
        ? `Block "${block_id}" is inside locked container "${editParentId}" and cannot be edited`
        : `Block "${block_id}" is locked and cannot be edited`,
    })
    return
  }

  if (!block.type) {
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'edit',
      blockId: block_id,
      reason: `Block "${block_id}" exists but has no type property`,
    })
    return
  }

  // Update inputs
  if (params?.inputs) {
    if (!block.subBlocks) block.subBlocks = {}

    const validationResult = validateInputsForBlock(block.type, params.inputs, block_id)
    validationErrors.push(...validationResult.errors)

    Object.entries(validationResult.validInputs).forEach(([inputKey, value]) => {
      let key = inputKey
      // Normalize common field name variations
      if (key === 'credentials' && !block.subBlocks.credentials && block.subBlocks.credential) {
        key = 'credential'
      }

      if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) return

      let sanitizedValue = value
      if (shouldNormalizeArrayIds(key)) {
        sanitizedValue = normalizeArrayWithIds(value)
      }
      if (key === 'tools' && Array.isArray(value)) {
        sanitizedValue = normalizeTools(value)
      }
      if (key === 'responseFormat' && value) {
        sanitizedValue = normalizeResponseFormat(value)
      }

      if (!block.subBlocks[key]) {
        block.subBlocks[key] = { id: key, type: 'short-input', value: sanitizedValue }
      } else {
        block.subBlocks[key].value = sanitizedValue
      }
    })

    // Update loop/parallel configuration in block.data
    if (block.type === 'loop') {
      block.data = block.data || {}
      if (params.inputs.loopType !== undefined) {
        const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
        if (validLoopTypes.includes(params.inputs.loopType)) {
          block.data.loopType = params.inputs.loopType
        }
      }
      const effectiveLoopType = params.inputs.loopType ?? block.data.loopType ?? 'for'
      if (params.inputs.iterations !== undefined && effectiveLoopType === 'for') {
        block.data.count = params.inputs.iterations
      }
      if (params.inputs.collection !== undefined && effectiveLoopType === 'forEach') {
        block.data.collection = params.inputs.collection
      }
      if (
        params.inputs.condition !== undefined &&
        (effectiveLoopType === 'while' || effectiveLoopType === 'doWhile')
      ) {
        if (effectiveLoopType === 'doWhile') {
          block.data.doWhileCondition = params.inputs.condition
        } else {
          block.data.whileCondition = params.inputs.condition
        }
      }
    } else if (block.type === 'parallel') {
      block.data = block.data || {}
      if (params.inputs.parallelType !== undefined) {
        const validParallelTypes = ['count', 'collection']
        if (validParallelTypes.includes(params.inputs.parallelType)) {
          block.data.parallelType = params.inputs.parallelType
        }
      }
      const effectiveParallelType = params.inputs.parallelType ?? block.data.parallelType ?? 'count'
      if (params.inputs.count !== undefined && effectiveParallelType === 'count') {
        block.data.count = params.inputs.count
      }
      if (params.inputs.collection !== undefined && effectiveParallelType === 'collection') {
        block.data.collection = params.inputs.collection
      }
    }
  }

  // Update basic properties
  if (params?.type !== undefined) {
    const isContainerType = params.type === 'loop' || params.type === 'parallel'
    const newBlockConfig = getBlockConfig(params.type)
    if (!newBlockConfig && !isContainerType) {
      logSkippedItem(skippedItems, {
        type: 'invalid_block_type',
        operationType: 'edit',
        blockId: block_id,
        reason: `Invalid block type "${params.type}" - type change skipped`,
        details: { requestedType: params.type },
      })
    } else {
      block.type = params.type
    }
  }

  if (params?.name !== undefined) {
    const normalizedNewName = normalizeName(params.name)
    if (!normalizedNewName) {
      logSkippedItem(skippedItems, {
        type: 'missing_required_params',
        operationType: 'edit',
        blockId: block_id,
        reason: `Cannot rename to empty name`,
        details: { requestedName: params.name },
      })
    } else if ((RESERVED_BLOCK_NAMES as readonly string[]).includes(normalizedNewName)) {
      logSkippedItem(skippedItems, {
        type: 'reserved_block_name',
        operationType: 'edit',
        blockId: block_id,
        reason: `Cannot rename to "${params.name}" - this is a reserved name`,
        details: { requestedName: params.name },
      })
    } else {
      const conflictingBlock = findBlockWithDuplicateNormalizedName(
        modifiedState.blocks, params.name, block_id
      )
      if (conflictingBlock) {
        logSkippedItem(skippedItems, {
          type: 'duplicate_block_name',
          operationType: 'edit',
          blockId: block_id,
          reason: `Cannot rename to "${params.name}" - conflicts with "${conflictingBlock[1].name}"`,
          details: {
            requestedName: params.name,
            conflictingBlockId: conflictingBlock[0],
            conflictingBlockName: conflictingBlock[1].name,
          },
        })
      } else {
        block.name = params.name
      }
    }
  }

  // Handle trigger mode toggle
  if (typeof params?.triggerMode === 'boolean') {
    block.triggerMode = params.triggerMode
    if (params.triggerMode === true) {
      modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.target !== block_id)
    }
  }

  // Handle advanced mode toggle
  if (typeof params?.advancedMode === 'boolean') {
    block.advancedMode = params.advancedMode
  }

  // Handle nested nodes update (for loops/parallels)
  if (params?.nestedNodes) {
    const existingChildren = Object.keys(modifiedState.blocks).filter(
      (id) => modifiedState.blocks[id].data?.parentId === block_id
    )
    existingChildren.forEach((childId) => delete modifiedState.blocks[childId])
    modifiedState.edges = modifiedState.edges.filter(
      (edge: any) =>
        !existingChildren.includes(edge.source) && !existingChildren.includes(edge.target)
    )

    Object.entries(params.nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
      if (!isValidKey(childId)) {
        logSkippedItem(skippedItems, {
          type: 'missing_required_params',
          operationType: 'add_nested_node',
          blockId: String(childId || 'invalid'),
          reason: `Invalid childId "${childId}" in nestedNodes - child block skipped`,
        })
        return
      }

      if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
        logSkippedItem(skippedItems, {
          type: 'nested_subflow_not_allowed',
          operationType: 'edit_nested_node',
          blockId: childId,
          reason: `Cannot nest ${childBlock.type} inside ${block.type} - nested subflows are not supported`,
          details: { parentType: block.type, childType: childBlock.type },
        })
        return
      }

      const childBlockState = createBlockFromParams(
        childId, childBlock, block_id, validationErrors, skippedItems
      )
      modifiedState.blocks[childId] = childBlockState

      if (childBlock.connections) {
        addConnectionsAsEdges(modifiedState, childId, childBlock.connections, skippedItems)
      }
    })
  }

  // Handle connections update
  if (params?.connections) {
    modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)

    Object.entries(params.connections).forEach(([connectionType, targets]) => {
      if (targets === null) return

      const mapConnectionTypeToHandle = (type: string): string => {
        if (type === 'success') return 'source'
        if (type === 'error') return 'error'
        return type
      }

      const sourceHandle = mapConnectionTypeToHandle(connectionType)

      const addEdgeForTarget = (targetBlock: string, targetHandle?: string) => {
        createValidatedEdge(
          modifiedState, block_id, targetBlock,
          sourceHandle, targetHandle || 'target',
          'edit', skippedItems
        )
      }

      if (typeof targets === 'string') {
        addEdgeForTarget(targets)
      } else if (Array.isArray(targets)) {
        (targets as any[]).forEach((target: any) => {
          if (typeof target === 'string') {
            addEdgeForTarget(target)
          } else if (target?.block) {
            addEdgeForTarget(target.block, target.handle)
          }
        })
      } else if (typeof targets === 'object' && (targets as any)?.block) {
        addEdgeForTarget((targets as any).block, (targets as any).handle)
      }
    })
  }

  // Handle edge removal
  if (params?.removeEdges && Array.isArray(params.removeEdges)) {
    params.removeEdges.forEach(({ targetBlockId, sourceHandle = 'source' }: any) => {
      modifiedState.edges = modifiedState.edges.filter(
        (edge: any) =>
          !(edge.source === block_id && edge.target === targetBlockId && edge.sourceHandle === sourceHandle)
      )
    })
  }
}

function handleAddOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems, validationErrors, deferredConnections } = ctx
  const { block_id, params } = op

  const addNormalizedName = params?.name ? normalizeName(params.name) : ''
  if (!params?.type || !params?.name || !addNormalizedName) {
    logSkippedItem(skippedItems, {
      type: 'missing_required_params',
      operationType: 'add',
      blockId: block_id,
      reason: `Missing required params (type or name) for adding block "${block_id}"`,
      details: { hasType: !!params?.type, hasName: !!params?.name },
    })
    return
  }

  if ((RESERVED_BLOCK_NAMES as readonly string[]).includes(addNormalizedName)) {
    logSkippedItem(skippedItems, {
      type: 'reserved_block_name',
      operationType: 'add',
      blockId: block_id,
      reason: `Block name "${params.name}" is a reserved name and cannot be used`,
      details: { requestedName: params.name },
    })
    return
  }

  const conflictingBlock = findBlockWithDuplicateNormalizedName(
    modifiedState.blocks, params.name, block_id
  )
  if (conflictingBlock) {
    logSkippedItem(skippedItems, {
      type: 'duplicate_block_name',
      operationType: 'add',
      blockId: block_id,
      reason: `Block name "${params.name}" conflicts with existing block "${conflictingBlock[1].name}"`,
      details: {
        requestedName: params.name,
        conflictingBlockId: conflictingBlock[0],
        conflictingBlockName: conflictingBlock[1].name,
      },
    })
    return
  }

  const isContainerType = params.type === 'loop' || params.type === 'parallel'
  const addBlockConfig = getBlockConfig(params.type)
  if (!addBlockConfig && !isContainerType) {
    logSkippedItem(skippedItems, {
      type: 'invalid_block_type',
      operationType: 'add',
      blockId: block_id,
      reason: `Invalid block type "${params.type}" - block not added`,
      details: { requestedType: params.type },
    })
    return
  }

  // Check for duplicate triggers
  if (addBlockConfig) {
    const isTrigger = addBlockConfig.category === 'triggers'
    if (isTrigger) {
      const existingTrigger = Object.values(modifiedState.blocks).find(
        (b: any) => {
          const bConfig = getBlockConfig(b.type)
          return bConfig?.category === 'triggers'
        }
      )
      if (existingTrigger) {
        logSkippedItem(skippedItems, {
          type: 'duplicate_trigger',
          operationType: 'add',
          blockId: block_id,
          reason: `Cannot add trigger "${params.type}" - a workflow can only have one trigger`,
          details: { requestedType: params.type },
        })
        return
      }
    }
  }

  const newBlock = createBlockFromParams(
    block_id, params, undefined, validationErrors, skippedItems
  )

  // Set loop/parallel data
  if (params.nestedNodes) {
    if (params.type === 'loop') {
      const validLoopTypes = ['for', 'forEach', 'while', 'doWhile']
      const loopType = params.inputs?.loopType && validLoopTypes.includes(params.inputs.loopType)
        ? params.inputs.loopType : 'for'
      newBlock.data = {
        ...newBlock.data,
        loopType,
        ...(loopType === 'forEach' && params.inputs?.collection && { collection: params.inputs.collection }),
        ...(loopType === 'for' && params.inputs?.iterations && { count: params.inputs.iterations }),
        ...(loopType === 'while' && params.inputs?.condition && { whileCondition: params.inputs.condition }),
        ...(loopType === 'doWhile' && params.inputs?.condition && { doWhileCondition: params.inputs.condition }),
      }
    } else if (params.type === 'parallel') {
      const validParallelTypes = ['count', 'collection']
      const parallelType = params.inputs?.parallelType && validParallelTypes.includes(params.inputs.parallelType)
        ? params.inputs.parallelType : 'count'
      newBlock.data = {
        ...newBlock.data,
        parallelType,
        ...(parallelType === 'collection' && params.inputs?.collection && { collection: params.inputs.collection }),
        ...(parallelType === 'count' && params.inputs?.count && { count: params.inputs.count }),
      }
    }
  }

  modifiedState.blocks[block_id] = newBlock

  // Handle nested nodes (for loops/parallels)
  if (params.nestedNodes) {
    Object.entries(params.nestedNodes).forEach(([childId, childBlock]: [string, any]) => {
      if (!isValidKey(childId)) {
        logSkippedItem(skippedItems, {
          type: 'missing_required_params',
          operationType: 'add_nested_node',
          blockId: String(childId || 'invalid'),
          reason: `Invalid childId "${childId}" in nestedNodes - child block skipped`,
        })
        return
      }

      if (childBlock.type === 'loop' || childBlock.type === 'parallel') {
        logSkippedItem(skippedItems, {
          type: 'nested_subflow_not_allowed',
          operationType: 'add_nested_node',
          blockId: childId,
          reason: `Cannot nest ${childBlock.type} inside ${params.type} - nested subflows are not supported`,
          details: { parentType: params.type, childType: childBlock.type },
        })
        return
      }

      const childBlockState = createBlockFromParams(
        childId, childBlock, block_id, validationErrors, skippedItems
      )
      modifiedState.blocks[childId] = childBlockState

      if (childBlock.connections) {
        deferredConnections.push({ blockId: childId, connections: childBlock.connections })
      }
    })
  }

  // Defer connection processing
  if (params.connections) {
    deferredConnections.push({ blockId: block_id, connections: params.connections })
  }
}

function handleInsertIntoSubflowOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems, validationErrors, deferredConnections } = ctx
  const { block_id, params } = op

  const subflowId = params?.subflowId
  if (!subflowId || !params?.type || !params?.name) {
    logSkippedItem(skippedItems, {
      type: 'missing_required_params',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Missing required params (subflowId, type, or name) for inserting block "${block_id}"`,
      details: { hasSubflowId: !!subflowId, hasType: !!params?.type, hasName: !!params?.name },
    })
    return
  }

  const subflowBlock = modifiedState.blocks[subflowId]
  if (!subflowBlock) {
    logSkippedItem(skippedItems, {
      type: 'invalid_subflow_parent',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Subflow block "${subflowId}" not found - block "${block_id}" not inserted`,
      details: { subflowId },
    })
    return
  }

  if (subflowBlock.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Subflow "${subflowId}" is locked - cannot insert block "${block_id}"`,
      details: { subflowId },
    })
    return
  }

  if (subflowBlock.type !== 'loop' && subflowBlock.type !== 'parallel') {
    logSkippedItem(skippedItems, {
      type: 'invalid_subflow_parent',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Block "${subflowId}" is type "${subflowBlock.type}", not a loop or parallel`,
      details: { subflowId, subflowType: subflowBlock.type },
    })
    return
  }

  if (params.type === 'loop' || params.type === 'parallel') {
    logSkippedItem(skippedItems, {
      type: 'nested_subflow_not_allowed',
      operationType: 'insert_into_subflow',
      blockId: block_id,
      reason: `Cannot nest ${params.type} inside ${subflowBlock.type} - nested subflows are not supported`,
      details: { parentType: subflowBlock.type, childType: params.type },
    })
    return
  }

  const existingBlock = modifiedState.blocks[block_id]

  if (existingBlock) {
    if (existingBlock.type === 'loop' || existingBlock.type === 'parallel') {
      logSkippedItem(skippedItems, {
        type: 'nested_subflow_not_allowed',
        operationType: 'insert_into_subflow',
        blockId: block_id,
        reason: `Cannot move ${existingBlock.type} into ${subflowBlock.type} - nested subflows are not supported`,
        details: { parentType: subflowBlock.type, childType: existingBlock.type },
      })
      return
    }

    if (existingBlock.locked) {
      logSkippedItem(skippedItems, {
        type: 'block_locked',
        operationType: 'insert_into_subflow',
        blockId: block_id,
        reason: `Block "${block_id}" is locked and cannot be moved into a subflow`,
      })
      return
    }

    existingBlock.data = {
      ...existingBlock.data,
      parentId: subflowId,
      extent: 'parent' as const,
    }

    if (params.inputs) {
      const validationResult = validateInputsForBlock(existingBlock.type, params.inputs, block_id)
      validationErrors.push(...validationResult.errors)
      Object.entries(validationResult.validInputs).forEach(([key, value]) => {
        if (TRIGGER_RUNTIME_SUBBLOCK_IDS.includes(key)) return
        let sanitizedValue = value
        if (shouldNormalizeArrayIds(key)) sanitizedValue = normalizeArrayWithIds(value)
        if (key === 'tools' && Array.isArray(value)) sanitizedValue = normalizeTools(value)
        if (key === 'responseFormat' && value) sanitizedValue = normalizeResponseFormat(value)

        if (!existingBlock.subBlocks[key]) {
          existingBlock.subBlocks[key] = { id: key, type: 'short-input', value: sanitizedValue }
        } else {
          existingBlock.subBlocks[key].value = sanitizedValue
        }
      })
    }
  } else {
    const isContainerType = params.type === 'loop' || params.type === 'parallel'
    const insertBlockConfig = getBlockConfig(params.type)
    if (!insertBlockConfig && !isContainerType) {
      logSkippedItem(skippedItems, {
        type: 'invalid_block_type',
        operationType: 'insert_into_subflow',
        blockId: block_id,
        reason: `Invalid block type "${params.type}" - block not inserted into subflow`,
        details: { requestedType: params.type, subflowId },
      })
      return
    }

    const newBlock = createBlockFromParams(
      block_id, params, subflowId, validationErrors, skippedItems
    )
    modifiedState.blocks[block_id] = newBlock
  }

  if (params.connections) {
    modifiedState.edges = modifiedState.edges.filter((edge: any) => edge.source !== block_id)
    deferredConnections.push({ blockId: block_id, connections: params.connections })
  }
}

function handleExtractFromSubflowOperation(op: EditWorkflowOperation, ctx: OperationContext): void {
  const { modifiedState, skippedItems } = ctx
  const { block_id, params } = op

  const subflowId = params?.subflowId
  if (!subflowId) {
    logSkippedItem(skippedItems, {
      type: 'missing_required_params',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Missing subflowId for extracting block "${block_id}"`,
    })
    return
  }

  const block = modifiedState.blocks[block_id]
  if (!block) {
    logSkippedItem(skippedItems, {
      type: 'block_not_found',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Block "${block_id}" not found for extraction`,
    })
    return
  }

  if (block.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Block "${block_id}" is locked and cannot be extracted from subflow`,
    })
    return
  }

  const parentSubflow = modifiedState.blocks[subflowId]
  if (parentSubflow?.locked) {
    logSkippedItem(skippedItems, {
      type: 'block_locked',
      operationType: 'extract_from_subflow',
      blockId: block_id,
      reason: `Subflow "${subflowId}" is locked - cannot extract block "${block_id}"`,
      details: { subflowId },
    })
    return
  }

  if (block.data) {
    block.data.parentId = undefined
    block.data.extent = undefined
  }
}

// ---------------------------------------------------------------------------
// ID Normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes block IDs in operations to ensure they are valid UUIDs.
 */
function normalizeBlockIdsInOperations(operations: EditWorkflowOperation[]): {
  normalizedOperations: EditWorkflowOperation[]
  idMapping: Map<string, string>
} {
  const idMapping = new Map<string, string>()

  for (const op of operations) {
    if (op.operation_type === 'add' || op.operation_type === 'insert_into_subflow') {
      if (op.block_id && !UUID_REGEX.test(op.block_id)) {
        idMapping.set(op.block_id, crypto.randomUUID())
      }
    }
  }

  if (idMapping.size === 0) {
    return { normalizedOperations: operations, idMapping }
  }

  logger.info('Normalizing block IDs in operations', {
    normalizedCount: idMapping.size,
    mappings: Object.fromEntries(idMapping),
  })

  const replaceId = (id: string | undefined): string | undefined => {
    if (!id) return id
    return idMapping.get(id) ?? id
  }

  const normalizedOperations = operations.map((op) => {
    const normalized: EditWorkflowOperation = {
      ...op,
      block_id: replaceId(op.block_id) ?? op.block_id,
    }

    if (op.params) {
      normalized.params = { ...op.params }

      if (normalized.params.subflowId) {
        normalized.params.subflowId = replaceId(normalized.params.subflowId)
      }

      if (normalized.params.connections) {
        const normalizedConnections: Record<string, any> = {}
        for (const [handle, targets] of Object.entries(normalized.params.connections)) {
          if (typeof targets === 'string') {
            normalizedConnections[handle] = replaceId(targets)
          } else if (Array.isArray(targets)) {
            normalizedConnections[handle] = targets.map((t) => {
              if (typeof t === 'string') return replaceId(t)
              if (t && typeof t === 'object' && t.block) {
                return { ...t, block: replaceId(t.block) }
              }
              return t
            })
          } else if (targets && typeof targets === 'object' && (targets as any).block) {
            normalizedConnections[handle] = { ...targets, block: replaceId((targets as any).block) }
          } else {
            normalizedConnections[handle] = targets
          }
        }
        normalized.params.connections = normalizedConnections
      }

      if (normalized.params.nestedNodes) {
        const normalizedNestedNodes: Record<string, any> = {}
        for (const [childId, childBlock] of Object.entries(normalized.params.nestedNodes)) {
          const newChildId = replaceId(childId) ?? childId
          normalizedNestedNodes[newChildId] = childBlock
        }
        normalized.params.nestedNodes = normalizedNestedNodes
      }
    }

    return normalized
  })

  return { normalizedOperations, idMapping }
}

// ---------------------------------------------------------------------------
// Operation Ordering & Topological Sort
// ---------------------------------------------------------------------------

type OperationHandler = (op: EditWorkflowOperation, ctx: OperationContext) => void

const OPERATION_HANDLERS: Record<EditWorkflowOperation['operation_type'], OperationHandler> = {
  delete: handleDeleteOperation,
  extract_from_subflow: handleExtractFromSubflowOperation,
  add: handleAddOperation,
  insert_into_subflow: handleInsertIntoSubflowOperation,
  edit: handleEditOperation,
}

/**
 * Topologically sort insert operations to ensure parents are created before children.
 */
function topologicalSortInserts(
  inserts: EditWorkflowOperation[],
  adds: EditWorkflowOperation[]
): EditWorkflowOperation[] {
  if (inserts.length === 0) return []

  const insertMap = new Map<string, EditWorkflowOperation>()
  inserts.forEach((op) => insertMap.set(op.block_id, op))

  const addedBlocks = new Set(adds.map((op) => op.block_id))

  const dependents = new Map<string, Set<string>>()
  const dependencies = new Map<string, Set<string>>()

  inserts.forEach((op) => {
    const blockId = op.block_id
    const parentId = op.params?.subflowId
    dependencies.set(blockId, new Set())

    if (parentId && insertMap.has(parentId)) {
      dependencies.get(blockId)!.add(parentId)
      if (!dependents.has(parentId)) {
        dependents.set(parentId, new Set())
      }
      dependents.get(parentId)!.add(blockId)
    }
  })

  const sorted: EditWorkflowOperation[] = []
  const queue: string[] = []

  inserts.forEach((op) => {
    const deps = dependencies.get(op.block_id)!
    if (deps.size === 0) queue.push(op.block_id)
  })

  while (queue.length > 0) {
    const blockId = queue.shift()!
    const op = insertMap.get(blockId)
    if (op) sorted.push(op)

    const children = dependents.get(blockId)
    if (children) {
      children.forEach((childId) => {
        const childDeps = dependencies.get(childId)!
        childDeps.delete(blockId)
        if (childDeps.size === 0) queue.push(childId)
      })
    }
  }

  if (sorted.length < inserts.length) {
    inserts.forEach((op) => {
      if (!sorted.includes(op)) sorted.push(op)
    })
  }

  return sorted
}

function orderOperations(operations: EditWorkflowOperation[]): EditWorkflowOperation[] {
  const deletes = operations.filter((op) => op.operation_type === 'delete')
  const extracts = operations.filter((op) => op.operation_type === 'extract_from_subflow')
  const adds = operations.filter((op) => op.operation_type === 'add')
  const inserts = operations.filter((op) => op.operation_type === 'insert_into_subflow')
  const edits = operations.filter((op) => op.operation_type === 'edit')

  const sortedInserts = topologicalSortInserts(inserts, adds)

  return [...deletes, ...extracts, ...adds, ...sortedInserts, ...edits]
}

// ---------------------------------------------------------------------------
// Loop / Parallel Regeneration (simplified from legacy generateLoopBlocks/generateParallelBlocks)
// ---------------------------------------------------------------------------

/**
 * Generates loop metadata from blocks state.
 */
function generateLoopBlocks(blocks: Record<string, any>): Record<string, any> {
  const loops: Record<string, any> = {}
  for (const [blockId, block] of Object.entries(blocks)) {
    if (block.type === 'loop') {
      const nestedNodes = Object.keys(blocks).filter(
        (id) => blocks[id].data?.parentId === blockId
      )
      loops[blockId] = {
        loopType: block.data?.loopType || 'for',
        count: block.data?.count,
        collection: block.data?.collection,
        whileCondition: block.data?.whileCondition,
        doWhileCondition: block.data?.doWhileCondition,
        nestedNodes,
      }
    }
  }
  return loops
}

/**
 * Generates parallel metadata from blocks state.
 */
function generateParallelBlocks(blocks: Record<string, any>): Record<string, any> {
  const parallels: Record<string, any> = {}
  for (const [blockId, block] of Object.entries(blocks)) {
    if (block.type === 'parallel') {
      const nestedNodes = Object.keys(blocks).filter(
        (id) => blocks[id].data?.parentId === blockId
      )
      parallels[blockId] = {
        parallelType: block.data?.parallelType || 'count',
        count: block.data?.count,
        collection: block.data?.collection,
        nestedNodes,
      }
    }
  }
  return parallels
}

// ---------------------------------------------------------------------------
// Auto Layout
// ---------------------------------------------------------------------------

/**
 * Auto-layouts blocks using topological sort based on edges.
 * Positions blocks left-to-right in layers.
 */
function autoLayoutBlocks(blocks: Record<string, any>, edges: any[]): void {
  const blockIds = Object.keys(blocks).filter((id) => !blocks[id].data?.parentId)
  if (blockIds.length === 0) return

  const inDegree: Record<string, number> = {}
  const adj: Record<string, string[]> = {}

  for (const id of blockIds) {
    inDegree[id] = 0
    adj[id] = []
  }

  for (const edge of edges) {
    if (blocks[edge.source] && blocks[edge.target] && !blocks[edge.source].data?.parentId && !blocks[edge.target].data?.parentId) {
      inDegree[edge.target] = (inDegree[edge.target] || 0) + 1
      adj[edge.source]?.push(edge.target)
    }
  }

  const queue = blockIds.filter((id) => inDegree[id] === 0)
  const sorted: string[] = []
  const layers: string[][] = []

  while (queue.length > 0) {
    const layer = [...queue]
    layers.push(layer)
    sorted.push(...layer)
    queue.length = 0

    for (const id of layer) {
      for (const next of adj[id] || []) {
        inDegree[next]--
        if (inDegree[next] === 0) queue.push(next)
      }
    }
  }

  const remaining = blockIds.filter((id) => !sorted.includes(id))
  if (remaining.length > 0) layers.push(remaining)

  const X_START = 100
  const Y_CENTER = 300
  const X_GAP = 350
  const Y_GAP = 200

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]
    const yOffset = Y_CENTER - ((layer.length - 1) * Y_GAP) / 2
    for (let bi = 0; bi < layer.length; bi++) {
      blocks[layer[bi]].position = {
        x: X_START + li * X_GAP,
        y: yOffset + bi * Y_GAP,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main Engine
// ---------------------------------------------------------------------------

/**
 * Apply operations to the workflow JSON state.
 * This is the main entry point for the edit engine.
 *
 * Operation order:
 * 1. delete - Remove blocks first
 * 2. extract_from_subflow - Extract blocks from subflows
 * 3. add - Create new blocks (sorted by connection dependencies)
 * 4. insert_into_subflow - Insert blocks into subflows (parent-dependency sorted)
 * 5. edit - Edit existing blocks last
 */
export function applyOperationsToWorkflowState(
  workflowState: Record<string, unknown>,
  operations: EditWorkflowOperation[]
): ApplyOperationsResult {
  const modifiedState = JSON.parse(JSON.stringify(workflowState))

  const validationErrors: ValidationError[] = []
  const skippedItems: SkippedItem[] = []

  // Normalize block IDs to UUIDs
  const { normalizedOperations } = normalizeBlockIdsInOperations(operations)

  // Order operations for deterministic application
  const orderedOperations = orderOperations(normalizedOperations)

  logger.info('Applying operations to workflow:', {
    totalOperations: orderedOperations.length,
    operationTypes: orderedOperations.reduce((acc: Record<string, number>, op) => {
      acc[op.operation_type] = (acc[op.operation_type] || 0) + 1
      return acc
    }, {}),
    initialBlockCount: Object.keys(modifiedState.blocks || {}).length,
  })

  const ctx: OperationContext = {
    modifiedState,
    skippedItems,
    validationErrors,
    deferredConnections: [],
  }

  for (const operation of orderedOperations) {
    const { operation_type, block_id } = operation

    if (!isValidKey(block_id)) {
      logSkippedItem(skippedItems, {
        type: 'missing_required_params',
        operationType: operation_type,
        blockId: String(block_id || 'invalid'),
        reason: `Invalid block_id "${block_id}" (type: ${typeof block_id}) - operation skipped.`,
      })
      continue
    }

    const handler = OPERATION_HANDLERS[operation_type]
    if (!handler) continue

    handler(operation, ctx)
  }

  // Pass 2: Process all deferred connections
  if (ctx.deferredConnections.length > 0) {
    logger.info('Processing deferred connections', {
      deferredConnectionCount: ctx.deferredConnections.length,
      totalBlocks: Object.keys(modifiedState.blocks || {}).length,
    })

    for (const { blockId, connections } of ctx.deferredConnections) {
      if (!modifiedState.blocks[blockId]) {
        logger.warn('Source block no longer exists for deferred connection', { blockId })
        continue
      }
      addConnectionsAsEdges(modifiedState, blockId, connections, skippedItems)
    }
  }

  // Regenerate loops and parallels
  modifiedState.loops = generateLoopBlocks(modifiedState.blocks || {})
  modifiedState.parallels = generateParallelBlocks(modifiedState.blocks || {})

  // Remove blocks without type
  const blocksWithoutType = Object.entries(modifiedState.blocks || {})
    .filter(([_, block]: [string, any]) => !block.type || block.type === undefined)
    .map(([id]) => id)

  if (blocksWithoutType.length > 0) {
    logger.error('Removing blocks without type', { count: blocksWithoutType.length })
    const removedIds = new Set(blocksWithoutType)
    blocksWithoutType.forEach((id) => delete modifiedState.blocks[id])
    modifiedState.edges = (modifiedState.edges || []).filter(
      (edge: any) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    )
  }

  // Auto-layout
  autoLayoutBlocks(modifiedState.blocks || {}, modifiedState.edges || [])

  return { state: modifiedState, validationErrors, skippedItems }
}
