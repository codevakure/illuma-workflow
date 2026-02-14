/**
 * User color palette matching terminal.tsx RUN_ID_COLORS
 * These colors are used consistently across cursors, avatars, and terminal run IDs
 */
export const USER_COLORS = [
  '#4ADE80', // Green
  '#F472B6', // Pink
  '#60C5FF', // Blue
  '#FF8533', // Orange
  '#C084FC', // Purple
  '#FCD34D', // Yellow
] as const

/**
 * Get a deterministic color for a user based on their ID or index
 */
export function getUserColor(userIdOrIndex: string | number): string {
  if (typeof userIdOrIndex === 'number') {
    return USER_COLORS[userIdOrIndex % USER_COLORS.length]
  }

  let hash = 0
  for (let i = 0; i < userIdOrIndex.length; i++) {
    const char = userIdOrIndex.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }

  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}
