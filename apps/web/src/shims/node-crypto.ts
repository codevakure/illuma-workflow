/**
 * Browser-compatible stub for Node.js crypto module.
 * Server-side tool code imports crypto but only executes on the API server.
 * This stub prevents runtime errors when the code is bundled for the browser.
 */

const noopDigest = (_encoding?: string) => ''
const noopUpdate = (_data: unknown) => ({ digest: noopDigest, update: noopUpdate })

export function createHmac(_algorithm: string, _key: unknown) {
  return { update: noopUpdate, digest: noopDigest }
}

export function createHash(_algorithm: string) {
  return { update: noopUpdate, digest: noopDigest }
}

export function createCipheriv(_algorithm: string, _key: unknown, _iv: unknown) {
  return { update: () => Buffer.alloc?.(0) ?? new Uint8Array(), final: () => Buffer.alloc?.(0) ?? new Uint8Array(), getAuthTag: () => Buffer.alloc?.(0) ?? new Uint8Array() }
}

export function createDecipheriv(_algorithm: string, _key: unknown, _iv: unknown) {
  return { update: () => Buffer.alloc?.(0) ?? new Uint8Array(), final: () => Buffer.alloc?.(0) ?? new Uint8Array(), setAuthTag: () => {} }
}

export function randomBytes(size: number): Uint8Array {
  const arr = new Uint8Array(size)
  globalThis.crypto.getRandomValues(arr)
  return arr
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

export function timingSafeEqual(a: unknown, b: unknown): boolean {
  return a === b
}

export function pbkdf2Sync() { return new Uint8Array() }
export function scryptSync() { return new Uint8Array() }

const cryptoStub = {
  createHmac,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  pbkdf2Sync,
  scryptSync,
  getHashes: () => ['sha256', 'sha512'],
  getCiphers: () => ['aes-256-gcm'],
}

export default cryptoStub
