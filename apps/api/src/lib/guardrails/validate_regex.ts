/**
 * Validate if input matches a regex pattern
 */
export function validateRegex(
  input: string,
  pattern: string
): { passed: boolean; error?: string } {
  try {
    const regex = new RegExp(pattern)
    const passed = regex.test(input)
    return { passed, error: passed ? undefined : `Input does not match pattern: ${pattern}` }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid regex'
    return { passed: false, error: `Invalid regex pattern: ${message}` }
  }
}
