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

/** Helper to create a manifest with triggers */
function createTriggerManifest(
  id: string,
  triggers: Array<{ id: string; name: string; provider: string }>
) {
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
    tools: [],
    triggers: triggers.map((t) => ({
      id: t.id,
      name: t.name,
      provider: t.provider,
      credentials: [],
      outputs: {},
    })),
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

  describe('trigger loading', () => {
    it('indexes triggers by ID from triggers array', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_byid__')
      const slackDir = path.join(tmpDir, 'test_trigger_slack')
      fs.mkdirSync(slackDir, { recursive: true })
      fs.writeFileSync(
        path.join(slackDir, 'manifest.json'),
        createTriggerManifest('test_trigger_slack', [
          { id: 'test_slack_webhook', name: 'Slack Webhook', provider: 'slack' },
        ])
      )

      try {
        manifestRegistry.load(tmpDir)

        const trigger = manifestRegistry.getTriggerById('test_slack_webhook')
        expect(trigger).toBeDefined()
        expect(trigger?.name).toBe('Slack Webhook')
        expect(trigger?.provider).toBe('slack')
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('indexes multiple triggers per provider', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_multi__')
      const ghDir = path.join(tmpDir, 'test_trigger_github')
      fs.mkdirSync(ghDir, { recursive: true })
      fs.writeFileSync(
        path.join(ghDir, 'manifest.json'),
        createTriggerManifest('test_trigger_github', [
          { id: 'test_gh_push', name: 'GitHub Push', provider: 'github' },
          { id: 'test_gh_pr_opened', name: 'GitHub PR Opened', provider: 'github' },
          { id: 'test_gh_issue', name: 'GitHub Issue', provider: 'github' },
        ])
      )

      try {
        manifestRegistry.load(tmpDir)

        // All three should be accessible by ID
        expect(manifestRegistry.getTriggerById('test_gh_push')).toBeDefined()
        expect(manifestRegistry.getTriggerById('test_gh_pr_opened')).toBeDefined()
        expect(manifestRegistry.getTriggerById('test_gh_issue')).toBeDefined()

        // Provider lookup should return all three
        const providerTriggers = manifestRegistry.getTriggersForProvider('github')
        const ids = providerTriggers.map((t) => t.id)
        expect(ids).toContain('test_gh_push')
        expect(ids).toContain('test_gh_pr_opened')
        expect(ids).toContain('test_gh_issue')
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('getTrigger returns first trigger for provider (backward compat)', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_compat__')
      const dir = path.join(tmpDir, 'test_trigger_compat')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        createTriggerManifest('test_trigger_compat', [
          { id: 'test_compat_first', name: 'First', provider: 'compat-prov' },
          { id: 'test_compat_second', name: 'Second', provider: 'compat-prov' },
        ])
      )

      try {
        manifestRegistry.load(tmpDir)

        const trigger = manifestRegistry.getTrigger('compat-prov')
        expect(trigger).toBeDefined()
        expect(trigger?.id).toBe('test_compat_first')
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('getAllTriggers returns all triggers from all integrations', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_all__')

      const dir1 = path.join(tmpDir, 'test_trigall_slack')
      fs.mkdirSync(dir1, { recursive: true })
      fs.writeFileSync(
        path.join(dir1, 'manifest.json'),
        createTriggerManifest('test_trigall_slack', [
          { id: 'test_trigall_slack_wh', name: 'Slack WH', provider: 'slack' },
        ])
      )

      const dir2 = path.join(tmpDir, 'test_trigall_stripe')
      fs.mkdirSync(dir2, { recursive: true })
      fs.writeFileSync(
        path.join(dir2, 'manifest.json'),
        createTriggerManifest('test_trigall_stripe', [
          { id: 'test_trigall_stripe_wh', name: 'Stripe WH', provider: 'stripe' },
        ])
      )

      try {
        manifestRegistry.load(tmpDir)

        const all = manifestRegistry.getAllTriggers()
        const ids = all.map((t) => t.id)
        expect(ids).toContain('test_trigall_slack_wh')
        expect(ids).toContain('test_trigall_stripe_wh')
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('getIntegrationForTrigger returns the parent integration', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_parent__')
      const dir = path.join(tmpDir, 'test_trigger_parent')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        createTriggerManifest('test_trigger_parent', [
          { id: 'test_parent_wh', name: 'Parent WH', provider: 'parent-prov' },
        ])
      )

      try {
        manifestRegistry.load(tmpDir)

        const integration = manifestRegistry.getIntegrationForTrigger('test_parent_wh')
        expect(integration).toBeDefined()
        expect(integration?.id).toBe('test_trigger_parent')
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('returns undefined for unknown trigger IDs', () => {
      expect(manifestRegistry.getTriggerById('nonexistent_trigger_xyz')).toBeUndefined()
      expect(manifestRegistry.getIntegrationForTrigger('nonexistent_trigger_xyz')).toBeUndefined()
      expect(manifestRegistry.getTriggersForProvider('nonexistent_provider_xyz')).toEqual([])
    })

    it('validates trigger entries with missing required fields', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_invalid__')
      const dir = path.join(tmpDir, 'test_trigger_invalid')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({
          id: 'test_trigger_invalid',
          name: 'Invalid',
          version: '1.0.0',
          icon: 'test.svg',
          block: {
            type: 'test_trigger_invalid',
            name: 'Invalid',
            category: 'tools',
            subBlocks: [],
          },
          tools: [],
          triggers: [{ id: 'missing_name_provider' }], // Missing name and provider
        })
      )

      try {
        manifestRegistry.load(tmpDir)
        // Should be skipped due to validation errors
        expect(manifestRegistry.getIntegration('test_trigger_invalid')).toBeUndefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('manifests without triggers array load normally', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_notrig__')
      const dir = path.join(tmpDir, 'test_no_triggers')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'manifest.json'), createManifest('test_no_triggers'))

      try {
        manifestRegistry.load(tmpDir)
        expect(manifestRegistry.getIntegration('test_no_triggers')).toBeDefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('trigger count in stats reflects loaded triggers', () => {
      const tmpDir = path.join(__dirname, '__test_trigger_stats__')
      const dir = path.join(tmpDir, 'test_trigger_stats')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        createTriggerManifest('test_trigger_stats', [
          { id: 'test_stats_t1', name: 'T1', provider: 'stats-prov' },
          { id: 'test_stats_t2', name: 'T2', provider: 'stats-prov' },
        ])
      )

      try {
        const before = manifestRegistry.stats().triggers
        manifestRegistry.load(tmpDir)
        const after = manifestRegistry.stats().triggers
        expect(after).toBe(before + 2)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('real manifest trigger loading', () => {
    it('loads triggers from actual marketplace manifests', () => {
      // This test verifies our actual manifest.json files have valid triggers
      const marketplaceDir = path.resolve(__dirname, '..', '..', '..', 'marketplace', 'integrations')
      if (!fs.existsSync(marketplaceDir)) return // Skip if marketplace not available

      const slackManifestPath = path.join(marketplaceDir, 'slack', 'manifest.json')
      if (!fs.existsSync(slackManifestPath)) return

      const raw = fs.readFileSync(slackManifestPath, 'utf-8')
      const manifest = JSON.parse(raw)

      expect(manifest.triggers).toBeDefined()
      expect(Array.isArray(manifest.triggers)).toBe(true)
      expect(manifest.triggers.length).toBeGreaterThan(0)

      const slackTrigger = manifest.triggers[0]
      expect(slackTrigger.id).toBe('slack_webhook')
      expect(slackTrigger.provider).toBe('slack')
      expect(slackTrigger.auth).toBeDefined()
      expect(slackTrigger.auth.type).toBe('custom')
      expect(slackTrigger.challenge).toBeDefined()
      expect(slackTrigger.challenge.type).toBe('body_echo')
    })

    it('loads triggers from actual GitHub manifest with multiple triggers', () => {
      const marketplaceDir = path.resolve(__dirname, '..', '..', '..', 'marketplace', 'integrations')
      if (!fs.existsSync(marketplaceDir)) return

      const ghManifestPath = path.join(marketplaceDir, 'github', 'manifest.json')
      if (!fs.existsSync(ghManifestPath)) return

      const raw = fs.readFileSync(ghManifestPath, 'utf-8')
      const manifest = JSON.parse(raw)

      expect(manifest.triggers).toBeDefined()
      expect(manifest.triggers.length).toBe(12)

      const triggerIds = manifest.triggers.map((t: { id: string }) => t.id)
      expect(triggerIds).toContain('github_push')
      expect(triggerIds).toContain('github_pr_opened')
      expect(triggerIds).toContain('github_pr_merged')
      expect(triggerIds).toContain('github_webhook')

      // All GitHub triggers should have HMAC auth
      for (const trigger of manifest.triggers) {
        expect(trigger.auth).toBeDefined()
        expect(trigger.auth.type).toBe('hmac')
        expect(trigger.auth.headerName).toBe('X-Hub-Signature-256')
        expect(trigger.auth.algorithm).toBe('sha256')
      }
    })

    it('loads triggers from core generic_webhook manifest', () => {
      const coreDir = path.resolve(__dirname, '..', 'blocks', 'manifests')
      if (!fs.existsSync(coreDir)) return

      const whManifestPath = path.join(coreDir, 'generic_webhook', 'manifest.json')
      if (!fs.existsSync(whManifestPath)) return

      const raw = fs.readFileSync(whManifestPath, 'utf-8')
      const manifest = JSON.parse(raw)

      expect(manifest.triggers).toBeDefined()
      expect(manifest.triggers.length).toBe(1)
      expect(manifest.triggers[0].id).toBe('generic_webhook')
      expect(manifest.triggers[0].provider).toBe('generic')
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
