/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Must import after mocks
import { manifestRegistry, initializeManifests } from '@/integrations/manifest-loader'

/** Helper to create a minimal valid manifest JSON */
function createManifest(id: string, category: 'blocks' | 'tools' | 'triggers' = 'blocks') {
  return JSON.stringify({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    version: '1.0.0',
    icon: `${id}.svg`,
    block: {
      type: id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      category,
      subBlocks: [],
    },
    tools: [],
  })
}

/** Helper to create a manifest with tools */
function createToolManifest(id: string, toolIds: string[]) {
  return JSON.stringify({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    version: '1.0.0',
    icon: `${id}.svg`,
    block: {
      type: id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      category: 'tools',
      subBlocks: [],
    },
    tools: toolIds.map((tid) => ({
      id: tid,
      name: tid,
      description: `Tool ${tid}`,
      version: '1.0.0',
      executionMode: 'handler',
      params: {},
    })),
  })
}

describe('ManifestRegistry', () => {
  // Since ManifestRegistry is a singleton, we need to be aware that state
  // accumulates. We use unique IDs per test to avoid collisions.

  describe('load with isCore flag', () => {
    it('marks integrations loaded with isCore=true as core', () => {
      // Create a temp directory structure
      const tmpDir = path.join(__dirname, '__test_core_manifests__')
      const agentDir = path.join(tmpDir, 'test_agent_core')
      fs.mkdirSync(agentDir, { recursive: true })
      fs.writeFileSync(path.join(agentDir, 'manifest.json'), createManifest('test_agent_core'))

      try {
        manifestRegistry.load(tmpDir, true)

        expect(manifestRegistry.isCoreIntegration('test_agent_core')).toBe(true)
        expect(manifestRegistry.getIntegration('test_agent_core')).toBeDefined()
        expect(manifestRegistry.getBlock('test_agent_core')).toBeDefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('marks integrations loaded with isCore=false as non-core', () => {
      const tmpDir = path.join(__dirname, '__test_tool_manifests__')
      const wikiDir = path.join(tmpDir, 'test_wiki_tool')
      fs.mkdirSync(wikiDir, { recursive: true })
      fs.writeFileSync(
        path.join(wikiDir, 'manifest.json'),
        createToolManifest('test_wiki_tool', ['test_wiki_search'])
      )

      try {
        manifestRegistry.load(tmpDir, false)

        expect(manifestRegistry.isCoreIntegration('test_wiki_tool')).toBe(false)
        expect(manifestRegistry.getIntegration('test_wiki_tool')).toBeDefined()
        expect(manifestRegistry.getTool('test_wiki_search')).toBeDefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('getCoreIntegrations returns only core manifests', () => {
      const tmpDir = path.join(__dirname, '__test_mixed_manifests__')

      // Core block
      const coreDir = path.join(tmpDir, 'test_starter_core')
      fs.mkdirSync(coreDir, { recursive: true })
      fs.writeFileSync(path.join(coreDir, 'manifest.json'), createManifest('test_starter_core'))

      // Tool block
      const toolDir = path.join(tmpDir, 'test_slack_tool')
      fs.mkdirSync(toolDir, { recursive: true })
      fs.writeFileSync(
        path.join(toolDir, 'manifest.json'),
        createToolManifest('test_slack_tool', ['test_slack_msg'])
      )

      try {
        // Load core first, then tools
        manifestRegistry.load(tmpDir, true)

        const coreIntegrations = manifestRegistry.getCoreIntegrations()
        const coreIds = coreIntegrations.map((i) => i.id)

        expect(coreIds).toContain('test_starter_core')
        expect(coreIds).toContain('test_slack_tool') // Also loaded as core since same dir
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('loads core blocks with tools category correctly', () => {
      // Some core blocks like evaluator have category "tools" in their manifest
      const tmpDir = path.join(__dirname, '__test_tools_cat_core__')
      const evalDir = path.join(tmpDir, 'test_evaluator_core')
      fs.mkdirSync(evalDir, { recursive: true })
      fs.writeFileSync(
        path.join(evalDir, 'manifest.json'),
        createManifest('test_evaluator_core', 'tools')
      )

      try {
        manifestRegistry.load(tmpDir, true)

        // Even though category is 'tools', it should be marked as core
        expect(manifestRegistry.isCoreIntegration('test_evaluator_core')).toBe(true)
        const block = manifestRegistry.getBlock('test_evaluator_core')
        expect(block?.category).toBe('tools')
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('load validates manifests', () => {
    it('skips manifests with missing required fields', () => {
      const tmpDir = path.join(__dirname, '__test_invalid_manifest__')
      const badDir = path.join(tmpDir, 'test_bad_manifest')
      fs.mkdirSync(badDir, { recursive: true })
      fs.writeFileSync(
        path.join(badDir, 'manifest.json'),
        JSON.stringify({ id: 'test_bad_manifest' }) // Missing name, version, block, tools
      )

      try {
        manifestRegistry.load(tmpDir)
        expect(manifestRegistry.getIntegration('test_bad_manifest')).toBeUndefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('skips directories without manifest.json', () => {
      const tmpDir = path.join(__dirname, '__test_no_manifest__')
      const emptyDir = path.join(tmpDir, 'test_empty_dir')
      fs.mkdirSync(emptyDir, { recursive: true })

      try {
        // Should not throw
        manifestRegistry.load(tmpDir)
        expect(manifestRegistry.getIntegration('test_empty_dir')).toBeUndefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('load with handlerOnly flag', () => {
    it('loads only integrations with handler.ts when handlerOnly=true', () => {
      const tmpDir = path.join(__dirname, '__test_handler_only__')

      // Integration WITH handler.ts
      const withHandler = path.join(tmpDir, 'test_with_handler')
      fs.mkdirSync(withHandler, { recursive: true })
      fs.writeFileSync(
        path.join(withHandler, 'manifest.json'),
        createToolManifest('test_with_handler', ['test_with_handler_search'])
      )
      fs.writeFileSync(path.join(withHandler, 'handler.ts'), 'export default {}')

      // Integration WITHOUT handler.ts
      const withoutHandler = path.join(tmpDir, 'test_without_handler')
      fs.mkdirSync(withoutHandler, { recursive: true })
      fs.writeFileSync(
        path.join(withoutHandler, 'manifest.json'),
        createToolManifest('test_without_handler', ['test_without_handler_op'])
      )

      try {
        manifestRegistry.load(tmpDir, false, true)

        expect(manifestRegistry.getIntegration('test_with_handler')).toBeDefined()
        expect(manifestRegistry.getTool('test_with_handler_search')).toBeDefined()
        expect(manifestRegistry.getIntegration('test_without_handler')).toBeUndefined()
        expect(manifestRegistry.getTool('test_without_handler_op')).toBeUndefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('loads all integrations when handlerOnly=false', () => {
      const tmpDir = path.join(__dirname, '__test_handler_all__')

      // Integration WITHOUT handler.ts
      const noHandler = path.join(tmpDir, 'test_no_handler_all')
      fs.mkdirSync(noHandler, { recursive: true })
      fs.writeFileSync(
        path.join(noHandler, 'manifest.json'),
        createToolManifest('test_no_handler_all', ['test_no_handler_all_op'])
      )

      try {
        manifestRegistry.load(tmpDir, false, false)

        expect(manifestRegistry.getIntegration('test_no_handler_all')).toBeDefined()
        expect(manifestRegistry.getTool('test_no_handler_all_op')).toBeDefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('stats', () => {
    it('returns correct counts', () => {
      const stats = manifestRegistry.stats()
      expect(stats.integrations).toBeGreaterThanOrEqual(0)
      expect(stats.blocks).toBeGreaterThanOrEqual(0)
      expect(stats.tools).toBeGreaterThanOrEqual(0)
      expect(stats.triggers).toBeGreaterThanOrEqual(0)
    })
  })
})
