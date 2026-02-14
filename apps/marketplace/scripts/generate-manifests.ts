#!/usr/bin/env bun
/**
 * Manifest Generator
 *
 * Reads existing block definitions (apps/web/src/blocks/) and tool definitions
 * (apps/api/src/tools/) to auto-generate manifest.json files for each connector
 * integration in the marketplace.
 *
 * Usage:
 *   cd apps/marketplace
 *   bun run scripts/generate-manifests.ts
 *
 * This produces one manifest.json per integration in integrations/{service}/.
 *
 * Core blocks (agent, function, condition, etc.) are excluded — they stay in
 * the API server.
 */

import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..', '..', '..')
const WEB_BLOCKS_DIR = path.join(ROOT, 'apps', 'web', 'src', 'blocks', 'blocks')
const WEB_REGISTRY = path.join(ROOT, 'apps', 'web', 'src', 'blocks', 'registry.ts')
const API_TOOLS_DIR = path.join(ROOT, 'apps', 'api', 'src', 'tools')
const API_TOOLS_REGISTRY = path.join(ROOT, 'apps', 'api', 'src', 'tools', 'registry.ts')
const OUTPUT_DIR = path.join(__dirname, '..', 'integrations')

// ---------------------------------------------------------------------------
// Core blocks — these stay in the API, NOT in marketplace
// ---------------------------------------------------------------------------

const CORE_BLOCK_TYPES = new Set([
  'agent',
  'api_trigger',
  'chat_trigger',
  'condition',
  'evaluator',
  'function',
  'generic_webhook',
  'guardrails',
  'human_in_the_loop',
  'input_trigger',
  'knowledge',
  'manual_trigger',
  'memory',
  'note',
  'parallel_ai',
  'response',
  'router',
  'router_v2',
  'start_trigger',
  'starter',
  'thinking',
  'variables',
  'wait',
  'webhook_request',
])

// ---------------------------------------------------------------------------
// Type extraction helpers (regex-based, works on TS source without compiling)
// ---------------------------------------------------------------------------

interface BlockInfo {
  type: string
  name: string
  description: string
  longDescription?: string
  docsLink?: string
  category: string
  bgColor: string
  icon: string
  authMode?: string
  hideFromToolbar?: boolean
  triggerAllowed?: boolean
  toolAccess: string[]
  toolConfig: string
  subBlocks: SubBlockInfo[]
  inputs: Record<string, { type: string; description?: string; required?: boolean }>
  outputs: Record<string, { type: string; description?: string }>
}

interface SubBlockInfo {
  id: string
  type: string
  title: string
  placeholder?: string
  required?: boolean
  password?: boolean
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  step?: number
  condition?: unknown
  dependsOn?: unknown
  mode?: string
  canonicalParamId?: string
  default?: unknown
}

interface ToolInfo {
  id: string
  name: string
  description: string
  version: string
  params: Record<string, { type: string; required?: boolean; description?: string }>
  outputs: Record<string, { type: string; description?: string }>
  oauthProvider?: string
}

/**
 * Parses the block registry to get a map of block type -> file.
 */
function parseBlockRegistry(): Map<string, string> {
  const content = fs.readFileSync(WEB_REGISTRY, 'utf-8')
  const map = new Map<string, string>()

  // Match patterns like: slack: SlackBlock,
  const entryPattern = /^\s+(\w+):\s+(\w+),?$/gm
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(content)) !== null) {
    map.set(match[1], match[2])
  }

  return map
}

/**
 * Parses the tool registry to get tool ID -> tool variable name mappings.
 */
function parseToolRegistry(): Map<string, string> {
  const content = fs.readFileSync(API_TOOLS_REGISTRY, 'utf-8')
  const map = new Map<string, string>()

  const entryPattern = /^\s+(\w+):\s+(\w+),?$/gm
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(content)) !== null) {
    map.set(match[1], match[2])
  }

  return map
}

/**
 * Extracts a string property from a TS object literal using regex.
 */
function extractStringProp(source: string, prop: string): string | undefined {
  // Match: prop: 'value' or prop: "value"
  const pattern = new RegExp(`${prop}:\\s*['"\`]([^'"\`]*?)['"\`]`, 'm')
  const match = source.match(pattern)
  return match?.[1]
}

/**
 * Extracts a boolean property from a TS object literal.
 */
function extractBoolProp(source: string, prop: string): boolean | undefined {
  const pattern = new RegExp(`${prop}:\\s*(true|false)`, 'm')
  const match = source.match(pattern)
  return match ? match[1] === 'true' : undefined
}

/**
 * Extracts the icon component name from a block file.
 */
function extractIcon(source: string): string {
  const match = source.match(/icon:\s*(\w+Icon)/)
  return match?.[1] || 'SearchIcon'
}

/**
 * Extracts the bgColor from a block file.
 */
function extractBgColor(source: string): string {
  const match = source.match(/bgColor:\s*['"]([^'"]+)['"]/)
  return match?.[1] || '#6B7280'
}

/**
 * Extracts auth mode from a block file.
 */
function extractAuthMode(source: string): string | undefined {
  if (source.includes('AuthMode.OAuth')) return 'oauth'
  if (source.includes('AuthMode.ApiKey')) return 'api_key'
  if (source.includes('AuthMode.BotToken')) return 'bot_token'
  return undefined
}

/**
 * Extracts the tools.access array from a block file.
 */
function extractToolAccess(source: string): string[] {
  const accessMatch = source.match(/access:\s*\[([\s\S]*?)\]/)
  if (!accessMatch) return []

  const toolIds: string[] = []
  const idPattern = /['"](\w+)['"]/g
  let match: RegExpExecArray | null
  while ((match = idPattern.exec(accessMatch[1])) !== null) {
    toolIds.push(match[1])
  }
  return toolIds
}

/**
 * Extracts the tool config pattern.
 * If it's a simple function, tries to determine the tool string pattern.
 */
function extractToolConfigPattern(source: string): string {
  // Static tool: tool: () => 'tool_id'
  const staticMatch = source.match(/tool:\s*\(\)\s*=>\s*['"](\w+)['"]/)
  if (staticMatch) return staticMatch[1]

  // Template pattern: tool: (params) => `service_${params.operation}`
  const templateMatch = source.match(/tool:\s*\(\s*\w+\s*\)\s*=>\s*[`'"](\w+)_?\$\{[^}]*\.(\w+)\}[`'"]/)
  if (templateMatch) return `${templateMatch[1]}_{{${templateMatch[2]}}}`

  // Pure template: tool: (params) => params.operation
  const pureMatch = source.match(/tool:\s*\(\s*\w+\s*\)\s*=>\s*(?:\w+\.)?(\w+)/)
  if (pureMatch) return `{{${pureMatch[1]}}}`

  // Complex switch — just use the first tool in access
  return '{{operation}}'
}

/**
 * Extracts options from a subblock definition.
 */
function extractOptions(optionsStr: string): Array<{ value: string; label: string }> | undefined {
  const options: Array<{ value: string; label: string }> = []

  // Match { label: 'X', id: 'y' } or { label: 'X', value: 'y' }
  const optPattern = /\{\s*label:\s*['"]([^'"]+)['"]\s*,\s*(?:id|value):\s*['"]([^'"]+)['"]\s*\}/g
  let match: RegExpExecArray | null
  while ((match = optPattern.exec(optionsStr)) !== null) {
    options.push({ label: match[1], value: match[2] })
  }

  // Also handle string-only options: ['option1', 'option2']
  if (options.length === 0) {
    const strPattern = /['"](\w+)['"]/g
    while ((match = strPattern.exec(optionsStr)) !== null) {
      if (match[1] !== 'label' && match[1] !== 'id' && match[1] !== 'value') {
        options.push({ label: match[1], value: match[1] })
      }
    }
  }

  return options.length > 0 ? options : undefined
}

/**
 * Extracts inputs object from a block file.
 */
function extractInputsOutputs(source: string, section: string): Record<string, { type: string; description?: string }> {
  const result: Record<string, { type: string; description?: string }> = {}

  // Find the section
  const sectionPattern = new RegExp(`${section}:\\s*\\{([\\s\\S]*?)\\}\\s*,?\\s*(?:outputs|triggers|tools|$)`, 'm')
  const match = source.match(sectionPattern)
  if (!match) return result

  const content = match[1]
  // Extract entries like: fieldName: { type: 'string', description: '...' }
  const entryPattern = /(\w+):\s*\{\s*type:\s*['"](\w+)['"]/g
  let entryMatch: RegExpExecArray | null
  while ((entryMatch = entryPattern.exec(content)) !== null) {
    result[entryMatch[1]] = { type: entryMatch[2] }
  }

  return result
}

/**
 * Extracts subblocks from a block file.
 * Returns simplified sub-block info (enough for manifest).
 */
function extractSubBlocks(source: string): SubBlockInfo[] {
  const subBlocks: SubBlockInfo[] = []

  // Find the subBlocks array
  const subBlocksMatch = source.match(/subBlocks:\s*\[([\s\S]*?)\]\s*,?\s*(?:tools|inputs|outputs)/)
  if (!subBlocksMatch) return subBlocks

  const content = subBlocksMatch[1]

  // Split into individual sub-block objects by matching { ... } at the top level
  const blockSegments: string[] = []
  let depth = 0
  let start = -1

  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (content[i] === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        blockSegments.push(content.slice(start, i + 1))
        start = -1
      }
    }
  }

  for (const segment of blockSegments) {
    const id = extractStringProp(segment, 'id')
    const type = extractStringProp(segment, 'type')
    const title = extractStringProp(segment, 'title')

    if (!id || !type) continue

    const sub: SubBlockInfo = {
      id,
      type,
      title: title || id,
    }

    const placeholder = extractStringProp(segment, 'placeholder')
    if (placeholder) sub.placeholder = placeholder

    const password = extractBoolProp(segment, 'password')
    if (password !== undefined) sub.password = password

    const mode = extractStringProp(segment, 'mode')
    if (mode) sub.mode = mode

    const canonicalParamId = extractStringProp(segment, 'canonicalParamId')
    if (canonicalParamId) sub.canonicalParamId = canonicalParamId

    // Extract options if it's a dropdown
    if (type === 'dropdown') {
      const optionsMatch = segment.match(/options:\s*\[([\s\S]*?)\]/)
      if (optionsMatch) {
        sub.options = extractOptions(optionsMatch[1])
      }
    }

    // Extract slider props
    const min = segment.match(/min:\s*(\d+(?:\.\d+)?)/)
    if (min) sub.min = Number(min[1])
    const max = segment.match(/max:\s*(\d+(?:\.\d+)?)/)
    if (max) sub.max = Number(max[1])
    const step = segment.match(/step:\s*(\d+(?:\.\d+)?)/)
    if (step) sub.step = Number(step[1])

    subBlocks.push(sub)
  }

  return subBlocks
}

/**
 * Resolves the tool directory for a service.
 * Maps block type to tool directory (most are 1:1, some differ).
 */
function resolveToolDir(blockType: string): string {
  // Special mappings where block type != tool directory
  const mappings: Record<string, string> = {
    google_search: 'google',
    google_calendar: 'google_calendar',
    google_docs: 'google_docs',
    google_drive: 'google_drive',
    google_forms: 'google_forms',
    google_groups: 'google_groups',
    google_maps: 'google_maps',
    google_sheets: 'google_sheets',
    google_slides: 'google_slides',
    google_vault: 'google_vault',
    twilio_sms: 'sms',
    twilio_voice: 'twilio_voice',
    microsoft_excel: 'microsoft_excel',
    microsoft_planner: 'microsoft_planner',
    microsoft_teams: 'microsoft_teams',
    jira_service_management: 'jsm',
    image_generator: 'vision',
    video_generator: 'video',
    stt: 'stt',
    tts: 'tts',
  }

  // Strip _v2, _v3 suffixes for directory lookup
  const base = blockType.replace(/_v[23]$/, '')
  return mappings[base] || base
}

/**
 * Extracts tool info from a tool definition file.
 */
function extractToolInfo(filePath: string): ToolInfo | null {
  try {
    const source = fs.readFileSync(filePath, 'utf-8')

    const id = extractStringProp(source, 'id')
    if (!id) return null

    const name = extractStringProp(source, 'name') || id
    const description = extractStringProp(source, 'description') || ''
    const version = extractStringProp(source, 'version') || '1.0.0'

    // Extract oauth provider
    let oauthProvider: string | undefined
    const oauthMatch = source.match(/provider:\s*['"](\w+)['"]/)
    if (oauthMatch) oauthProvider = oauthMatch[1]

    return { id, name, description, version, params: {}, outputs: {}, oauthProvider }
  } catch {
    return null
  }
}

/**
 * Gets all tool files for a service directory.
 */
function getToolFiles(serviceDir: string): string[] {
  if (!fs.existsSync(serviceDir)) return []

  return fs.readdirSync(serviceDir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'types.ts' && !f.endsWith('.test.ts'))
    .map((f) => path.join(serviceDir, f))
}

// ---------------------------------------------------------------------------
// Manifest generation
// ---------------------------------------------------------------------------

interface ManifestOutput {
  id: string
  name: string
  version: string
  description: string
  icon: string
  block: {
    type: string
    name: string
    description: string
    longDescription?: string
    docsLink?: string
    category: string
    bgColor: string
    icon: string
    authMode?: string
    hideFromToolbar?: boolean
    subBlocks: SubBlockInfo[]
    tools: {
      access: string[]
      config: { tool: string }
    }
    inputs: Record<string, { type: string; description?: string }>
    outputs: Record<string, { type: string; description?: string }>
    triggerAllowed?: boolean
  }
  tools: Array<{
    id: string
    name: string
    description: string
    version: string
    executionMode: string
    params: Record<string, unknown>
    proxy: { handler: string; operation: string }
  }>
}

function generateManifest(blockType: string, blockFile: string): ManifestOutput | null {
  try {
    const source = fs.readFileSync(blockFile, 'utf-8')

    const name = extractStringProp(source, 'name') || blockType
    const description = extractStringProp(source, 'description') || `${name} integration`
    const longDescription = extractStringProp(source, 'longDescription')
    const docsLink = extractStringProp(source, 'docsLink')
    const category = extractStringProp(source, 'category') || 'tools'
    const bgColor = extractBgColor(source)
    const icon = extractIcon(source)
    const authMode = extractAuthMode(source)
    const hideFromToolbar = extractBoolProp(source, 'hideFromToolbar')
    const triggerAllowed = extractBoolProp(source, 'triggerAllowed')

    const toolAccess = extractToolAccess(source)
    const toolConfigPattern = extractToolConfigPattern(source)
    const subBlocks = extractSubBlocks(source)
    const inputs = extractInputsOutputs(source, 'inputs')
    const outputs = extractInputsOutputs(source, 'outputs')

    // Determine the tool directory
    const toolDirName = resolveToolDir(blockType)
    const toolDir = path.join(API_TOOLS_DIR, toolDirName)

    // Get all tools for this service
    const toolFiles = getToolFiles(toolDir)
    const tools: ManifestOutput['tools'] = []

    for (const toolFile of toolFiles) {
      const info = extractToolInfo(toolFile)
      if (!info) continue

      // Only include tools that are in the access list
      if (toolAccess.length > 0 && !toolAccess.includes(info.id)) continue

      tools.push({
        id: info.id,
        name: info.name,
        description: info.description,
        version: info.version,
        executionMode: 'proxy',
        params: {},
        proxy: {
          handler: toolDirName,
          operation: info.id,
        },
      })
    }

    // If no tools were found from files, create entries from the access list
    if (tools.length === 0 && toolAccess.length > 0) {
      for (const toolId of toolAccess) {
        tools.push({
          id: toolId,
          name: toolId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: `${name} ${toolId.split('_').slice(1).join(' ')} operation`,
          version: '1.0.0',
          executionMode: 'proxy',
          params: {},
          proxy: {
            handler: toolDirName,
            operation: toolId,
          },
        })
      }
    }

    if (tools.length === 0) {
      console.warn(`  ⚠ No tools found for ${blockType}, skipping`)
      return null
    }

    // Determine integration ID — use the base service name
    const integrationId = blockType.replace(/_v[23]$/, '')

    const manifest: ManifestOutput = {
      id: integrationId,
      name,
      version: '1.0.0',
      description,
      icon,
      block: {
        type: blockType,
        name,
        description,
        longDescription,
        docsLink,
        category,
        bgColor,
        icon,
        authMode,
        hideFromToolbar,
        subBlocks,
        tools: {
          access: toolAccess,
          config: { tool: toolConfigPattern },
        },
        inputs,
        outputs,
        triggerAllowed,
      },
      tools,
    }

    // Clean up undefined values
    return JSON.parse(JSON.stringify(manifest))
  } catch (error) {
    console.error(`  ✗ Error generating manifest for ${blockType}:`, error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('🔄 Manifest Generator')
  console.log('='.repeat(60))

  // Parse registries
  const blockRegistry = parseBlockRegistry()
  console.log(`📦 Found ${blockRegistry.size} blocks in web registry`)

  const toolRegistry = parseToolRegistry()
  console.log(`🔧 Found ${toolRegistry.size} tools in API registry`)

  // List all block files
  const blockFiles = fs.readdirSync(WEB_BLOCKS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  console.log(`📄 Found ${blockFiles.length} block definition files`)
  console.log()

  let generated = 0
  let skipped = 0
  let coreSkipped = 0

  // Process each block type in the registry
  for (const [blockType, _blockVar] of blockRegistry) {
    // Skip core blocks
    if (CORE_BLOCK_TYPES.has(blockType)) {
      coreSkipped++
      continue
    }

    // Find the block definition file
    // Block types map to files: slack -> slack.ts, google_search -> google.ts, etc.
    let blockFile: string | null = null

    // Try direct match first
    const directFile = path.join(WEB_BLOCKS_DIR, `${blockType}.ts`)
    if (fs.existsSync(directFile)) {
      blockFile = directFile
    } else {
      // Try base name without version suffix
      const baseName = blockType.replace(/_v[23]$/, '')
      const baseFile = path.join(WEB_BLOCKS_DIR, `${baseName}.ts`)
      if (fs.existsSync(baseFile)) {
        blockFile = baseFile
      }
    }

    if (!blockFile) {
      // Some blocks are defined in multi-block files (e.g., google.ts has google_search)
      // Try common patterns
      for (const f of blockFiles) {
        const stem = f.replace('.ts', '')
        if (blockType.startsWith(stem + '_') || blockType.startsWith(stem)) {
          blockFile = path.join(WEB_BLOCKS_DIR, f)
          break
        }
      }
    }

    if (!blockFile) {
      console.log(`  ⚠ No block file found for "${blockType}", skipping`)
      skipped++
      continue
    }

    // Skip v2/v3 variants — they share the same integration
    if (/_v[23]$/.test(blockType)) {
      // Check if base version already exists
      const baseType = blockType.replace(/_v[23]$/, '')
      const outputPath = path.join(OUTPUT_DIR, baseType, 'manifest.json')
      if (fs.existsSync(outputPath)) {
        continue
      }
    }

    // Generate manifest
    const manifest = generateManifest(blockType, blockFile)
    if (!manifest) {
      skipped++
      continue
    }

    // Write manifest
    const outputPath = path.join(OUTPUT_DIR, manifest.id)
    fs.mkdirSync(outputPath, { recursive: true })
    fs.writeFileSync(
      path.join(outputPath, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    )

    generated++
    console.log(`  ✓ ${manifest.id} (${manifest.tools.length} tools)`)
  }

  console.log()
  console.log('='.repeat(60))
  console.log(`✅ Generated: ${generated} manifests`)
  console.log(`⏭  Core blocks skipped: ${coreSkipped}`)
  console.log(`⚠  Errors/skipped: ${skipped}`)
  console.log(`📂 Output: ${OUTPUT_DIR}`)
}

main()
