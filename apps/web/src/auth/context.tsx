import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface User {
  id: string
  email?: string
  name?: string
}

interface SessionContextValue {
  user: User | null
  jwt: string | null
  isLoading: boolean
  isAuthenticated: boolean
  login: () => void
  logout: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

const SESSION_MANAGER_URL = import.meta.env.VITE_SESSION_MANAGER_URL || 'http://localhost:3003'

interface SessionProviderProps {
  children: ReactNode
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [jwt, setJwt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Try to get JWT from session-manager
    async function fetchSession() {
      try {
        const response = await fetch(`${SESSION_MANAGER_URL}/api/token`, {
          credentials: 'include',
        })

        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data?.token) {
            setJwt(data.data.token)
            setUser({
              id: data.data.payload?.sub || 'unknown',
              email: data.data.payload?.email,
              name: data.data.payload?.name,
            })
          }
        }
      } catch (error) {
        console.log('[Session] Could not fetch session from session-manager:', error)
        // In dev mode, use a placeholder user
        if (import.meta.env.DEV) {
          console.log('[Session] Using placeholder user for development')
          setUser({ id: 'test-user-id', email: 'test@example.com', name: 'Test User' })
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchSession()
  }, [])

  const login = () => {
    const callbackUrl = encodeURIComponent(`${window.location.origin}/auth/callback`)
    window.location.href = `${SESSION_MANAGER_URL}/login?client_id=sim&callback=${callbackUrl}`
  }

  const logout = () => {
    setUser(null)
    setJwt(null)
    // Optionally redirect to session-manager logout
    window.location.href = `${SESSION_MANAGER_URL}/logout?callback=${encodeURIComponent(window.location.origin)}`
  }

  return (
    <SessionContext.Provider
      value={{
        user,
        jwt,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
