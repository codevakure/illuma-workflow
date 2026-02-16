/**
 * @vitest-environment node
 */
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fs and fs/promises before importing
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
}))

vi.mock('./lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import type { ToolHandler } from '../sdk/types'
import {
  getHandler,
  getHandlerCount,
  getHandlerForTool,
  getIntegrationForTool,
  getLoadedIntegrations,
  loadHandlers,
} from './handler-loader'

const mockExistsSync = vi.mocked(existsSync)
const mockReaddir = vi.mocked(readdir)

function createMockHandler(operations: Record<string, unknown> = {}): ToolHandler {
  return {
    operations: Object.fromEntries(
      Object.entries(operations).map(([k, v]) => [k, typeof v === 'function' ? v : vi.fn()])
    ),
  } as ToolHandler
}

describe('handler-loader', () => {
  const integrationsDir = '/mock/integrations'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('loadHandlers', () => {
    it('loads handler.ts files from integration directories', async () => {
      const mockHandler = createMockHandler({ search: vi.fn() })

      mockReaddir.mockResolvedValue([
        { name: 'wikipedia', isDirectory: () => true },
        { name: 'slack', isDirectory: () => true },
      ] as never)

      mockExistsSync.mockImplementation((p: unknown) => {
        const pathStr = String(p)
        return pathStr.includes('wikipedia') && pathStr.includes('handler.ts')
      })

      // Mock dynamic import
      vi.doMock(resolve(integrationsDir, 'wikipedia', 'handler.ts'), () => ({
        default: mockHandler,
      }))

      const toolIdMappings = new Map([['wikipedia_search', 'wikipedia']])
      await loadHandlers(integrationsDir, toolIdMappings)

      expect(getHandlerCount()).toBe(1)
      expect(getHandler('wikipedia')).toBeDefined()
      expect(getHandlerForTool('wikipedia_search')).toBeDefined()
    })

    it('skips directories starting with underscore', async () => {
      mockReaddir.mockResolvedValue([
        { name: '_internal', isDirectory: () => true },
        { name: 'wikipedia', isDirectory: () => true },
      ] as never)

      mockExistsSync.mockReturnValue(false)

      const toolIdMappings = new Map<string, string>()
      await loadHandlers(integrationsDir, toolIdMappings)

      expect(getHandlerCount()).toBe(0)
    })

    it('skips non-directory entries', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'readme.md', isDirectory: () => false },
      ] as never)

      const toolIdMappings = new Map<string, string>()
      await loadHandlers(integrationsDir, toolIdMappings)

      expect(getHandlerCount()).toBe(0)
    })

    it('skips directories without handler.ts', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'wikipedia', isDirectory: () => true },
      ] as never)

      mockExistsSync.mockReturnValue(false)

      const toolIdMappings = new Map<string, string>()
      await loadHandlers(integrationsDir, toolIdMappings)

      expect(getHandlerCount()).toBe(0)
    })

    it('skips handlers that fail validation (no operations)', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'bad', isDirectory: () => true },
      ] as never)

      mockExistsSync.mockReturnValue(true)

      vi.doMock(resolve(integrationsDir, 'bad', 'handler.ts'), () => ({
        default: { notOperations: {} },
      }))

      const toolIdMappings = new Map<string, string>()
      await loadHandlers(integrationsDir, toolIdMappings)

      expect(getHandlerCount()).toBe(0)
    })

    it('handles import errors gracefully', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'broken', isDirectory: () => true },
      ] as never)

      mockExistsSync.mockReturnValue(true)

      vi.doMock(resolve(integrationsDir, 'broken', 'handler.ts'), () => {
        throw new Error('Syntax error in handler')
      })

      const toolIdMappings = new Map<string, string>()
      await loadHandlers(integrationsDir, toolIdMappings)

      expect(getHandlerCount()).toBe(0)
    })

    it('clears previous handlers on reload', async () => {
      mockReaddir.mockResolvedValue([] as never)

      const toolIdMappings = new Map<string, string>()

      // First load
      await loadHandlers(integrationsDir, toolIdMappings)
      expect(getHandlerCount()).toBe(0)

      // Second load should also be clean
      await loadHandlers(integrationsDir, toolIdMappings)
      expect(getHandlerCount()).toBe(0)
    })

    it('only maps tool IDs for integrations with loaded handlers', async () => {
      mockReaddir.mockResolvedValue([] as never)

      const toolIdMappings = new Map([
        ['slack_message', 'slack'],
        ['wikipedia_search', 'wikipedia'],
      ])

      await loadHandlers(integrationsDir, toolIdMappings)

      // No handlers loaded, so tool ID mappings should be empty
      expect(getIntegrationForTool('slack_message')).toBeUndefined()
      expect(getIntegrationForTool('wikipedia_search')).toBeUndefined()
    })
  })

  describe('getHandler', () => {
    it('returns undefined for unknown integration', () => {
      expect(getHandler('nonexistent')).toBeUndefined()
    })
  })

  describe('getHandlerForTool', () => {
    it('returns undefined for unknown tool ID', () => {
      expect(getHandlerForTool('nonexistent_tool')).toBeUndefined()
    })
  })

  describe('getIntegrationForTool', () => {
    it('returns undefined for unknown tool ID', () => {
      expect(getIntegrationForTool('nonexistent_tool')).toBeUndefined()
    })
  })

  describe('getLoadedIntegrations', () => {
    it('returns empty array when no handlers loaded', async () => {
      mockReaddir.mockResolvedValue([] as never)
      await loadHandlers(integrationsDir, new Map())

      expect(getLoadedIntegrations()).toEqual([])
    })
  })
})
