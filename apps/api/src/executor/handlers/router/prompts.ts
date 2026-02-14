/**
 * Router prompt generators for legacy (block-based) and v2 (port-based) routers.
 */

interface TargetBlock {
  id: string
  type?: string
  title?: string
  description?: string
  category?: string
  subBlocks?: Record<string, any>
  currentState?: any
}

/**
 * Generates the system prompt for the legacy router (block-based).
 */
export const generateRouterPrompt = (prompt: string, targetBlocks?: TargetBlock[]): string => {
  const basePrompt = `You are an intelligent routing agent responsible for directing workflow requests to the most appropriate block. Your task is to analyze the input and determine the single most suitable destination based on the request.

Key Instructions:
1. You MUST choose exactly ONE destination from the IDs of the blocks in the workflow. The destination must be a valid block id.

2. Analysis Framework:
   - Carefully evaluate the intent and requirements of the request
   - Consider the primary action needed
   - Match the core functionality with the most appropriate destination`

  const targetBlocksInfo = targetBlocks
    ? `

Available Target Blocks:
${targetBlocks
  .map(
    (block) => `
ID: ${block.id}
Type: ${block.type}
Title: ${block.title}
Description: ${block.description}
System Prompt: ${JSON.stringify(block.subBlocks?.systemPrompt || '')}
Configuration: ${JSON.stringify(block.subBlocks, null, 2)}
${block.currentState ? `Current State: ${JSON.stringify(block.currentState, null, 2)}` : ''}
---`
  )
  .join('\n')}

Routing Instructions:
1. Analyze the input request carefully against each block's:
   - Primary purpose (from title, description, and system prompt)
   - Look for keywords in the system prompt that match the user's request
   - Configuration settings
   - Current state (if available)
   - Processing capabilities

2. Selection Criteria:
   - Choose the block that best matches the input's requirements
   - Consider the block's specific functionality and constraints
   - Factor in any relevant current state or configuration
   - Prioritize blocks that can handle the input most effectively`
    : ''

  return `${basePrompt}${targetBlocksInfo}

Routing Request: ${prompt}

Response Format:
Return ONLY the destination id as a single word, lowercase, no punctuation or explanation.
Example: "2acd9007-27e8-4510-a487-73d3b825e7c1"

Remember: Your response must be ONLY the block ID - no additional text, formatting, or explanation.`
}

/**
 * Generates the system prompt for the port-based router (v2).
 * Instead of selecting a block by ID, it selects a route by evaluating all route descriptions.
 */
export const generateRouterV2Prompt = (
  context: string,
  routes: Array<{ id: string; title: string; value: string }>
): string => {
  const routesInfo = routes
    .map(
      (route, index) => `
Route ${index + 1}:
ID: ${route.id}
Description: ${route.value || 'No description provided'}
---`
    )
    .join('\n')

  return `You are a DETERMINISTIC routing agent. You MUST select exactly ONE option.

Available Routes:
${routesInfo}

Context to route:
${context}

ROUTING RULES:
1. ALWAYS prefer selecting a route over NO_MATCH
2. Pick the route whose description BEST matches the context, even if it's not a perfect match
3. If the context is even partially related to a route's description, select that route
4. ONLY output NO_MATCH if the context is completely unrelated to ALL route descriptions

Respond with a JSON object containing:
- route: EXACTLY one route ID (copied exactly as shown above) OR "NO_MATCH"
- reasoning: A brief explanation (1-2 sentences) of why you chose this route`
}
