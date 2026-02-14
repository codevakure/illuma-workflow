/**
 * File tool processor stub for client-side compilation.
 */

export class FileToolProcessor {
  constructor(_config?: unknown) {}

  static hasFileOutputs(_tool: unknown): boolean {
    return false
  }

  static async processToolOutputs(
    _output: unknown,
    _tool: unknown,
    _context?: unknown
  ): Promise<Record<string, any>> {
    throw new Error('FileToolProcessor is only available on the server')
  }

  async processFiles(..._args: unknown[]): Promise<unknown> {
    throw new Error('FileToolProcessor is only available on the server')
  }
}
