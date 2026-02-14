/**
 * Output mapper for manifest-driven tool execution.
 *
 * Extracts fields from API response JSON using simplified dot-path notation.
 *
 * Supported path syntax:
 *   $                    → entire response
 *   $.field              → response.field
 *   $.data.nested        → response.data.nested
 *   $.items[0].name      → response.items[0].name
 *   $.items[*].title     → map over array, extract .title from each element
 */

import { createLogger } from '@sim/logger'

const logger = createLogger('OutputMapper')

/** Segment of a parsed path */
type PathSegment =
  | { type: 'key'; key: string }
  | { type: 'index'; index: number }
  | { type: 'wildcard' }

/** Parses a JSONPath-lite string into segments */
function parsePath(path: string): PathSegment[] {
  // Handle root reference
  if (path === '$') return []

  // Strip leading "$."
  const normalized = path.startsWith('$.') ? path.slice(2) : path

  const segments: PathSegment[] = []
  const parts = normalized.split('.')

  for (const part of parts) {
    // Check for array index: items[0]
    const indexMatch = part.match(/^(\w+)\[(\d+|\*)\]$/)
    if (indexMatch) {
      segments.push({ type: 'key', key: indexMatch[1] })
      if (indexMatch[2] === '*') {
        segments.push({ type: 'wildcard' })
      } else {
        segments.push({ type: 'index', index: Number.parseInt(indexMatch[2], 10) })
      }
    } else if (part === '[*]') {
      segments.push({ type: 'wildcard' })
    } else {
      segments.push({ type: 'key', key: part })
    }
  }

  return segments
}

/**
 * Resolves a value from a JSON object using parsed path segments.
 *
 * @param data - The source JSON data
 * @param segments - Parsed path segments
 * @returns The resolved value, or undefined if path doesn't match
 */
function resolveSegments(data: unknown, segments: PathSegment[]): unknown {
  let current: unknown = data

  for (let i = 0; i < segments.length; i++) {
    if (current === undefined || current === null) return undefined

    const segment = segments[i]

    switch (segment.type) {
      case 'key': {
        if (typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[segment.key]
        break
      }
      case 'index': {
        if (!Array.isArray(current)) return undefined
        current = current[segment.index]
        break
      }
      case 'wildcard': {
        if (!Array.isArray(current)) return undefined
        // Remaining segments are applied to each array element
        const remainingSegments = segments.slice(i + 1)
        if (remainingSegments.length === 0) return current
        return current.map((item) => resolveSegments(item, remainingSegments))
      }
    }
  }

  return current
}

/**
 * Resolves a single JSONPath-lite expression against response data.
 *
 * @param data - The API response JSON
 * @param path - JSONPath-lite expression (e.g. "$.data.results")
 * @returns The resolved value
 */
export function resolvePath(data: unknown, path: string): unknown {
  if (path === '$') return data

  const segments = parsePath(path)
  return resolveSegments(data, segments)
}

/**
 * Maps an API response to a structured output using a mapping spec.
 *
 * @param data - The raw API response JSON
 * @param mapping - Record of output field names to JSONPath-lite expressions
 * @returns Mapped output record
 *
 * @example
 * ```ts
 * mapOutput(apiResponse, {
 *   results: '$.data.items',
 *   total: '$.meta.total_count',
 *   query: '$.query',
 * })
 * ```
 */
export function mapOutput(
  data: unknown,
  mapping: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [outputKey, path] of Object.entries(mapping)) {
    try {
      const value = resolvePath(data, path)
      if (value !== undefined) {
        result[outputKey] = value
      }
    } catch (error) {
      logger.warn(`Failed to resolve output mapping "${outputKey}" with path "${path}"`, {
        error,
      })
    }
  }

  return result
}
