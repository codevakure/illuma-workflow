/**
 * Permission type definitions for workspace permissions.
 * Server-side permission checking functions require @sim/db and are not available in the web client.
 */

export type PermissionType = 'admin' | 'write' | 'read'
