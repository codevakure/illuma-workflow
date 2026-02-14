/**
 * Organization types
 */

export interface User {
  id: string
  email: string
  name: string
  image?: string | null
}

export interface Member {
  id: string
  userId: string
  role: string
  user?: User
}

export interface Organization {
  id: string
  name: string
  slug: string
  members?: Member[]
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
}

export interface Subscription {
  id: string
  plan: string
  status: string
  referenceId: string
  seats: number | null
}

export interface Invitation {
  id: string
  email: string
  role: string
  status: string
}

export interface WorkspaceInvitation {
  id: string
  email: string
  workspaceId: string
}

export interface MemberUsageData {
  userId: string
  currentUsage: number
  totalCost: number
}

export interface OrganizationBillingData {
  plan: string
  seats: number
  orgUsageLimit: number
}

export interface OrganizationFormData {
  name: string
  slug: string
}
