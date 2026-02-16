import path from 'path'
/// <reference types="vitest" />
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'integrations/**/*.test.{ts,tsx}', 'sdk/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        useAtomics: true,
        isolate: true,
      },
    },
    fileParallelism: true,
    maxConcurrency: 20,
    testTimeout: 10000,
  },
  resolve: {
    alias: [
      { find: '@/', replacement: path.resolve(__dirname, 'src/') },
      { find: '@sdk/', replacement: path.resolve(__dirname, 'sdk/') },
    ],
  },
})
