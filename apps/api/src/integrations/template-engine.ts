/**
 * Template interpolation engine for manifest-driven tool execution.
 *
 * Replaces `{{params.key}}` placeholders in URL, header, and body strings
 * with actual parameter values. Supports default values and URL encoding.
 *
 * Syntax:
 *   {{params.query}}                  → params.query value
 *   {{params.limit|default:10}}       → params.limit or "10"
 *   {{params.query|urlencode}}        → URL-encoded value
 *   {{params.key|urlencode|default:}} → chained modifiers
 */

import { createLogger } from '@sim/logger'

const logger = createLogger('TemplateEngine')

const TEMPLATE_PATTERN = /\{\{params\.(\w+)((?:\|[^}]+)*)\}\}/g

interface Modifier {
  name: string
  arg?: string
}

/** Parses modifier chain like "|urlencode|default:10" into structured modifiers */
function parseModifiers(raw: string): Modifier[] {
  if (!raw) return []
  return raw
    .split('|')
    .filter(Boolean)
    .map((seg) => {
      const colonIdx = seg.indexOf(':')
      if (colonIdx === -1) return { name: seg }
      return { name: seg.slice(0, colonIdx), arg: seg.slice(colonIdx + 1) }
    })
}

/** Applies a single modifier to a value */
function applyModifier(value: string, mod: Modifier): string {
  switch (mod.name) {
    case 'urlencode':
      return encodeURIComponent(value)
    case 'default':
      return value || mod.arg || ''
    case 'lower':
      return value.toLowerCase()
    case 'upper':
      return value.toUpperCase()
    case 'trim':
      return value.trim()
    default:
      logger.warn(`Unknown template modifier: ${mod.name}`)
      return value
  }
}

/**
 * Interpolates a template string, replacing `{{params.x}}` with values from `params`.
 *
 * @param template - The template string containing `{{params.x}}` placeholders
 * @param params - Key-value map of parameter values
 * @returns The interpolated string
 */
export function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(TEMPLATE_PATTERN, (_match, key: string, modifierChain: string) => {
    let value = params[key]

    // Convert non-string values to string representation
    if (value === undefined || value === null) {
      value = ''
    } else if (typeof value !== 'string') {
      value = String(value)
    }

    const modifiers = parseModifiers(modifierChain)
    let result = value as string
    for (const mod of modifiers) {
      result = applyModifier(result, mod)
    }

    return result
  })
}

/**
 * Interpolates all string values in an object (shallow — one level deep).
 * Non-string values are passed through unchanged.
 *
 * @param obj - Object whose string values may contain templates
 * @param params - Key-value map of parameter values
 * @returns New object with interpolated string values
 */
export function interpolateObject<T extends Record<string, unknown>>(
  obj: T,
  params: Record<string, unknown>
): T {
  const result = { ...obj } as Record<string, unknown>
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      result[key] = interpolate(value, params)
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = interpolateObject(value as Record<string, unknown>, params)
    }
  }
  return result as T
}

/**
 * Builds a query string from a template spec and params.
 *
 * @param querySpec - Record of query param names to template strings
 * @param params - Key-value map of parameter values
 * @returns URL query string (without leading ?)
 */
export function buildQueryString(
  querySpec: Record<string, string>,
  params: Record<string, unknown>
): string {
  const parts: string[] = []
  for (const [key, template] of Object.entries(querySpec)) {
    const value = interpolate(template, params)
    if (value) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
  }
  return parts.join('&')
}
