/**
 * @vitest-environment node
 */
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

/** Tracks which paths "exist" in the virtual filesystem */
let virtualFs: Map<string, string>
let virtualDirs: Map<string, Array<{ name: string; isDirectory: () => boolean }>>

/** Normalize path separators for cross-platform testing */
function norm(p: string): string {
  return path.normalize(p)
}

vi.mock('node:fs', () => {
  return {
    default: {
      existsSync: (p: string) => virtualFs.has(norm(p)) || virtualDirs.has(norm(p)),
      readdirSync: (p: string) => virtualDirs.get(norm(p)) ?? [],
      readFileSync: (p: string) => {
        const content = virtualFs.get(norm(p))
        if (!content) throw new Error(`ENOENT: ${p}`)
        return content
      },
    },
    existsSync: (p: string) => virtualFs.has(norm(p)) || virtualDirs.has(norm(p)),
    readdirSync: (p: string) => virtualDirs.get(norm(p)) ?? [],
    readFileSync: (p: string) => {
      const content = virtualFs.get(norm(p))
      if (!content) throw new Error(`ENOENT: ${p}`)
      return content
    },
  }
})

// Import after mocks
import { manifestRegistry } from './manifest-loader'

/** Helper to set a virtual directory listing */
function setDir(dir: string, entries: Array<{ name: string; isDirectory: () => boolean }>): void {
  virtualDirs.set(norm(dir), entries)
}

/** Helper to set a virtual file */
function setFile(filePath: string, content: string): void {
  virtualFs.set(norm(filePath), content)
}

const validManifest = {
  id: 'wikipedia',
  name: 'Wikipedia',
  version: '1.0.0',
  description: 'Wikipedia integration',
  icon: 'WikipediaIcon',
  block: {
    type: 'wikipedia',
    name: 'Wikipedia',
    description: 'Search Wikipedia',
    category: 'tools',
    bgColor: '#000000',
    icon: 'WikipediaIcon',
    subBlocks: [],
    tools: { access: ['wikipedia_search'], config: { tool: 'wikipedia_search' } },
    inputs: {},
    outputs: {},
  },
  tools: [
    {
      id: 'wikipedia_search',
      name: 'Wikipedia Search',
      description: 'Search Wikipedia articles',
      version: '1.0.0',
      executionMode: 'handler',
      params: { query: { type: 'string', required: true } },
      outputs: { content: { type: 'string' } },
    },
  ],
}

function makeManifest(
  id: string,
  overrides?: Partial<typeof validManifest>
): typeof validManifest {
  return {
    ...validManifest,
    id,
    block: { ...validManifest.block, type: id },
    tools: [{ ...validManifest.tools[0], id: `${id}_search` }],
    ...overrides,
  }
}

describe('manifest-loader', () => {
  beforeEach(() => {
    virtualFs = new Map()
    virtualDirs = new Map()
  })

  describe('ManifestRegistry.load', () => {
    it('loads valid manifests from integrations directory', () => {
      const dir = path.join('/test', 'load-valid')
      setDir(dir, [{ name: 'wikipedia', isDirectory: () => true }])
      setFile(path.join(dir, 'wikipedia', 'manifest.json'), JSON.stringify(validManifest))

      manifestRegistry.load(dir)

      const integration = manifestRegistry.getIntegration('wikipedia')
      expect(integration).toBeDefined()
      expect(integration?.name).toBe('Wikipedia')
    })

    it('skips non-directory entries', () => {
      const dir = path.join('/test', 'skip-files')
      setDir(dir, [{ name: 'readme.md', isDirectory: () => false }])

      manifestRegistry.load(dir)
    })

    it('returns early when integrations directory does not exist', () => {
      manifestRegistry.load(path.join('/nonexistent', 'path'))
    })

    it('skips manifests with validation errors', () => {
      const dir = path.join('/test', 'skip-invalid')
      setDir(dir, [{ name: 'badtool', isDirectory: () => true }])
      setFile(path.join(dir, 'badtool', 'manifest.json'), JSON.stringify({ id: 'badtool', name: 'Bad' }))

      manifestRegistry.load(dir)

      expect(manifestRegistry.getIntegration('badtool')).toBeUndefined()
    })

    it('skips manifest when id does not match directory name', () => {
      const dir = path.join('/test', 'skip-mismatch')
      const manifest = makeManifest('mismatched_id')
      setDir(dir, [{ name: 'wikipedia', isDirectory: () => true }])
      setFile(path.join(dir, 'wikipedia', 'manifest.json'), JSON.stringify(manifest))

      manifestRegistry.load(dir)

      expect(manifestRegistry.getIntegration('mismatched_id')).toBeUndefined()
    })

    it('detects handler.ts presence and sets hasHandler to true', () => {
      const dir = path.join('/test', 'handler-present')
      const manifest = makeManifest('wiki_with_handler')
      setDir(dir, [{ name: 'wiki_with_handler', isDirectory: () => true }])
      setFile(path.join(dir, 'wiki_with_handler', 'manifest.json'), JSON.stringify(manifest))
      setFile(path.join(dir, 'wiki_with_handler', 'handler.ts'), 'export default {}')

      manifestRegistry.load(dir)

      const integration = manifestRegistry.getIntegration('wiki_with_handler')
      expect(integration?.hasHandler).toBe(true)
    })

    it('sets hasHandler to false when handler.ts does not exist', () => {
      const dir = path.join('/test', 'handler-absent')
      const manifest = makeManifest('wiki_no_handler')
      setDir(dir, [{ name: 'wiki_no_handler', isDirectory: () => true }])
      setFile(path.join(dir, 'wiki_no_handler', 'manifest.json'), JSON.stringify(manifest))

      manifestRegistry.load(dir)

      const integration = manifestRegistry.getIntegration('wiki_no_handler')
      expect(integration?.hasHandler).toBe(false)
    })

    it('handles malformed JSON gracefully', () => {
      const dir = path.join('/test', 'bad-json')
      setDir(dir, [{ name: 'broken_json', isDirectory: () => true }])
      setFile(path.join(dir, 'broken_json', 'manifest.json'), '{not valid json')

      manifestRegistry.load(dir)

      expect(manifestRegistry.getIntegration('broken_json')).toBeUndefined()
    })

    it('skips directories without manifest.json', () => {
      const dir = path.join('/test', 'no-manifest')
      setDir(dir, [{ name: 'empty_dir', isDirectory: () => true }])

      manifestRegistry.load(dir)

      expect(manifestRegistry.getIntegration('empty_dir')).toBeUndefined()
    })
  })

  describe('ManifestRegistry lookups', () => {
    beforeEach(() => {
      const dir = path.join('/test', 'lookups')
      const manifest = makeManifest('lookup_wiki')
      setDir(dir, [{ name: 'lookup_wiki', isDirectory: () => true }])
      setFile(path.join(dir, 'lookup_wiki', 'manifest.json'), JSON.stringify(manifest))
      manifestRegistry.load(dir)
    })

    it('getIntegration returns integration by ID', () => {
      const integration = manifestRegistry.getIntegration('lookup_wiki')
      expect(integration).toBeDefined()
      expect(integration?.name).toBe('Wikipedia')
    })

    it('getIntegration returns undefined for unknown ID', () => {
      expect(manifestRegistry.getIntegration('totally_nonexistent_xyz')).toBeUndefined()
    })

    it('getAllIntegrations includes loaded integration', () => {
      const all = manifestRegistry.getAllIntegrations()
      const found = all.find((i) => i.id === 'lookup_wiki')
      expect(found).toBeDefined()
    })

    it('getBlock returns block by type', () => {
      const block = manifestRegistry.getBlock('lookup_wiki')
      expect(block).toBeDefined()
      expect(block?.name).toBe('Wikipedia')
    })

    it('getTool returns tool by ID', () => {
      const tool = manifestRegistry.getTool('lookup_wiki_search')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('Wikipedia Search')
    })

    it('getIntegrationForTool returns parent integration', () => {
      const integration = manifestRegistry.getIntegrationForTool('lookup_wiki_search')
      expect(integration).toBeDefined()
      expect(integration?.id).toBe('lookup_wiki')
    })

    it('hasManifestTool returns true for known tool', () => {
      expect(manifestRegistry.hasManifestTool('lookup_wiki_search')).toBe(true)
    })

    it('hasManifestTool returns false for unknown tool', () => {
      expect(manifestRegistry.hasManifestTool('totally_nonexistent_tool')).toBe(false)
    })
  })

  describe('getToolIdMappings', () => {
    it('returns tool ID to integration ID mapping', () => {
      const dir = path.join('/test', 'mappings')
      const manifest = makeManifest('map_wiki')
      setDir(dir, [{ name: 'map_wiki', isDirectory: () => true }])
      setFile(path.join(dir, 'map_wiki', 'manifest.json'), JSON.stringify(manifest))

      manifestRegistry.load(dir)

      const mappings = manifestRegistry.getToolIdMappings()
      expect(mappings.get('map_wiki_search')).toBe('map_wiki')
    })

    it('returns a copy (mutations do not affect registry)', () => {
      const dir = path.join('/test', 'mappings-copy')
      const manifest = makeManifest('copy_wiki')
      setDir(dir, [{ name: 'copy_wiki', isDirectory: () => true }])
      setFile(path.join(dir, 'copy_wiki', 'manifest.json'), JSON.stringify(manifest))

      manifestRegistry.load(dir)

      const mappings = manifestRegistry.getToolIdMappings()
      mappings.set('injected_tool', 'injected')

      expect(manifestRegistry.getIntegrationForTool('injected_tool')).toBeUndefined()
    })
  })

  describe('triggers', () => {
    it('registers trigger manifest when present', () => {
      const dir = path.join('/test', 'triggers')
      const manifest = {
        ...makeManifest('trigger_wiki'),
        trigger: {
          id: 'trigger_wiki_trigger',
          name: 'Wikipedia Webhook',
          provider: 'trigger_wiki',
          credentials: [],
          outputs: {},
        },
      }
      setDir(dir, [{ name: 'trigger_wiki', isDirectory: () => true }])
      setFile(path.join(dir, 'trigger_wiki', 'manifest.json'), JSON.stringify(manifest))

      manifestRegistry.load(dir)

      expect(manifestRegistry.getTrigger('trigger_wiki')).toBeDefined()
    })

    it('getAllTriggers includes registered triggers', () => {
      const dir = path.join('/test', 'all-triggers')
      const manifest = {
        ...makeManifest('all_trigger_wiki'),
        trigger: {
          id: 'all_trigger_wiki_trigger',
          name: 'Wikipedia Webhook',
          provider: 'all_trigger_wiki',
          credentials: [],
          outputs: {},
        },
      }
      setDir(dir, [{ name: 'all_trigger_wiki', isDirectory: () => true }])
      setFile(path.join(dir, 'all_trigger_wiki', 'manifest.json'), JSON.stringify(manifest))

      manifestRegistry.load(dir)

      const triggers = manifestRegistry.getAllTriggers()
      const found = triggers.find((t) => t.provider === 'all_trigger_wiki')
      expect(found).toBeDefined()
    })
  })

  describe('stats', () => {
    it('returns counts of loaded manifests', () => {
      const stats = manifestRegistry.stats()
      expect(typeof stats.integrations).toBe('number')
      expect(typeof stats.blocks).toBe('number')
      expect(typeof stats.tools).toBe('number')
      expect(typeof stats.triggers).toBe('number')
    })
  })
})
