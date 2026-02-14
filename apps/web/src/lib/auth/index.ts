/**
 * Auth barrel export - stub for frontend
 * Real auth runs on API server
 */
export type AnonymousSession = { userId: string; isAnonymous: true }
export type AuthResult = { userId: string; isAuthenticated: boolean }

export const ANONYMOUS_USER_ID = 'anonymous'
export const ANONYMOUS_USER = { id: ANONYMOUS_USER_ID, name: 'Anonymous', email: '' }

export async function createAnonymousSession() { return { userId: ANONYMOUS_USER_ID } }
export async function ensureAnonymousUserExists() {}
export async function getSession() { return null }
export async function signIn() {}
export async function signUp() {}
export const auth = {} as Record<string, unknown>
export async function checkHybridAuth() { return { userId: 'test-user-id' } }
export async function checkInternalAuth() { return { valid: true } }
export async function checkSessionOrInternalAuth() { return { userId: 'test-user-id' } }
