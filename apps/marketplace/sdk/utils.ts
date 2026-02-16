/**
 * Validates that a URL is safe to call (no SSRF).
 * Blocks private IPs, localhost, and link-local addresses.
 */
export function validateUrl(url: string): void {
  const parsed = new URL(url)

  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']
  if (blockedHosts.includes(parsed.hostname)) {
    throw new Error(`Blocked request to localhost: ${parsed.hostname}`)
  }

  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
  ]

  for (const range of privateRanges) {
    if (range.test(parsed.hostname)) {
      throw new Error(`Blocked request to private IP: ${parsed.hostname}`)
    }
  }
}

/**
 * Makes an HTTP request with standard error handling.
 * Returns the parsed JSON response.
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  validateUrl(url)

  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  return (await response.json()) as T
}

/**
 * Makes an HTTP request and returns the raw text response.
 */
export async function httpRequestText(url: string, options: RequestInit = {}): Promise<string> {
  validateUrl(url)

  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  return response.text()
}
