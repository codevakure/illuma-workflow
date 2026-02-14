/**
 * Organization utility stubs
 */

import type { Organization } from './types'

/**
 * Get the role of a user in an organization
 */
export function getUserRole(
  organization: Organization | null | undefined,
  userEmail?: string
): string {
  if (!userEmail || !organization?.members) {
    return 'member'
  }
  const currentMember = organization.members.find((m) => m.user?.email === userEmail)
  return currentMember?.role ?? 'member'
}

/**
 * Check if a user is an admin or owner in an organization
 */
export function isAdminOrOwner(
  organization: Organization | null | undefined,
  userEmail?: string
): boolean {
  const role = getUserRole(organization, userEmail)
  return role === 'admin' || role === 'owner'
}

/**
 * Calculate seat usage for an organization
 */
export function calculateSeatUsage(
  _members: Array<{ role: string }>,
  _maxSeats: number
): { used: number; max: number; available: number } {
  return { used: 0, max: 0, available: 0 }
}

/**
 * Get the number of used seats in an organization
 */
export function getUsedSeats(_members: Array<{ role: string }>): number {
  return 0
}

/**
 * Generate a slug from a name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Validate a slug format
 */
export function validateSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)
}

/**
 * Validate an email address format
 */
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
