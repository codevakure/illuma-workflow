import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { createLogger } from '@sim/logger'
import { db, copilotChats, workflowCheckpoints, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db'
import { type AuthContext } from '../middleware/auth'
import { getUserId } from '../middleware/auth'
import { getApiKeyWithBYOK } from '@/lib/api-key/byok'
import { SSE_HEADERS, encodeSSE } from '@/lib/core/utils/sse'
import { manifestRegistry } from '@/integrations/manifest-loader'
import { applyOperationsToWorkflowState } from '@/lib/copilot/edit-engine'

const logger = createLogger('CopilotRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * Returns all integrations from the in-memory manifest registry.
 * No HTTP calls needed — manifests are loaded at server startup.
 */
function getIntegrations(): any[] {
  return manifestRegistry.getAllIntegrations()
}

/**
 * Sanitized block representation for copilot context.
 * Strips positions, layout data, and UI-specific fields.
 */
interface CopilotBlock {
  type: string
  name: string
  enabled: boolean
  inputs?: Record<string, unknown>
  connections?: Record<string, string | string[]>
  advancedMode?: boolean
  triggerMode?: boolean
}

/**
 * Loads the current workflow state from normalized DB tables and sanitizes it
 * for copilot consumption. Removes positions, layout data, and UI-specific
 * fields so the LLM understands what blocks exist and how they're connected.
 */
async function loadWorkflowContextForCopilot(
  workflowId: string
): Promise<{ blocks: Record<string, CopilotBlock> } | null> {
  try {
    const [blocks, edges] = await Promise.all([
      db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
      db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
    ])

    if (blocks.length === 0) {
      return null
    }

    // Build edge lookup: blockId -> outgoing edges grouped by source handle
    const edgesBySource = new Map<string, Map<string, string[]>>()
    for (const edge of edges) {
      const handle = edge.sourceHandle || 'source'
      if (!edgesBySource.has(edge.sourceBlockId)) {
        edgesBySource.set(edge.sourceBlockId, new Map())
      }
      const handleMap = edgesBySource.get(edge.sourceBlockId)!
      if (!handleMap.has(handle)) {
        handleMap.set(handle, [])
      }
      handleMap.get(handle)!.push(edge.targetBlockId)
    }

    const sanitizedBlocks: Record<string, CopilotBlock> = {}

    for (const block of blocks) {
      // Sanitize subBlocks: extract just the values, skip null/undefined
      const inputs: Record<string, unknown> = {}
      const subBlocks = (block.subBlocks as Record<string, { value?: unknown; type?: string }>) || {}
      for (const [key, sb] of Object.entries(subBlocks)) {
        if (sb?.value === null || sb?.value === undefined) continue
        // Skip workspace-specific metadata
        if (key === 'tagFilters' || key === 'documentTags') continue
        inputs[key] = sb.value
      }

      // Build connections from edges
      let connections: Record<string, string | string[]> | undefined
      const handleMap = edgesBySource.get(block.id)
      if (handleMap && handleMap.size > 0) {
        connections = {}
        for (const [handle, targets] of handleMap) {
          connections[handle] = targets.length === 1 ? targets[0] : targets
        }
      }

      const copilotBlock: CopilotBlock = {
        type: block.type,
        name: block.name,
        enabled: block.enabled,
      }
      if (Object.keys(inputs).length > 0) copilotBlock.inputs = inputs
      if (connections) copilotBlock.connections = connections
      if (block.advancedMode) copilotBlock.advancedMode = true
      if (block.triggerMode) copilotBlock.triggerMode = true

      sanitizedBlocks[block.id] = copilotBlock
    }

    return { blocks: sanitizedBlocks }
  } catch (error) {
    logger.error('Failed to load workflow context for copilot', { workflowId, error })
    return null
  }
}

/**
 * Resolves an existing copilot chat or creates a new one.
 * Returns the chat record and conversation history for LLM context.
 */
async function resolveOrCreateChat(
  chatId: string | undefined,
  userId: string,
  workflowId: string,
  model: string,
  mode: string,
  createNew: boolean
): Promise<{
  chatId: string
  conversationHistory: Array<{ role: string; content: string }>
  isNew: boolean
}> {
  // Load existing chat
  if (chatId && !createNew) {
    try {
      const [chat] = await db
        .select()
        .from(copilotChats)
        .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
        .limit(1)

      if (chat) {
        const messages = Array.isArray(chat.messages) ? chat.messages : []
        const history = messages
          .filter((m: any) => m.role === 'user' || m.role === 'assistant')
          .filter((m: any) => m.content && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role, content: m.content }))
        return { chatId: chat.id, conversationHistory: history, isNew: false }
      }
    } catch (err) {
      logger.warn('Failed to load chat from DB, creating new', { chatId, error: err })
    }
  }

  // Create new chat
  try {
    const [newChat] = await db
      .insert(copilotChats)
      .values({
        userId,
        workflowId: workflowId || 'default',
        title: null,
        messages: [],
        model,
        config: { model, mode },
      })
      .returning({ id: copilotChats.id })

    return { chatId: newChat.id, conversationHistory: [], isNew: true }
  } catch (err) {
    logger.warn('Failed to create chat in DB, using ephemeral ID', { error: err })
    return {
      chatId: `ephemeral-${Date.now()}`,
      conversationHistory: [],
      isNew: true,
    }
  }
}

/**
 * Saves user and assistant messages to the copilot chat in the database.
 */
async function persistMessages(
  chatId: string,
  userMessage: string,
  assistantResponse: string,
  title?: string
): Promise<void> {
  if (chatId.startsWith('ephemeral-')) return
  try {
    const [chat] = await db
      .select({ messages: copilotChats.messages })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
      .limit(1)

    const existing = Array.isArray(chat?.messages) ? chat.messages : []

    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    }
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: assistantResponse,
      timestamp: new Date().toISOString(),
    }

    const updated = [...existing, userMsg, assistantMsg]

    const setValues: Record<string, any> = {
      messages: updated,
      updatedAt: new Date(),
    }
    // Auto-title on first message
    if (title) {
      setValues.title = title
    }

    await db.update(copilotChats).set(setValues).where(eq(copilotChats.id, chatId))
  } catch (err) {
    logger.warn('Failed to persist messages to DB', { chatId, error: err })
  }
}

/**
 * Maps frontend copilot model IDs to real provider model + provider pairs.
 */
const MODEL_MAP: Record<string, { provider: string; model: string }> = {
  'gpt-5-fast': { provider: 'openai', model: 'gpt-4o-mini' },
  'gpt-5': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5-medium': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5-high': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5.1-fast': { provider: 'openai', model: 'gpt-4o-mini' },
  'gpt-5.1': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5.1-medium': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5.1-high': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5-codex': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5.1-codex': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5.2': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5.2-codex': { provider: 'openai', model: 'gpt-4o' },
  'gpt-5.2-pro': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4.1': { provider: 'openai', model: 'gpt-4o' },
  'o3': { provider: 'openai', model: 'gpt-4o' },
  'claude-4-sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-4.5-haiku': { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
  'claude-4.5-sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-4.5-opus': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-4.1-opus': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'gemini-3-pro': { provider: 'google', model: 'gemini-2.0-flash' },
}

const DEFAULT_RESOLVED = { provider: 'openai', model: 'gpt-4o' }

const ASK_SYSTEM_PROMPT = `You are a helpful AI assistant for Sim, a powerful workflow automation platform. You help users understand and optimize their workflows. Be concise and practical.`

/**
 * Builds the system prompt dynamically from marketplace integrations.
 * This ensures the LLM always has up-to-date knowledge of available blocks.
 */
function buildDynamicSystemPrompt(): string {
  const integrations = getIntegrations()

  const blockLines: string[] = []
  for (const integration of integrations) {
    const block = integration.block
    if (!block || block.hideFromToolbar) continue

    const subBlockParts: string[] = []
    for (const sb of block.subBlocks || []) {
      if (sb.hidden) continue
      let desc = sb.id
      if (sb.type === 'dropdown' && sb.options?.length) {
        const opts = sb.options
          .slice(0, 6)
          .map((o: any) => o.value)
          .join('|')
        desc += `(${opts}${sb.options.length > 6 ? '|...' : ''})`
        if (sb.required) desc += '*'
      } else {
        if (sb.required) desc += '*'
      }
      subBlockParts.push(desc)
    }

    const inputsStr = subBlockParts.length > 0 ? ` Inputs: ${subBlockParts.join(', ')}` : ''
    blockLines.push(
      `- ${block.type}: "${block.name}" — ${block.description || 'No description'}.${inputsStr}`
    )
  }

  blockLines.push(
    `- loop: "Loop" — Iterate over collections or repeat actions. Config via inputs: loopType(for|forEach|while|doWhile), iterations, collection, condition. Contains nestedNodes.`,
    `- parallel: "Parallel" — Execute branches simultaneously. Config via inputs: parallelType(count|collection), count, collection. Contains nestedNodes.`
  )

  return `You are a workflow builder AI for Sim Studio. When the user asks to build or modify a workflow, you MUST use the edit_workflow tool.

RULES:
- Always use edit_workflow with properly structured operations
- Each block needs a unique block_id (use descriptive names like "search_block", "agent_1")
- Use the "inputs" field to set subBlock values by their subBlock ID
- Use "connections" on a block to define where its OUTPUT goes. { "source": "next_block_id" } means "this block's output feeds into next_block_id"
- Example: if search feeds into agent, put connections on the SEARCH block: { "source": "agent_block" }
- The "source" handle is for success/default output, "error" handle for error path
- Skip credential/apiKey inputs — the user configures auth separately
- After creating blocks, briefly explain what you built

OPERATION FORMAT:
{ "operation_type": "add", "block_id": "unique_id", "params": { "type": "block_type", "name": "Display Name", "inputs": { "subBlockId": value }, "connections": { "source": "next_block_id" } } }
{ "operation_type": "edit", "block_id": "existing_id", "params": { "inputs": { "subBlockId": newValue } } }
{ "operation_type": "delete", "block_id": "existing_id" }
{ "operation_type": "insert_into_subflow", "block_id": "child_id", "params": { "subflowId": "loop_or_parallel_id", "type": "block_type", "name": "Name", "inputs": {...} } }
{ "operation_type": "extract_from_subflow", "block_id": "child_id", "params": { "subflowId": "loop_or_parallel_id" } }

EXAMPLE - Search → Summarize chain:
[
  { "operation_type": "add", "block_id": "search_1", "params": { "type": "duckduckgo", "name": "Search", "inputs": { "query": "AI news" }, "connections": { "source": "agent_1" } } },
  { "operation_type": "add", "block_id": "agent_1", "params": { "type": "agent", "name": "Summarizer", "inputs": { "model": "gpt-4o", "systemPrompt": "Summarize the search results" } } }
]

AVAILABLE BLOCKS (${blockLines.length} total):
${blockLines.join('\n')}

TIPS:
- agent blocks: set model (e.g. "gpt-4o"), systemPrompt, context, temperature
- function blocks: set code (JavaScript)
- condition blocks: set conditions
- API blocks: set url, method, headers, body
- Search blocks (tavily, serper, duckduckgo, etc.): set query
- Position is auto-calculated, you don't need to set it`
}

/**
 * OpenAI function calling tool definitions for build mode.
 */
const OPENAI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'edit_workflow',
      description:
        'Add, edit, or delete blocks in the workflow. Use "inputs" to set block configuration values by subBlock ID, and "connections" to wire blocks together.',
      parameters: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            description: 'List of operations to perform on the workflow',
            items: {
              type: 'object',
              properties: {
                operation_type: {
                  type: 'string',
                  enum: ['add', 'edit', 'delete', 'insert_into_subflow', 'extract_from_subflow'],
                  description: 'Type of operation',
                },
                block_id: {
                  type: 'string',
                  description: 'Unique identifier for the block (use descriptive names)',
                },
                params: {
                  type: 'object',
                  description: 'Block parameters',
                  properties: {
                    type: {
                      type: 'string',
                      description: 'Block type from the available blocks list',
                    },
                    name: {
                      type: 'string',
                      description: 'Display name for the block',
                    },
                    inputs: {
                      type: 'object',
                      description:
                        'SubBlock values keyed by subBlock ID (e.g., { "model": "gpt-4o", "systemPrompt": "You are helpful" })',
                      additionalProperties: true,
                    },
                    connections: {
                      type: 'object',
                      description:
                        'Outgoing connections as { sourceHandle: targetBlockId }. Use "source" for success path.',
                      additionalProperties: true,
                    },
                    subflowId: {
                      type: 'string',
                      description: 'For insert_into_subflow/extract_from_subflow: ID of the loop or parallel block',
                    },
                    nestedNodes: {
                      type: 'object',
                      description: 'For loop/parallel blocks: child blocks keyed by ID, each with type, name, inputs, connections',
                      additionalProperties: true,
                    },
                  },
                },
              },
              required: ['operation_type', 'block_id'],
            },
          },
        },
        required: ['operations'],
      },
    },
  },
]

/**
 * Reads an SSE stream from a provider and handles text + tool_call deltas.
 * Returns collected assistant text.
 */
async function readOpenAIStream(
  response: Response,
  controller: ReadableStreamDefaultController,
  mode: string
): Promise<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let collectedText = ''

  // Accumulate tool calls across chunks
  const toolCalls: Record<
    number,
    { id: string; name: string; arguments: string }
  > = {}

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          if (!choice) continue

          const delta = choice.delta

          // Text content
          if (delta?.content) {
            collectedText += delta.content
            controller.enqueue(encodeSSE({ type: 'content', data: delta.content }))
          }

          // Tool calls (streamed incrementally)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tc.id || '', name: '', arguments: '' }
              }
              if (tc.id) toolCalls[idx].id = tc.id
              if (tc.function?.name) {
                toolCalls[idx].name = tc.function.name
                // Send tool_generating as soon as we know the name
                controller.enqueue(
                  encodeSSE({
                    type: 'tool_generating',
                    toolCallId: toolCalls[idx].id,
                    toolName: toolCalls[idx].name,
                  })
                )
              }
              if (tc.function?.arguments) {
                toolCalls[idx].arguments += tc.function.arguments
              }
            }
          }

          // When finish_reason is 'tool_calls' or 'stop', emit accumulated tool calls
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            for (const [, tc] of Object.entries(toolCalls)) {
              if (tc.name && tc.arguments) {
                try {
                  const args = JSON.parse(tc.arguments)
                  controller.enqueue(
                    encodeSSE({
                      type: 'tool_call',
                      data: {
                        id: tc.id,
                        name: tc.name,
                        arguments: args,
                      },
                    })
                  )
                } catch {
                  logger.warn('Failed to parse tool call arguments', {
                    name: tc.name,
                    args: tc.arguments,
                  })
                }
              }
            }
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return collectedText
}

/**
 * Streams OpenAI with optional function calling for build mode.
 * Returns collected assistant text for conversation context.
 */
async function streamOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  controller: ReadableStreamDefaultController,
  mode: string
): Promise<string> {
  const useFunctionCalling = mode === 'agent' || mode === 'build'

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    max_tokens: 8192,
    temperature: 0.1,
  }

  if (useFunctionCalling) {
    body.tools = OPENAI_TOOLS
    body.tool_choice = 'auto'
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    logger.error('OpenAI API error', { status: response.status, error: err })
    controller.enqueue(encodeSSE({ type: 'error', error: `OpenAI error: ${response.status}` }))
    controller.enqueue(encodeSSE({ type: 'done' }))
    controller.close()
    return ''
  }

  const text = await readOpenAIStream(response, controller, mode)
  controller.enqueue(encodeSSE({ type: 'done' }))
  controller.close()
  return text
}

/**
 * Streams Anthropic Messages API with optional tool use for build mode.
 * Returns collected assistant text for conversation context.
 */
async function streamAnthropic(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  controller: ReadableStreamDefaultController,
  mode: string
): Promise<string> {
  const useFunctionCalling = mode === 'agent' || mode === 'build'

  const body: Record<string, unknown> = {
    model,
    system: systemPrompt,
    messages: messages.filter((m) => m.role !== 'system'),
    stream: true,
    max_tokens: 8192,
    temperature: 0.1,
  }

  if (useFunctionCalling) {
    body.tools = [
      {
        name: 'edit_workflow',
        description: OPENAI_TOOLS[0].function.description,
        input_schema: OPENAI_TOOLS[0].function.parameters,
      },
    ]
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    logger.error('Anthropic API error', { status: response.status, error: err })
    controller.enqueue(
      encodeSSE({ type: 'error', error: `Anthropic error: ${response.status}` })
    )
    controller.enqueue(encodeSSE({ type: 'done' }))
    controller.close()
    return ''
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let collectedText = ''
  let currentToolId = ''
  let currentToolName = ''
  let toolInputJson = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)

          if (parsed.type === 'content_block_start') {
            if (parsed.content_block?.type === 'tool_use') {
              currentToolId = parsed.content_block.id
              currentToolName = parsed.content_block.name
              toolInputJson = ''
              controller.enqueue(
                encodeSSE({
                  type: 'tool_generating',
                  toolCallId: currentToolId,
                  toolName: currentToolName,
                })
              )
            }
          }

          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'text_delta' && parsed.delta?.text) {
              collectedText += parsed.delta.text
              controller.enqueue(encodeSSE({ type: 'content', data: parsed.delta.text }))
            }
            if (parsed.delta?.type === 'input_json_delta' && parsed.delta?.partial_json) {
              toolInputJson += parsed.delta.partial_json
            }
          }

          if (parsed.type === 'content_block_stop' && currentToolName) {
            try {
              const args = JSON.parse(toolInputJson)
              controller.enqueue(
                encodeSSE({
                  type: 'tool_call',
                  data: {
                    id: currentToolId,
                    name: currentToolName,
                    arguments: args,
                  },
                })
              )
            } catch {
              logger.warn('Failed to parse Anthropic tool input', { toolInputJson })
            }
            currentToolId = ''
            currentToolName = ''
            toolInputJson = ''
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  controller.enqueue(encodeSSE({ type: 'done' }))
  controller.close()
  return collectedText
}

/**
 * Streams Google Gemini (text only, no tool calling).
 * Returns collected assistant text.
 */
async function streamGoogle(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  controller: ReadableStreamDefaultController
): Promise<string> {
  const geminiMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: geminiMessages,
        generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
      }),
    }
  )

  if (!response.ok) {
    const err = await response.text()
    logger.error('Google API error', { status: response.status, error: err })
    controller.enqueue(encodeSSE({ type: 'error', error: `Google error: ${response.status}` }))
    controller.enqueue(encodeSSE({ type: 'done' }))
    controller.close()
    return ''
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let collectedText = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()

        try {
          const parsed = JSON.parse(data)
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) {
            collectedText += text
            controller.enqueue(encodeSSE({ type: 'content', data: text }))
          }
        } catch {
          // Skip
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  controller.enqueue(encodeSSE({ type: 'done' }))
  controller.close()
  return collectedText
}


/**
 * POST /copilot/chat
 * Streams LLM responses with function calling support for build mode.
 * Persists conversation history to the copilotChats DB table.
 */
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json()
    const {
      message,
      model: requestedModel,
      mode,
      chatId: existingChatId,
      createNewChat,
      workflowId,
    } = body

    if (!message) {
      return c.json({ error: 'Message is required' }, 400)
    }

    const userId = getUserId(c)
    const resolved = MODEL_MAP[requestedModel] || DEFAULT_RESOLVED
    const apiMode = mode === 'build' ? 'agent' : mode || 'ask'

    logger.info('Copilot chat', {
      requestedModel,
      resolved: `${resolved.provider}/${resolved.model}`,
      mode: apiMode,
      existingChatId,
      createNewChat,
    })

    const { apiKey } = await getApiKeyWithBYOK(resolved.provider, resolved.model, 'default')

    const systemPrompt =
      apiMode === 'agent' ? buildDynamicSystemPrompt() : ASK_SYSTEM_PROMPT

    // Resolve or create chat in the database
    const chatResult = await resolveOrCreateChat(
      existingChatId,
      userId,
      workflowId || 'default',
      resolved.model,
      apiMode,
      !!createNewChat
    )
    const chatId = chatResult.chatId

    // In agent/build mode, load current workflow state so the LLM knows
    // what blocks already exist and can edit/delete them instead of always adding new ones
    let workflowContext = ''
    if (apiMode === 'agent' && workflowId) {
      const currentState = await loadWorkflowContextForCopilot(workflowId)
      if (currentState && Object.keys(currentState.blocks).length > 0) {
        workflowContext = `\n\n## Current Workflow State\nThe user's workflow currently contains these blocks. Use "edit" operations to modify existing blocks and "delete" to remove them. Only use "add" for truly new blocks.\n\`\`\`json\n${JSON.stringify(currentState, null, 2)}\n\`\`\``
        logger.info('Injected workflow context', {
          workflowId,
          blockCount: Object.keys(currentState.blocks).length,
        })
      }
    }

    // Build messages with conversation history from DB
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt + workflowContext },
    ]

    // Include prior conversation context (last 20 messages)
    const history = chatResult.conversationHistory.slice(-20)
    messages.push(...history)

    // Add the new user message
    messages.push({ role: 'user', content: message })

    // Collect assistant response text for DB persistence
    let assistantResponse = ''

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encodeSSE({ type: 'chat_id', chatId }))

        try {
          if (resolved.provider === 'anthropic') {
            assistantResponse = await streamAnthropic(
              apiKey,
              resolved.model,
              messages,
              systemPrompt,
              controller,
              apiMode
            )
          } else if (resolved.provider === 'google') {
            assistantResponse = await streamGoogle(
              apiKey,
              resolved.model,
              messages,
              systemPrompt,
              controller
            )
          } else {
            assistantResponse = await streamOpenAI(
              apiKey,
              resolved.model,
              messages,
              controller,
              apiMode
            )
          }

          // Persist user + assistant messages to DB
          if (assistantResponse) {
            const title = chatResult.isNew
              ? message.slice(0, 50) + (message.length > 50 ? '...' : '')
              : undefined
            await persistMessages(chatId, message, assistantResponse, title)
          }
        } catch (err) {
          logger.error('Copilot streaming error', { error: err })
          controller.enqueue(
            encodeSSE({
              type: 'error',
              error: err instanceof Error ? err.message : 'Streaming failed',
            })
          )
          controller.enqueue(encodeSSE({ type: 'done' }))
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  } catch (err) {
    logger.error('Copilot error', { error: err })
    return c.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500
    )
  }
})

/**
 * POST /copilot/execute-copilot-server-tool
 * Dispatches client tool execution requests to server-side handlers.
 * Client tools (edit_workflow, get_blocks_and_tools, etc.) call this to process operations.
 */
app.post('/execute-copilot-server-tool', async (c) => {
  try {
    const body = await c.req.json()
    const { toolName, payload } = body

    if (!toolName) {
      return c.json({ error: 'toolName is required' }, 400)
    }

    logger.info('Execute copilot server tool', { toolName })

    switch (toolName) {
      case 'edit_workflow': {
        const { operations, currentUserWorkflow } = payload || {}

        if (!operations || !Array.isArray(operations)) {
          return c.json({ success: true, result: { error: 'No operations provided' } })
        }

        let workflowState: Record<string, any> = {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        }

        if (currentUserWorkflow) {
          try {
            const parsed =
              typeof currentUserWorkflow === 'string'
                ? JSON.parse(currentUserWorkflow)
                : currentUserWorkflow
            workflowState = {
              blocks: parsed.blocks || {},
              edges: parsed.edges || [],
              loops: parsed.loops || {},
              parallels: parsed.parallels || {},
              variables: parsed.variables,
              metadata: parsed.metadata,
            }
          } catch {
            logger.warn('Failed to parse currentUserWorkflow, starting fresh')
          }
        }

        const { state, validationErrors, skippedItems } =
          applyOperationsToWorkflowState(workflowState, operations)

        const result: Record<string, any> = { workflowState: state }
        if (skippedItems.length > 0) {
          result.skippedItems = skippedItems
          result.skippedItemsMessage = `${skippedItems.length} operation(s) were skipped`
        }
        if (validationErrors.length > 0) {
          result.validationErrors = validationErrors
        }

        return c.json({ success: true, result })
      }

      case 'get_blocks_and_tools': {
        const allIntegrations = getIntegrations()
        const blocks = allIntegrations
          .filter((i: any) => i.block && !i.block.hideFromToolbar)
          .map((i: any) => ({
            type: i.block.type,
            name: i.block.name,
            description: i.block.longDescription || i.block.description,
            triggerAllowed: !!i.block.triggerAllowed,
          }))

        blocks.push(
          {
            type: 'loop',
            name: 'Loop',
            description: 'Control flow block for iterating over collections',
            triggerAllowed: false,
          },
          {
            type: 'parallel',
            name: 'Parallel',
            description: 'Control flow block for parallel execution',
            triggerAllowed: false,
          }
        )

        return c.json({ success: true, result: { blocks } })
      }

      case 'get_blocks_metadata': {
        const { blockTypes } = payload || {}
        const allIntegrations = getIntegrations()
        const metadata: Record<string, any> = {}

        const typesToFetch = Array.isArray(blockTypes) ? blockTypes : allIntegrations
          .filter((i: any) => i.block && !i.block.hideFromToolbar)
          .map((i: any) => i.block.type)

        for (const blockType of typesToFetch) {
          const integration = allIntegrations.find((i: any) => i.block?.type === blockType)
          if (!integration?.block) continue
          const block = integration.block

          const subBlockMeta: Record<string, any> = {}
          for (const sb of block.subBlocks || []) {
            if (sb.hidden) continue
            const meta: any = {
              type: sb.type,
              required: !!sb.required,
            }
            if (sb.placeholder) meta.placeholder = sb.placeholder
            if (sb.description) meta.description = sb.description
            if (sb.default !== undefined) meta.default = sb.default
            if (sb.type === 'dropdown' && sb.options) {
              const opts = typeof sb.options === 'function' ? sb.options() : sb.options
              meta.options = opts?.map((o: any) => ({ id: o.id ?? o.value, label: o.label ?? o.name }))
            }
            if (sb.type === 'slider') {
              meta.min = sb.min
              meta.max = sb.max
              meta.step = sb.step
            }
            if (sb.condition) meta.condition = sb.condition
            if (sb.mode) meta.mode = sb.mode
            subBlockMeta[sb.id] = meta
          }

          const outputsMeta: Record<string, any> = {}
          if (block.outputs) {
            for (const [key, config] of Object.entries(block.outputs)) {
              outputsMeta[key] = { type: (config as any).type || 'any' }
            }
          }

          metadata[blockType] = {
            type: block.type,
            name: block.name,
            description: block.description,
            longDescription: block.longDescription,
            category: block.category,
            inputs: subBlockMeta,
            outputs: outputsMeta,
            triggerAllowed: !!block.triggerAllowed,
          }

          // Include tool info
          if (integration.tools?.length) {
            metadata[blockType].tools = integration.tools.map((t: any) => ({
              id: t.id,
              name: t.name,
              description: t.description,
            }))
          }
        }

        // Include loop/parallel metadata
        if (!blockTypes || blockTypes.includes('loop')) {
          metadata['loop'] = {
            type: 'loop',
            name: 'Loop',
            description: 'Iterate over collections or repeat actions',
            category: 'control-flow',
            inputs: {
              loopType: { type: 'dropdown', options: [
                { id: 'for', label: 'For (count)' },
                { id: 'forEach', label: 'For Each (collection)' },
                { id: 'while', label: 'While (condition)' },
                { id: 'doWhile', label: 'Do While (condition)' },
              ]},
              iterations: { type: 'short-input', condition: { field: 'loopType', value: 'for' } },
              collection: { type: 'short-input', condition: { field: 'loopType', value: 'forEach' } },
              condition: { type: 'short-input', condition: { field: 'loopType', value: ['while', 'doWhile'] } },
            },
            outputs: { output: { type: 'any' } },
          }
        }
        if (!blockTypes || blockTypes.includes('parallel')) {
          metadata['parallel'] = {
            type: 'parallel',
            name: 'Parallel',
            description: 'Execute branches simultaneously',
            category: 'control-flow',
            inputs: {
              parallelType: { type: 'dropdown', options: [
                { id: 'count', label: 'By Count' },
                { id: 'collection', label: 'By Collection' },
              ]},
              count: { type: 'short-input', condition: { field: 'parallelType', value: 'count' } },
              collection: { type: 'short-input', condition: { field: 'parallelType', value: 'collection' } },
            },
            outputs: { output: { type: 'any' } },
          }
        }

        return c.json({ success: true, result: { metadata } })
      }

      case 'get_block_config': {
        const { blockType } = payload || {}
        if (!blockType) {
          return c.json({ success: true, result: { error: 'blockType is required' } })
        }

        const blockConfig = manifestRegistry.getBlock(blockType)
        if (!blockConfig) {
          return c.json({ success: true, result: { error: `Block type "${blockType}" not found` } })
        }

        const inputs: Record<string, any> = {}
        for (const sb of blockConfig.subBlocks || []) {
          const schema: any = {
            type: sb.type,
            required: !!sb.required,
          }
          if (sb.placeholder) schema.placeholder = sb.placeholder
          if (sb.type === 'dropdown' && sb.options) {
            schema.options = sb.options.map((o: any) => {
              if (typeof o === 'string') return { id: o, label: o }
              return { id: o.value, label: o.label }
            })
          }
          if (sb.type === 'slider') {
            schema.min = sb.min
            schema.max = sb.max
          }
          if (sb.condition) schema.condition = sb.condition
          inputs[sb.id] = schema
        }

        const outputs: Record<string, any> = {}
        if (blockConfig.outputs) {
          for (const [key, config] of Object.entries(blockConfig.outputs)) {
            outputs[key] = { type: (config as any).type || 'any' }
          }
        }

        return c.json({
          success: true,
          result: {
            type: blockConfig.type,
            name: blockConfig.name,
            description: blockConfig.description,
            inputs,
            outputs,
          },
        })
      }

      case 'get_block_options': {
        const { blockType } = payload || {}
        if (!blockType) {
          return c.json({ success: true, result: { error: 'blockType is required' } })
        }

        const allIntegrations = getIntegrations()
        const integration = allIntegrations.find((i: any) => i.block?.type === blockType)
        if (!integration?.block) {
          return c.json({ success: true, result: { error: `Block type "${blockType}" not found` } })
        }

        const operations: Array<{ id: string; name: string; description?: string }> = []

        // Check if block has operation dropdown
        const operationSubBlock = (integration.block.subBlocks || []).find(
          (sb: any) => sb.id === 'operation' && sb.type === 'dropdown'
        )
        if (operationSubBlock?.options) {
          const opts = typeof operationSubBlock.options === 'function'
            ? operationSubBlock.options()
            : operationSubBlock.options
          for (const opt of opts || []) {
            const opEntry: any = {
              id: opt.id ?? opt.value,
              name: opt.label ?? opt.name,
            }
            // Try to get description from corresponding tool
            const toolId = `${blockType}_${opt.id ?? opt.value}`
            const tool = integration.tools?.find((t: any) => t.id === toolId)
            if (tool?.description) opEntry.description = tool.description
            operations.push(opEntry)
          }
        }

        return c.json({ success: true, result: { operations } })
      }

      case 'get_trigger_blocks': {
        const allIntegrations = getIntegrations()
        const triggerBlocks = allIntegrations
          .filter((i: any) => {
            if (!i.block) return false
            if (i.block.category === 'triggers') return true
            if (i.block.triggerAllowed) return true
            const hasTriggerMode = (i.block.subBlocks || []).some(
              (sb: any) => sb.mode === 'trigger'
            )
            return hasTriggerMode
          })
          .map((i: any) => ({
            type: i.block.type,
            name: i.block.name,
            description: i.block.description,
            category: i.block.category,
          }))

        return c.json({ success: true, result: { blocks: triggerBlocks } })
      }

      case 'get_block_outputs': {
        const { blockType, inputs: blockInputs } = payload || {}
        if (!blockType) {
          return c.json({ success: true, result: { error: 'blockType is required' } })
        }

        const blockConfig = manifestRegistry.getBlock(blockType)
        if (!blockConfig?.outputs) {
          return c.json({ success: true, result: { outputs: {} } })
        }

        const outputs: Record<string, any> = {}
        for (const [key, config] of Object.entries(blockConfig.outputs)) {
          outputs[key] = { type: (config as any).type || 'any' }
        }

        return c.json({ success: true, result: { outputs } })
      }

      case 'get_block_upstream_references': {
        // Returns blocks that can be referenced via {{blockName.output}} syntax
        const { workflowState: wfState, blockId: targetBlockId } = payload || {}
        if (!wfState || !targetBlockId) {
          return c.json({ success: true, result: { references: [] } })
        }

        const parsed = typeof wfState === 'string' ? JSON.parse(wfState) : wfState
        const references: Array<{ blockId: string; blockName: string; outputs: string[] }> = []

        // Find upstream blocks via edges
        const visited = new Set<string>()
        const queue = [targetBlockId]
        const edges = parsed.edges || []

        while (queue.length > 0) {
          const current = queue.shift()!
          for (const edge of edges) {
            if (edge.target === current && !visited.has(edge.source)) {
              visited.add(edge.source)
              queue.push(edge.source)
              const block = parsed.blocks?.[edge.source]
              if (block) {
                const outputKeys = block.outputs ? Object.keys(block.outputs) : ['response']
                references.push({
                  blockId: edge.source,
                  blockName: block.name || block.type,
                  outputs: outputKeys,
                })
              }
            }
          }
        }

        return c.json({ success: true, result: { references } })
      }

      default:
        logger.warn('Unknown copilot server tool', { toolName })
        return c.json({ success: true, result: { error: `Unknown tool: ${toolName}` } })
    }
  } catch (err) {
    logger.error('Execute copilot server tool error', { error: err })
    return c.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500
    )
  }
})

/**
 * POST /copilot/tools/mark-complete
 * Called by frontend after client-side tool execution completes.
 */
app.post('/tools/mark-complete', async (c) => {
  const body = await c.req.json()
  logger.info('Tool marked complete', {
    toolCallId: body.toolCallId,
    toolName: body.toolName,
    status: body.status,
  })
  return c.json({ success: true })
})

/**
 * GET /copilot/chat
 * Returns copilot chat history from the database.
 * Supports ?chatId=X for single chat or ?workflowId=X for all workflow chats.
 */
app.get('/chat', async (c) => {
  try {
    const userId = getUserId(c)
    const chatId = c.req.query('chatId')
    const workflowId = c.req.query('workflowId')

    if (chatId) {
      const [chat] = await db
        .select()
        .from(copilotChats)
        .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
        .limit(1)

      if (!chat) {
        return c.json({ success: true, chats: [] })
      }

      const messages = Array.isArray(chat.messages) ? chat.messages : []
      return c.json({
        success: true,
        chats: [
          {
            id: chat.id,
            title: chat.title || 'Chat',
            model: chat.model,
            messages,
            messageCount: messages.length,
            planArtifact: chat.planArtifact,
            config: chat.config,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
          },
        ],
      })
    }

    // List chats for a workflow (or all user chats)
    const condition = workflowId
      ? and(eq(copilotChats.userId, userId), eq(copilotChats.workflowId, workflowId))
      : eq(copilotChats.userId, userId)

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        model: copilotChats.model,
        messages: copilotChats.messages,
        planArtifact: copilotChats.planArtifact,
        config: copilotChats.config,
        createdAt: copilotChats.createdAt,
        updatedAt: copilotChats.updatedAt,
      })
      .from(copilotChats)
      .where(condition)
      .orderBy(desc(copilotChats.updatedAt))
      .limit(50)

    return c.json({
      success: true,
      chats: chats.map((chat) => {
        const msgs = Array.isArray(chat.messages) ? chat.messages : []
        return {
          ...chat,
          messages: msgs,
          messageCount: msgs.length,
        }
      }),
    })
  } catch (err) {
    logger.error('Failed to fetch copilot chats', { error: err })
    return c.json({ success: true, chats: [] })
  }
})

/**
 * POST /copilot/chat/update-messages
 * Persists chat messages to the database.
 */
app.post('/chat/update-messages', async (c) => {
  try {
    const body = await c.req.json()
    const { chatId, messages, planArtifact, config } = body

    if (!chatId) {
      return c.json({ success: true })
    }

    const setValues: Record<string, any> = {
      updatedAt: new Date(),
    }

    if (Array.isArray(messages)) {
      setValues.messages = messages
    }
    if (planArtifact !== undefined) {
      setValues.planArtifact = planArtifact
    }
    if (config !== undefined) {
      setValues.config = config
    }

    await db.update(copilotChats).set(setValues).where(eq(copilotChats.id, chatId))
    logger.info('Chat messages updated', {
      chatId,
      messageCount: Array.isArray(messages) ? messages.length : 'unchanged',
    })
  } catch (err) {
    logger.warn('Failed to update chat messages', { error: err })
  }
  return c.json({ success: true })
})

/**
 * GET /copilot/auto-allowed-tools
 * Returns auto-allowed tools list.
 */
app.get('/auto-allowed-tools', (c) => {
  return c.json({ tools: [] })
})

/**
 * POST /copilot/checkpoints
 * Creates a workflow checkpoint (snapshot) linked to a chat message.
 */
app.post('/checkpoints', async (c) => {
  try {
    const userId = getUserId(c)
    const body = await c.req.json()
    const { workflowId, chatId, messageId, workflowState } = body

    if (!workflowId || !chatId || !workflowState) {
      return c.json({ error: 'workflowId, chatId, and workflowState are required' }, 400)
    }

    const [checkpoint] = await db
      .insert(workflowCheckpoints)
      .values({
        userId,
        workflowId,
        chatId,
        messageId: messageId || null,
        workflowState,
      })
      .returning({ id: workflowCheckpoints.id, createdAt: workflowCheckpoints.createdAt })

    logger.info('Created workflow checkpoint', {
      checkpointId: checkpoint.id,
      workflowId,
      chatId,
      messageId,
    })

    return c.json({ success: true, checkpoint })
  } catch (err) {
    logger.error('Failed to create checkpoint', { error: err })
    return c.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500
    )
  }
})

/**
 * GET /copilot/checkpoints
 * Lists checkpoints for a workflow/chat.
 */
app.get('/checkpoints', async (c) => {
  try {
    const userId = getUserId(c)
    const workflowId = c.req.query('workflowId')
    const chatId = c.req.query('chatId')

    if (!workflowId && !chatId) {
      return c.json({ error: 'workflowId or chatId is required' }, 400)
    }

    const conditions = [eq(workflowCheckpoints.userId, userId)]
    if (workflowId) conditions.push(eq(workflowCheckpoints.workflowId, workflowId))
    if (chatId) conditions.push(eq(workflowCheckpoints.chatId, chatId))

    const checkpoints = await db
      .select({
        id: workflowCheckpoints.id,
        workflowId: workflowCheckpoints.workflowId,
        chatId: workflowCheckpoints.chatId,
        messageId: workflowCheckpoints.messageId,
        createdAt: workflowCheckpoints.createdAt,
      })
      .from(workflowCheckpoints)
      .where(and(...conditions))
      .orderBy(desc(workflowCheckpoints.createdAt))
      .limit(50)

    return c.json({ success: true, checkpoints })
  } catch (err) {
    logger.error('Failed to list checkpoints', { error: err })
    return c.json({ success: true, checkpoints: [] })
  }
})

/**
 * POST /copilot/checkpoints/revert
 * Reverts a workflow to a specific checkpoint state.
 */
app.post('/checkpoints/revert', async (c) => {
  try {
    const userId = getUserId(c)
    const body = await c.req.json()
    const { checkpointId } = body

    if (!checkpointId) {
      return c.json({ error: 'checkpointId is required' }, 400)
    }

    const [checkpoint] = await db
      .select()
      .from(workflowCheckpoints)
      .where(
        and(
          eq(workflowCheckpoints.id, checkpointId),
          eq(workflowCheckpoints.userId, userId)
        )
      )
      .limit(1)

    if (!checkpoint) {
      return c.json({ error: 'Checkpoint not found' }, 404)
    }

    logger.info('Reverting to checkpoint', {
      checkpointId,
      workflowId: checkpoint.workflowId,
    })

    return c.json({
      success: true,
      workflowState: checkpoint.workflowState,
      checkpointId: checkpoint.id,
      createdAt: checkpoint.createdAt,
    })
  } catch (err) {
    logger.error('Failed to revert checkpoint', { error: err })
    return c.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500
    )
  }
})

export { app as copilotRoutes }
