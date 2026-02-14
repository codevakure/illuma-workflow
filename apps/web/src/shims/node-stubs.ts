/**
 * Browser stubs for Node.js modules imported by server-side code.
 * These functions are never called in the browser — they exist only
 * to prevent import errors when server-side tool code is bundled.
 */

// zlib
export function gzipSync() { return new Uint8Array() }
export function gunzipSync() { return new Uint8Array() }
export function deflateSync() { return new Uint8Array() }
export function inflateSync() { return new Uint8Array() }

// dns
export function resolve() {}
export function lookup() {}
export function resolve4() {}
export function resolve6() {}

// util
export function promisify(fn: unknown) { return fn }
export function inspect() { return '' }
export function format() { return '' }
export function deprecate(fn: unknown) { return fn }
export function inherits() {}
export function isDeepStrictEqual() { return false }

// http / https
export function request() {}
export function get() {}
export function createServer() {}
export const Agent = class {}
export const Server = class {}
export const globalAgent = {}

// net
export function connect() {}
export function createConnection() {}
export function isIP() { return 0 }
export function isIPv4() { return false }
export function isIPv6() { return false }
export const Socket = class {}
export type LookupFunction = (hostname: string, options: unknown, callback: unknown) => void

// os
export function platform() { return 'browser' }
export function hostname() { return 'localhost' }
export function tmpdir() { return '/tmp' }
export function homedir() { return '/' }
export function cpus() { return [] }
export function totalmem() { return 0 }
export function freemem() { return 0 }
export const EOL = '\n'

// stream
export const Readable = class {}
export const Writable = class {}
export const Transform = class {}
export const PassThrough = class {}
export const Duplex = class {}
export const pipeline = () => {}
export const finished = () => {}

// events
export class EventEmitter {
  on() { return this }
  off() { return this }
  once() { return this }
  emit() { return false }
  addListener() { return this }
  removeListener() { return this }
  removeAllListeners() { return this }
  listeners() { return [] }
  listenerCount() { return 0 }
}

// buffer (if needed)
export const Buffer = globalThis.Buffer ?? {
  from: () => new Uint8Array(),
  alloc: (size: number) => new Uint8Array(size),
  isBuffer: () => false,
  concat: () => new Uint8Array(),
}

export default {}
