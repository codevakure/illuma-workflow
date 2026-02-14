/**
 * Server-side file utility stubs for client-side compilation.
 */
export async function downloadFileFromUrl(..._args: unknown[]): Promise<Buffer> {
  throw new Error('downloadFileFromUrl is only available on the server')
}

export async function downloadFileFromStorage(..._args: unknown[]): Promise<Buffer> {
  throw new Error('downloadFileFromStorage is only available on the server')
}
