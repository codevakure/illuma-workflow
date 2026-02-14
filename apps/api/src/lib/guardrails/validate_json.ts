/**
 * Validate if input is valid JSON
 */
export function validateJson(input: string): { passed: boolean; error?: string } {
  try {
    JSON.parse(input)
    return { passed: true }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    return { passed: false, error: `Invalid JSON: ${message}` }
  }
}
