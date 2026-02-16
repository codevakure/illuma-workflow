/// <reference types="vitest" />
import path from 'path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, 'src') + '/',
      '@sim/logger': path.resolve(__dirname, 'src/lib/logger.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
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
})
