import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { cn } from '@/lib/core/utils/cn'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatConfig {
  id: string
  title: string
  description: string
  customizations: {
    primaryColor?: string
    logoUrl?: string
    imageUrl?: string
    welcomeMessage?: string
    headerText?: string
  } | null
  authType?: 'public' | 'password' | 'email'
  outputConfigs?: Array<{ blockId: string; path?: string }> | null
}

const CHAT_REQUEST_TIMEOUT_MS = 120_000

/**
 * Public chat widget page.
 * Communicates with the API at /api/chat/:identifier.
 */
export default function ChatPage() {
  const { identifier } = useParams<{ identifier: string }>()
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigLoading, setIsConfigLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState<'password' | 'email' | null>(null)
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const conversationId = useRef(crypto.randomUUID())
  const abortControllerRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const fetchChatConfig = useCallback(async () => {
    if (!identifier) return
    setIsConfigLoading(true)
    try {
      const response = await fetch(`/api/chat/${identifier}`, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      if (!response.ok) {
        if (response.status === 401) {
          const errorData = await response.json()
          if (errorData.error === 'auth_required_password') {
            setAuthRequired('password')
            setIsConfigLoading(false)
            return
          }
          if (errorData.error === 'auth_required_email') {
            setAuthRequired('email')
            setIsConfigLoading(false)
            return
          }
        }
        throw new Error(`Failed to load chat configuration: ${response.status}`)
      }

      setAuthRequired(null)
      const data = await response.json()
      setConfig(data)

      if (data?.customizations?.welcomeMessage) {
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content: data.customizations.welcomeMessage,
            timestamp: new Date(),
          },
        ])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat is currently unavailable.')
    } finally {
      setIsConfigLoading(false)
    }
  }, [identifier])

  useEffect(() => {
    fetchChatConfig()
    conversationId.current = crypto.randomUUID()
  }, [fetchChatConfig])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleAuthSubmit = useCallback(async () => {
    if (!identifier) return
    setAuthSubmitting(true)
    setAuthError(null)

    try {
      const body: Record<string, string> = {}
      if (authRequired === 'password') body.password = password
      if (authRequired === 'email') body.email = email

      const response = await fetch(`/api/chat/${identifier}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Authentication failed')
      }

      setAuthRequired(null)
      setPassword('')
      setEmail('')
      await fetchChatConfig()
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setAuthSubmitting(false)
    }
  }, [identifier, authRequired, password, email, fetchChatConfig])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !identifier || isLoading) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, CHAT_REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`/api/chat/${identifier}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          input: userMessage.content,
          conversationId: conversationId.current,
        }),
        credentials: 'same-origin',
        signal: abortController.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.error || 'Failed to get response')
      }

      if (!response.body) {
        throw new Error('Response body is missing')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      const assistantId = crypto.randomUUID()

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', timestamp: new Date() },
      ])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'content' || data.content) {
                assistantContent += data.content || data.text || ''
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: assistantContent } : m
                  )
                )
              }
            } catch {
              /* ignore parse errors for non-JSON SSE lines */
            }
          }
        }
      }

      if (!assistantContent) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: 'I received your message but had no response to generate.' }
              : m
          )
        )
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setIsLoading(false)
        return
      }
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }, [input, identifier, isLoading])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  const primaryColor = config?.customizations?.primaryColor || '#6f3dfa'

  // Error state
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Chat Unavailable</h2>
          <p className="text-sm text-[var(--text-secondary)]">{error}</p>
        </div>
      </div>
    )
  }

  // Auth required state
  if (authRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
        <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <svg className="h-6 w-6" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-[var(--text-primary)]">Authentication Required</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {authRequired === 'password'
                ? 'Enter the password to access this chat.'
                : 'Enter your email to access this chat.'}
            </p>
          </div>

          <div className="space-y-4">
            {authRequired === 'password' ? (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAuthSubmit()}
                placeholder="Enter password"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-5)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-1)] focus:outline-none"
                autoFocus
              />
            ) : (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAuthSubmit()}
                placeholder="Enter your email"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-5)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-1)] focus:outline-none"
                autoFocus
              />
            )}

            {authError && (
              <p className="text-center text-sm text-red-500">{authError}</p>
            )}

            <button
              onClick={handleAuthSubmit}
              disabled={authSubmitting || (authRequired === 'password' ? !password : !email)}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: primaryColor }}
            >
              {authSubmitting ? 'Verifying...' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Loading state
  if (isConfigLoading || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-1)] border-t-[var(--text-primary)]" />
          <p className="text-sm text-[var(--text-secondary)]">Loading chat...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg)]">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 shadow-sm">
        {config.customizations?.logoUrl && (
          <img
            src={config.customizations.logoUrl}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium text-[var(--text-primary)]">
            {config.customizations?.headerText || config.title}
          </h1>
          {config.description && (
            <p className="truncate text-xs text-[var(--text-secondary)]">{config.description}</p>
          )}
        </div>
      </header>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ backgroundColor: `${primaryColor}15` }}
              >
                <svg className="h-7 w-7" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="mb-1 text-base font-medium text-[var(--text-primary)]">
                {config.title}
              </h2>
              <p className="max-w-sm text-sm text-[var(--text-secondary)]">
                {config.description || 'Send a message to get started.'}
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              data-message-id={message.id}
              className={cn(
                'flex',
                message.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  message.role === 'user'
                    ? 'text-white'
                    : 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-primary)]'
                )}
                style={
                  message.role === 'user'
                    ? { backgroundColor: primaryColor }
                    : undefined
                }
              >
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
                {message.content === '' && message.role === 'assistant' && (
                  <div className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '0ms' }} />
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '150ms' }} />
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                <div className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '0ms' }} />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '150ms' }} />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--border)] bg-[var(--surface-2)] p-3 pb-4 md:p-4 md:pb-6">
        <div className="relative mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-5)] p-2 transition-colors focus-within:border-[var(--border-1)]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              disabled={isLoading}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: primaryColor }}
              aria-label="Send message"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
