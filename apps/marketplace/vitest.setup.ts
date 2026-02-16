import { afterAll, vi } from 'vitest'

/** Global fetch mock for handler tests */
const originalFetch = globalThis.fetch

vi.stubGlobal(
  'fetch',
  vi.fn().mockRejectedValue(new Error('fetch is not mocked for this test'))
)

const originalConsoleError = console.error

console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('fetch is not mocked')) {
    return
  }
  originalConsoleError(...args)
}

afterAll(() => {
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})
