const API_URL = import.meta.env.VITE_API_URL || ''

interface ApiClientOptions {
  jwt?: string | null
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string>
}

class ApiClient {
  private jwt: string | null = null

  setJwt(jwt: string | null) {
    this.jwt = jwt
  }

  async fetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, ...fetchOptions } = options

    let url = `${API_URL}${path}`
    if (params) {
      const searchParams = new URLSearchParams(params)
      url += `?${searchParams.toString()}`
    }

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    // Add auth header if we have a JWT
    if (this.jwt) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.jwt}`
    }

    // For dev mode without session-manager, add test user header
    if (import.meta.env.DEV && !this.jwt) {
      (headers as Record<string, string>)['X-Test-User-Id'] = 'test-user-id'
    }

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    })

    if (response.status === 401) {
      // Token expired or invalid
      console.warn('[API] Unauthorized - redirecting to login')
      // Could trigger a re-auth flow here
    }

    const data = await response.json()

    if (!response.ok) {
      throw new ApiError(data.error || 'Request failed', response.status, data)
    }

    return data as T
  }

  // Convenience methods
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.fetch<T>(path, { ...options, method: 'GET' })
  }

  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.fetch<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.fetch<T>(path, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.fetch<T>(path, { ...options, method: 'DELETE' })
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiClient = new ApiClient()

// Hook to use API client with session
export function useApiClient() {
  // This could be enhanced to automatically inject JWT from session context
  return apiClient
}
