/**
 * Storage client stubs for client-side compilation.
 */
export function getFileMetadata(..._args: unknown[]): unknown {
  throw new Error('getFileMetadata is only available on the server')
}

export function getServePathPrefix(): string {
  return '/api/files'
}

export function getStorageProvider(): unknown {
  throw new Error('getStorageProvider is only available on the server')
}
