import {
  drizzleOrmMock,
  loggerMock,
  setupGlobalFetchMock,
} from '@sim/testing'
import { afterAll, vi } from 'vitest'

setupGlobalFetchMock()

vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/logger', () => loggerMock)

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: unknown[]) => {
  if (args[0] === 'Workflow execution failed:' && (args[1] as Error)?.message === 'Test error') {
    return
  }
  originalConsoleError(...args)
}

console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleWarn(...args)
}

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})
