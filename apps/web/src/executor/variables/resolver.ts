/**
 * Variable resolver stub for client-side compilation.
 */
export class VariableResolver {
  constructor(_config?: unknown) {}
  resolve(_template: string, _context?: unknown): string {
    throw new Error('VariableResolver is only available on the server')
  }
}
