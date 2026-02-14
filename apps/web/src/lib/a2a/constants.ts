/**
 * A2A protocol constants
 */

export const A2A_PROTOCOL_VERSION = '0.3.0'

export const A2A_DEFAULT_TIMEOUT = 300_000

export const A2A_MAX_HISTORY_LENGTH = 100

export const A2A_DEFAULT_CAPABILITIES = {
  streaming: true,
  pushNotifications: false,
  stateTransitionHistory: true,
} as const

export const A2A_TERMINAL_STATES = ['completed', 'failed', 'canceled'] as const
