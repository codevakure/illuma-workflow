'use client'

import type React from 'react'
import { createContext, useCallback, useMemo, useState } from 'react'

export type AppSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name?: string | null
    image?: string | null
    createdAt?: Date
    updatedAt?: Date
  } | null
  session?: {
    id?: string
    userId?: string
    activeOrganizationId?: string
  }
} | null

export type SessionHookResult = {
  data: AppSession
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export const SessionContext = createContext<SessionHookResult | null>(null)

const PLACEHOLDER_SESSION: AppSession = {
  user: {
    id: 'test-user-id',
    email: 'test@test.com',
    name: 'Test User',
    image: null,
  },
  session: {
    id: 'test-session-id',
    userId: 'test-user-id',
  },
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data] = useState<AppSession>(PLACEHOLDER_SESSION)

  const refetch = useCallback(async () => {
    // Placeholder: no-op
  }, [])

  const value = useMemo<SessionHookResult>(
    () => ({ data, isPending: false, error: null, refetch }),
    [data, refetch]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
